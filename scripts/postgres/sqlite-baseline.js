const Database = require("better-sqlite3");
const fs = require("fs");

const db = new Database("data/finance.db", { readonly: true });
const tables = db
  .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
  .all()
  .map((r) => r.name);

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const result = {
  generatedAt: new Date().toISOString(),
  dbSize: fs.statSync("data/finance.db").size,
  tables: {},
};

for (const t of tables) {
  const qt = quoteIdent(t);
  const count = db.prepare(`select count(*) c from ${qt}`).get().c;
  const cols = db
    .prepare(`pragma table_info(${qt})`)
    .all()
    .map((c) => ({
      name: c.name,
      type: c.type,
      notnull: c.notnull,
      pk: c.pk,
      dflt_value: c.dflt_value,
    }));
  const indexes = db.prepare(`pragma index_list(${qt})`).all();
  result.tables[t] = { count, cols, indexes, dateRanges: {}, numericSums: {} };

  const dateCols = cols
    .map((c) => c.name)
    .filter((n) => /date|dt|created|updated|rr_dt|saved_at|refreshed_at|synced_at|valid_from|valid_to/i.test(n));
  for (const c of dateCols.slice(0, 8)) {
    try {
      result.tables[t].dateRanges[c] = db
        .prepare(`select min(${quoteIdent(c)}) min, max(${quoteIdent(c)}) max from ${qt}`)
        .get();
    } catch (e) {
      result.tables[t].dateRanges[c] = { error: e.message };
    }
  }

  const numCols = cols
    .filter((c) => /(INT|REAL|NUM|DEC|DOUBLE|FLOAT)/i.test(c.type || ""))
    .map((c) => c.name)
    .filter((n) => !/id$/i.test(n))
    .slice(0, 12);
  for (const c of numCols) {
    try {
      result.tables[t].numericSums[c] = db
        .prepare(`select round(coalesce(sum(${quoteIdent(c)}),0),6) s from ${qt}`)
        .get().s;
    } catch {}
  }
}

console.log(JSON.stringify(result, null, 2));
