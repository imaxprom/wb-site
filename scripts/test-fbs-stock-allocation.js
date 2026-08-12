#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.join(process.cwd(), "src/lib/fbs-stock-allocation.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const moduleUnderTest = { exports: {} };
new Function("module", "exports", "require", compiled)(moduleUnderTest, moduleUnderTest.exports, require);
const { allocateFbsStock } = moduleUnderTest.exports;

function quantities(result) {
  return Object.fromEntries(result.warehouses.map((row) => [row.warehouseId, row.targetQuantity]));
}

// Scarcity: stock must leave zero-demand warehouses for the strongest demand.
assert.deepEqual(quantities(allocateFbsStock([
  { warehouseId: 1, targetQuantity: 0, orders30d: 26 },
  { warehouseId: 2, targetQuantity: 0, orders30d: 16 },
  { warehouseId: 3, targetQuantity: 1, orders30d: 0 },
  { warehouseId: 4, targetQuantity: 1, orders30d: 0 },
], 2)), { 1: 1, 2: 1, 3: 0, 4: 0 });

// Enough stock: every warehouse remains visible and surplus follows demand.
assert.deepEqual(quantities(allocateFbsStock([
  { warehouseId: 1, targetQuantity: 1, orders30d: 8 },
  { warehouseId: 2, targetQuantity: 1, orders30d: 2 },
  { warehouseId: 3, targetQuantity: 1, orders30d: 0 },
], 8)), { 1: 5, 2: 2, 3: 1 });

// Equal demand: retain already active warehouses to avoid needless churn.
assert.deepEqual(quantities(allocateFbsStock([
  { warehouseId: 1, targetQuantity: 0, orders30d: 0 },
  { warehouseId: 2, targetQuantity: 1, orders30d: 0 },
  { warehouseId: 3, targetQuantity: 1, orders30d: 0 },
], 2)), { 1: 0, 2: 1, 3: 1 });

// No demand history with surplus: preserve the previous distribution.
assert.deepEqual(quantities(allocateFbsStock([
  { warehouseId: 1, targetQuantity: 4, orders30d: 0 },
  { warehouseId: 2, targetQuantity: 1, orders30d: 0 },
  { warehouseId: 3, targetQuantity: 1, orders30d: 0 },
], 6)), { 1: 4, 2: 1, 3: 1 });

// Zero physical stock always zeros every warehouse.
assert.deepEqual(quantities(allocateFbsStock([
  { warehouseId: 1, targetQuantity: 3, orders30d: 9 },
  { warehouseId: 2, targetQuantity: 2, orders30d: 1 },
], 0)), { 1: 0, 2: 0 });

console.log("FBS stock allocation tests passed");
