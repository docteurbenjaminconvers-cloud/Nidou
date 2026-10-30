import type { Category } from "./types";

export const fmtEuro = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtDate = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", opts) : "—";

export const today = () => new Date().toISOString().slice(0, 10);

export const daysUntil = (iso: string) => Math.round((Date.parse(iso + "T00:00:00") - Date.parse(today() + "T00:00:00")) / 864e5);

export const PERIOD_LABEL: Record<string, string> = { mensuel: "/ mois", trimestriel: "/ trimestre", annuel: "/ an", unique: "une fois" };

export function DateChip({ iso }: { iso: string }) {
  const d = daysUntil(iso);
  const cls = d < 0 ? "late" : d <= 14 ? "soon" : "";
  return (
    <div className={`date-chip ${cls}`} aria-label={fmtDate(iso)}>
      <b>{new Date(iso + "T00:00:00").getDate()}</b>
      <span>{new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</span>
    </div>
  );
}

export function relative(iso: string): string {
  const d = daysUntil(iso);
  if (d === 0) return "aujourd'hui";
  if (d === 1) return "demain";
  if (d < 0) return `il y a ${-d} j`;
  if (d < 30) return `dans ${d} j`;
  if (d < 365) return `dans ${Math.round(d / 30)} mois`;
  return `dans ${(d / 365).toFixed(1).replace(".0", "")} an${d >= 730 ? "s" : ""}`;
}

const ICONS: Record<Category, JSX.Element> = {
  assurance: <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />,
  energie: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  telecom: <path d="M5 12a7 7 0 0114 0M8.5 15.5a3 3 0 017 0M12 19h.01M2 8.5a11 11 0 0120 0" />,
  logement: <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z" />,
  banque: <path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" />,
  impots: <path d="M6 3h9l5 5v13H6zM14 3v6h6M9 13h6M9 17h6" />,
  abonnement: <path d="M4 6h16v12H4zM4 10h16M8 15h3" />,
  sante: <path d="M12 21s-8-5.5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 10c0 5.5-8 11-8 11z" />,
  identite: <path d="M3 6h18v12H3zM7 10a2 2 0 104 0 2 2 0 00-4 0M13 10h5M13 14h5M6 15c.5-1.5 1.8-2 3-2s2.5.5 3 2" />,
  garantie: <path d="M12 2l3 3 4-1 1 4 3 3-3 3 1 4-4-1-3 3-3-3-4 1 1-4-3-3 3-3-1-4 4 1zM9 12l2 2 4-4" />,
  education: <path d="M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6" />,
  vehicule: <path d="M5 13l1.5-5h11L19 13M3 13h18v5h-2a2 2 0 11-4 0H9a2 2 0 11-4 0H3z" />,
  autre: <path d="M6 3h9l5 5v13H6zM14 3v6h6" />,
};

export function CatIcon({ c }: { c: Category }) {
  return (
    <div className="cat" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[c] ?? ICONS.autre}</svg>
    </div>
  );
}

export const CAT_COLORS: Record<string, string> = {
  assurance: "#b89bd9", energie: "#e9b23a", telecom: "#7fb5d6", logement: "#8a5a4a", banque: "#5a3f6e", impots: "#c99a2e",
  abonnement: "#d95f45", sante: "#e58aa5", identite: "#8b6f84", garantie: "#6fbf96", education: "#5fa8b8", vehicule: "#3b2a3a", autre: "#d9c6d4",
};

/** Le nœud papillon de Lucien (logo seul). */
export function Noeud() {
  return <svg viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" rx="32" fill="#D95F45" /><path d="M12 21.5c0-2.6 2.7-4.3 5-3.2l11.5 6.2v15l-11.5 6.2c-2.3 1.1-5-.6-5-3.2z" fill="#FBF4F0" /><path d="M52 21.5c0-2.6-2.7-4.3-5-3.2l-11.5 6.2v15l11.5 6.2c2.3 1.1 5-.6 5-3.2z" fill="#FBF4F0" /><rect x="26.5" y="24.5" width="11" height="15" rx="4" fill="#E9B23A" /></svg>;
}

export function Logo() {
  return (
    <span className="brand">
      <Noeud />
      Lucien
    </span>
  );
}

export function Back({ onClick, label = "Retour" }: { onClick: () => void; label?: string }) {
  return (
    <button className="back" onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      {label}
    </button>
  );
}
