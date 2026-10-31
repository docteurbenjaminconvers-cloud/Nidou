import { createHash } from "node:crypto";
import { structured, provider } from "./ia.js";
import { coutAppel, type BudgetIa } from "./iaBudget.js";

export { TX_CATEGORIES, TX_LABEL, type TxCategory } from "./categorie.js";
import { TX_CATEGORIES, type TxCategory } from "./categorie.js";

export interface ParsedTx {
  date: string;
  libelle: string;
  montant: number; // négatif = dépense
  compte: string | null;
}

// ---------- parsing ----------

function toIso(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function toAmount(raw: string): number | null {
  const s = raw.replace(/\s| |€|EUR/gi, "").replace(/\.(?=\d{3}(?:[,.]|$))/g, "").replace(",", ".");
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  return parseFloat(s);
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Parses bank statements exported as CSV (semicolon, comma or tab) in the usual French layouts:
 * date;libellé;montant  ·  date;libellé;débit;crédit  ·  with or without a header, any column order.
 * Also accepts pasted text where each line starts with a date and ends with an amount.
 */
export function parseStatement(text: string, compte: string | null = null): ParsedTx[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const sep = [";", "\t", ","].map((s) => [s, lines.slice(0, 5).reduce((n, l) => n + (l.split(s).length - 1), 0)] as const).sort((a, b) => b[1] - a[1])[0];
  const out: ParsedTx[] = [];

  if (sep[1] > 0) {
    const rows = lines.map((l) => splitLine(l, sep[0]));
    const header = rows[0].map((h) => h.toLowerCase());
    const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const hasHeader = rows[0].every((c) => toIso(c) === null) && header.some((h) => /date|libell|montant|d[ée]bit|cr[ée]dit|label|amount/.test(h));
    let iDate = find("date"), iLib = find("libell", "label", "description", "intitul", "motif"), iMont = find("montant", "amount"), iDeb = find("débit", "debit"), iCred = find("crédit", "credit");
    const data = hasHeader ? rows.slice(1) : rows;
    if (!hasHeader || iDate < 0) {
      // Infer columns from content.
      const sample = data[0] ?? [];
      iDate = sample.findIndex((c) => toIso(c) !== null);
      const amountCols = sample.map((c, i) => (i !== iDate && toAmount(c) !== null ? i : -1)).filter((i) => i >= 0);
      iMont = amountCols.length === 1 ? amountCols[0] : -1;
      if (amountCols.length >= 2) { iDeb = amountCols[0]; iCred = amountCols[1]; }
      iLib = sample.findIndex((c, i) => i !== iDate && !amountCols.includes(i) && c.length > 2);
    }
    for (const r of data) {
      const date = toIso(r[iDate] ?? "");
      if (!date) continue;
      let montant: number | null = null;
      if (iMont >= 0) montant = toAmount(r[iMont] ?? "");
      if (montant === null && (iDeb >= 0 || iCred >= 0)) {
        const d = iDeb >= 0 ? toAmount(r[iDeb] ?? "") : null;
        const c = iCred >= 0 ? toAmount(r[iCred] ?? "") : null;
        if (d !== null && d !== 0) montant = -Math.abs(d);
        else if (c !== null && c !== 0) montant = Math.abs(c);
      }
      if (montant === null) continue;
      const libelle = (r[iLib] ?? "").replace(/\s+/g, " ").trim();
      if (!libelle) continue;
      out.push({ date, libelle, montant, compte });
    }
    if (out.length) return out;
  }

  // Free text: "12/10/2026 CARTE 11/10 CARREFOUR MARKET -54,30"
  for (const l of lines) {
    const m = l.match(/^(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-+]?\d[\d\s .]*,?\d*)\s*€?$/);
    if (!m) continue;
    const date = toIso(m[1]), montant = toAmount(m[3]);
    if (!date || montant === null) continue;
    out.push({ date, libelle: m[2].trim(), montant, compte });
  }
  return out;
}

// ---------- merchant normalisation ----------

const NOISE = /\b(CB|CARTE|PAIEMENT|PRLV|PRELEVEMENT|PRELEVT|SEPA|VIR|VIREMENT|INST|FACTURE|ECHEANCE|DU|LE|REF|FR\d{2}[A-Z0-9]*|\d{2}\/\d{2}(?:\/\d{2,4})?|\d{6,}|X{3,}\d*|N°?\d+)\b/gi;

/** "CB CARREFOUR MARKET 11/10 MONTPELLIER" → "carrefour market" */
export function merchantOf(libelle: string): string {
  let s = libelle.toUpperCase().replace(/[*#_.:,'"]/g, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\b(SAS|SARL|SA|SASU|EURL|FRANCE|FR|PARIS|LYON|MONTPELLIER|MARSEILLE|TOULOUSE|NANTES|BORDEAUX|LILLE|UZES|NIMES)\b/g, " ").replace(/\s+/g, " ").trim();
  return (s.split(" ").slice(0, 3).join(" ") || libelle).toLowerCase();
}

// ---------- categorisation ----------

import { RULES } from "./categorie.js";

export function ruleCategory(libelle: string, montant: number): TxCategory | null {
  for (const [re, cat] of RULES) if (re.test(libelle)) return cat;
  if (montant > 0 && /remb|rembourse|avoir/i.test(libelle)) return "revenus";
  return null;
}

/**
 * Categorises transactions: rules first, then Claude for the leftovers (in one batch), else "autre".
 */
export async function categorise(items: { libelle: string; montant: number }[], budget?: BudgetIa): Promise<TxCategory[]> {
  const out: (TxCategory | null)[] = items.map((t) => ruleCategory(t.libelle, t.montant));
  const todo = out.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
  if (todo.length && provider() && (!budget || budget.ok())) {
    const uniq = [...new Set(todo.map((i) => items[i].libelle))].slice(0, 300);
    try {
      const r = await structured({
        tier: "rapide",
        system: `Tu classes des libellés de relevé bancaire français dans une de ces catégories : ${TX_CATEGORIES.join(", ")}.`,
        content: [{ type: "text", text: uniq.join("\n") }],
        tool: { name: "classer", description: "Attribue une catégorie à chaque libellé.", schema: { type: "object", required: ["items"], properties: { items: { type: "array", items: { type: "object", required: ["libelle", "categorie"], properties: { libelle: { type: "string" }, categorie: { type: "string", enum: [...TX_CATEGORIES] } } } } } } },
        maxTokens: 4000,
      });
      budget?.compter(coutAppel("rapide", 2));
      const map = new Map<string, TxCategory>();
      for (const it of (r.data as any).items ?? []) if (TX_CATEGORIES.includes(it.categorie)) map.set(it.libelle, it.categorie);
      for (const i of todo) out[i] = map.get(items[i].libelle) ?? null;
    } catch { /* keep rules only */ }
  }
  return out.map((c) => c ?? "autre");
}

export function fingerprint(householdId: string, t: ParsedTx): string {
  return createHash("sha1").update(`${householdId}|${t.compte ?? ""}|${t.date}|${t.libelle.toLowerCase()}|${t.montant.toFixed(2)}`).digest("hex");
}
