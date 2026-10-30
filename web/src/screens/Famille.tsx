import { useEffect, useState } from "react";
import type { Api } from "../api";
import type { Activite, Conseil, FamilleReport, Household, Member, Role } from "../types";
import { Bell } from "../notifications";
import { Back, fmtDate, fmtEuro } from "../ui";
import { VeilleCard, estProtegeable } from "./Veille";

export const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const JOURS_COURT = ["", "lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const ROLE_LABEL: Record<Role, string> = { adulte: "Adulte", enfant: "Enfant", parent_a_charge: "Parent à charge", autre_a_charge: "Personne à charge" };
const NIVEAU_LABEL: Record<string, string> = { petite_enfance: "petite enfance", maternelle: "maternelle", primaire: "primaire", college: "collège", lycee: "lycée", terminale: "terminale", superieur: "études supérieures", adulte: "", inconnu: "" };
const CAT_LABEL: Record<Conseil["categorie"], string> = { aide: "Aide", impots: "Impôts", budget: "Budget", organisation: "Organisation", legal: "Cadre légal" };
const TYPES_ACTIVITE = ["sport", "musique", "art", "soutien", "garde", "sante", "autre"];
const TYPE_LABEL: Record<string, string> = { sport: "Sport", musique: "Musique", art: "Art", soutien: "Soutien scolaire", garde: "Garde", sante: "Santé", autre: "Autre", cantine: "Cantine" };

export function Famille({ api, household, go, unread, onChanged, toast }: { api: Api; household: Household; go: (s: string, id?: string) => void; unread: number; onChanged: () => void; toast: (m: string) => void }) {
  const [f, setF] = useState<FamilleReport | null>(null);
  const [adding, setAdding] = useState<Role | null>(null);
  const [prenom, setPrenom] = useState("");
  const load = async () => setF(await api.famille());
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return <div className="screen"><div className="top"><h1>Famille</h1></div><p className="note">Chargement…</p></div>;

  const groups: { role: Role[]; label: string; add: Role }[] = [
    { role: ["adulte"], label: f.situation === "seul" ? "Vous" : "Adultes", add: "adulte" },
    { role: ["enfant"], label: "Enfants", add: "enfant" },
    { role: ["parent_a_charge", "autre_a_charge"], label: "Personnes à charge", add: "parent_a_charge" },
  ];
  const todayIdx = ((new Date().getDay() + 6) % 7) + 1;
  const setSituation = async (s: "seul" | "couple") => { await api.setSituation(s); await load(); onChanged(); };
  const addMember = async () => {
    if (!prenom.trim() || !adding) return;
    try { await api.addMember({ prenom: prenom.trim(), role: adding }); setPrenom(""); setAdding(null); await load(); onChanged(); }
    catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="screen">
      <div className="top"><div><h1>Famille</h1><p className="sub">{f.composition.adultes} adulte{f.composition.adultes > 1 ? "s" : ""}{f.composition.enfants ? ` · ${f.composition.enfants} enfant${f.composition.enfants > 1 ? "s" : ""}` : ""}{f.composition.a_charge ? ` · ${f.composition.a_charge} à charge` : ""}</p></div><Bell unread={unread} onClick={() => go("notifs")} /></div>

      <div className="pills" role="group" aria-label="Situation">
        <button className="pill" aria-pressed={f.situation === "seul"} onClick={() => setSituation("seul")}>Seul·e</button>
        <button className="pill" aria-pressed={f.situation === "couple"} onClick={() => setSituation("couple")}>En couple</button>
      </div>

      {groups.map((g) => {
        const items = f.membres.filter((m) => g.role.includes(m.role));
        return (
          <section className="section" key={g.label}>
            <div className="section-head"><h2>{g.label}</h2><button className="link" onClick={() => { setAdding(g.add); setPrenom(""); }}>Ajouter</button></div>
            {adding === g.add && (
              <div className="lock" style={{ marginTop: 0, marginBottom: 10 }}>
                {g.add !== "adulte" && g.add !== "enfant" && (
                  <div className="pills"><button className="pill" aria-pressed={adding === "parent_a_charge"} onClick={() => setAdding("parent_a_charge")}>Parent</button><button className="pill" aria-pressed={adding === "autre_a_charge"} onClick={() => setAdding("autre_a_charge")}>Autre personne</button></div>
                )}
                <input className="in" placeholder="Prénom" value={prenom} onChange={(e) => setPrenom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMember()} autoFocus />
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}><button className="btn" onClick={addMember}>Ajouter</button><button className="btn ghost" onClick={() => setAdding(null)}>Annuler</button></div>
              </div>
            )}
            {items.length === 0 && adding !== g.add && <p className="note">{g.add === "enfant" ? "Ajoutez vos enfants : école, cantine, activités, et Lucien suit les dates qui comptent." : g.add === "adulte" ? "Vous, et votre conjoint·e le cas échéant." : "Un parent âgé ou une personne dont vous gérez les papiers, avec son accord."}</p>}
            <ul className="list">
              {items.map((m) => {
                const cout = f.couts.find((c) => c.member_id === m.id);
                const nbAct = f.activites.filter((a) => a.member_id === m.id).length;
                return (
                  <li key={m.id}>
                    <button className="row-item" onClick={() => go("membre", m.id)}>
                      <div className={`avatar ${m.role}`}>{m.prenom.slice(0, 1).toUpperCase()}</div>
                      <div>
                        <div className="t">{m.prenom}{m.age !== null ? ` · ${m.age} ans` : ""}</div>
                        <div className="s">{[m.role !== "adulte" && m.role !== "enfant" ? ROLE_LABEL[m.role] : null, m.classe ? `${m.classe}${m.etablissement ? ` · ${m.etablissement}` : ""}` : NIVEAU_LABEL[m.niveau] || null, nbAct ? `${nbAct} activité${nbAct > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ") || "Compléter la fiche"}</div>
                      </div>
                      {cout && cout.total > 0 ? <div className="r">{fmtEuro(cout.total)}<small>/ mois</small></div> : <span />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className="section">
        <div className="section-head"><h2>La semaine</h2><button className="link" onClick={() => go("activite", "nouvelle")}>Ajouter une activité</button></div>
        {f.semaine.length === 0 ? <p className="note">Activités, cantine, garde : saisissez-les sur la fiche de chacun, et la semaine se dessine ici.</p> : (
          <div className="week">
            {[1, 2, 3, 4, 5, 6, 7].map((j) => {
              const items = f.semaine.filter((s) => s.jour === j);
              if (!items.length) return null;
              return (
                <div className={`day ${j === todayIdx ? "today" : ""}`} key={j}>
                  <div className="day-name">{JOURS[j]}{j === todayIdx ? " · aujourd'hui" : ""}</div>
                  {items.map((s, i) => (
                    <button className="slot" key={i} onClick={() => s.activite_id ? go("activite", s.activite_id) : s.member_id ? go("membre", s.member_id) : undefined}>
                      <span className="h">{s.heure_debut ?? "—"}</span>
                      <span className="w"><b>{s.titre}</b>{s.membre ? ` · ${s.membre}` : ""}{s.lieu ? <small>{s.lieu}</small> : null}</span>
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
          <ul className="legend" style={{ padding: 0, margin: 0, gridTemplateColumns: "1fr" }}>
            {f.couts.filter((c) => c.total > 0).map((c) => (
              <li key={c.member_id} style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>{c.prenom}</span><b>{fmtEuro(c.total)}</b></div>
                <div className="note">{[c.cantine ? `cantine ${fmtEuro(c.cantine)}` : null, ...c.lignes.map((l) => `${l.titre} ${fmtEuro(l.mensuel)}`)].filter(Boolean).join(" · ")}</div>
              </li>
            ))}
          </ul>
          <p className="note" style={{ marginTop: 8 }}>Soit {fmtEuro(f.cout_enfants_mois * 12)} par an. Ces lignes rejoignent vos charges fixes dans le Budget.</p>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Dates clés de la famille</h2></div>
        {f.echeances.filter((e) => !e.fait).length === 0 ? <p className="note">Renseignez les dates de naissance et les classes : anniversaires, bourses, Parcoursup, réinscriptions apparaîtront ici et dans l'Agenda.</p> : (
          <ul className="list">
            {f.echeances.filter((e) => !e.fait).slice(0, 6).map((e) => (
              <li key={e.cle}><div className="row-item" style={{ gridTemplateColumns: "1fr auto" }}><div><div className="t">{e.titre}</div>{e.note && <div className="s">{e.note}</div>}</div><div className="r">{fmtDate(e.date)}</div></div></li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Conseils pour votre famille</h2></div>
        {f.conseils.length === 0 ? <p className="note">Complétez la composition du foyer pour recevoir des conseils adaptés : aides, impôts, dates à ne pas rater.</p> : (
          <div>
            {f.conseils.map((c) => (
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
      <h1 className="detail-title">{m.prenom}</h1>
      <p className="detail-sub">{ROLE_LABEL[m.role]}{f.membres.find((x) => x.id === id)?.age !== null ? ` · ${f.membres.find((x) => x.id === id)?.age} ans` : ""}</p>

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
