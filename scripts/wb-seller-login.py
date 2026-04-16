"""WB Seller Auth via Playwright.
Result: data/wb-tokens.json

Run: python3 scripts/wb-seller-login.py
Then: echo 123456 > /tmp/wb_sms_code
"""
from playwright.sync_api import sync_playwright
import json, time, sys, os, base64

PHONE = "9641521652"
WEBSITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS_PATH = os.path.join(WEBSITE_DIR, "data", "wb-tokens.json")

print("Starting WB SELLER auth...")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    ctx = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        viewport={"width": 1920, "height": 1080}
    )
    ctx.add_init_script('Object.defineProperty(navigator, "webdriver", {get: () => undefined});')

    # Intercept auth API responses
    auth_tokens = {}
    def handle_response(response):
        url = response.url
        try:
            if "auth/token" in url or "suppliers-portal-core" in url:
                body = response.json()
                if "result" in body and "token" in body.get("result", {}):
                    auth_tokens["wbSellerLk"] = body["result"]["token"]
                    print("    [intercepted] seller token")
        except:
            pass

    page = ctx.new_page()
    page.on("response", handle_response)

    print("[1] Opening seller-auth...")
    page.goto("https://seller-auth.wildberries.ru/", timeout=30000)
    page.wait_for_timeout(8000)

    print("[2] Entering phone:", PHONE)
    inp = page.query_selector("input[type=text]")
    if inp:
        inp.click()
        page.wait_for_timeout(300)
        inp.fill(PHONE)
        print("    Phone entered")
    else:
        page.keyboard.type(PHONE, delay=100)
        print("    Phone typed")
    page.wait_for_timeout(1000)

    print("[3] Requesting code...")
    submitted = False
    for sel in ['button[type=submit]', 'button:has-text("Получить")', 'button:has-text("Далее")', 'button:has-text("Войти")']:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                el.click()
                submitted = True
                print("    Clicked:", sel)
                break
        except:
            continue
    if not submitted:
        page.keyboard.press("Enter")
        print("    Pressed Enter")
    page.wait_for_timeout(5000)
    print("    URL:", page.url)

    print()
    print("=" * 50)
    print("SMS sent! Enter code:")
    print("  echo XXXXXX > /tmp/wb_sms_code")
    print("=" * 50)
    sys.stdout.flush()

    try:
        os.unlink("/tmp/wb_sms_code")
    except:
        pass

    sms_code = None
    for i in range(180):
        try:
            with open("/tmp/wb_sms_code") as f:
                sms_code = f.read().strip()
            if sms_code:
                break
        except FileNotFoundError:
            pass
        time.sleep(1)

    if not sms_code:
        print("TIMEOUT")
        browser.close()
        sys.exit(1)

    print("[5] Entering code:", sms_code)
    # Dump current page state for debugging
    all_inputs = page.query_selector_all("input")
    print("    All inputs on page:", len(all_inputs))
    editable_inputs = []
    for inp in all_inputs:
        t = inp.get_attribute("type") or "none"
        im = inp.get_attribute("inputmode") or "none"
        vis = inp.is_visible()
        edt = inp.is_editable()
        print("      type=%s inputmode=%s visible=%s editable=%s" % (t, im, vis, edt))
        if vis and edt and im == "numeric":
            editable_inputs.append(inp)

    print("    Editable numeric inputs:", len(editable_inputs))

    if len(editable_inputs) >= 6:
        # Last 6 editable numeric inputs = code fields
        code_fields = editable_inputs[-6:]
        for i, ch in enumerate(sms_code[:6]):
            code_fields[i].fill(ch)
            page.wait_for_timeout(100)
        print("    Code filled into 6 inputs")
    elif len(editable_inputs) >= 1:
        # Try filling first one
        editable_inputs[0].click()
        page.wait_for_timeout(200)
        page.keyboard.type(sms_code, delay=150)
        print("    Code typed via keyboard into focused input")
    else:
        # Last resort: just type
        page.keyboard.type(sms_code, delay=150)
        print("    Code typed via keyboard (no inputs found)")

    page.wait_for_timeout(15000)
    print("    URL:", page.url)

    # Step 6: After SMS code, navigate to seller portal (within same session!)
    page.goto("https://seller.wildberries.ru/", timeout=30000)
    page.wait_for_timeout(10000)
    print("    Seller URL:", page.url)

    # Step 7: Find and click supplier switcher in top-right corner
    print("[7] Looking for supplier switcher (ИП in header)...")

    # Find elements with ИП/ООО text on the right side
    ip_elements = []
    for el in page.query_selector_all("*"):
        try:
            if not el.is_visible():
                continue
            txt = el.inner_text().strip()
            if ("ИП" in txt or "ООО" in txt) and len(txt) < 80:
                box = el.bounding_box()
                if box and box["x"] > 800:
                    ip_elements.append((el, txt, box))
                    print("    Found:", txt[:60], "x=%.0f y=%.0f" % (box["x"], box["y"]))
        except:
            pass

    if ip_elements:
        # Click to open dropdown
        el, txt, box = ip_elements[0]
        print("    Clicking:", txt[:60])
        el.click()
        page.wait_for_timeout(3000)

        # Look for "Беликова" or "Сорокина" or supplier with ID 1166225 in dropdown
        TARGET_NAMES = ["Беликова", "Сорокина", "1166225"]
        clicked_target = False
        for el2 in page.query_selector_all("*"):
            try:
                if not el2.is_visible():
                    continue
                txt2 = el2.inner_text().strip()
                if any(name in txt2 for name in TARGET_NAMES) and len(txt2) < 100:
                    tag2 = el2.evaluate("e => e.tagName")
                    print("    Dropdown item:", txt2[:80])
                    if not clicked_target:
                        el2.click()
                        clicked_target = True
                        print("    CLICKED TARGET!")
                        page.wait_for_timeout(10000)
                        print("    URL after switch:", page.url)
            except:
                pass

        if not clicked_target:
            print("    Target supplier not found in dropdown, listing all items:")
            for el2 in page.query_selector_all("*"):
                try:
                    if el2.is_visible():
                        txt2 = el2.inner_text().strip()
                        if ("ИП" in txt2 or "ООО" in txt2) and len(txt2) < 80:
                            print("      -", txt2)
                except:
                    pass
    else:
        print("    No ИП found in header, dumping page state...")
        for el in page.query_selector_all("button, a, [role=button]"):
            try:
                if el.is_visible():
                    txt = el.inner_text().strip()
                    box = el.bounding_box()
                    if txt and box and box["y"] < 80 and len(txt) < 60:
                        print("    header:", txt, "x=%.0f" % box["x"])
            except:
                pass

    # Collect cookies
    all_cookies = ctx.cookies()
    cookies_dict = {c["name"]: c["value"] for c in all_cookies}

    # Find authorizev3 — long JWT tokens
    auth_token = auth_tokens.get("authorizev3")
    if not auth_token:
        # Search cookies for JWT-like tokens
        for c in all_cookies:
            if len(c["value"]) > 200 and c["value"].count(".") == 2:
                auth_token = c["value"]
                print("    authorizev3 from cookie:", c["name"], "len=", len(c["value"]))
                break
    if not auth_token:
        for name in ["WILDAUTHNEW_V3", "WBTokenV3", "WBToken", "wbx-refresh"]:
            if cookies_dict.get(name):
                auth_token = cookies_dict[name]
                print("    authorizev3 from cookie:", name)
                break

    # Build cookie string
    cookie_string = "; ".join(c["name"] + "=" + c["value"] for c in all_cookies)

    seller_token = auth_tokens.get("wbSellerLk", "")

    print()
    print("=" * 50)
    print("RESULT:")
    has_auth = "YES" if auth_token else "NO"
    has_seller = "YES" if seller_token else "NO"
    print("  authorizev3:", has_auth, "(" + str(len(auth_token or "")) + " chars)")
    print("  wbSellerLk:", has_seller, "(" + str(len(seller_token)) + " chars)")
    print("  intercepted:", list(auth_tokens.keys()))
    print("  cookies:", len(all_cookies))

    for c in all_cookies:
        if len(c["value"]) > 100:
            print("  cookie:", c["name"], "domain=" + c["domain"], "len=" + str(len(c["value"])))

    if auth_token:
        exp = 0
        sid = ""
        uuid = ""
        if seller_token:
            try:
                parts = seller_token.split(".")
                payload = json.loads(base64.b64decode(parts[1] + "=="))
                exp = payload.get("exp", 0)
                sd = payload.get("data", {})
                sid = sd.get("Z-Sfid") or sd.get("Z-Soid", "")
                uuid = sd.get("Z-Sid", "")
            except:
                pass

        tokens = {
            "authorizev3": auth_token,
            "wbSellerLk": seller_token,
            "wbSellerLkExpires": exp,
            "supplierId": str(sid),
            "supplierUuid": str(uuid),
            "cookies": cookie_string,
            "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }
        with open(TOKENS_PATH, "w") as f:
            json.dump(tokens, f, indent=2)
        print()
        print("Tokens saved to", TOKENS_PATH)
        print("*** SUCCESS ***")
    else:
        print()
        print("*** FAILED — no auth token ***")
        with open("/tmp/wb_auth_debug.json", "w") as f:
            json.dump({"cookies": cookies_dict}, f, indent=2)
        print("Debug: /tmp/wb_auth_debug.json")

    browser.close()

try:
    os.unlink("/tmp/wb_sms_code")
except:
    pass
