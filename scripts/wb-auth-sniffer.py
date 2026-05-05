#!/usr/bin/env python3
"""
WB Seller Auth — HTTP-only auth flow with full request logging.
No browser needed. Discovers and logs all WB auth API endpoints.

Usage:
  python3 scripts/wb-auth-sniffer.py

Requirements:
  pip3 install requests
"""

import requests
import json
import os
import sys
import time
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
LOG_PATH = DATA_DIR / "wb-auth-log.json"
TOKENS_PATH = DATA_DIR / "wb-tokens.json"

# Collected request/response log
request_log = []

def write_secret_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass

    tmp_path = path.with_name(f".{path.name}.{os.getpid()}.{int(time.time() * 1000)}.tmp")
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

def log_request(method, url, req_headers=None, req_body=None, resp_status=None, resp_headers=None, resp_body=None):
    """Log every request/response for analysis."""
    entry = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "method": method,
        "url": url,
        "request_headers": dict(req_headers) if req_headers else {},
        "request_body": req_body,
        "response_status": resp_status,
        "response_headers": dict(resp_headers) if resp_headers else {},
        "response_body": resp_body,
    }
    request_log.append(entry)
    # Save after each request
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text(json.dumps(request_log, indent=2, ensure_ascii=False))
    print(f"  [{resp_status}] {method} {url}")


# --- Session setup ---

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "Origin": "https://seller-auth.wildberries.ru",
    "Referer": "https://seller-auth.wildberries.ru/",
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
})


def do_request(method, url, json_body=None, extra_headers=None):
    """Make request, log everything, return response."""
    headers = dict(session.headers)
    if extra_headers:
        headers.update(extra_headers)

    resp = session.request(method, url, json=json_body, headers=headers, allow_redirects=False)

    # Try to parse response as JSON
    try:
        resp_body = resp.json()
    except Exception:
        resp_body = resp.text[:2000] if resp.text else None

    log_request(
        method=method,
        url=url,
        req_headers=headers,
        req_body=json_body,
        resp_status=resp.status_code,
        resp_headers=resp.headers,
        resp_body=resp_body,
    )
    return resp, resp_body


def print_cookies():
    """Print current session cookies."""
    if session.cookies:
        print("\n  Cookies:")
        for c in session.cookies:
            val = c.value[:60] + "..." if len(c.value) > 60 else c.value
            print(f"    {c.domain}: {c.name} = {val}")
    print()


# --- Auth Flow ---

def step_load_page():
    """Step 0: Load the auth page to get initial cookies/CSRF."""
    print("\n=== Step 0: Loading auth page ===")
    resp, body = do_request("GET", "https://seller-auth.wildberries.ru/")
    print_cookies()
    return resp.status_code == 200


def step_send_phone(phone):
    """Step 1: Send phone number. Try known WB auth endpoints."""
    print(f"\n=== Step 1: Sending phone {phone} ===")

    # Clean phone
    digits = phone.replace("+", "").replace("-", "").replace(" ", "")
    if digits.startswith("8") and len(digits) == 11:
        digits = "7" + digits[1:]
    phone_formatted = "+" + digits

    # Try different known endpoints
    endpoints = [
        # Current WB auth endpoints (v2/v3)
        ("POST", "https://seller-auth.wildberries.ru/auth/v2/auth/wild_v3_phone",
         {"phone": phone_formatted, "is_terms_and_conditions_accepted": True}),
        ("POST", "https://seller-auth.wildberries.ru/auth/v2/auth",
         {"phone": phone_formatted}),
        ("POST", "https://seller-auth.wildberries.ru/auth/v2/auth/phone",
         {"phone": phone_formatted}),
        # Passport endpoints
        ("POST", "https://passport.wildberries.ru/api/v2/auth/login_by_phone",
         {"phone": phone_formatted, "is_terms_and_conditions_accepted": True}),
    ]

    for method, url, body in endpoints:
        print(f"\n  Trying: {url}")
        resp, resp_body = do_request(method, url, json_body=body)

        if resp.status_code == 404:
            print(f"  -> 404, skipping")
            continue

        print(f"  -> Response: {json.dumps(resp_body, indent=2, ensure_ascii=False)[:500]}")
        print_cookies()

        if resp.status_code in (200, 201):
            return resp_body
        if resp.status_code == 429:
            print("  -> RATE LIMITED!")
            return resp_body

    return None


def step_submit_captcha(captcha_token, captcha_answer):
    """Step 2 (if needed): Submit captcha solution."""
    print(f"\n=== Step 2: Submitting captcha ===")

    endpoints = [
        ("POST", "https://seller-auth.wildberries.ru/auth/v2/auth/slide-v3",
         {"captcha_token": captcha_token, "answer": captcha_answer}),
        ("POST", "https://seller-auth.wildberries.ru/auth/v2/auth/captcha",
         {"token": captcha_token, "captcha": captcha_answer}),
    ]

    for method, url, body in endpoints:
        print(f"\n  Trying: {url}")
        resp, resp_body = do_request(method, url, json_body=body)
        if resp.status_code != 404:
            print(f"  -> Response: {json.dumps(resp_body, indent=2, ensure_ascii=False)[:500]}")
            return resp_body

    return None


def step_submit_code(token, code):
    """Step 3: Submit SMS code."""
    print(f"\n=== Step 3: Submitting SMS code: {code} ===")

    endpoints = [
        ("POST", "https://seller-auth.wildberries.ru/auth/v2/auth/wild_v3_code",
         {"token": token, "code": code}),
        ("POST", "https://seller-auth.wildberries.ru/auth/v2/auth/confirm",
         {"token": token, "code": code}),
        ("POST", "https://seller-auth.wildberries.ru/auth/v2/auth/verify",
         {"token": token, "code": code}),
    ]

    for method, url, body in endpoints:
        print(f"\n  Trying: {url}")
        resp, resp_body = do_request(method, url, json_body=body)
        if resp.status_code != 404:
            print(f"  -> Response: {json.dumps(resp_body, indent=2, ensure_ascii=False)[:500]}")
            print_cookies()
            return resp, resp_body

    return None, None


def extract_tokens(resp, resp_body):
    """Extract auth tokens from response and cookies."""
    print("\n=== Extracting tokens ===")

    tokens = {
        "authorizev3": "",
        "wbSellerLk": "",
        "wbSellerLkExpires": 0,
        "supplierId": "",
        "supplierUuid": "",
        "cookies": "",
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    # Check response body for tokens
    if isinstance(resp_body, dict):
        for key in ["token", "access_token", "authorizev3", "auth_token"]:
            if key in resp_body:
                tokens["authorizev3"] = resp_body[key]
                print(f"  Found token in response['{key}'], length: {len(resp_body[key])}")

    # Check cookies
    cookie_parts = []
    for c in session.cookies:
        print(f"  Cookie: {c.name} = {c.value[:60]}...")
        if c.name in ("wbx-validation-key", "x-supplier-id-external", "WBTokenV3"):
            cookie_parts.append(f"{c.name}={c.value}")
        if c.name == "WBTokenV3" and not tokens["authorizev3"]:
            tokens["authorizev3"] = c.value

    tokens["cookies"] = "; ".join(cookie_parts)

    # Check response headers
    for header in ["authorizev3", "authorization", "set-cookie"]:
        val = resp.headers.get(header, "")
        if val and "eyJ" in val:
            print(f"  Found token in header '{header}'")
            if not tokens["authorizev3"]:
                tokens["authorizev3"] = val

    if tokens["authorizev3"]:
        print(f"\n  authorizev3 token captured! Length: {len(tokens['authorizev3'])}")
        write_secret_json(TOKENS_PATH, tokens)
        print(f"  Saved to {TOKENS_PATH}")
    else:
        print("\n  No auth token found yet.")

    return tokens


# --- Main ---

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  WB Seller Auth — HTTP Sniffer")
    print("=" * 60)
    print(f"  Log: {LOG_PATH}")
    print(f"  Tokens: {TOKENS_PATH}")
    print()

    # Step 0: Load page
    step_load_page()

    # Step 1: Phone
    phone = input("Введите номер телефона (+7...): ").strip()
    if not phone:
        print("Номер не указан, выход.")
        return

    result = step_send_phone(phone)
    if not result:
        print("\nВсе эндпоинты вернули 404. Проверьте лог: data/wb-auth-log.json")
        return

    # Check if we need captcha
    token = None
    if isinstance(result, dict):
        token = result.get("token") or result.get("data", {}).get("token") or result.get("payload", {}).get("token")

        # Captcha?
        captcha_token = result.get("captcha_token") or result.get("captcha", {}).get("token") if isinstance(result.get("captcha"), dict) else None
        if captcha_token or "captcha" in json.dumps(result).lower():
            print("\n  CAPTCHA detected!")
            captcha_answer = input("Введите решение капчи: ").strip()
            if captcha_answer:
                captcha_result = step_submit_captcha(captcha_token or token, captcha_answer)
                if isinstance(captcha_result, dict):
                    token = captcha_result.get("token") or token

    if not token:
        print(f"\nНе удалось получить token из ответа. Полный ответ в логе.")
        print(f"Response: {json.dumps(result, indent=2, ensure_ascii=False)[:1000]}")

        # Maybe the response itself is the prompt to enter code?
        proceed = input("\nПопробовать ввести SMS-код? (y/n): ").strip()
        if proceed.lower() != "y":
            return
        token = "unknown"

    # Step 3: SMS code
    code = input("\nВведите SMS-код: ").strip()
    if not code:
        print("Код не указан, выход.")
        return

    resp, resp_body = step_submit_code(token, code)
    if resp is None:
        print("\nВсе эндпоинты для кода вернули 404.")
        return

    # Extract tokens
    tokens = extract_tokens(resp, resp_body)

    print("\n" + "=" * 60)
    print("  DONE! Full request log saved to:")
    print(f"  {LOG_PATH}")
    print("=" * 60)
    print(f"\nВсего запросов: {len(request_log)}")
    for entry in request_log:
        print(f"  [{entry['response_status']}] {entry['method']} {entry['url']}")


if __name__ == "__main__":
    main()
