#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = String(process.env.MPHUB_URL || "https://hub.imaxprom.site").replace(/\/$/, "");
const token = String(process.env.MPHUB_PRINT_TOKEN || "");
const printer = String(process.env.MPHUB_PRINTER || "");
const commandTemplate = String(process.env.MPHUB_PRINT_COMMAND || "");
if (!token) throw new Error("Set MPHUB_PRINT_TOKEN");
if (!printer && !commandTemplate) throw new Error("Set MPHUB_PRINTER or MPHUB_PRINT_COMMAND");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(action, body = {}) {
  const response = await fetch(`${baseUrl}/api/fbs/print-agent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, printerName: printer, ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function run(command, args = [], shell = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell, windowsHide: true });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { errors += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors.trim() || `${command}: exit ${code}`)));
  });
}

async function cupsPending(requestId) {
  try {
    const output = await run("lpstat", ["-W", "not-completed", "-o", requestId]);
    return Boolean(output.trim());
  } catch {
    return false;
  }
}

async function printFile(file, format) {
  if (commandTemplate) {
    const command = commandTemplate.replaceAll("{file}", JSON.stringify(file)).replaceAll("{printer}", JSON.stringify(printer));
    await run(command, [], true);
    return;
  }
  if (process.platform === "win32") throw new Error("Для Windows используйте fbs-print-agent-windows.ps1");
  const args = ["-d", printer];
  if (String(format).startsWith("zpl")) args.push("-o", "raw");
  args.push(file);
  const response = await run("lp", args);
  const requestId = response.match(/request id is\s+(\S+)/i)?.[1];
  if (!requestId) return;
  while (await cupsPending(requestId)) {
    await api("heartbeat", { status: "printing" }).catch(() => undefined);
    await wait(3000);
  }
}

for (;;) {
  let item;
  try {
    item = (await api("claim")).item;
  } catch (error) {
    process.stderr.write(`${new Date().toISOString()} ${error.message}\n`);
    await wait(5000);
    continue;
  }
  if (!item) {
    await wait(2000);
    continue;
  }
  const dir = await mkdtemp(join(tmpdir(), "mphub-label-"));
  const format = String(item.sticker_format || "png");
  const file = join(dir, `${item.job_id}-${item.position}.${format.startsWith("zpl") ? "zpl" : "png"}`);
  try {
    await writeFile(file, Buffer.from(item.sticker_file, "base64"));
    await printFile(file, format);
    await api("complete", { jobId: item.job_id, position: item.position });
    process.stdout.write(`Printed ${item.position}/${item.total_count}\n`);
  } catch (error) {
    await api("pause", { jobId: item.job_id, position: item.position, error: error.message }).catch(() => undefined);
    process.stderr.write(`Paused ${item.position}/${item.total_count}: ${error.message}\n`);
    await wait(5000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
