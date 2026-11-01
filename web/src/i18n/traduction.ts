/**
 * The app in English, without touching every screen: the French interface is translated at display time.
 * Each text node (and placeholder, aria-label, title) is looked up in a French → English dictionary; sentences with
 * numbers or names go through patterns ("{0} documents dans le foyer" → "{0} documents in the household").
 * The dictionary is loaded only when English is chosen, so the French app stays as light as before.
 */
export type Langue = "fr" | "en";
const CLE = "lucien.langue";

export function langueChoisie(): Langue {
  // French by default: English only when chosen in Settings
  try { if (localStorage.getItem(CLE) === "en") return "en"; } catch { /* storage refused */ }
  return "fr";
}

export function choisirLangue(l: Langue) {
  try { localStorage.setItem(CLE, l); } catch { /* storage refused */ }
  location.reload();
}

import { traducteur, type Dico } from "../../../server/src/traducteur";

const ATTRIBUTS = ["placeholder", "aria-label", "title"] as const;
/** Never translated: letters and documents the person will send, typed values. */
const exclu = (el: Element | null) => !!el?.closest("pre, textarea, [contenteditable], [data-pas-traduire]");

export async function demarrerTraduction(): Promise<void> {
  if (langueChoisie() !== "en") return;
  document.documentElement.lang = "en";
  const d = (await import("../../../server/src/i18n/en.json")).default as unknown as Dico;
  const t = traducteur(d);
  const faits = new WeakMap<Node, string>(); // node → the English we wrote, so our own writes are not re-translated

  const texte = (n: Text) => {
    if (exclu(n.parentElement)) return;
    const v = n.nodeValue ?? "";
    if (faits.get(n) === v) return;
    const e = t(v);
    if (e !== null && e !== v) { faits.set(n, e); n.nodeValue = e; }
  };
  const attributs = (el: Element) => {
    if (exclu(el)) return;
    for (const a of ATTRIBUTS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const e = t(v);
      if (e !== null && e !== v) el.setAttribute(a, e);
    }
  };
  const parcourir = (racine: Node) => {
    if (racine.nodeType === Node.TEXT_NODE) { texte(racine as Text); return; }
    if (racine.nodeType !== Node.ELEMENT_NODE) return;
    attributs(racine as Element);
    const w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === Node.TEXT_NODE ? texte(n as Text) : attributs(n as Element);
  };

  parcourir(document.body);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "characterData") texte(m.target as Text);
      else if (m.type === "attributes" && m.target.nodeType === Node.ELEMENT_NODE) attributs(m.target as Element);
      else m.addedNodes.forEach(parcourir);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTS] });
}
