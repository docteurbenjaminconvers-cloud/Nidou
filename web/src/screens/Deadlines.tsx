import { Bell } from "../notifications";
import { useState, type ReactNode } from "react";
import type { Api } from "../api";
import type { Deadline, FamilleReport, Household } from "../types";
import { agendaIcs } from "../../../server/src/ics";
import { DateChip, daysUntil, relative } from "../ui";

const TYPE_LABEL: Record<string, string> = {
  resiliation: "Résiliation", renouvellement: "Renouvellement", expiration: "Expiration", garantie: "Garantie",
  sante: "Santé", declaration: "Déclaration", echeance: "Échéance", famille: "Famille",
};

export function Deadlines({ deadlines, go, onDone, unread, semaine, extra }: { deadlines: Deadline[]; go: (s: string, id?: string) => void; onDone: (id: string) => void; unread: number; semaine?: { jour: number; heure_debut: string | null; titre: string; membre: string | null; lieu: string | null }[]; extra?: ReactNode }) {
  const todayIdx = ((new Date().getDay() + 6) % 7) + 1;
  const aujourdhui = (semaine ?? []).filter((s) => s.jour === todayIdx);
  const demain = (semaine ?? []).filter((s) => s.jour === (todayIdx % 7) + 1);
  const groups: { label: string; items: Deadline[] }[] = [
    { label: "En retard", items: deadlines.filter((d) => daysUntil(d.date) < 0) },
    { label: "Ce mois-ci", items: deadlines.filter((d) => daysUntil(d.date) >= 0 && daysUntil(d.date) <= 30) },
    { label: "Dans 1 à 3 mois", items: deadlines.filter((d) => daysUntil(d.date) > 30 && daysUntil(d.date) <= 90) },
    { label: "Plus tard", items: deadlines.filter((d) => daysUntil(d.date) > 90) },
  ].filter((g) => g.items.length);

  return (
    <div className="screen">
      <div className="top"><div><h1>Agenda</h1><p className="sub">{deadlines.length} échéance{deadlines.length > 1 ? "s" : ""} à venir, d'après vos papiers et votre famille</p></div><Bell unread={unread} onClick={() => go("notifs")} /></div>
      {semaine && semaine.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Aujourd'hui et demain</h2><button className="link" onClick={() => go("famille")}>Toute la semaine</button></div>
          {[["Aujourd'hui", aujourdhui], ["Demain", demain]].map(([label, items]) => (
            <div key={label as string} style={{ marginBottom: 8 }}>
              <div className="s" style={{ color: "var(--mist)", fontSize: 13, marginBottom: 4 }}>{label as string}</div>
              {(items as typeof aujourdhui).length === 0 ? <p className="note">Rien de prévu.</p> : (items as typeof aujourdhui).map((s, i) => (
                <div key={i} className="slot" style={{ padding: "6px 0" }}><span className="h">{s.heure_debut ?? "—"}</span><span className="w"><b>{s.titre}</b>{s.membre ? ` · ${s.membre}` : ""}{s.lieu ? <small>{s.lieu}</small> : null}</span></div>
              ))}
            </div>
          ))}
        </section>
      )}
      {deadlines.length === 0 && <div className="empty"><b>Aucune échéance</b>Ajoutez un contrat, une facture ou une pièce d'identité.</div>}
      {extra}
      {groups.map((g) => (
        <section className="section" key={g.label}>
          <div className="section-head"><h2>{g.label}</h2></div>
          <ul className="list">
            {g.items.map((d) => (
              <li key={d.id}>
                <div className="row-item">
                  <DateChip iso={d.date} />
                  <div>
                    <div className="t">{d.titre.replace(/^[^:]+:\s*/, "")}</div>
                    <div className="s">{TYPE_LABEL[d.type] ?? d.type} · {relative(d.date)}{d.note ? ` · ${d.note}` : ""}</div>
                    <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                      {d.document_id && <button className="link" onClick={() => go("doc", d.document_id!)}>Document</button>}
                      {d.type === "famille" && <button className="link" onClick={() => go(d.member_id ? "membre" : "famille", d.member_id ?? undefined)}>Famille</button>}
                      <button className="link" onClick={() => onDone(d.id)}>C'est fait</button>
                    </div>
                  </div>
                  <span />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** « Dans l'agenda de votre téléphone » : abonnement .ics (Google, Apple, Outlook), ou fichier à importer en démo. */
export function AgendaTelephone({ api, deadlines, famille, household, toast }: { api: Api; deadlines: Deadline[]; famille: FamilleReport | null; household: Household; toast: (m: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const demo = api.mode === "demo";
  const ouvrir = async () => {
    setOuvert(true);
    if (!demo && !url) try { setUrl((await api.agendaLien()).url); } catch { toast("Lien indisponible, réessayez"); }
  };
  const telecharger = () => {
    const ics = agendaIcs({ foyer: household.nom, echeances: deadlines.map((d) => ({ id: d.id, titre: d.titre, date: d.date, rappel_jours: d.rappel_jours, note: d.note })), creneaux: famille?.semaine ?? [] });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "lucien-agenda.ics"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const webcal = url?.replace(/^https?:/, "webcal:");
  return (
    <section className="section agenda-tel">
      {!ouvert ? (
        <button className="agenda-tel-carte" onClick={ouvrir}>
          <span className="agenda-tel-ico" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM9 7h6M9 11h6M11 18h2" /></svg></span>
          <span><b>Dans l'agenda de votre téléphone</b><span>Échéances et activités des enfants dans Google, Apple ou Outlook, mises à jour toutes seules.</span></span>
        </button>
      ) : (
        <div className="lock">
          <b>Dans l'agenda de votre téléphone</b>
          <p>{demo ? "Dans votre compte, vous vous abonnez une fois : chaque nouvelle échéance apparaît d'elle-même. En démo, téléchargez le fichier et ouvrez-le avec votre agenda." : "Abonnez-vous une fois : chaque échéance et chaque activité apparaissent d'elles-mêmes, avec un rappel avant."}</p>
          {demo ? <button className="btn block" onClick={telecharger}>Télécharger l'agenda (.ics)</button> : url && (
            <div style={{ display: "grid", gap: 8 }}>
              <a className="btn block" href={webcal}>iPhone, iPad, Mac, Outlook</a>
              <a className="btn ghost block" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal!)}`} target="_blank" rel="noreferrer">Google Agenda</a>
              <button className="link" onClick={async () => { try { await navigator.clipboard.writeText(url); toast("Lien copié"); } catch { toast(url); } }}>Copier le lien</button>
              <p className="note">Ce lien est personnel : il donne accès à vos dates. <button className="link" onClick={async () => { if (!confirm("Changer le lien ? Les agendas déjà abonnés ne se mettront plus à jour.")) return; setUrl((await api.agendaLienNouveau()).url); toast("Nouveau lien créé"); }}>Changer le lien</button></p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
