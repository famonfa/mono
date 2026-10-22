import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, dialog } from "electron";

/** The relay publishes the latest desktop build (CI writes /_mono/version next to the zips). */
const RELAY = process.env.MONO_RELAY ?? "https://mono.155-181-39-178.sslip.io";

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** Checks for a newer Mono and offers to install it. `manual` also reports "up to date" and errors. */
export async function checkForUpdates({ manual = false } = {}) {
  if (!app.isPackaged) {
    if (manual) dialog.showMessageBox({ message: "Las actualizaciones funcionan en la app instalada, no en desarrollo." });
    return;
  }
  let latest;
  try {
    const res = await fetch(`${RELAY}/_mono/version`, { signal: AbortSignal.timeout(8000) });
    latest = res.ok ? await res.json() : null;
  } catch {
    latest = null;
  }
  if (!latest?.version) {
    if (manual) dialog.showErrorBox("Mono", "No pude buscar actualizaciones. Revisá tu conexión.");
    return;
  }
  if (!newer(latest.version, app.getVersion())) {
    if (manual) dialog.showMessageBox({ message: `Tenés la última versión de Mono (${app.getVersion()}).` });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: `Hay una versión nueva de Mono (${latest.version})`,
    detail: `Tenés la ${app.getVersion()}. Se baja, se instala y Mono se vuelve a abrir.`,
    buttons: ["Actualizar", "Más tarde"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    await install();
  } catch (error) {
    dialog.showErrorBox("No se pudo actualizar", error.message);
  }
}

/**
 * Downloads the new app next to the old one and swaps them once this process has quit: Finder
 * trashes the old bundle (macOS only lets Finder remove installed apps), the new one takes its
 * place, the background service is restarted if it runs from this bundle, and Mono reopens.
 */
async function install() {
  const bundle = path.resolve(process.execPath, "..", "..", "..");
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mono-update-"));
  const res = await fetch(`${RELAY}/_mono/download/Mono-${arch}.zip`);
  if (!res.ok) throw new Error(`No pude bajar la versión nueva (${res.status})`);
  fs.writeFileSync(path.join(work, "Mono.zip"), Buffer.from(await res.arrayBuffer()));
  execFileSync("ditto", ["-x", "-k", path.join(work, "Mono.zip"), work]);

  const plist = path.join(os.homedir(), "Library", "LaunchAgents", "com.famonfa.mono.plist");
  const script = path.join(work, "swap.sh");
  fs.writeFileSync(
    script,
    `#!/bin/sh
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done
osascript -e 'tell application "Finder" to delete (POSIX file "${bundle}" as alias)' >/dev/null 2>&1
[ -e "${bundle}" ] && exit 1
mv "${work}/Mono.app" "${bundle}"
grep -q "${bundle}" "${plist}" 2>/dev/null && launchctl kickstart -k "gui/$(id -u)/com.famonfa.mono"
open "${bundle}"
rm -rf "${work}"
`,
    { mode: 0o755 },
  );
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  spawn("/bin/sh", [script], { detached: true, stdio: "ignore", env }).unref();
  app.quit();
}
