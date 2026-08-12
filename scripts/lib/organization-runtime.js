const fs = require("fs");
const path = require("path");

function requireOrganizationId() {
  const organizationId = Number(process.env.MPHUB_ORGANIZATION_ID || "");
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("MPHUB_ORGANIZATION_ID is required for tenant background jobs");
  }
  return organizationId;
}

function organizationSchema(organizationId = requireOrganizationId()) {
  return organizationId === 1 ? "public" : `organization_${organizationId}`;
}

function organizationDataDir(projectDir, organizationId = requireOrganizationId()) {
  return path.join(projectDir, "data", "organizations", String(organizationId));
}

function organizationDataPath(projectDir, fileName, organizationId = requireOrganizationId()) {
  if (fileName !== path.basename(fileName)) throw new Error("Invalid organization data file name");
  return path.join(organizationDataDir(projectDir, organizationId), fileName);
}

function ensureOrganizationDataDir(projectDir, organizationId = requireOrganizationId()) {
  const dataDir = organizationDataDir(projectDir, organizationId);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dataDir, 0o700); } catch {}
  return dataDir;
}

function organizationPoolOptions(organizationId = requireOrganizationId()) {
  const schema = organizationSchema(organizationId);
  return `-c search_path=${schema},pg_catalog -c app.current_organization_id=${organizationId}`;
}

function organizationTempPath(baseName, organizationId = requireOrganizationId()) {
  if (baseName !== path.basename(baseName)) throw new Error("Invalid organization temp file name");
  return path.join("/tmp", `${baseName}-${organizationId}`);
}

module.exports = {
  ensureOrganizationDataDir,
  organizationDataDir,
  organizationDataPath,
  organizationPoolOptions,
  organizationSchema,
  organizationTempPath,
  requireOrganizationId,
};
