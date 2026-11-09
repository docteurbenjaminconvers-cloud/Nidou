import { Bell } from "../notifications";
import { useState, type ReactNode } from "react";
import type { Api } from "../api";
import type { Creneau as CreneauFamille, Deadline, FamilleReport, Household } from "../types";
import { agendaIcs } from "../../../server/src/ics";
import { DateChip, daysUntil, relative } from "../ui";
import { Semainier } from "./Semainier";

const TYPE_LABEL: Record<string, string> = {
  resiliation: "Résiliation", renouvellement: "Renouvellement", expiration: "Expiration", garantie: "Garantie",
  sante: "Santé", declaration: "Déclaration", echeance: "Échéance", famille: "Famille", situation: "Situation de vie",
};

export function Deadlines({ api, membres, deadlines, go, onDone, unread, semaine, extra }: { api?: Api; membres?: FamilleReport["membres"]; deadlines: Deadline[]; go: (s: string, id?: string) => void; onDone: (id: string) => void; unread: number; semaine?: CreneauFamille[]; extra?: ReactNode }) {
  const groups: { label: string; items: Deadline[] }[] = [
    { label: "En retard", items: deadlines.filter((d) => daysUntil(d.date) < 0) },
    { label: "Ce mois-ci", items: deadlines.filter((d) => daysUntil(d.date) >= 0 && daysUntil(d.date) <= 30) },
    { label: "Dans 1 à 3 mois", items: deadlines.filter((d) => daysUntil(d.date) > 30 && daysUntil(d.date) <= 90) },
    { label: "Plus tard", items: deadlines.filter((d) => daysUntil(d.date) > 90) },
  ].filter((g) => g.items.length);

  return (
    <div className="screen colonnes agenda">
      <div className="top"><div><h1>Agenda</h1><p className="sub">{deadlines.length} échéance{deadlines.length > 1 ? "s" : ""} à venir, d'après vos papiers et votre famille</p></div><Bell unread={unread} onClick={() => go("notifs")} /></div>
      {api && membres
        ? <Semainier api={api} membres={membres} semaine={semaine ?? []} deadlines={deadlines} go={go} mois={(ouvrir) => <Calendrier deadlines={deadlines} semaine={semaine ?? []} go={go} onDone={onDone} onOuvrir={ouvrir} />} />
        : <Calendrier deadlines={deadlines} semaine={semaine ?? []} go={go} onDone={onDone} />}
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
                      {d.type === "situation" && <button className="link" onClick={() => go("situations")}>Situation</button>}
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

type Creneau = { jour: number; heure_debut: string | null; titre: string; membre: string | null; lieu: string | null };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

/** A month you can click through: each day shows its deadlines and the family's weekly activities. */
function Calendrier({ deadlines, semaine, go, onDone, onOuvrir }: { deadlines: Deadline[]; semaine: Creneau[]; go: (s: string, id?: string) => void; onDone: (id: string) => void; onOuvrir?: (jour: string) => void }) {
  const auj = iso(new Date());
  const [mois, setMois] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [choisi, setChoisi] = useState(auj);
  const parJour = new Map<string, Deadline[]>();
  for (const d of deadlines) parJour.set(d.date.slice(0, 10), [...(parJour.get(d.date.slice(0, 10)) ?? []), d]);
  const jourSemaine = (x: string) => ((new Date(`${x}T12:00:00`).getDay() + 6) % 7) + 1;
  const activites = (x: string) => semaine.filter((c) => c.jour === jourSemaine(x)).sort((a, b) => (a.heure_debut ?? "99").localeCompare(b.heure_debut ?? "99"));
  // 6 rows of 7 days, starting on the Monday on or before the 1st
  const debut = new Date(mois); debut.setDate(1 - ((mois.getDay() + 6) % 7));
  const cases = Array.from({ length: 42 }, (_, k) => { const d = new Date(debut); d.setDate(debut.getDate() + k); return d; });
  const lignes = cases[35].getMonth() !== mois.getMonth() ? cases.slice(0, 35) : cases;
  const changer = (n: number) => setMois(new Date(mois.getFullYear(), mois.getMonth() + n, 1));
  const echeances = parJour.get(choisi) ?? [];
  const acts = activites(choisi);
  const titreJour = new Date(`${choisi}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return (
    <section className={`section calendrier${onOuvrir ? " dans-agenda" : ""}`}>
      <div className="cal-mois">
        <div className="cal-tete">
          <button className="round" aria-label="Mois précédent" onClick={() => changer(-1)}>‹</button>
          <b>{mois.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</b>
          <button className="round" aria-label="Mois suivant" onClick={() => changer(1)}>›</button>
        </div>
        <div className="cal-grille" role="grid" aria-label="Choisir un jour">
          {JOURS.map((j) => <span key={j} className="cal-jsem">{j}</span>)}
          {lignes.map((d) => {
            const x = iso(d), e = parJour.get(x)?.length ?? 0, a = activites(x).length;
            return (
              <button key={x} role="gridcell" className={`cal-jour${d.getMonth() !== mois.getMonth() ? " hors" : ""}${x === auj ? " auj" : ""}${x < auj ? " passe" : ""}`} aria-selected={x === choisi} aria-label={`${d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}${e ? `, ${e} échéance${e > 1 ? "s" : ""}` : ""}${a ? `, ${a} activité${a > 1 ? "s" : ""}` : ""}`} onClick={() => setChoisi(x)}>
                <span>{d.getDate()}</span>
                <i className="cal-points">{e > 0 && <em className="ech" />}{a > 0 && <em className="act" />}</i>
              </button>
            );
          })}
        </div>
        <div className="cal-legende"><span><em className="ech" />échéance</span><span><em className="act" />activité</span>{choisi !== auj && <button className="link" onClick={() => { setChoisi(auj); const d = new Date(); setMois(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Aujourd'hui</button>}</div>
      </div>
      <div className="cal-detail">
        <h3>{choisi === auj ? "Aujourd'hui, " : ""}{titreJour}</h3>
        {echeances.length === 0 && acts.length === 0 && <p className="note">Rien de prévu ce jour-là.</p>}
        {echeances.map((d) => (
          <div key={d.id} className="cal-item ech">
            <b>{d.titre.replace(/^[^:]+:\s*/, "")}</b>
            <span>{TYPE_LABEL[d.type] ?? d.type}{d.note ? ` · ${d.note}` : ""}</span>
            <div className="cal-actions">
              {d.document_id && <button className="link" onClick={() => go("doc", d.document_id!)}>Document</button>}
              {d.type === "famille" && <button className="link" onClick={() => go(d.member_id ? "membre" : "famille", d.member_id ?? undefined)}>Famille</button>}
              <button className="link" onClick={() => onDone(d.id)}>C'est fait</button>
            </div>
          </div>
        ))}
        {acts.map((c, k) => (
          <div key={k} className="cal-item act"><b><span className="h">{c.heure_debut ?? "—"}</span> {c.titre}</b><span>{[c.membre, c.lieu].filter(Boolean).join(" · ")}</span></div>
        ))}
        {onOuvrir ? <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => onOuvrir(choisi)}>Ouvrir la journée</button>
          : acts.length > 0 && <button className="link" style={{ marginTop: 6 }} onClick={() => go("famille")}>Toute la semaine de la famille</button>}
      </div>
    </section>
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
