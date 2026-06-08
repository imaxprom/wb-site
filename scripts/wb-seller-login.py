"""WB Seller Auth via Playwright — structured output.
Communicates with Node.js API via STATUS lines in /tmp/wb_auth_log.txt.

STATUS:{"state":"...","message":"..."}

States: sms_sent, blocked, code_error, code_expired, supplier_select, success, failed
"""
from playwright.sync_api import sync_playwright
import base64, json, time, sys, os, re, subprocess, urllib.request

PHONE = os.environ.get("WB_PHONE", "9641521652")
WEBSITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS_PATH = os.path.join(WEBSITE_DIR, "data", "wb-tokens.json")
ENV_PATH = os.path.join(WEBSITE_DIR, ".env.production.local")
LOG_PATH = "/tmp/wb_auth_log.txt"
SMS_CODE_PATH = "/tmp/wb_sms_code"
SUPPLIER_CHOICE_PATH = "/tmp/wb_supplier_choice"

def load_env_file(path):
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                key, value = stripped.split("=", 1)
                key = key.strip()
                value = value.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = value
    except Exception:
        pass

def write_secret_json(path, data):
    data_dir = os.path.dirname(path)
    os.makedirs(data_dir, mode=0o700, exist_ok=True)
    try:
        os.chmod(data_dir, 0o700)
    except OSError:
        pass

    tmp_path = os.path.join(
        data_dir,
        f".{os.path.basename(path)}.{os.getpid()}.{int(time.time() * 1000)}.tmp",
    )
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, path)
        os.chmod(path, 0o600)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def sync_review_account_tokens(tokens, cookies_dict):
    supplier_id = str(tokens.get("supplierId") or "")
    if not supplier_id:
        return

    validation_key = cookies_dict.get("wbx-validation-key") or ""
    load_env_file(ENV_PATH)
    if not os.environ.get("DATABASE_URL"):
        print("Review account token sync skipped: DATABASE_URL is not set")
        return

    payload = {
        "supplierId": supplier_id,
        "authorizev3": tokens.get("authorizev3") or "",
        "validationKey": validation_key,
        "wbSellerLk": tokens.get("wbSellerLk") or "",
    }
    js = """
const { Pool } = require("pg");
const payload = JSON.parse(process.argv[1]);
(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    application_name: "mphub-wb-seller-login",
  });
  try {
    const result = await pool.query(`
      UPDATE review_accounts
         SET wb_authorize_v3 = $1,
             wb_validation_key = COALESCE(NULLIF($2, ''), wb_validation_key),
             wb_seller_lk = COALESCE(NULLIF($3, ''), wb_seller_lk),
             wb_cookie_updated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
       WHERE supplier_id = $4
    `, [payload.authorizev3, payload.validationKey, payload.wbSellerLk, payload.supplierId]);
    console.log(String(result.rowCount || 0));
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
"""
    try:
        result = subprocess.run(
            ["node", "-e", js, json.dumps(payload, ensure_ascii=False)],
            cwd=WEBSITE_DIR,
            text=True,
            capture_output=True,
            timeout=20,
            check=True,
        )
        if int((result.stdout or "0").strip() or "0") > 0:
            print("Review account tokens synced for supplierId", supplier_id)
    except Exception as exc:
        print("Review account token sync failed:", str(exc))

class TeeWriter:
    def __init__(self, *streams):
        self.streams = streams
    def write(self, data):
        for s in self.streams:
            s.write(data)
            s.flush()
    def flush(self):
        for s in self.streams:
            s.flush()

log_file = open(LOG_PATH, "w")
sys.stdout = TeeWriter(sys.__stdout__, log_file)
sys.stderr = TeeWriter(sys.__stderr__, log_file)

def status(state, **kwargs):
    """Write structured status line."""
    data = {"state": state, **kwargs}
    print("STATUS:" + json.dumps(data, ensure_ascii=False))

def cleanup():
    for f in [SMS_CODE_PATH, SUPPLIER_CHOICE_PATH]:
        try: os.unlink(f)
        except: pass

def wait_for_file(path, timeout=180):
    """Wait for file to appear and have content."""
    for _ in range(timeout):
        try:
            with open(path) as f:
                val = f.read().strip()
            if val:
                return val
        except FileNotFoundError:
            pass
        time.sleep(1)
    return None

def normalize_rate_limit_text(value):
    """Normalize common WB countdown text for the Node.js cooldown parser."""
    return (
        value.strip()
        .replace("hours", "ч.")
        .replace("hour", "ч.")
        .replace("hrs", "ч.")
        .replace("hr", "ч.")
        .replace("minutes", "мин.")
        .replace("minute", "мин.")
        .replace("mins", "мин.")
        .replace("min", "мин.")
        .replace("seconds", "сек.")
        .replace("second", "сек.")
        .replace("secs", "сек.")
        .replace("sec", "сек.")
    )

def extract_rate_limit_remaining(page_text):
    """Return WB retry countdown from Russian or English auth text."""
    patterns = [
        r"(?:request\s+a\s+new\s+code|new\s+code).*?\bin\s+((?:\d+\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\s*)+)",
        r"(?:запрос[а-яё\s]*код[а-яё\s]*(?:возможен|можно)|через)\s+((?:\d+\s*(?:час[а-яё]*|ч\.?|минут[а-яё]*|мин\.?|секунд[а-яё]*|сек\.?)\s*)+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, page_text, re.IGNORECASE)
        if match:
            return normalize_rate_limit_text(match.group(1))
    return None

def sanitize_debug_text(value):
    """Mask phone-like digit runs before writing diagnostic page state to logs."""
    return re.sub(r"\+?\d[\d\s().-]{7,}\d", "***", value)

def page_debug_state(page):
    try:
        text = sanitize_debug_text(page.inner_text("body")[:1200])
    except Exception as e:
        text = f"<body read error: {e}>"

    buttons = []
    for i, el in enumerate(page.query_selector_all("button")[:8]):
        try:
            buttons.append({
                "i": i,
                "type": el.get_attribute("type"),
                "text": sanitize_debug_text((el.inner_text() or "")[:80]),
                "visible": el.is_visible(),
                "enabled": el.is_enabled(),
            })
        except Exception as e:
            buttons.append({"i": i, "error": str(e)})

    inputs = []
    for i, el in enumerate(page.query_selector_all("input")[:8]):
        try:
            inputs.append({
                "i": i,
                "type": el.get_attribute("type"),
                "inputmode": el.get_attribute("inputmode"),
                "placeholder": el.get_attribute("placeholder"),
                "valueLen": len(el.input_value() or ""),
                "visible": el.is_visible(),
                "editable": el.is_editable(),
            })
        except Exception as e:
            inputs.append({"i": i, "error": str(e)})

    return {
        "url": page.url,
        "title": page.title(),
        "body": text,
        "inputs": inputs,
        "buttons": buttons,
    }

def has_sms_code_page(page_text):
    text = page_text.lower()
    return any(h in text for h in ["код", "code", "sms", "enter sms", "verification"])

def decode_jwt_payload(token):
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
    except Exception:
        return {}

def looks_like_access_token(token):
    if not token or len(token) < 100 or token.count(".") != 2:
        return False
    payload = decode_jwt_payload(token)
    return bool(payload.get("user") or payload.get("client_id") or payload.get("data"))

def refresh_seller_token(authorizev3, cookie_string):
    req = urllib.request.Request(
        "https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token",
        data=json.dumps({"params": {}, "jsonrpc": "2.0", "id": "json-rpc_1"}).encode(),
        headers={
            "content-type": "application/json",
            "authorizev3": authorizev3,
            "cookie": cookie_string,
            "origin": "https://seller.wildberries.ru",
            "referer": "https://seller.wildberries.ru/",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode())
    except Exception as e:
        print("    Seller token refresh failed:", e)
        return None

    token = (((data.get("result") or {}).get("data") or {}).get("token")
             or (data.get("result") or {}).get("token"))
    if not token:
        print("    Seller token refresh returned no token")
        return None

    payload = decode_jwt_payload(token)
    supplier_data = payload.get("data") or {}
    return {
        "wbSellerLk": token,
        "wbSellerLkExpires": payload.get("exp") or int(time.time()) + 300,
        "supplierId": supplier_data.get("Z-Sfid") or supplier_data.get("Z-Soid") or "",
        "supplierUuid": supplier_data.get("Z-Sid") or "",
    }

def capture_authorizev3(page):
    captured = {"token": ""}

    def on_request(request):
        try:
            headers = request.headers
            token = headers.get("authorizev3") or headers.get("Authorizev3") or headers.get("AuthorizeV3") or ""
            if looks_like_access_token(token):
                captured["token"] = token
        except Exception:
            pass

    page.on("request", on_request)

    targets = [
        "https://seller.wildberries.ru/feedbacks-questions/feedbacks",
        "https://seller.wildberries.ru/analytics/orders-stats",
        "https://seller.wildberries.ru/",
    ]
    for target in targets:
        try:
            page.goto(target, timeout=30000)
        except Exception:
            pass
        page.wait_for_timeout(5000)
        if captured["token"]:
            print("    Auth from request header len=", len(captured["token"]))
            return captured["token"]

    try:
        token = page.evaluate("""
            () => {
              for (const storage of [localStorage, sessionStorage]) {
                for (let i = 0; i < storage.length; i++) {
                  const key = storage.key(i);
                  const val = storage.getItem(key) || "";
                  if (val.startsWith("eyJ") && val.length > 100 && val.split(".").length === 3) return val;
                }
              }
              return "";
            }
        """)
        if looks_like_access_token(token):
            print("    Auth from browser storage len=", len(token))
            return token
    except Exception as e:
        print("    Storage token read failed:", e)

    return ""

def normalize_supplier_name(value):
    value = re.sub(r"\s+", " ", value or "").strip()
    value = value.replace("Индивидуальный предприниматель", "ИП")
    return value

def supplier_names_from_text(value):
    value = normalize_supplier_name(value)
    names = []

    for match in re.finditer(r"\bИП\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)?", value):
        names.append(normalize_supplier_name(match.group(0)))

    for match in re.finditer(r"\bООО\s+[«\"]?[^,\n]{2,60}", value):
        names.append(normalize_supplier_name(match.group(0).strip(" .")))

    result = []
    seen = set()
    for name in names:
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(name)
    return result

def collect_supplier_elements(page, header_only=False):
    items = []
    seen = set()
    for el in page.query_selector_all("*"):
        try:
            if not el.is_visible():
                continue
            names = supplier_names_from_text(el.inner_text())
            if not names:
                continue
            box = el.bounding_box()
            if not box:
                continue
            if header_only and not (box["x"] > 900 and box["y"] < 90):
                continue
            for name in names:
                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)
                items.append({"name": name, "x": box["x"], "y": box["y"], "el": el})
        except Exception:
            pass
    return items

def click_supplier_header(page, current_supplier):
    for item in collect_supplier_elements(page, header_only=True):
        try:
            if item["name"] == current_supplier:
                item["el"].click()
                page.wait_for_timeout(2500)
                return True
        except Exception:
            pass
    return False

def click_supplier_choice(page, choice):
    wanted = normalize_supplier_name(choice)
    for item in collect_supplier_elements(page, header_only=False):
        try:
            if item["name"] == wanted and item["y"] > 45:
                item["el"].click()
                page.wait_for_timeout(8000)
                print("    Switched to:", wanted)
                return True
        except Exception:
            pass
    return False

cleanup()
print("Starting WB SELLER auth...")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    ctx = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        viewport={"width": 1920, "height": 1080}
    )
    ctx.add_init_script('Object.defineProperty(navigator, "webdriver", {get: () => undefined});')
    page = ctx.new_page()

    # === Step 1: Open seller-auth ===
    print("[1] Opening seller-auth...")
    page.goto("https://seller-auth.wildberries.ru/", timeout=30000)
    page.wait_for_timeout(8000)

    # === Step 2: Enter phone ===
    print("[2] Entering phone:", PHONE)
    inp = page.query_selector("input[type=text]")
    if inp:
        inp.click()
        page.wait_for_timeout(300)
        inp.fill(PHONE)
    else:
        page.keyboard.type(PHONE, delay=100)
    page.wait_for_timeout(1000)

    # === Step 3: Click submit ===
    print("[3] Requesting code...")
    btn = page.query_selector("button[type=submit]")
    if btn:
        btn.click()
    else:
        page.keyboard.press("Enter")

    # === Step 4: Check page state after submit ===
    page_text = ""
    has_code_page = False
    for _ in range(25):
        page.wait_for_timeout(1000)
        page_text = page.inner_text("body")[:1500]

        has_code_page = has_sms_code_page(page_text)
        if has_code_page:
            break

        remaining = extract_rate_limit_remaining(page_text)
        if remaining:
            status("blocked", message="WB заблокировал отправку SMS. Повтор через " + remaining, debug=page_debug_state(page))
            browser.close()
            sys.exit(0)

        if "request a new code" in page_text.lower() or "запрос кода возможен" in page_text.lower():
            status("blocked", message="WB заблокировал отправку SMS. Попробуйте позже.", debug=page_debug_state(page))
            browser.close()
            sys.exit(0)

    # Check rate limit
    # Check if code page appeared
    if not has_code_page:
        remaining = extract_rate_limit_remaining(page_text)
        if remaining:
            status("blocked", message="WB заблокировал отправку SMS. Повтор через " + remaining, debug=page_debug_state(page))
            browser.close()
            sys.exit(0)

        if "request a new code" in page_text.lower() or "запрос кода возможен" in page_text.lower():
            status("blocked", message="WB заблокировал отправку SMS. Попробуйте позже.", debug=page_debug_state(page))
            browser.close()
            sys.exit(0)

        status("failed", message="WB не показал экран ввода SMS после отправки номера.", debug=page_debug_state(page))
        browser.close()
        sys.exit(0)

    status("sms_sent", phone=PHONE, resendAfter=extract_rate_limit_remaining(page_text), debug=page_debug_state(page))

    # === Step 5: Wait for SMS code ===
    while True:
        sms_code = wait_for_file(SMS_CODE_PATH, timeout=180)
        if not sms_code:
            status("failed", message="Таймаут: SMS-код не введён за 3 минуты.")
            browser.close()
            sys.exit(0)

        print("[5] Entering code:", sms_code)

        # Clean up code file for potential retry
        try: os.unlink(SMS_CODE_PATH)
        except: pass

        # Find code input fields
        all_inputs = page.query_selector_all("input")
        editable_inputs = []
        for inp_el in all_inputs:
            t = inp_el.get_attribute("type") or "none"
            im = inp_el.get_attribute("inputmode") or "none"
            vis = inp_el.is_visible()
            edt = inp_el.is_editable()
            if vis and edt and im == "numeric":
                editable_inputs.append(inp_el)

        if len(editable_inputs) >= 6:
            code_fields = editable_inputs[-6:]
            for i, ch in enumerate(sms_code[:6]):
                code_fields[i].fill(ch)
                page.wait_for_timeout(100)
        elif len(editable_inputs) >= 1:
            editable_inputs[0].click()
            page.wait_for_timeout(200)
            page.keyboard.type(sms_code, delay=150)
        else:
            page.keyboard.type(sms_code, delay=150)

        # Wait for WB to process the code
        page.wait_for_timeout(8000)

        # Check result
        current_url = page.url
        new_page_text = page.inner_text("body")[:1500]

        # Check for wrong code
        wrong_code_markers = ["неверный код", "invalid code", "wrong code", "incorrect"]
        if any(m in new_page_text.lower() for m in wrong_code_markers):
            status("code_error", message="Неверный SMS-код. Попробуйте ещё раз.")
            # Clear the code fields for retry
            for inp_el in editable_inputs[-6:]:
                try: inp_el.fill("")
                except: pass
            continue  # Wait for new code

        # Check for expired code
        expired_markers = ["код истёк", "code expired", "истёк", "expired"]
        if any(m in new_page_text.lower() for m in expired_markers):
            status("code_expired", message="SMS-код истёк. Запросите новый код.")
            browser.close()
            sys.exit(0)

        # Check if redirected to seller portal
        if "seller.wildberries.ru" in current_url and "seller-auth" not in current_url:
            print("    Redirected to seller portal!")
            break

        # Check if still on auth page but code was accepted (no error shown)
        if "seller-auth" in current_url:
            # Wait a bit more
            page.wait_for_timeout(5000)
            current_url = page.url
            if "seller.wildberries.ru" in current_url and "seller-auth" not in current_url:
                break

            # Still on auth page — might be wrong code without explicit error
            if any(m in page.inner_text("body")[:500].lower() for m in wrong_code_markers):
                status("code_error", message="Неверный SMS-код. Попробуйте ещё раз.")
                for inp_el in editable_inputs[-6:]:
                    try: inp_el.fill("")
                    except: pass
                continue

        # If we got here, try navigating to seller
        page.goto("https://seller.wildberries.ru/", timeout=30000)
        page.wait_for_timeout(8000)
        break

    # === Step 6: Check seller portal ===
    seller_url = page.url
    print("    Seller URL:", seller_url)

    if "about-portal" in seller_url or "seller-auth" in seller_url:
        status("failed", message="Авторизация не удалась. WB не принял код.")
        browser.close()
        sys.exit(0)

    # === Step 7: Check for multiple suppliers ===
    print("[7] Checking suppliers in header...")

    header_suppliers = collect_supplier_elements(page, header_only=True)
    current_supplier = header_suppliers[0]["name"] if header_suppliers else "Неизвестно"
    print("    Current supplier:", current_supplier)

    # Try clicking to see if dropdown opens with more suppliers
    all_suppliers = [{"name": current_supplier}] if current_supplier != "Неизвестно" else []
    if current_supplier != "Неизвестно" and click_supplier_header(page, current_supplier):
        dropdown_items = collect_supplier_elements(page, header_only=False)
        dropdown_names = []
        seen_names = set()
        for item in dropdown_items:
            key = item["name"].lower()
            if key in seen_names:
                continue
            seen_names.add(key)
            dropdown_names.append({"name": item["name"]})

        if len(dropdown_names) > len(all_suppliers):
            all_suppliers = dropdown_names
        print("    Supplier candidates:", [s["name"] for s in all_suppliers])
    else:
        print("    Supplier dropdown not opened")

    if len(all_suppliers) > 1:
        supplier_list = [s["name"] for s in all_suppliers]
        status("supplier_select", suppliers=supplier_list, current=current_supplier)

        choice = wait_for_file(SUPPLIER_CHOICE_PATH, timeout=180)
        if not choice:
            status("failed", message="Таймаут: юрлицо не выбрано за 3 минуты.")
            browser.close()
            sys.exit(0)

        choice = normalize_supplier_name(choice)
        print("    User chose:", choice)

        if choice not in supplier_list:
            status("failed", message=f"Выбранное юрлицо не найдено в списке: {choice}")
            browser.close()
            sys.exit(0)

        if choice != current_supplier:
            if not click_supplier_header(page, current_supplier):
                status("failed", message="Не удалось открыть список юрлиц для переключения.")
                browser.close()
                sys.exit(0)
            if not click_supplier_choice(page, choice):
                status("failed", message=f"Не удалось выбрать юрлицо: {choice}")
                browser.close()
                sys.exit(0)
            current_supplier = choice
    elif current_supplier == "Неизвестно":
        status("failed", message="Не удалось определить текущее юрлицо после авторизации.")
        browser.close()
        sys.exit(0)

    # === Step 8: Collect cookies and save tokens ===
    all_cookies = ctx.cookies()
    cookies_dict = {c["name"]: c["value"] for c in all_cookies}

    auth_token = capture_authorizev3(page)
    if not auth_token:
        for name in ["WILDAUTHNEW_V3", "WBTokenV3", "WBToken"]:
            token = cookies_dict.get(name)
            if looks_like_access_token(token):
                auth_token = token
                print("    Auth from cookie:", name, "len=", len(token))
                break

    cookie_string = "; ".join(c["name"] + "=" + c["value"] for c in all_cookies)

    if auth_token:
        refreshed = refresh_seller_token(auth_token, cookie_string) or {}
        tokens = {
            "authorizev3": auth_token,
            "wbSellerLk": refreshed.get("wbSellerLk", ""),
            "wbSellerLkExpires": refreshed.get("wbSellerLkExpires", 0),
            "supplierId": refreshed.get("supplierId", ""),
            "supplierUuid": refreshed.get("supplierUuid", ""),
            "cookies": cookie_string,
            "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }
        write_secret_json(TOKENS_PATH, tokens)
        sync_review_account_tokens(tokens, cookies_dict)
        print("Tokens saved to", TOKENS_PATH)
        status("success", message="Авторизация успешна!", supplier=current_supplier)
    else:
        status("failed", message="Не удалось получить токен авторизации.")

    browser.close()

cleanup()
