import fs from "fs";
import path from "path";

const SECRET_FILE_MODE = 0o600;
const SECRET_DIR_MODE = 0o700;

export function ensurePrivateDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: SECRET_DIR_MODE });
  }

  try {
    fs.chmodSync(dirPath, SECRET_DIR_MODE);
  } catch {
    // Best effort: some filesystems may not support chmod.
  }
}

export function writeSecretFileSync(filePath: string, data: string | Buffer): void {
  const dir = path.dirname(filePath);
  ensurePrivateDir(dir);

  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    fs.writeFileSync(tmpPath, data, { mode: SECRET_FILE_MODE });
    fs.chmodSync(tmpPath, SECRET_FILE_MODE);
    fs.renameSync(tmpPath, filePath);
    fs.chmodSync(filePath, SECRET_FILE_MODE);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch { /* ignore cleanup errors */ }
    throw err;
  }
}
