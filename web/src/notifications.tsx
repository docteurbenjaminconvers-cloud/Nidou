import { useEffect, useState } from "react";
import type { BudgetReport, ChargesReport, Deadline, Doc, Household } from "./types";
import type { Api } from "./api";
import { PushCard } from "./push";
import { daysUntil, fmtEuro, relative } from "./ui";

export interface Notif {
  id: string;
  kind: "echeance" | "economie" | "verifier" | "info" | "essai";
  titre: string;
  detail: string;
  quand: string;      // ISO date used for ordering
  route: { s: string; id?: string };
  urgent: boolean;
}

const READ_KEY = "lucien.notifs.lues";

function readSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? "[]")); } catch { return new Set(); }
}
function writeSet(s: Set<string>) {
  try { localStorage.setItem(READ_KEY, JSON.stringify([...s])); } catch {}
}

/** Builds the family's notification feed from the loaded state. The server will push the same items later. */
export function buildNotifications(deadlines: Deadline[], docs: Doc[], budget: BudgetReport | null, household?: Household | null, charges?: ChargesReport | null): Notif[] {
  const out: Notif[] = [];
  const today = new Date().toISOString().slice(0, 10);
  // Reverse trial: a reminder two days before the end (day 13), one on the last day, and a recap once the account is back on free.
  const essai = household?.essai;
  if (essai) {
    const eco = budget?.economies_possibles ?? 0;
    const perdu = [eco > 0 ? `${fmtEuro(eco)} par an d'économies repérées` : null, "la lecture des papiers par l'IA", budget?.nb_transactions ? "le suivi des dépenses" : null].filter(Boolean).join(", ");
    const j = essai.jours_restants ?? 0;
    if (essai.actif && j <= 2) {
      out.push({
        id: `e:fin:${essai.fin.slice(0, 10)}`, kind: "essai",
        titre: j <= 1 ? "Dernier jour de votre plan Famille offert" : `Votre plan Famille offert se termine dans ${j} jours`,
        detail: `Après, votre compte passe en gratuit et met en pause ${perdu}. Vos papiers et vos rappels restent.`,
        quand: today, route: { s: "settings" }, urgent: true,
      });
    }
    if (!essai.actif && household?.plan === "gratuit") {
      out.push({
        id: `e:termine:${essai.fin.slice(0, 10)}`, kind: "essai",
        titre: eco > 0 ? `${fmtEuro(eco)} par an d'économies vous attendent` : "Votre essai est terminé",
        detail: `Votre compte est passé en gratuit : en pause, ${perdu}. Le plan Famille reprend là où vous en étiez, 9,90 € par mois ou 99 € par an.`,
        quand: essai.fin.slice(0, 10), route: { s: "settings" }, urgent: false,
      });
    }
  }
  for (const d of deadlines) {
    const n = daysUntil(d.date);
    if (n <= d.rappel_jours) {
      out.push({
        id: `d:${d.id}`, kind: "echeance",
        titre: `${n < 0 ? "En retard" : relative(d.date)[0].toUpperCase() + relative(d.date).slice(1)} : ${d.titre.replace(/^[^:]+:\s*/, "")}`,
        detail: d.note ?? "", quand: d.date, route: d.document_id ? { s: "doc", id: d.document_id } : { s: "deadlines" }, urgent: n <= 3,
      });
    }
  }
  for (const a of budget?.actions ?? []) {
    if (a.decision === "garde" || a.decision === "resilie") continue;
    if (a.priorite === 1 || a.type === "derive") {
      out.push({
        id: `b:${a.cle}`, kind: "economie", titre: a.titre,
        detail: a.economie_annuelle ? `${fmtEuro(a.economie_annuelle)} ${a.type === "derive" ? "de plus ce mois-ci" : "par an"} · ${a.effort}` : a.detail,
        quand: new Date().toISOString().slice(0, 10), route: { s: "budget" }, urgent: false,
      });
    }
  }
  // Savings alerts on contracts (increase, duplicate, commitment over…): the "info" ones stay on the Budget screen.
  for (const a of charges?.alertes ?? []) {
    if (a.gravite === "info") continue;
    out.push({
      id: `c:${a.type}:${[...a.document_ids].sort().join(",")}`, kind: "economie", titre: a.titre,
      detail: a.economie_estimee ? `Jusqu'à ${fmtEuro(a.economie_estimee)} par an · ${a.detail}` : a.detail,
      quand: today, route: a.document_ids.length === 1 ? { s: "doc", id: a.document_ids[0] } : { s: "budget" }, urgent: false,
    });
  }
  for (const d of docs) {
    if (!d.verifie && (d.confiance ?? 1) < 0.7) {
      out.push({ id: `v:${d.id}`, kind: "verifier", titre: `À vérifier : ${d.title}`, detail: "L'extraction est incertaine. Confirmez les dates et le montant.", quand: d.cree_le.slice(0, 10), route: { s: "doc", id: d.id }, urgent: false });
    }
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.quand.localeCompare(b.quand));
}

export function useNotifications(deadlines: Deadline[], docs: Doc[], budget: BudgetReport | null, household?: Household | null, charges?: ChargesReport | null) {
  const [read, setRead] = useState<Set<string>>(readSet);
  const items = buildNotifications(deadlines, docs, budget, household, charges);
  const unread = items.filter((n) => !read.has(n.id)).length;
  const markRead = (id: string) => { const s = new Set(read); s.add(id); setRead(s); writeSet(s); };
  const markAll = () => { const s = new Set(items.map((n) => n.id)); setRead(s); writeSet(s); };
  useEffect(() => { try { if ("setAppBadge" in navigator) (unread ? (navigator as any).setAppBadge(unread) : (navigator as any).clearAppBadge()); } catch {} }, [unread]);
  return { items, unread, read, markRead, markAll };
}

export function Bell({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <button className="bell" onClick={onClick} aria-label={unread ? `${unread} notifications non lues` : "Notifications"}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 16V11a6 6 0 0112 0v5l2 2H4l2-2zM10 20a2 2 0 004 0" />
      </svg>
      {unread > 0 && <span className="bell-badge">{unread > 9 ? "9+" : unread}</span>}
    </button>
  );
}

export function NotificationsScreen({ items, read, markRead, markAll, go, onBack, api, toast }: {
  items: Notif[]; read: Set<string>; markRead: (id: string) => void; markAll: () => void; go: (s: string, id?: string) => void; onBack: () => void; api: Api; toast: (m: string) => void;
}) {
  const ICON: Record<Notif["kind"], string> = { echeance: "M4 5h16v15H4zM4 9h16M8 3v4M16 3v4", economie: "M12 3v18M7 8h7a3 3 0 010 6H8a3 3 0 000 6h9", verifier: "M12 9v4M12 17h.01M10.3 3.9L2.5 17a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z", info: "M12 8h.01M12 12v4M12 22a10 10 0 100-20 10 10 0 000 20z", essai: "M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" };
  return (
    <div className="screen">
      <button className="back" onClick={onBack}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Retour</button>
      <div className="top"><div><h1>Notifications</h1><p className="sub">{items.length ? `${items.filter((n) => !read.has(n.id)).length} non lue${items.filter((n) => !read.has(n.id)).length > 1 ? "s" : ""}` : "Rien à signaler"}</p></div>{items.length > 0 && <button className="link" onClick={markAll}>Tout lire</button>}</div>
      {items.length === 0 && <div className="empty"><b>Tout est calme</b>Lucien vous préviendra avant chaque échéance et dès qu'une économie est repérée.</div>}
      <ul className="list">
        {items.map((n) => (
          <li key={n.id}>
            <button className={`row-item notif ${read.has(n.id) ? "lu" : ""} ${n.urgent ? "urgent" : ""}`} onClick={() => { markRead(n.id); go(n.route.s, n.route.id); }}>
              <div className="cat" style={n.kind === "economie" || n.kind === "essai" ? { background: "var(--yolk-soft)", color: "#8a6210" } : n.urgent ? { background: "var(--ember-soft)", color: "var(--ember)" } : undefined}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[n.kind]} /></svg>
              </div>
              <div><div className="t">{n.titre}</div>{n.detail && <div className="s">{n.detail}</div>}</div>
              <div className="r">{!read.has(n.id) && <span className="dot" aria-hidden />}</div>
            </button>
          </li>
        ))}
      </ul>
      <PushCard api={api} toast={toast} />
    </div>
  );
}
