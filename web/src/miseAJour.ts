import { useEffect, useState } from "react";

declare const __LUCIEN_VERSION__: string;
/** Build stamp of the code running now (set by vite.config.ts, also written to version.json). */
export const VERSION: string = typeof __LUCIEN_VERSION__ === "string" ? __LUCIEN_VERSION__ : "dev";

export const versionLisible = (v = VERSION) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
};

/** The version on the server (never cached), or null without network. */
export async function versionEnLigne(): Promise<string | null> {
  try { const r = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" }); return r.ok ? ((await r.json()) as { v: string }).v : null; } catch { return null; }
}

/**
 * Fetches the latest Lucien and restarts on it: asks the service worker to look for a new version, waits for it to
 * take over, empties the kept pages, then reloads (data stays on the server, nothing is lost).
 */
export async function mettreAJour(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update().catch(() => {});
      const nouveau = reg.installing ?? reg.waiting;
      if (nouveau) await new Promise<void>((ok) => {
        if (nouveau.state === "activated") return ok();
        nouveau.addEventListener("statechange", () => { if (nouveau.state === "activated") ok(); });
        setTimeout(ok, 6000);
      });
    }
    if ("caches" in window) await caches.delete("lucien-pages");
  } catch { /* still reload below */ }
  location.replace(`${location.pathname}?maj=${Date.now()}${location.hash}`);
}

/** True when the server has a newer version than the one running (checked at start and when the app comes back). */
export function useNouvelleVersion(): boolean {
  const [nouvelle, setNouvelle] = useState(false);
  useEffect(() => {
    if (VERSION === "dev") return;
    const verifier = () => versionEnLigne().then((v) => setNouvelle(!!v && v !== VERSION));
    verifier();
    const quand = () => { if (document.visibilityState === "visible") verifier(); };
    document.addEventListener("visibilitychange", quand);
    const t = setInterval(verifier, 30 * 60_000);
    return () => { document.removeEventListener("visibilitychange", quand); clearInterval(t); };
  }, []);
  return nouvelle;
}
