#!/usr/bin/env python3
"""Regression checks for Russian and foreign WB seller account rows."""

from lib.wb_legal_entities import parse_legal_entity_text, seller_identity_from_payload


cases = [
    (
        "ИП Иванов И. И.\nОсновной магазин\nINN 123456789012 • ID 101001",
        {"id": "101001", "name": "ИП Иванов И. И.", "storeName": "Основной магазин", "inn": "123456789012"},
    ),
    (
        "示例国际贸易有限公司\nFOREIGN STORE\nID 202002 • INN 12345ABCDEF6789",
        {"id": "202002", "name": "示例国际贸易有限公司", "storeName": "FOREIGN STORE", "inn": "12345ABCDEF6789"},
    ),
]

for raw, expected in cases:
    actual = parse_legal_entity_text(raw)
    assert actual is not None
    for key, value in expected.items():
        assert actual[key] == value, (key, actual, expected)

print(f"WB legal entity parser: {len(cases)}/{len(cases)} checks passed")

identity_cases = [
    (
        {"data": {"Z-Soid": "101001", "Z-Sfid": "101001", "Z-Sid": "uuid-russian"}},
        {"supplierOwnerId": "101001", "supplierId": "101001", "supplierUuid": "uuid-russian"},
    ),
    (
        {"data": {"Z-Soid": "202002", "Z-Sfid": "303003", "Z-Sid": "uuid-foreign"}},
        {"supplierOwnerId": "202002", "supplierId": "303003", "supplierUuid": "uuid-foreign"},
    ),
]

for payload, expected in identity_cases:
    assert seller_identity_from_payload(payload) == expected

print(f"WB seller identity: {len(identity_cases)}/{len(identity_cases)} checks passed")
