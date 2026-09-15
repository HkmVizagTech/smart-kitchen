// @ts-nocheck
// Self-hosted OTA bar (native only). Checks YOUR Railway API for the latest
// published bundle; if newer than what's running AND not one we've already
// applied, shows "Update now". Tapping downloads + reloads into it.
// On web / PWA this renders nothing.
import { useEffect, useState } from "react";

const API = (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, "") ||
  `http://${location.hostname}:4000`;
const APPLIED_KEY = (app: string) => `ota_applied_${app}`;
// version baked in at build time (see vite.config.ts define)
const BUILD_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

// returns true if a > b  (simple x.y.z compare)
function gt(a: string, b: string) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

export function OtaUpdate({ app }: { app: string }) {
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor?.isNativePlatform?.()) return;
        const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
        // CRITICAL: tell the updater this bundle booted fine, so it is kept
        // (otherwise it rolls back after a timeout and the bar reappears).
        await CapacitorUpdater.notifyAppReady().catch(() => {});

        const r = await fetch(`${API}/updates/${app}/latest`);
        if (!r.ok) return;
        const info = await r.json(); // { version, url }
        if (!info?.version || !info?.url) return;

        // baseline = the newer of (this build's version, last version we applied)
        const applied = localStorage.getItem(APPLIED_KEY(app)) || "0.0.0";
        const base = gt(applied, BUILD_VERSION) ? applied : BUILD_VERSION;

        // only prompt if the server bundle is genuinely newer than the baseline
        if (gt(info.version, base)) setLatest(info);
      } catch {
        /* plugin missing (web) — ignore */
      }
    })();
  }, []);

  async function apply() {
    setBusy(true);
    setErr("");
    try {
      const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
      const bundle = await CapacitorUpdater.download({ url: latest.url, version: latest.version });
      // remember BEFORE switching (set() reloads, so code after it won't run)
      localStorage.setItem(APPLIED_KEY(app), latest.version);
      await CapacitorUpdater.set(bundle); // switches + reloads the webview
    } catch (e) {
      setErr("Update failed — please try again.");
      setBusy(false);
    }
  }

  if (!latest) return null;
  return (
    <div className="ota-bar">
      <div className="ota-msg">
        <i className="ti ti-rocket" aria-hidden="true"></i>
        <span>{err || `A new version (v${latest.version}) is available.`}</span>
      </div>
      <button className={`btn sm ${busy ? "loading" : ""}`} disabled={busy} onClick={apply}>
        {busy ? "Updating…" : "Update now"}
      </button>
    </div>
  );
}
