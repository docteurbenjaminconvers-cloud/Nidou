import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { demarrerTraduction } from "./i18n/traduction";
import "./styles.css";

// Ancien nom (Nidou) : les préférences gardées sur le téléphone (email, nom, langue…) passent sous le nouveau nom.
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith("nidou.")) continue;
    const nouvelle = "lucien." + k.slice("nidou.".length);
    if (localStorage.getItem(nouvelle) === null) localStorage.setItem(nouvelle, localStorage.getItem(k)!);
    localStorage.removeItem(k);
  }
} catch {}

// A link shared by a partner accountant: ...?partenaire=CODE (before or after the #), kept until the household is logged in.
try {
  const code = new URLSearchParams(location.search).get("partenaire") ?? new URLSearchParams(location.hash.split("?")[1] ?? "").get("partenaire");
  if (code && /^[A-Za-z0-9-]{4,20}$/.test(code)) localStorage.setItem("lucien.partenaire", code.toUpperCase());
} catch {}

// While a field is being typed in on a phone, the bottom bar steps aside: iPhone moves the screen for the keyboard and
// a bar fixed at the bottom would otherwise float in the middle of the form.
if (window.matchMedia("(pointer: coarse)").matches) {
  const champ = (t: EventTarget | null) => t instanceof HTMLElement && t.matches("input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, [contenteditable]");
  document.addEventListener("focusin", (e) => { if (champ(e.target)) document.body.classList.add("clavier"); });
  document.addEventListener("focusout", () => setTimeout(() => { if (!champ(document.activeElement)) document.body.classList.remove("clavier"); }, 50));
}

/**
 * Never a blank page: if the app crashes (on a browser we could not test, for instance), the person sees what happened
 * and can reload; the message is also what they send us to fix it.
 */
function afficherErreur(err: unknown) {
  const root = document.getElementById("root");
  if (!root || root.querySelector(".erreur-fatale")) return;
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  root.innerHTML = `<div class="erreur-fatale" style="max-width:440px;margin:18vh auto 0;padding:24px;font-family:system-ui,sans-serif;color:#3a2a33">
    <h1 style="font-size:22px;margin:0 0 10px">Lucien n'a pas pu s'afficher</h1>
    <p style="margin:0 0 14px;line-height:1.45">Rechargez la page. Si cela recommence, envoyez une capture de cet écran à l'équipe Lucien.</p>
    <button onclick="location.reload()" style="padding:12px 18px;border-radius:999px;border:0;background:#d9644a;color:#fff;font-size:16px">Recharger</button>
    <pre style="margin-top:18px;white-space:pre-wrap;font-size:12px;color:#7a6470">${msg.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}\n${navigator.userAgent}</pre></div>`;
}
class Garde extends React.Component<{ children: React.ReactNode }, { err: unknown }> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) { return { err }; }
  componentDidCatch(err: unknown) { console.error("[lucien]", err); setTimeout(() => afficherErreur(err)); }
  render() { return this.state.err ? null : this.props.children; }
}
// Diagnostics: errors are kept (messages only), and if the current screen is still empty a few seconds after it
// opens, its sizes and styles are sent to the server log, never its text.
const erreursVues: string[] = [];
const noter = (m: unknown) => { if (erreursVues.length < 15) erreursVues.push(String(m instanceof Error ? `${m.name}: ${m.message} @ ${(m.stack ?? "").split("\n").slice(0, 3).join(" | ")}` : m).slice(0, 400)); };
const consoleErreur = console.error.bind(console);
console.error = (...a: unknown[]) => { noter(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : typeof x === "string" ? x : "")).join(" ")); consoleErreur(...a); };
window.addEventListener("error", (e) => noter(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => noter(e.reason));
let diagEnvoyes = 0;
const verifierEcran = () => setTimeout(() => {
  const root = document.getElementById("root");
  const ecran = root?.querySelector(".screen") as HTMLElement | null;
  const lettres = (ecran?.innerText ?? root?.innerText ?? "").replace(/\s+/g, "").length;
  const r = ecran?.getBoundingClientRect();
  // visible part of the screen in the window: content present but scrolled or pushed out of view counts as empty
  const visible = r ? Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) : 0;
  const st = ecran ? getComputedStyle(ecran) : null;
  const cache = st ? st.visibility === "hidden" || Number(st.opacity) < 0.1 || st.display === "none" : true;
  if ((lettres > 30 && visible > 120 && !cache) || diagEnvoyes >= 5 || /connexion/.test(location.hash) || !root?.querySelector(".tabs")) return;
  diagEnvoyes++;
  const diag = {
    route: location.hash.split("?")[0].slice(0, 40), lettres, visible: Math.round(visible), ecran: !!ecran, version: document.querySelector('script[type="module"][src*="index-"]')?.getAttribute("src") ?? null, enfants: ecran?.childElementCount ?? null,
    rect: r ? [Math.round(r.top), Math.round(r.left), Math.round(r.width), Math.round(r.height)] : null,
    style: st ? { display: st.display, visibility: st.visibility, opacity: st.opacity, transform: st.transform, animation: st.animationName } : null,
    root: root ? { scrollTop: root.scrollTop, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight, pos: getComputedStyle(root).position } : null,
    vue: [innerWidth, innerHeight, Math.round(visualViewport?.height ?? 0), devicePixelRatio], standalone: matchMedia("(display-mode: standalone)").matches,
    erreurs: erreursVues, ua: navigator.userAgent,
  };
  fetch("/api/diagnostic", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(diag), keepalive: true }).catch(() => {});
}, 5000);
window.addEventListener("hashchange", verifierEcran);
window.addEventListener("load", verifierEcran);
document.addEventListener("click", (e) => { if ((e.target as HTMLElement | null)?.closest?.(".tabs")) verifierEcran(); });

window.addEventListener("error", (e) => { if (!document.getElementById("root")?.childElementCount) afficherErreur(e.error ?? e.message); });
window.addEventListener("unhandledrejection", (e) => { if (!document.getElementById("root")?.childElementCount) afficherErreur(e.reason); });

// English: the interface is translated as it is displayed (i18n/traduction.ts); French needs nothing.
const afficher = () => ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Garde><App /></Garde>
  </React.StrictMode>
);
demarrerTraduction().catch((e) => console.error("[traduction]", e)).finally(afficher);

// Rangées de pastilles qui défilent (catégories, situation…) : la pastille touchée vient au centre, dans les deux sens.
document.addEventListener("click", (e) => {
  const pill = (e.target as HTMLElement | null)?.closest?.(".pills .pill") as HTMLElement | null;
  if (!pill) return;
  const row = pill.parentElement!;
  if (row.scrollWidth <= row.clientWidth) return;
  const target = pill.offsetLeft - row.offsetLeft - (row.clientWidth - pill.offsetWidth) / 2;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollTo({ left: Math.max(0, target), behavior: reduce ? "auto" : "smooth" });
});
