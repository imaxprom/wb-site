"""Pure helpers for recognizing WB seller legal entities.

WB accounts are not limited to Russian legal forms.  Some seller profiles use a
foreign company name and an alphanumeric tax identifier, so the stable row
marker is the WB cabinet ID rather than an ``ИП``/``ООО`` prefix.
"""

import re


SUPPLIER_ID_RE = re.compile(
    r"(?:^|[\s•])(?:ID|ИД)\s*[:№#]?\s*([0-9a-z-]{3,})",
    re.IGNORECASE,
)
INN_RE = re.compile(
    r"(?:^|[\s•])(?:INN|ИНН)\s*[:№#]?\s*([0-9a-zа-яё-]{8,40})",
    re.IGNORECASE,
)
LEGAL_PREFIX_RE = re.compile(r"^(?:ИП|ООО|АО|Самозанят)\s+", re.IGNORECASE)
LEGAL_NAME_IN_TEXT_RE = re.compile(r"(?:^|\s)(?:ИП|ООО|АО|Самозанят)\s+", re.IGNORECASE)
META_START_RE = re.compile(r"(?:^|\s)(?:INN|ИНН|ID|ИД)\s*[:№#]?", re.IGNORECASE)
IGNORED_LINE_RE = re.compile(
    r"^(?:Ваш\s+(?:аккаунт|кабинет)|Your\s+account|Выбрать|Продолжить|"
    r"Add\s+Business|Settings|Documents|Seller\s+Offer|Seller\s+Training|API|B2B|"
    r"English|App\s+version|Sign\s+Out)$",
    re.IGNORECASE,
)


def normalize_supplier_name(value):
    value = re.sub(r"\s+", " ", value or "").strip()
    return value.replace("Индивидуальный предприниматель", "ИП")


def supplier_names_from_text(value):
    value = normalize_supplier_name(value)
    names = []

    for match in re.finditer(r"\bИП\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)?", value):
        names.append(normalize_supplier_name(match.group(0)))

    for match in re.finditer(r"\bИП\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){1,2}", value):
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


def supplier_matches_query(name, query):
    if not query:
        return False
    normalized_name = normalize_supplier_name(name).lower().replace("ё", "е")
    normalized_query = normalize_supplier_name(query).lower().replace("ё", "е")
    query_words = [
        word for word in re.findall(r"[а-яa-z0-9]+", normalized_query, re.IGNORECASE)
        if word not in ["ип", "ооо"] and len(word) > 2
    ]
    return bool(query_words) and all(word in normalized_name for word in query_words)


def has_legal_entity_marker(value):
    clean = normalize_supplier_name(value)
    return bool(LEGAL_NAME_IN_TEXT_RE.search(clean) or SUPPLIER_ID_RE.search(clean))


def seller_identity_from_payload(payload):
    """Keep WB's owner ID and internal supplier ID as separate values."""
    supplier_data = (payload or {}).get("data") or {}
    supplier_owner_id = str(supplier_data.get("Z-Soid") or "")
    return {
        "supplierId": str(supplier_data.get("Z-Sfid") or supplier_owner_id),
        "supplierOwnerId": supplier_owner_id,
        "supplierUuid": str(supplier_data.get("Z-Sid") or ""),
    }


def _clean_display_line(value):
    line = normalize_supplier_name(value).strip(" ·•-")
    line = re.sub(r"^(?:Ваш\s+(?:аккаунт|кабинет)|Your\s+account)\s*", "", line, flags=re.IGNORECASE)
    line = META_START_RE.split(line, maxsplit=1)[0].strip(" ·•-")
    return line


def parse_legal_entity_text(value, fallback_name=""):
    """Parse one WB account row using its stable cabinet ID.

    Russian rows retain the familiar legal name parsing.  Foreign rows are
    taken from the text before the ID/INN metadata and may contain any script.
    """
    raw = value or ""
    clean = normalize_supplier_name(raw)
    supplier_match = SUPPLIER_ID_RE.search(clean)
    inn_match = INN_RE.search(clean)
    supplier_id = supplier_match.group(1) if supplier_match else ""
    inn = inn_match.group(1) if inn_match else ""

    names = []
    for line in raw.splitlines():
        names.extend(supplier_names_from_text(line))
    if not names:
        names = supplier_names_from_text(clean)

    display_lines = []
    for raw_line in raw.splitlines():
        candidate = _clean_display_line(raw_line)
        if not candidate or IGNORED_LINE_RE.fullmatch(candidate):
            continue
        if candidate not in display_lines:
            display_lines.append(candidate)

    name = names[0] if names else ""
    if not name:
        if display_lines:
            name = display_lines[0]
        else:
            name = _clean_display_line(clean) or normalize_supplier_name(fallback_name)
    if not name:
        return None

    store_name = ""
    for candidate in display_lines:
        if candidate == name:
            continue
        if supplier_matches_query(candidate, name) or supplier_names_from_text(candidate):
            remainder = normalize_supplier_name(candidate.replace(name, "", 1)).strip(" ·•-")
            if remainder and not IGNORED_LINE_RE.fullmatch(remainder):
                store_name = remainder
                break
            continue
        if len(candidate) <= 100:
            store_name = candidate
            break

    if not store_name and names:
        before_meta = META_START_RE.split(clean, maxsplit=1)[0].strip(" ·•-")
        remainder = normalize_supplier_name(before_meta.replace(name, "", 1)).strip(" ·•-")
        if remainder and len(remainder) <= 100 and not IGNORED_LINE_RE.fullmatch(remainder):
            store_name = remainder

    entity_id = supplier_id or (
        "name:" + re.sub(r"[^а-яёa-z0-9]+", "-", name.lower(), flags=re.IGNORECASE).strip("-")
    )
    subtitle_parts = []
    if store_name:
        subtitle_parts.append(store_name)
    if inn:
        subtitle_parts.append("ИНН " + inn)
    if supplier_id:
        subtitle_parts.append("ID " + supplier_id)
    return {
        "id": entity_id,
        "name": name,
        "subtitle": " · ".join(subtitle_parts),
        "supplierId": supplier_id,
        "storeName": store_name,
        "inn": inn,
    }
