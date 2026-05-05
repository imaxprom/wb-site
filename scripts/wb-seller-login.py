"""WB Seller Auth via Playwright — structured output.
Communicates with Node.js API via STATUS lines in /tmp/wb_auth_log.txt.

STATUS:{"state":"...","message":"..."}

States: sms_sent, blocked, code_error, code_expired, supplier_select, success, failed
"""
from playwright.sync_api import sync_playwright
import json, time, sys, os, re

PHONE = os.environ.get("WB_PHONE", "9641521652")
WEBSITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS_PATH = os.path.join(WEBSITE_DIR, "data", "wb-tokens.json")
LOG_PATH = "/tmp/wb_auth_log.txt"
SMS_CODE_PATH = "/tmp/wb_sms_code"
SUPPLIER_CHOICE_PATH = "/tmp/wb_supplier_choice"

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
    page.wait_for_timeout(5000)

    # === Step 4: Check page state after submit ===
    page_text = page.inner_text("body")[:1500]

    # Check rate limit
    remaining = extract_rate_limit_remaining(page_text)
    if remaining:
        status("blocked", message="WB заблокировал отправку SMS. Повтор через " + remaining)
        browser.close()
        sys.exit(0)

    if "request a new code" in page_text.lower() or "запрос кода возможен" in page_text.lower():
        status("blocked", message="WB заблокировал отправку SMS. Попробуйте позже.")
        browser.close()
        sys.exit(0)

    # Check if code page appeared
    has_code_page = any(h in page_text.lower() for h in ["код", "code", "sms", "enter sms"])
    if not has_code_page:
        # Phone might not be registered
        if "sign in" in page_text.lower() or "войти" in page_text.lower():
            status("failed", message="Номер не зарегистрирован в WB Partners или SMS не отправлен.")
            browser.close()
            sys.exit(0)

    status("sms_sent", phone=PHONE)

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
        expired_markers = ["код истёк", "code expired", "истёк", "expired", "request a new code"]
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

    # Find ИП/ООО elements in the top-right area
    ip_elements = []
    for el in page.query_selector_all("*"):
        try:
            if not el.is_visible():
                continue
            txt = el.inner_text().strip()
            if ("ИП" in txt or "ООО" in txt) and len(txt) < 80 and "\n" not in txt:
                box = el.bounding_box()
                if box and box["x"] > 1000 and box["y"] < 60:
                    ip_elements.append({"name": txt, "x": box["x"], "y": box["y"]})
        except:
            pass

    # Get unique supplier names from header
    seen_names = set()
    unique_suppliers = []
    for ip in ip_elements:
        if ip["name"] not in seen_names:
            seen_names.add(ip["name"])
            unique_suppliers.append(ip["name"])

    current_supplier = unique_suppliers[0] if unique_suppliers else "Неизвестно"
    print("    Current supplier:", current_supplier)

    # Try clicking to see if dropdown opens with more suppliers
    if ip_elements:
        # Click the supplier name in header
        for el in page.query_selector_all("*"):
            try:
                if el.is_visible() and el.inner_text().strip() == current_supplier:
                    box = el.bounding_box()
                    if box and box["x"] > 1000 and box["y"] < 60:
                        el.click()
                        page.wait_for_timeout(2000)
                        break
            except:
                pass

        # Check if dropdown appeared with OTHER supplier names
        dropdown_suppliers = []
        for el in page.query_selector_all("*"):
            try:
                if not el.is_visible():
                    continue
                txt = el.inner_text().strip()
                if ("ИП" in txt or "ООО" in txt) and len(txt) < 80 and "\n" not in txt:
                    box = el.bounding_box()
                    # Dropdown items are usually below the header (y > 50)
                    if box and box["y"] > 50 and box["y"] < 400:
                        if txt not in [s["name"] for s in dropdown_suppliers]:
                            dropdown_suppliers.append({"name": txt, "x": box["x"], "y": box["y"]})
            except:
                pass

        if dropdown_suppliers:
            print("    Dropdown suppliers:", [s["name"] for s in dropdown_suppliers])
            all_suppliers = dropdown_suppliers
            # Close dropdown by pressing Escape
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
        else:
            all_suppliers = [{"name": current_supplier}]

        if len(all_suppliers) > 1:
            # Multiple suppliers — ask user to choose
            supplier_list = [s["name"] for s in all_suppliers]
            status("supplier_select", suppliers=supplier_list, current=current_supplier)

            # Wait for user choice
            choice = wait_for_file(SUPPLIER_CHOICE_PATH, timeout=120)
            if not choice:
                status("failed", message="Таймаут: юрлицо не выбрано за 2 минуты.")
                browser.close()
                sys.exit(0)

            print("    User chose:", choice)

            if choice != current_supplier:
                # Click header to open dropdown again
                for el in page.query_selector_all("*"):
                    try:
                        if el.is_visible() and el.inner_text().strip() == current_supplier:
                            box = el.bounding_box()
                            if box and box["x"] > 1000 and box["y"] < 60:
                                el.click()
                                page.wait_for_timeout(2000)
                                break
                    except:
                        pass

                # Click the chosen supplier
                for el in page.query_selector_all("*"):
                    try:
                        if el.is_visible() and el.inner_text().strip() == choice:
                            box = el.bounding_box()
                            if box and box["y"] > 50:
                                el.click()
                                page.wait_for_timeout(8000)
                                print("    Switched to:", choice)
                                break
                    except:
                        pass

    # === Step 8: Collect cookies and save tokens ===
    all_cookies = ctx.cookies()
    cookies_dict = {c["name"]: c["value"] for c in all_cookies}

    # Find auth token — JWT in cookies
    auth_token = None
    for c in all_cookies:
        if len(c["value"]) > 200 and c["value"].count(".") == 2:
            auth_token = c["value"]
            print("    Auth from cookie:", c["name"], "len=", len(c["value"]))
            break
    if not auth_token:
        for name in ["WILDAUTHNEW_V3", "WBTokenV3", "WBToken", "wbx-refresh"]:
            if cookies_dict.get(name):
                auth_token = cookies_dict[name]
                print("    Auth from cookie:", name)
                break

    cookie_string = "; ".join(c["name"] + "=" + c["value"] for c in all_cookies)

    if auth_token:
        tokens = {
            "authorizev3": auth_token,
            "wbSellerLk": "",
            "wbSellerLkExpires": 0,
            "supplierId": "",
            "supplierUuid": "",
            "cookies": cookie_string,
            "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }
        write_secret_json(TOKENS_PATH, tokens)
        print("Tokens saved to", TOKENS_PATH)
        status("success", message="Авторизация успешна!", supplier=current_supplier)
    else:
        status("failed", message="Не удалось получить токен авторизации.")

    browser.close()

cleanup()
