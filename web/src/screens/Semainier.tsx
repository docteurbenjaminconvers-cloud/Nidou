import { useState } from "react";
import type { Api } from "../api";
import type { Creneau, Deadline, FamilleReport } from "../types";
import { Portrait, pour } from "./Famille";

type Membre = FamilleReport["membres"][number];
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
/** One pastel per person, in the order of the family: the same colour everywhere in the week. */
const TEINTES = ["lilas", "peche", "menthe", "soleil", "ciel", "rose", "sauge"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lundiDe = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const EMOJI: [RegExp, string][] = [
  [/cantine|repas|déjeuner/i, "🍽️"], [/judo|karat|boxe|lutte/i, "🥋"], [/foot|soccer/i, "⚽"], [/basket/i, "🏀"], [/tennis|padel/i, "🎾"],
  [/natation|piscine|nage/i, "🏊"], [/danse|ballet/i, "🩰"], [/piano|guitare|violon|musique|conservatoire|solf/i, "🎵"], [/théâtre|theatre/i, "🎭"],
  [/dessin|peinture|art/i, "🎨"], [/équitation|poney|cheval/i, "🐴"], [/gym|sport|athlé|course/i, "🏃"], [/anglais|cours|soutien|devoirs/i, "📚"],
  [/garde|nounou|baby|périscolaire|garderie/i, "🧸"], [/scout/i, "⛺"], [/médecin|orthodont|dentiste|kiné|ortho/i, "🩺"],
];
const emoji = (titre: string, type: string) => EMOJI.find(([r]) => r.test(`${titre} ${type}`))?.[1] ?? "✨";

/**
 * Le semainier : the family's week as a paper planner, one column per day, each activity a coloured sticky note
 * in the colour of the person it concerns. Tap faces to see only some members.
 */
export function Semainier({ api, membres, semaine, deadlines, go }: { api: Api; membres: Membre[]; semaine: Creneau[]; deadlines: Deadline[]; go: (s: string, id?: string) => void }) {
  const [debut, setDebut] = useState(() => lundiDe(new Date()));
  const [choix, setChoix] = useState<string[]>([]);
  const auj = iso(new Date());
  const teinte = new Map(membres.map((m, k) => [m.id, TEINTES[k % TEINTES.length]]));
  const choisis = membres.filter((m) => choix.includes(m.id));
  const garde = (s: Creneau) => !choisis.length || (!s.member_id && !s.membre) || choisis.some((m) => pour(s, m));
  const gardeEch = (d: Deadline) => !choisis.length || !d.member_id || choix.includes(d.member_id);
  const concernes = (s: Creneau) => membres.filter((m) => pour(s, m));
  const basculer = (id: string) => setChoix((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const jours = Array.from({ length: 7 }, (_, k) => { const d = new Date(debut); d.setDate(debut.getDate() + k); return d; });
  const decaler = (n: number) => { const d = new Date(debut); d.setDate(d.getDate() + 7 * n); setDebut(d); };
  const fin = jours[6];
  const titre = debut.getMonth() === fin.getMonth()
    ? `${debut.getDate()} – ${fin.getDate()} ${fin.toLocaleDateString("fr-FR", { month: "long" })}`
    : `${debut.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${fin.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
  const cetteSemaine = iso(debut) === iso(lundiDe(new Date()));
  const total = jours.reduce((n, d) => n + semaine.filter((s) => s.jour === ((d.getDay() + 6) % 7) + 1 && garde(s)).length, 0);

  return (
    <section className="section semainier">
      <div className="sem-tete">
        <div className="sem-titre">
          <h2>La semaine de la famille</h2>
          <div className="sem-nav">
            <button className="round" aria-label="Semaine précédente" onClick={() => decaler(-1)}>‹</button>
            <b>{titre}</b>
            <button className="round" aria-label="Semaine suivante" onClick={() => decaler(1)}>›</button>
            {!cetteSemaine && <button className="link" onClick={() => setDebut(lundiDe(new Date()))}>Cette semaine</button>}
          </div>
        </div>
        {membres.length > 1 && (
          <div className="sem-qui" role="group" aria-label="Afficher la semaine de">
            <button className={`sem-pers tous${!choix.length ? " on" : ""}`} aria-pressed={!choix.length} onClick={() => setChoix([])}><span className="sem-tous">Tous</span></button>
            {membres.map((m) => (
              <button key={m.id} className={`sem-pers t-${teinte.get(m.id)}${choix.includes(m.id) ? " on" : ""}`} aria-pressed={choix.includes(m.id)} onClick={() => basculer(m.id)}>
                <Portrait api={api} m={m} size={34} />
                <span>{m.prenom.replace(/^(mamie|papi|papy|mamy)\s+/i, "")}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sem-grille">
        {jours.map((d, k) => {
          const x = iso(d), jour = k + 1;
          const acts = semaine.filter((s) => s.jour === jour && garde(s)).sort((a, b) => (a.heure_debut ?? "99").localeCompare(b.heure_debut ?? "99"));
          const echs = deadlines.filter((e) => e.date.slice(0, 10) === x && gardeEch(e));
          return (
            <div key={x} className={`sem-jour${x === auj ? " auj" : ""}${x < auj ? " passe" : ""}${k >= 5 ? " we" : ""}`}>
              <div className="sem-date"><span>{JOURS[k]}</span><b>{d.getDate()}</b>{x === auj && <em>auj.</em>}</div>
              <div className="sem-notes">
                {echs.map((e) => (
                  <button key={e.id} className="sem-note ech" onClick={() => e.document_id ? go("doc", e.document_id) : e.member_id ? go("membre", e.member_id) : undefined}>
                    <span className="sem-pin" aria-hidden>📌</span>
                    <b>{e.titre.replace(/^[^:]+:\s*/, "")}</b>
                    <small>À ne pas oublier</small>
                  </button>
                ))}
                {acts.map((s, i) => {
                  const qui = concernes(s);
                  const t = qui.length === 1 ? teinte.get(qui[0].id) : qui.length ? "multi" : "foyer";
                  return (
                    <button key={i} className={`sem-note t-${t}`} style={{ ["--r" as string]: `${(((k * 3 + i * 5) % 5) - 2) * 0.6}deg` }} onClick={() => s.activite_id ? go("activite", s.activite_id) : s.member_id ? go("membre", s.member_id) : go("famille")}>
                      <span className="sem-h">{s.heure_debut ?? "Journée"}{s.heure_fin ? `–${s.heure_fin}` : ""}</span>
                      <b><span aria-hidden>{emoji(s.titre, s.type)}</span> {s.titre}</b>
                      {s.lieu && <small>{s.lieu}</small>}
                      {qui.length > 0 && <span className="sem-visages">{qui.slice(0, 4).map((m) => <Portrait key={m.id} api={api} m={m} size={22} />)}</span>}
                    </button>
                  );
                })}
                {!acts.length && !echs.length && <p className="sem-vide">{k >= 5 ? "Week-end libre ☀︎" : "Rien de prévu"}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {semaine.length === 0 ? (
        <p className="note sem-pied">Ajoutez les activités de chacun (sport, musique, garde, cantine) avec le jour et l'heure : elles se placent ici toutes seules. <button className="link" onClick={() => go("activite", "nouvelle")}>Ajouter une activité</button></p>
      ) : (
        <p className="note sem-pied">{total} activité{total > 1 ? "s" : ""} cette semaine{choisis.length ? ` pour ${choisis.map((m) => m.prenom).join(", ")}` : ""} · <button className="link" onClick={() => go("activite", "nouvelle")}>Ajouter une activité</button></p>
      )}
    </section>
  );
}
