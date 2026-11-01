/**
 * The app in English, without touching every screen: the French interface is translated at display time.
 * Each text node (and placeholder, aria-label, title) is looked up in a French → English dictionary; sentences with
 * numbers or names go through patterns ("{0} documents dans le foyer" → "{0} documents in the household").
 * The dictionary is loaded only when English is chosen, so the French app stays as light as before.
 */
export type Langue = "fr" | "en";
const CLE = "lucien.langue";

export function langueChoisie(): Langue {
  try { const l = localStorage.getItem(CLE); if (l === "fr" || l === "en") return l; } catch { /* storage refused */ }
  const nav = (navigator.languages?.[0] ?? navigator.language ?? "fr").slice(0, 2).toLowerCase();
  return nav === "en" ? "en" : "fr";
}

export function choisirLangue(l: Langue) {
  try { localStorage.setItem(CLE, l); } catch { /* storage refused */ }
  location.reload();
}

interface Dico { textes: Record<string, string>; motifs: [string, string][] }
interface Motif { re: RegExp; vers: string; indice: string }

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compiler(d: Dico): Motif[] {
  // indice: the longest fixed part of the pattern, a cheap test before the regular expression (hundreds of patterns)
  return d.motifs.map(([de, vers]) => ({
    // {2#} stands for a number (« et {2#} autres »), so the parts around it are not cut in the wrong place
    re: new RegExp(`^${echapper(de).replace(/\\\{(\d+)#\\\}/g, "([\\d\\s\u202f\u00a0]+)").replace(/\\\{(\d+)\\\}/g, "(.+?)")}$`, "s"), vers,
    indice: de.split(/\{\d+#?\}/).map((x) => x.trim()).sort((a, b) => b.length - a.length)[0] ?? "",
  }));
}

export function traducteur(d: Dico) {
  const motifs = compiler(d);
  const t = (texte: string, profondeur = 0): string | null => {
    const brut = texte.trim();
    if (!brut || !/\p{L}/u.test(brut)) return null;
    const direct = d.textes[brut];
    if (direct !== undefined) return texte.replace(brut, direct);
    // a name used in the middle of a sentence, without its capital (« louer un logement »)
    const majuscule = brut[0].toUpperCase() + brut.slice(1);
    const enMajuscule = majuscule !== brut ? d.textes[majuscule] : undefined;
    if (enMajuscule) return texte.replace(brut, enMajuscule[0].toLowerCase() + enMajuscule.slice(1));
    if (profondeur > 2) return null;
    for (const m of motifs) {
      if (m.indice && !brut.includes(m.indice)) continue;
      const r = brut.match(m.re);
      if (!r) continue;
      // a variable part that is a whole untranslated French phrase means the pattern caught a sentence it was not made
      // for: better leave the sentence in French than mix the two languages
      let melange = false;
      const sortie = m.vers.replace(/\{(\d+)\}/g, (_, i: string) => {
        const v = r[Number(i) + 1] ?? "";
        const tv = t(v, profondeur + 1);
        if (tv === null && (v.match(/\p{L}{2,}/gu) ?? []).length > 3) melange = true;
        return tv ?? v; // keeps the spaces around the part (" La cantine est notée…" after a full stop)
      });
      if (melange) continue;
      return texte.replace(brut, sortie);
    }
    // a list built by the app (« A, B et 2 autres »): translated when every item is
    const morceaux = brut.split(/(, | et )/);
    if (morceaux.length > 1) {
      const sortie = morceaux.map((m, i) => (i % 2 ? (m === " et " ? " and " : m) : t(m, profondeur)));
      if (sortie.every((m, i) => i % 2 || m !== null || !/\p{L}{2,}/u.test(morceaux[i]))) {
        return texte.replace(brut, sortie.map((m, i) => m ?? morceaux[i]).join(""));
      }
    }
    return null;
  };
  return t;
}

const ATTRIBUTS = ["placeholder", "aria-label", "title"] as const;
/** Never translated: letters and documents the person will send, typed values. */
const exclu = (el: Element | null) => !!el?.closest("pre, textarea, [contenteditable], [data-pas-traduire]");

export async function demarrerTraduction(): Promise<void> {
  if (langueChoisie() !== "en") return;
  document.documentElement.lang = "en";
  const d = (await import("./en.json")).default as unknown as Dico;
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
