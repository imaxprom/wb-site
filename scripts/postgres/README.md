# MPHub SQLite to PostgreSQL migration helpers

These scripts are operational helpers for the MPHub database migration.
They do not contain secrets.

## Files

- `sqlite-baseline.js` - collects row counts, date ranges and numeric sums from `data/finance.db`.
- `sqlite-to-postgres.py` - streams a SQLite snapshot into PostgreSQL using `COPY`.
- `postgres-baseline.py` - collects matching metrics from PostgreSQL using the SQLite baseline file.

## Expected runtime locations

Production SQLite baseline:

```bash
cd /home/makson/website
NODE_PATH=/home/makson/website/node_modules node /tmp/sqlite-baseline.js > /tmp/mphub-sqlite-baseline.json
```

PostgreSQL import VM:

```bash
sudo SQLITE_PATH=/tmp/mphub-finance-migration.sqlite /tmp/sqlite-to-postgres.py
sudo /tmp/postgres-baseline.py > /tmp/mphub-pg-baseline.json
```

PostgreSQL credentials are read from:

```text
/etc/mphub/postgres-credentials.env
```
