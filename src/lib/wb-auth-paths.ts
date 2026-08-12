import path from "node:path";
import { requireActiveOrganizationId } from "@/lib/organization-context";
import {
  getOrganizationDataDir,
  getOrganizationDataPath,
  getOrganizationTempPath,
} from "@/lib/organization-paths";

export interface WbAuthPaths {
  organizationId: number;
  dataDir: string;
  tokensPath: string;
  cooldownPath: string;
  profileDir: string;
  smsCodePath: string;
  authLogPath: string;
  authPidPath: string;
  supplierChoicePath: string;
}

export function getWbAuthPaths(organizationId = requireActiveOrganizationId()): WbAuthPaths {
  const dataDir = getOrganizationDataDir(organizationId);
  return {
    organizationId,
    dataDir,
    tokensPath: getOrganizationDataPath("wb-tokens.json", organizationId),
    cooldownPath: getOrganizationDataPath("wb-auth-cooldown.json", organizationId),
    profileDir: path.join(dataDir, "wb-playwright-profile"),
    smsCodePath: getOrganizationTempPath("wb_sms_code", organizationId),
    authLogPath: getOrganizationTempPath("wb_auth_log.txt", organizationId),
    authPidPath: getOrganizationTempPath("wb_auth_pid", organizationId),
    supplierChoicePath: getOrganizationTempPath("wb_supplier_choice", organizationId),
  };
}
