import { useEffect, useRef, useState, type ReactNode } from "react";
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

const HEURE = 56; // px per hour in the day view
const minutes = (h: string | null) => { if (!h) return null; const [a, b] = h.split(":").map(Number); return a * 60 + (b || 0); };
type Vue = "jour" | "semaine" | "mois";
const vueInitiale = (): Vue => {
  try { const v = localStorage.getItem("lucien-agenda-vue"); if (v === "jour" || v === "semaine" || v === "mois") return v; } catch { /* storage blocked */ }
  return typeof window !== "undefined" && window.innerWidth < 1024 ? "jour" : "semaine";
};

/**
 * L'agenda de la famille, three ways: a day as a 24-hour notebook page, the week as sticky notes on a planner,
 * or the month. Each activity takes the colour of the person it concerns; tap faces to see only some members.
 */
export function Semainier({ api, membres, semaine, deadlines, go, mois }: { api: Api; membres: Membre[]; semaine: Creneau[]; deadlines: Deadline[]; go: (s: string, id?: string) => void; mois?: (ouvrir: (jour: string) => void) => ReactNode }) {
  const auj = iso(new Date());
  const [vue, setVueEtat] = useState<Vue>(vueInitiale);
  const [jourChoisi, setJourChoisi] = useState(auj);
  const setVue = (v: Vue) => { setVueEtat(v); try { localStorage.setItem("lucien-agenda-vue", v); } catch { /* storage blocked */ } };
  const debut = lundiDe(new Date(`${jourChoisi}T12:00:00`));
  const [choix, setChoix] = useState<string[]>([]);
  const teinte = new Map(membres.map((m, k) => [m.id, TEINTES[k % TEINTES.length]]));
  const choisis = membres.filter((m) => choix.includes(m.id));
  const garde = (s: Creneau) => !choisis.length || (!s.member_id && !s.membre) || choisis.some((m) => pour(s, m));
  const gardeEch = (d: Deadline) => !choisis.length || !d.member_id || choix.includes(d.member_id);
  const concernes = (s: Creneau) => membres.filter((m) => pour(s, m));
  const teinteDe = (s: Creneau) => { const qui = concernes(s); return qui.length === 1 ? teinte.get(qui[0].id) : qui.length ? "multi" : "foyer"; };
  const basculer = (id: string) => setChoix((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const jours = Array.from({ length: 7 }, (_, k) => { const d = new Date(debut); d.setDate(debut.getDate() + k); return d; });
  const decaler = (n: number) => { const d = new Date(`${jourChoisi}T12:00:00`); d.setDate(d.getDate() + n); setJourChoisi(iso(d)); };
  const fin = jours[6];
  const titreSemaine = debut.getMonth() === fin.getMonth()
    ? `${debut.getDate()} – ${fin.getDate()} ${fin.toLocaleDateString("fr-FR", { month: "long" })}`
    : `${debut.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${fin.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
  const titreJour = new Date(`${jourChoisi}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const actsDu = (x: string) => { const j = ((new Date(`${x}T12:00:00`).getDay() + 6) % 7) + 1; return semaine.filter((s) => s.jour === j && garde(s)).sort((a, b) => (a.heure_debut ?? "99").localeCompare(b.heure_debut ?? "99")); };
  const echsDu = (x: string) => deadlines.filter((e) => e.date.slice(0, 10) === x && gardeEch(e));
  const total = jours.reduce((n, d) => n + actsDu(iso(d)).length, 0);
  const ouvrirJour = (x: string) => { setJourChoisi(x); setVue("jour"); };
  const ouvrirAct = (s: Creneau) => (s.activite_id ? go("activite", s.activite_id) : s.member_id ? go("membre", s.member_id) : go("famille"));
  const ouvrirEch = (e: Deadline) => (e.document_id ? go("doc", e.document_id) : e.member_id ? go("membre", e.member_id) : undefined);

  return (
    <section className={`section semainier vue-${vue}`}>
      <div className="sem-tete">
        <div className="sem-titre">
          <div className="sem-ligne1">
            <h2>{vue === "jour" ? "La journée" : vue === "semaine" ? "La semaine" : "Le mois"}</h2>
            <div className="sem-vues" role="tablist" aria-label="Affichage">
              {(["jour", "semaine", "mois"] as Vue[]).map((v) => <button key={v} role="tab" aria-selected={vue === v} className={vue === v ? "on" : ""} onClick={() => setVue(v)}>{v === "jour" ? "Jour" : v === "semaine" ? "Semaine" : "Mois"}</button>)}
            </div>
          </div>
          {vue !== "mois" && (
            <div className="sem-nav">
              <button className="round" aria-label={vue === "jour" ? "Jour précédent" : "Semaine précédente"} onClick={() => decaler(vue === "jour" ? -1 : -7)}>‹</button>
              <b>{vue === "jour" ? titreJour : titreSemaine}</b>
              <button className="round" aria-label={vue === "jour" ? "Jour suivant" : "Semaine suivante"} onClick={() => decaler(vue === "jour" ? 1 : 7)}>›</button>
              {(vue === "jour" ? jourChoisi !== auj : iso(debut) !== iso(lundiDe(new Date()))) && <button className="link" onClick={() => setJourChoisi(auj)}>Aujourd'hui</button>}
            </div>
          )}
        </div>
        {membres.length > 1 && vue !== "mois" && (
          <div className="sem-qui" role="group" aria-label="Afficher l'agenda de">
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

      {vue === "mois" && mois?.(ouvrirJour)}

      {vue === "jour" && (
        <>
          <div className="jr-bande" role="tablist" aria-label="Jour de la semaine">
            {jours.map((d, k) => {
              const x = iso(d), n = actsDu(x).length + echsDu(x).length;
              return (
                <button key={x} role="tab" aria-selected={x === jourChoisi} className={`jr-j${x === jourChoisi ? " on" : ""}${x === auj ? " auj" : ""}`} onClick={() => setJourChoisi(x)}>
                  <span>{JOURS[k].slice(0, 3)}</span><b>{d.getDate()}</b><i>{n > 0 && Array.from({ length: Math.min(n, 3) }, (_, i) => <em key={i} />)}</i>
                </button>
              );
            })}
          </div>
          <Calepin jour={jourChoisi} auj={auj} acts={actsDu(jourChoisi)} echs={echsDu(jourChoisi)} teinteDe={teinteDe} concernes={concernes} api={api} ouvrirAct={ouvrirAct} ouvrirEch={ouvrirEch} />
        </>
      )}

      {vue === "semaine" && (
      <div className="sem-grille">
        {jours.map((d, k) => {
          const x = iso(d);
          const acts = actsDu(x), echs = echsDu(x);
          return (
            <div key={x} className={`sem-jour${x === auj ? " auj" : ""}${x < auj ? " passe" : ""}${k >= 5 ? " we" : ""}`}>
              <button className="sem-date" title="Ouvrir la journée" onClick={() => ouvrirJour(x)}><span>{JOURS[k]}</span><b>{d.getDate()}</b>{x === auj && <em>auj.</em>}</button>
              <div className="sem-notes">
                {echs.map((e) => (
                  <button key={e.id} className="sem-note ech" onClick={() => ouvrirEch(e)}>
                    <span className="sem-pin" aria-hidden>📌</span>
                    <b>{e.titre.replace(/^[^:]+:\s*/, "")}</b>
                    <small>À ne pas oublier</small>
                  </button>
                ))}
                {acts.map((s, i) => {
                  const qui = concernes(s);
                  return (
                    <button key={i} className={`sem-note t-${teinteDe(s)}`} style={{ ["--r" as string]: `${(((k * 3 + i * 5) % 5) - 2) * 0.6}deg` }} onClick={() => ouvrirAct(s)}>
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
      )}
      {vue === "mois" ? null : semaine.length === 0 ? (
        <p className="note sem-pied">Ajoutez les activités de chacun (sport, musique, garde, cantine) avec le jour et l'heure : elles se placent ici toutes seules. <button className="link" onClick={() => go("activite", "nouvelle")}>Ajouter une activité</button></p>
      ) : (
        <p className="note sem-pied">{total} activité{total > 1 ? "s" : ""} {vue === "jour" ? "dans la semaine" : "cette semaine"}{choisis.length ? ` pour ${choisis.map((m) => m.prenom).join(", ")}` : ""} · <button className="link" onClick={() => go("activite", "nouvelle")}>Ajouter une activité</button></p>
      )}
    </section>
  );
}

/** One day as a notebook page: 24 ruled hours, a red margin, each activity a coloured block at its time. */
function Calepin({ jour, auj, acts, echs, teinteDe, concernes, api, ouvrirAct, ouvrirEch }: {
  jour: string; auj: string; acts: Creneau[]; echs: Deadline[]; teinteDe: (s: Creneau) => string | undefined; concernes: (s: Creneau) => Membre[];
  api: Api; ouvrirAct: (s: Creneau) => void; ouvrirEch: (e: Deadline) => void;
}) {
  const boite = useRef<HTMLDivElement>(null);
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setMaintenant(new Date()), 60_000); return () => clearInterval(t); }, []);
  const horaires = acts.filter((s) => minutes(s.heure_debut) != null);
  const journee = acts.filter((s) => minutes(s.heure_debut) == null);
  // side-by-side columns when two activities overlap
  const places = horaires.map((s) => { const d = minutes(s.heure_debut)!; const f = Math.max(minutes(s.heure_fin) ?? d + 60, d + 30); return { s, d, f, col: 0, cols: 1 }; });
  for (const p of places) { const avant = places.filter((q) => q !== p && q.d < p.f && p.d < q.f && places.indexOf(q) < places.indexOf(p)); while (avant.some((q) => q.col === p.col)) p.col++; }
  for (const p of places) p.cols = Math.max(...places.filter((q) => q.d < p.f && p.d < q.f).map((q) => q.col)) + 1;
  const premier = places.length ? Math.min(...places.map((p) => p.d)) : 8 * 60;
  useEffect(() => {
    const cible = jour === auj ? maintenant.getHours() * 60 + maintenant.getMinutes() - 120 : premier - 45;
    boite.current?.scrollTo({ top: Math.max(0, (cible / 60) * HEURE), behavior: "smooth" });
  }, [jour]); // eslint-disable-line react-hooks/exhaustive-deps
  const minNow = maintenant.getHours() * 60 + maintenant.getMinutes();
  return (
    <div className="calepin">
      {(echs.length > 0 || journee.length > 0) && (
        <div className="cp-journee">
          {echs.map((e) => <button key={e.id} className="cp-etiq ech" onClick={() => ouvrirEch(e)}>📌 {e.titre.replace(/^[^:]+:\s*/, "")}</button>)}
          {journee.map((s, i) => <button key={i} className={`cp-etiq t-${teinteDe(s)}`} onClick={() => ouvrirAct(s)}>{emoji(s.titre, s.type)} {s.titre}</button>)}
        </div>
      )}
      <div className="cp-page" ref={boite}>
        <div className="cp-heures" style={{ height: 24 * HEURE }}>
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="cp-h" style={{ top: h * HEURE }}><span>{String(h).padStart(2, "0")}:00</span></div>)}
          {jour === auj && <div className="cp-now" style={{ top: (minNow / 60) * HEURE }}><span>{String(maintenant.getHours()).padStart(2, "0")}:{String(maintenant.getMinutes()).padStart(2, "0")}</span></div>}
          <div className="cp-zone">
            {places.map((p, i) => {
              const qui = concernes(p.s);
              const court = p.f - p.d < 50;
              return (
                <button key={i} className={`cp-bloc t-${teinteDe(p.s)}${court ? " court" : ""}`} onClick={() => ouvrirAct(p.s)}
                  style={{ top: (p.d / 60) * HEURE + 1, height: ((p.f - p.d) / 60) * HEURE - 3, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)` }}>
                  <span className="cp-t"><b>{emoji(p.s.titre, p.s.type)} {p.s.titre}</b><small>{p.s.heure_debut}{p.s.heure_fin ? `–${p.s.heure_fin}` : ""}{p.s.lieu ? ` · ${p.s.lieu}` : ""}</small></span>
                  {qui.length > 0 && <span className="sem-visages">{qui.slice(0, 4).map((m) => <Portrait key={m.id} api={api} m={m} size={court ? 18 : 24} />)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {!acts.length && !echs.length && <p className="cp-libre">Journée libre : rien de prévu.</p>}
    </div>
  );
}
