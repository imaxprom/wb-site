# MpHub database migrations

Migrations in this directory are run manually by the PostgreSQL migration owner.
They must be tested against a restored production snapshot before production use.

Required order for multi-organization work:

1. `20260805-multi-organization-foundation.sql` — additive organization catalog,
   memberships and schema-provisioning function.
2. `20260807-fbs-stock-manager.sql` — isolated FBS stock ledger, warehouse
   targets, order idempotency journal and audit log.
3. `20260807-fbs-product-photo.sql` — authoritative WB card photo URL for FBS
   products in every tenant schema.
4. `20260807-fbs-fulfillment.sql` — isolated FBS assembly workflow, scanner
   audit, supplies and pre-delivery controls for every tenant schema.
5. `20260811-fbs-marking-queue.sql` — durable per-tenant queue for background
   upload and batch verification of FBS Honest Sign codes.
6. `20260812-fbs-pvz-hardening.sql` — live WB cargo-box state and confirmed
   print state for supplies delivered through a pickup point.
7. `20260814-fbs-kiz-archive.sql` — encrypted, organization-isolated archive
   of already applied Honest Sign codes and its immutable scan journal.
8. `20260814-fbs-kiz-printing.sql` — per-code reservation/consumption state and
   durable print-agent recovery for archive batch printing.
9. `20260814-fbs-kiz-gtin-mapping.sql` — explicit tenant-isolated mapping from
   Honest Sign GTIN to the exact WB article and size when the WB barcode differs.
10. `20260816-fbs-supply-archive.sql` — immutable FBS identifiers, observed
    status history, sale/return events and resumable archive sync state.
11. Tenant-aware application and background jobs select the organization schema
   through a server-controlled PostgreSQL `search_path`.
12. The existing legal entity remains in `public`; each additional legal entity
   receives an empty `organization_<id>` structural clone. This keeps identical
   WB identifiers independent without rewriting the current 3.2 GB dataset.

Never run these files through the normal `mphub_app` runtime connection.
