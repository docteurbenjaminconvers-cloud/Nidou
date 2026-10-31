import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Api } from "../api";
import type { Activite, Conseil, Creneau, Deadline, Doc, FamilleReport, Household, Member, Role } from "../types";
import { Bell } from "../notifications";
import { Back, fmtDate, fmtEuro, Logo } from "../ui";
import { VeilleCard, estProtegeable } from "./Veille";

export const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const JOURS_COURT = ["", "lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const ROLE_LABEL: Record<Role, string> = { adulte: "Adulte", enfant: "Enfant", parent_a_charge: "Parent à charge", autre_a_charge: "Personne à charge" };
const NIVEAU_LABEL: Record<string, string> = { petite_enfance: "petite enfance", maternelle: "maternelle", primaire: "primaire", college: "collège", lycee: "lycée", terminale: "terminale", superieur: "études supérieures", adulte: "", inconnu: "" };
const CAT_LABEL: Record<Conseil["categorie"], string> = { aide: "Aide", impots: "Impôts", budget: "Budget", organisation: "Organisation", legal: "Cadre légal" };
const TYPES_ACTIVITE = ["sport", "musique", "art", "soutien", "garde", "sante", "autre"];
const TYPE_LABEL: Record<string, string> = { sport: "Sport", musique: "Musique", art: "Art", soutien: "Soutien scolaire", garde: "Garde", sante: "Rendez-vous", autre: "Autre", cantine: "Cantine" };

type Membre = FamilleReport["membres"][number];
type Go = (s: string, id?: string) => void;
const ROLE_ORDRE: Record<Role, number> = { adulte: 0, enfant: 1, parent_a_charge: 2, autre_a_charge: 3 };
const ROLES_AJOUT: { role: Role; label: string }[] = [{ role: "adulte", label: "Adulte" }, { role: "enfant", label: "Enfant" }, { role: "parent_a_charge", label: "Parent âgé" }, { role: "autre_a_charge", label: "Autre proche" }];
const isoJour = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const joursAvant = (date: string) => Math.round((new Date(date + "T00:00:00").getTime() - new Date(isoJour(new Date()) + "T00:00:00").getTime()) / 864e5);
const dans = (n: number) => (n <= 0 ? "aujourd'hui" : n === 1 ? "demain" : `dans ${n} jours`);
/** Does this slot concern this member? (the canteen is one slot for several children) */
const pour = (s: Creneau, m: Pick<Member, "id" | "prenom">) => s.member_id === m.id || (!s.member_id && !!s.membre && s.membre.split(", ").includes(m.prenom));

/** Round portrait: the photo when there is one, otherwise the initial on the role's colour. */
export function Portrait({ api, m, size = 56, className = "" }: { api: Api; m: Pick<Member, "id" | "prenom" | "role" | "photo">; size?: number; className?: string }) {
  const url = api.photoUrl(m);
  const [ko, setKo] = useState(false);
  useEffect(() => setKo(false), [url]);
  return (
    <span className={`portrait ${m.role} ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden>
      {url && !ko ? <img src={url} alt="" loading="lazy" onError={() => setKo(true)} /> : m.prenom.replace(/^(mamie|papi|papy|mamy|tata|tonton)\s+/i, "").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Square crop, 480 px, JPEG: a portrait weighs ~40 Ko whatever the phone sends. */
async function reduirePhoto(f: File): Promise<Blob> {
  const img = await createImageBitmap(f).catch(() => null);
  if (!img) throw new Error("Cette image ne peut pas être lue. Essayez une photo JPEG ou PNG.");
  const c = Math.min(img.width, img.height), n = Math.min(480, c);
  const cv = document.createElement("canvas"); cv.width = n; cv.height = n;
  // a little higher than the centre: faces are rarely at the very middle of a photo
  cv.getContext("2d")!.drawImage(img, (img.width - c) / 2, Math.max(0, (img.height - c) * 0.35), c, c, 0, 0, n, n);
  return await new Promise<Blob>((ok, ko) => cv.toBlob((b) => (b ? ok(b) : ko(new Error("Photo illisible"))), "image/jpeg", 0.86));
}

/** Tap the portrait to take or pick a photo (the phone offers camera or gallery). */
export function ChoixPhoto({ api, m, onDone, toast, children }: { api: Api; m: Member; onDone: (m: Member) => void; toast: (t: string) => void; children: ReactNode }) {
  const ref = useRef<HTMLInputElement>(null);
  const [envoi, setEnvoi] = useState(false);
  const choisi = async (f: File | undefined) => {
    if (!f) return;
    setEnvoi(true);
    try { onDone(await api.setMemberPhoto(m.id, await reduirePhoto(f))); toast(`Photo de ${m.prenom} enregistrée`); }
    catch (e) { toast((e as Error).message); }
    finally { setEnvoi(false); if (ref.current) ref.current.value = ""; }
  };
  return (
    <button className={`choix-photo ${envoi ? "envoi" : ""}`} onClick={() => ref.current?.click()} aria-label={m.photo ? `Changer la photo de ${m.prenom}` : `Ajouter une photo de ${m.prenom}`}>
      {children}
      <span className="choix-photo-ico" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg></span>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => choisi(e.target.files?.[0])} />
    </button>
  );
}

export function Famille({ api, household, go, unread, onChanged, toast, sel, docs, deadlines }: { api: Api; household: Household; go: Go; unread: number; onChanged: () => void; toast: (m: string) => void; sel?: string; docs: Doc[]; deadlines: Deadline[] }) {
  const [f, setF] = useState<FamilleReport | null>(null);
  const [adding, setAdding] = useState<Role | null>(null);
  const [prenom, setPrenom] = useState("");
  const load = async () => setF(await api.famille());
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // keep the selected face visible in the strip
  useEffect(() => { strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }, [sel, f]);

  if (!f) return <div className="screen"><div className="top"><h1>Famille</h1></div><p className="note">Chargement…</p></div>;

  const membres = [...f.membres].sort((a, b) => ROLE_ORDRE[a.role] - ROLE_ORDRE[b.role] || (b.age ?? 0) - (a.age ?? 0));
  // Living alone: the page is simply "me", with an option to add a relative whose papers one also handles.
  const solo = membres.length === 1;
  const choisi = membres.find((m) => m.id === sel) ?? (solo ? membres[0] : null);
  const addMember = async () => {
    if (!prenom.trim() || !adding) return;
    try {
      const m = await api.addMember({ prenom: prenom.trim(), role: adding });
      setPrenom(""); setAdding(null); await load(); onChanged();
      go("famille", m.id); // straight to the new member, ready for a photo
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="screen famille">
      <div className="top"><div><h1>{solo ? "Mon foyer" : "Famille"}</h1><p className="sub">{solo ? (f.situation === "couple" ? "En couple" : "Vous vivez seul·e") : <>{f.composition.adultes} adulte{f.composition.adultes > 1 ? "s" : ""}{f.composition.enfants ? ` · ${f.composition.enfants} enfant${f.composition.enfants > 1 ? "s" : ""}` : ""}{f.composition.a_charge ? ` · ${f.composition.a_charge} à charge` : ""}</>}</p></div><Bell unread={unread} onClick={() => go("notifs")} /></div>

      <div className="trombi" ref={strip} role="tablist" aria-label="Membres de la famille">
        {!solo && <button role="tab" className="trombi-m" aria-selected={!choisi} onClick={() => go("famille")}>
          <span className="trombi-tous" aria-hidden>{membres.slice(0, 4).map((m) => <Portrait key={m.id} api={api} m={m} size={30} />)}{membres.length === 0 && <span className="portrait adulte" style={{ width: 30, height: 30 }}>+</span>}</span>
          <b>Tous</b>
        </button>}
        {membres.map((m) => (
          <button role="tab" key={m.id} className="trombi-m" aria-selected={choisi?.id === m.id} onClick={() => go("famille", m.id)}>
            <Portrait api={api} m={m} size={64} />
            <b>{m.prenom}</b>
            <small>{m.age !== null ? `${m.age} ans` : ROLE_LABEL[m.role]}</small>
          </button>
        ))}
        <button className="trombi-m trombi-plus" onClick={() => { setAdding(adding ? null : "enfant"); setPrenom(""); }} aria-expanded={!!adding}>
          <span className="portrait plus" style={{ width: 64, height: 64 }} aria-hidden><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span>
          <b>{solo ? "Un proche" : "Ajouter"}</b>
        </button>
      </div>

      {adding && (
        <div className="lock ajout-membre">
          <div className="pills">{ROLES_AJOUT.map((r) => <button key={r.role} className="pill" aria-pressed={adding === r.role} onClick={() => setAdding(r.role)}>{r.label}</button>)}</div>
          <input className="in" placeholder="Prénom" value={prenom} onChange={(e) => setPrenom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMember()} autoFocus />
          <p className="note" style={{ margin: "8px 0 0" }}>{adding === "enfant" ? "École, cantine, activités : Lucien suit ensuite les dates qui comptent pour lui." : adding === "adulte" ? "Vous, ou votre conjoint·e." : "Un parent âgé ou un proche dont vous gérez les papiers, avec son accord."}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}><button className="btn" onClick={addMember}>Ajouter</button><button className="btn ghost" onClick={() => setAdding(null)}>Annuler</button></div>
        </div>
      )}

      {solo && !adding && (
        <div className="solo-carte">
          <b>Lucien s'occupe de vous, tout simplement.</b>
          <p>Vos papiers, vos dates, votre budget, votre semaine : tout est ici. Si vous gérez aussi les papiers d'un proche (un parent âgé, un enfant en garde alternée), ajoutez-le avec le bouton « Un proche ». Sinon, il n'y a rien d'autre à faire.</p>
          <div className="pills" role="group" aria-label="Situation">
            <button className="pill" aria-pressed={f.situation !== "couple"} onClick={async () => { await api.setSituation("seul"); await load(); onChanged(); }}>Je vis seul·e</button>
            <button className="pill" aria-pressed={f.situation === "couple"} onClick={async () => { await api.setSituation("couple"); await load(); onChanged(); }}>En couple</button>
          </div>
        </div>
      )}

      {choisi
        ? <VueMembre key={choisi.id} moi={choisi.prenom === "Moi" || (!!household.utilisateur?.prenom && choisi.prenom.toLowerCase() === household.utilisateur.prenom.toLowerCase())} api={api} f={f} m={choisi} go={go} docs={docs} deadlines={deadlines} toast={toast} onPhoto={async () => { await load(); onChanged(); }} />
        : <VueFamille api={api} f={f} membres={membres} go={go} onSituation={async (s) => { await api.setSituation(s); await load(); onChanged(); }} />}
    </div>
  );
}

/** Everyone at once: today, the week, what the children cost, key dates, advice. */
function VueFamille({ api, f, membres, go, onSituation }: { api: Api; f: FamilleReport; membres: Membre[]; go: Go; onSituation: (s: "seul" | "couple") => void }) {
  const todayIdx = ((new Date().getDay() + 6) % 7) + 1;
  const parId = new Map(membres.map((m) => [m.id, m]));
  const qui = (s: Creneau) => membres.filter((m) => pour(s, m));
  const Visages = ({ s }: { s: Creneau }) => <span className="visages">{qui(s).map((m) => <Portrait key={m.id} api={api} m={m} size={26} />)}</span>;
  const aujourdhui = f.semaine.filter((s) => s.jour === todayIdx).sort((a, b) => (a.heure_debut ?? "").localeCompare(b.heure_debut ?? ""));
  const dates = f.echeances.filter((e) => !e.fait).slice(0, 6);

  return (
    <>
      {membres.length === 0 && <p className="note" style={{ marginTop: 14 }}>Commencez par vous, puis ajoutez chaque membre du foyer avec sa photo : Lucien organise ensuite la semaine, les papiers et les dates de chacun.</p>}

      <section className="section aujourdhui-famille">
        <div className="section-head"><h2>Aujourd'hui</h2><span className="badge">{fmtDate(isoJour(new Date()), { weekday: "long", day: "numeric", month: "long" })}</span></div>
        {aujourdhui.length === 0 ? <p className="note">Rien de prévu aujourd'hui dans l'agenda de la famille.</p> : (
          <ol className="fil">
            {aujourdhui.map((s, i) => (
              <li key={i}><button onClick={() => s.activite_id ? go("activite", s.activite_id) : s.member_id ? go("famille", s.member_id) : undefined}>
                <span className="h">{s.heure_debut ?? "—"}</span>
                <span className="w"><b>{s.titre}</b><small>{[s.membre, s.lieu].filter(Boolean).join(" · ")}</small></span>
                <Visages s={s} />
              </button></li>
            ))}
          </ol>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>La semaine</h2><button className="link" onClick={() => go("activite", "nouvelle")}>Ajouter une activité</button></div>
        {f.semaine.length === 0 ? <p className="note">Activités, cantine, garde : ajoutez-les sur la page de chacun, et la semaine se dessine ici.</p> : (
          <div className="week">
            {[1, 2, 3, 4, 5, 6, 7].map((j) => {
              const items = f.semaine.filter((s) => s.jour === j);
              if (!items.length) return null;
              return (
                <div className={`day ${j === todayIdx ? "today" : ""}`} key={j}>
                  <div className="day-name">{JOURS[j]}{j === todayIdx ? " · aujourd'hui" : ""}</div>
                  {items.map((s, i) => (
                    <button className="slot" key={i} onClick={() => s.activite_id ? go("activite", s.activite_id) : s.member_id ? go("famille", s.member_id) : undefined}>
                      <span className="h">{s.heure_debut ?? "—"}</span>
                      <span className="w"><b>{s.titre}</b>{s.lieu ? <small>{s.lieu}</small> : null}</span>
                      <Visages s={s} />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {f.couts.some((c) => c.total > 0) && (
        <section className="section">
          <div className="section-head"><h2>Ce que coûtent les enfants</h2><span className="badge">{fmtEuro(f.cout_enfants_mois)} / mois</span></div>
          <ul className="list">
            {f.couts.filter((c) => c.total > 0).map((c) => {
              const m = parId.get(c.member_id);
              return (
                <li key={c.member_id}><button className="row-item cout-membre" onClick={() => go("famille", c.member_id)}>
                  {m ? <Portrait api={api} m={m} size={44} /> : <span />}
                  <div><div className="t">{c.prenom}</div><div className="s">{[c.cantine ? `cantine ${fmtEuro(c.cantine)}` : null, ...c.lignes.map((l) => `${l.titre} ${fmtEuro(l.mensuel)}`)].filter(Boolean).join(" · ")}</div></div>
                  <div className="r">{fmtEuro(c.total)}<small>/ mois</small></div>
                </button></li>
              );
            })}
          </ul>
          <p className="note" style={{ marginTop: 8 }}>Soit {fmtEuro(f.cout_enfants_mois * 12)} par an. Ces lignes rejoignent vos charges fixes dans le Budget.</p>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Dates clés de la famille</h2></div>
        {dates.length === 0 ? <p className="note">Renseignez les dates de naissance et les classes : anniversaires, bourses, Parcoursup, réinscriptions apparaîtront ici et dans l'Agenda.</p> : (
          <ul className="list">
            {dates.map((e) => {
              const m = e.member_id ? parId.get(e.member_id) : undefined;
              return (
                <li key={e.cle}><button className="row-item cout-membre" onClick={() => m ? go("famille", m.id) : go("deadlines")}>
                  {m ? <Portrait api={api} m={m} size={40} /> : <span className="portrait foyer" style={{ width: 40, height: 40 }} aria-hidden><Logo /></span>}
                  <div><div className="t">{e.titre}</div><div className="s">{e.note ?? dans(joursAvant(e.date))}</div></div>
                  <div className="r">{fmtDate(e.date, { day: "numeric", month: "short" })}</div>
                </button></li>
              );
            })}
          </ul>
        )}
      </section>

      <Conseils conseils={f.conseils} vide="Complétez la composition du foyer pour recevoir des conseils adaptés : aides, impôts, dates à ne pas rater." />

      <section className="section">
        <div className="section-head"><h2>Le foyer</h2></div>
        <div className="pills" role="group" aria-label="Situation">
          <button className="pill" aria-pressed={f.situation === "seul"} onClick={() => onSituation("seul")}>Je suis seul·e</button>
          <button className="pill" aria-pressed={f.situation === "couple"} onClick={() => onSituation("couple")}>En couple</button>
        </div>
        <p className="note">La situation compte pour les aides et les impôts (parent isolé, quotient familial).</p>
      </section>
    </>
  );
}

function Conseils({ conseils, vide, titre = "Conseils pour votre famille" }: { conseils: Conseil[]; vide: string | null; titre?: string }) {
  if (!conseils.length && !vide) return null;
  return (
    <section className="section">
      <div className="section-head"><h2>{titre}</h2></div>
      {conseils.length === 0 ? <p className="note">{vide}</p> : (
        <div>
          {conseils.map((c) => (
            <div className="alert" key={c.cle} style={{ gridTemplateColumns: "6px 1fr" }}>
              <i style={{ background: c.categorie === "aide" ? "var(--nest)" : c.categorie === "impots" ? "var(--yolk)" : c.categorie === "legal" ? "var(--ember)" : "var(--mist)" }} />
              <div>
                <div className="s" style={{ marginBottom: 2 }}>{CAT_LABEL[c.categorie]}{c.membre ? ` · ${c.membre}` : ""}</div>
                <div className="t">{c.titre}</div>
                <div className="d">{c.detail}</div>
                {c.source && <a className="link" href={c.source} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 6, fontSize: 13.5 }}>Vérifier sur la source officielle</a>}
              </div>
            </div>
          ))}
          <p className="note" style={{ marginTop: 10 }}>Repères donnés à titre indicatif : les montants et les dates changent chaque année, vérifiez-les sur la source avant d'agir.</p>
        </div>
      )}
    </section>
  );
}

/** One member's page: portrait, who they are, their week, what is coming, their papers, what they cost, advice. */
function VueMembre({ moi = false, api, f, m, go, docs, deadlines, toast, onPhoto }: { moi?: boolean; api: Api; f: FamilleReport; m: Membre; go: Go; docs: Doc[]; deadlines: Deadline[]; toast: (t: string) => void; onPhoto: () => void }) {
  const todayIdx = ((new Date().getDay() + 6) % 7) + 1;
  const creneaux = f.semaine.filter((s) => pour(s, m));
  const acts = f.activites.filter((a) => a.member_id === m.id);
  const cout = f.couts.find((c) => c.member_id === m.id);
  const papiers = docs.filter((d) => d.member_id === m.id);
  const docIds = new Set(papiers.map((d) => d.id));
  const today = isoJour(new Date());
  const avenir = [
    ...f.echeances.filter((e) => e.member_id === m.id && !e.fait).map((e) => ({ cle: e.cle, titre: e.titre, date: e.date, route: null as [string, string?] | null })),
    ...deadlines.filter((d) => !d.fait && d.document_id && docIds.has(d.document_id)).map((d) => ({ cle: d.id, titre: d.titre, date: d.date, route: ["doc", d.document_id!] as [string, string?] })),
  ].filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const anniv = f.echeances.find((e) => e.member_id === m.id && e.cle.startsWith("anniv:") && !e.fait);
  const jAnniv = anniv ? joursAvant(anniv.date) : null;
  const expire = papiers.filter((d) => d.date_fin && d.date_fin >= today && joursAvant(d.date_fin) <= 120 && /identite|vehicule/.test(d.category));
  const conseils = f.conseils.filter((c) => c.membre === m.prenom);
  const ecole = [m.classe, m.etablissement].filter(Boolean).join(" · ");
  const prochain = (() => {
    for (let k = 0; k < 7; k++) {
      const j = ((todayIdx - 1 + k) % 7) + 1;
      const l = creneaux.filter((s) => s.jour === j && s.type !== "cantine").sort((a, b) => (a.heure_debut ?? "").localeCompare(b.heure_debut ?? ""));
      const h = `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
      const s = k === 0 ? l.find((x) => (x.heure_debut ?? "99") >= h) : l[0];
      if (s) return { s, quand: k === 0 ? "aujourd'hui" : k === 1 ? "demain" : JOURS[j].toLowerCase() };
    }
    return null;
  })();

  return (
    <div className="vue-membre">
      <div className={`fiche-hero ${m.role}`}>
        <ChoixPhoto api={api} m={m} onDone={onPhoto} toast={toast}><Portrait api={api} m={m} size={116} /></ChoixPhoto>
        <h2>{m.prenom}</h2>
        <p>{[m.age !== null ? `${m.age} ans` : null, ecole || (NIVEAU_LABEL[m.niveau] || null), m.role === "parent_a_charge" || m.role === "autre_a_charge" ? ROLE_LABEL[m.role] : null].filter(Boolean).join(" · ") || ROLE_LABEL[m.role]}</p>
        {jAnniv !== null && jAnniv <= 45 && <span className="fiche-anniv">Anniversaire {dans(jAnniv)}{anniv!.titre.match(/\((\d+) ans\)/) ? ` · ${anniv!.titre.match(/\((\d+) ans\)/)![1]} ans` : ""}</span>}
        {!m.photo && <p className="fiche-astuce">Touchez le cercle pour ajouter {moi ? "votre" : "sa"} photo.</p>}
        <div className="fiche-actions">
          <button className="btn ghost" onClick={() => go("membre", m.id)}>Modifier la fiche</button>
          <button className="btn ghost" onClick={() => go("activite", `nouvelle:${m.id}`)}>Ajouter une activité</button>
        </div>
      </div>

      <div className="fiche-chiffres">
        <div><b>{acts.length}</b><span>activité{acts.length > 1 ? "s" : ""}</span></div>
        <div><b>{cout && cout.total > 0 ? fmtEuro(cout.total) : "—"}</b><span>par mois</span></div>
        <div><b>{papiers.length}</b><span>papier{papiers.length > 1 ? "s" : ""}</span></div>
      </div>

      {(prochain || expire.length > 0) && (
        <div className="fiche-alertes">
          {prochain && <div className="fiche-prochain"><span>Prochain rendez-vous</span><b>{prochain.s.titre}, {prochain.quand}{prochain.s.heure_debut ? ` à ${prochain.s.heure_debut.replace(":", " h ")}` : ""}</b>{prochain.s.lieu && <small>{prochain.s.lieu}</small>}</div>}
          {expire.map((d) => <button key={d.id} className="fiche-expire" onClick={() => go("doc", d.id)}><span>À renouveler</span><b>{d.title}</b><small>Expire {dans(joursAvant(d.date_fin!))}, le {fmtDate(d.date_fin)}. Les délais de rendez-vous sont longs : prenez-le maintenant.</small></button>)}
        </div>
      )}

      <section className="section">
        <div className="section-head"><h2>{moi ? "Ma semaine" : "Sa semaine"}</h2>{creneaux.length > 0 && <button className="link" onClick={() => go("activite", `nouvelle:${m.id}`)}>Ajouter</button>}</div>
        {creneaux.length === 0 ? <p className="note">{m.role === "enfant" ? "Cantine, sport, musique, garde : ajoutez ses activités avec le jour et l'heure, et sa semaine se dessine ici." : "Rien dans l'agenda de la semaine. Ajoutez une activité régulière si besoin."}</p> : (
          <div className="semaine-membre">
            {[1, 2, 3, 4, 5, 6, 7].map((j) => {
              const l = creneaux.filter((s) => s.jour === j).sort((a, b) => (a.heure_debut ?? "").localeCompare(b.heure_debut ?? ""));
              return (
                <div key={j} className={`sm-jour ${j === todayIdx ? "today" : ""} ${l.length ? "" : "libre"}`}>
                  <span className="sm-nom">{JOURS_COURT[j]}</span>
                  <div className="sm-items">
                    {l.length === 0 ? <span className="sm-libre">libre</span> : l.map((s, i) => (
                      <button key={i} className={`sm-item ${s.type}`} onClick={() => s.activite_id ? go("activite", s.activite_id) : go("membre", m.id)}>
                        <b>{s.titre}</b><span>{[s.heure_debut && `${s.heure_debut}${s.heure_fin ? `–${s.heure_fin}` : ""}`, s.lieu].filter(Boolean).join(" · ")}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>À venir</h2></div>
        {avenir.length === 0 ? <p className="note">Aucune date à surveiller{moi ? "" : ` pour ${m.prenom}`}. {moi ? "Ajoutez votre date de naissance et vos papiers" : "Ajoutez sa date de naissance et ses papiers"} : Lucien suivra anniversaires, expirations et démarches.</p> : (
          <ul className="list">
            {avenir.map((e) => (
              <li key={e.cle}><button className="row-item" style={{ gridTemplateColumns: "auto 1fr" }} onClick={() => e.route ? go(...e.route) : go("deadlines")}>
                <div className="date-chip"><b>{new Date(e.date + "T00:00:00").getDate()}</b><span>{new Date(e.date + "T00:00:00").toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</span></div>
                <div><div className="t">{e.titre}</div><div className="s">{dans(joursAvant(e.date))}</div></div>
              </button></li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>{moi ? "Mes papiers" : "Ses papiers"}</h2><button className="link" onClick={() => go("add")}>Ajouter</button></div>
        {papiers.length === 0 ? <p className="note">{m.role === "enfant" ? "Carte d'identité, carnet de santé, certificat de scolarité, assurance scolaire : rangez-les à son nom pour les retrouver en un geste." : moi ? "Identité, permis, contrats, attestations à votre nom : en ajoutant un papier, indiquez que vous êtes la personne concernée." : `Identité, contrats, attestations au nom de ${m.prenom} : en ajoutant un papier, choisissez « ${m.prenom} » comme personne concernée.`}</p> : (
          <ul className="list">
            {papiers.map((d) => (
              <li key={d.id}><button className="row-item" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => go("doc", d.id)}>
                <div><div className="t">{d.title}</div><div className="s">{[d.organisme, d.date_fin ? `jusqu'au ${fmtDate(d.date_fin, { day: "numeric", month: "short", year: "numeric" })}` : null].filter(Boolean).join(" · ") || "Ouvrir"}</div></div>
                {d.montant ? <div className="r">{fmtEuro(d.montant)}</div> : <span />}
              </button></li>
            ))}
          </ul>
        )}
      </section>

      {cout && cout.total > 0 && (
        <section className="section">
          <div className="section-head"><h2>Ce que ça coûte</h2><span className="badge">{fmtEuro(cout.total)} / mois</span></div>
          <ul className="legend" style={{ padding: 0, margin: 0, gridTemplateColumns: "1fr" }}>
            {cout.cantine > 0 && <li style={{ display: "flex", justifyContent: "space-between" }}><span>Cantine</span><b>{fmtEuro(cout.cantine)}</b></li>}
            {cout.lignes.map((l) => <li key={l.titre} style={{ display: "flex", justifyContent: "space-between" }}><span>{l.titre}</span><b>{fmtEuro(l.mensuel)}</b></li>)}
          </ul>
          <p className="note" style={{ marginTop: 8 }}>Soit {fmtEuro(cout.total * 12)} sur l'année.</p>
        </section>
      )}

      {estProtegeable(m) && <VeilleCard api={api} membre={m} go={go} />}

      <Conseils conseils={conseils} vide={null} titre={moi ? "Pour vous" : `Pour ${m.prenom}`} />

      {m.notes && <p className="note fiche-notes">{m.notes}</p>}
    </div>
  );
}

/** One member: identity, school, canteen days, activities. */
export function MembreDetail({ api, id, onBack, go, onChanged, toast }: { api: Api; id: string; onBack: () => void; go: (s: string, id?: string) => void; onChanged: () => void; toast: (m: string) => void }) {
  const [f, setF] = useState<FamilleReport | null>(null);
  const [m, setM] = useState<Member | null>(null);
  const load = async () => { const r = await api.famille(); setF(r); setM(r.membres.find((x) => x.id === id) ?? null); };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f || !m) return <div className="screen"><Back onClick={onBack} /><p className="note">Chargement…</p></div>;

  const save = async (patch: Partial<Member>) => { const u = await api.updateMember(m.id, patch); setM({ ...m, ...u }); onChanged(); };
  const jours = (m.cantine_jours ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const toggleJour = (j: string) => save({ cantine_jours: (jours.includes(j) ? jours.filter((x) => x !== j) : [...jours, j]).join(",") || null });
  const acts = f.activites.filter((a) => a.member_id === m.id);
  const isChild = m.role === "enfant";
  const field = (label: string, key: keyof Member, type = "text", placeholder = "") => (
    <div className="field"><span>{label}</span><input type={type} value={(m[key] as string | number | null) ?? ""} placeholder={placeholder} onChange={(e) => setM({ ...m, [key]: type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value || null })} onBlur={() => save({ [key]: m[key] } as Partial<Member>)} /></div>
  );

  return (
    <div className="screen">
      <Back onClick={onBack} />
      <div className="fiche-edit-tete">
        <ChoixPhoto api={api} m={m} onDone={(u) => { setM({ ...m, ...u }); onChanged(); }} toast={toast}><Portrait api={api} m={m} size={84} /></ChoixPhoto>
        <div>
          <h1 className="detail-title" style={{ margin: 0 }}>{m.prenom}</h1>
          <p className="detail-sub" style={{ margin: "2px 0 0" }}>{ROLE_LABEL[m.role]}{f.membres.find((x) => x.id === id)?.age !== null ? ` · ${f.membres.find((x) => x.id === id)?.age} ans` : ""}</p>
          {m.photo && <button className="link" style={{ fontSize: 13.5, marginTop: 4 }} onClick={async () => { const u = await api.deleteMemberPhoto(m.id); setM({ ...m, ...u }); onChanged(); }}>Retirer la photo</button>}
        </div>
      </div>

      <div className="fields">
        {field("Prénom", "prenom")}
        <div className="field"><span>Rôle</span><select value={m.role} onChange={(e) => save({ role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
        {field("Date de naissance", "date_naissance", "date")}
        {(isChild || m.classe) && field("Établissement", "etablissement", "text", "École, collège, lycée, université…")}
        {(isChild || m.classe) && field("Classe / année", "classe", "text", "CM1, 4e, Terminale, L2 droit…")}
        {field("Notes", "notes", "text", isChild ? "Allergies connues de l'école, garde alternée…" : "Ce qu'il faut savoir")}
      </div>

      {isChild && (
        <section className="section">
          <div className="section-head"><h2>Cantine</h2>{(m.cantine_cout_mois ?? 0) > 0 && <span className="badge">{fmtEuro(m.cantine_cout_mois!)} / mois</span>}</div>
          <div className="pills">{["lun", "mar", "mer", "jeu", "ven"].map((j) => <button key={j} className="pill" aria-pressed={jours.includes(j)} onClick={() => toggleJour(j)}>{j}</button>)}</div>
          <div className="fields">{field("Coût par mois (€)", "cantine_cout_mois", "number", "0")}</div>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Activités</h2><button className="link" onClick={() => go("activite", `nouvelle:${m.id}`)}>Ajouter</button></div>
        {acts.length === 0 ? <p className="note">Sport, musique, soutien, garde : avec le jour, l'heure, le lieu et le coût, Lucien dessine la semaine et compte le budget.</p> : (
          <ul className="list">
            {acts.map((a) => (
              <li key={a.id}><button className="row-item" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => go("activite", a.id)}>
                <div><div className="t">{a.titre}</div><div className="s">{[a.jour ? `${JOURS[a.jour]}${a.heure_debut ? ` ${a.heure_debut}` : ""}${a.heure_fin ? `–${a.heure_fin}` : ""}` : "ponctuel", a.lieu, a.date_fin ? `jusqu'au ${fmtDate(a.date_fin)}` : null].filter(Boolean).join(" · ")}</div></div>
                {(a.cout_mois ?? 0) > 0 ? <div className="r">{fmtEuro(a.cout_mois!)}<small>/ mois</small></div> : <span />}
              </button></li>
            ))}
          </ul>
        )}
      </section>

      {estProtegeable(m) && <VeilleCard api={api} membre={m} go={go} />}

      {estProtegeable(m) && (
        <div className="confidence" style={{ display: "block", width: "100%" }}>Les papiers de {m.prenom} se rangent dans Lucien avec son accord. Sous tutelle ou curatelle, c'est le tuteur ou le curateur qui autorise, notamment pour la banque.</div>
      )}

      <div style={{ marginTop: 20 }}>
        <button className="btn danger" onClick={async () => { if (confirm(`Retirer ${m.prenom} du foyer ? Ses activités seront supprimées, ses papiers restent.`)) { await api.deleteMember(m.id); toast(`${m.prenom} retiré du foyer`); onChanged(); onBack(); } }}>Retirer du foyer</button>
      </div>
    </div>
  );
}

/** One activity: create (`id` = "nouvelle" or "nouvelle:<member_id>") or edit. */
export function ActiviteDetail({ api, id, onBack, onChanged, toast }: { api: Api; id: string; onBack: () => void; onChanged: () => void; toast: (m: string) => void }) {
  const isNew = id.startsWith("nouvelle");
  const [f, setF] = useState<FamilleReport | null>(null);
  const [a, setA] = useState<Partial<Activite>>({ titre: "", type: "sport", jour: null, heure_debut: null, heure_fin: null, lieu: null, cout_mois: null, date_debut: null, date_fin: null, note: null, member_id: isNew && id.includes(":") ? id.split(":")[1] : null });
  useEffect(() => { api.famille().then((r) => { setF(r); if (!isNew) { const x = r.activites.find((y) => y.id === id); if (x) setA(x); } }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <div className="screen"><Back onClick={onBack} /><p className="note">Chargement…</p></div>;

  const set = (k: keyof Activite, v: unknown) => setA({ ...a, [k]: v === "" ? null : v });
  const save = async () => {
    if (!a.titre?.trim()) { toast("Donnez un nom à l'activité"); return; }
    if (isNew) await api.addActivite(a as Activite); else await api.updateActivite(id, a);
    toast(isNew ? "Activité ajoutée" : "Activité enregistrée"); onChanged(); onBack();
  };

  return (
    <div className="screen">
      <Back onClick={onBack} />
      <h1 className="detail-title">{isNew ? "Nouvelle activité" : a.titre}</h1>
      <p className="detail-sub">Jour, heure et coût : la semaine et le budget se mettent à jour.</p>
      <div className="fields">
        <div className="field"><span>Nom</span><input value={a.titre ?? ""} placeholder="Judo, piano, garderie…" onChange={(e) => set("titre", e.target.value)} /></div>
        <div className="field"><span>Pour</span><select value={a.member_id ?? ""} onChange={(e) => set("member_id", e.target.value || null)}><option value="">Toute la famille</option>{f.membres.map((m) => <option key={m.id} value={m.id}>{m.prenom}</option>)}</select></div>
        <div className="field"><span>Type</span><select value={a.type ?? "autre"} onChange={(e) => set("type", e.target.value)}>{TYPES_ACTIVITE.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></div>
        <div className="field"><span>Jour</span><select value={a.jour ?? ""} onChange={(e) => set("jour", e.target.value ? Number(e.target.value) : null)}><option value="">Ponctuel</option>{[1, 2, 3, 4, 5, 6, 7].map((j) => <option key={j} value={j}>{JOURS[j]}</option>)}</select></div>
        <div className="field"><span>De</span><input type="time" value={a.heure_debut ?? ""} onChange={(e) => set("heure_debut", e.target.value)} /></div>
        <div className="field"><span>À</span><input type="time" value={a.heure_fin ?? ""} onChange={(e) => set("heure_fin", e.target.value)} /></div>
        <div className="field"><span>Lieu</span><input value={a.lieu ?? ""} placeholder="Gymnase, conservatoire…" onChange={(e) => set("lieu", e.target.value)} /></div>
        <div className="field"><span>Coût par mois (€)</span><input type="number" value={a.cout_mois ?? ""} onChange={(e) => set("cout_mois", e.target.value === "" ? null : Number(e.target.value))} /></div>
        <div className="field"><span>Début</span><input type="date" value={a.date_debut ?? ""} onChange={(e) => set("date_debut", e.target.value)} /></div>
        <div className="field"><span>Fin de saison</span><input type="date" value={a.date_fin ?? ""} onChange={(e) => set("date_fin", e.target.value)} /></div>
        <div className="field"><span>Note</span><input value={a.note ?? ""} placeholder="Tenue, covoiturage, contact…" onChange={(e) => set("note", e.target.value)} /></div>
      </div>
      <p className="note" style={{ marginBottom: 14 }}>Avec une date de fin, Lucien vous rappelle la réinscription un mois avant : c'est le moment de renégocier ou d'arrêter.</p>
      <div className="actions">
        <button className="btn" onClick={save}>{isNew ? "Ajouter" : "Enregistrer"}</button>
        {!isNew && <button className="btn danger" onClick={async () => { await api.deleteActivite(id); toast("Activité supprimée"); onChanged(); onBack(); }}>Supprimer</button>}
      </div>
    </div>
  );
}

export { JOURS_COURT, TYPE_LABEL as ACTIVITE_LABEL };
