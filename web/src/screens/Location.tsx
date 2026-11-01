import { useEffect, useRef, useState } from "react";
import type { Api, DocLocation, SignaturePublique } from "../api";
import { IRL, type Bail, type Bien, type DonneesLocatif } from "../../../server/src/locatif";
import { contenuBail, contenuEdl, edlVide, type ContenuDocument, type DonneesBail, type DonneesEdl, type Etat, type TypeDocLocation } from "../../../server/src/documentsLocation";
import { Champ, dateFr, EnTete, useEspace, Verrou } from "./espacesCommun";
import { Back } from "../ui";

const TYPE_TXT: Record<TypeDocLocation, string> = { bail: "Bail", edl_entree: "État des lieux d'entrée", edl_sortie: "État des lieux de sortie" };
const STATUT_TXT: Record<DocLocation["statut"], string> = { brouillon: "Brouillon", a_signer: "En signature", signe: "Signé", annule: "Annulé" };
const ETATS: { v: Etat; t: string }[] = [{ v: "neuf", t: "Neuf" }, { v: "bon", t: "Bon" }, { v: "moyen", t: "Usage" }, { v: "mauvais", t: "Mauvais" }];
const auj = () => new Date().toISOString().slice(0, 10);
const n = (s: string | number | null | undefined) => (s === "" || s === null || s === undefined ? null : Number(String(s).replace(",", ".")));
const dernierIrl = () => { const k = Object.keys(IRL).sort().at(-1)!; return `${k.slice(0, 4)} T${k.slice(5)} (${IRL[k].toLocaleString("fr-FR")})`; };

/** Signature drawn with the finger or the mouse; returns a PNG (white background) or null while empty. */
export function PaveSignature({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const trace = useRef(false), vide = useRef(true);
  useEffect(() => {
    const c = ref.current!; const r = c.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const x = c.getContext("2d")!; x.scale(dpr, dpr); x.fillStyle = "#fff"; x.fillRect(0, 0, r.width, r.height);
    x.lineWidth = 2.4; x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = "#1d1630";
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const effacer = () => { const c = ref.current!; const x = c.getContext("2d")!; const r = c.getBoundingClientRect(); x.fillStyle = "#fff"; x.fillRect(0, 0, r.width, r.height); vide.current = true; onChange(null); };
  return (
    <div className="pave-signature">
      <canvas ref={ref} aria-label="Zone de signature : signez avec le doigt"
        onPointerDown={(e) => { (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); trace.current = true; const x = ref.current!.getContext("2d")!; const [a, b] = pos(e); x.beginPath(); x.moveTo(a, b); x.lineTo(a + 0.1, b + 0.1); x.stroke(); }}
        onPointerMove={(e) => { if (!trace.current) return; const x = ref.current!.getContext("2d")!; const [a, b] = pos(e); x.lineTo(a, b); x.stroke(); vide.current = false; }}
        onPointerUp={() => { trace.current = false; if (!vide.current) onChange(ref.current!.toDataURL("image/png")); }} />
      <div className="pave-pied"><span>Signez dans le cadre</span><button className="link" type="button" onClick={effacer}>Effacer</button></div>
    </div>
  );
}

export function Apercu({ c }: { c: Pick<ContenuDocument, "titre" | "sous_titre" | "sections"> & { avertissements?: string[] } }) {
  return (
    <article className="apercu-doc">
      <h2>{c.titre}</h2>
      <p className="apercu-sous">{c.sous_titre}</p>
      {c.avertissements?.map((a) => <p key={a} className="confidence">{a}</p>)}
      {c.sections.map((s) => (
        <section key={s.titre}><h3>{s.titre}</h3>{s.paragraphes.map((p, i) => <p key={i}>{p}</p>)}</section>
      ))}
    </article>
  );
}

const contenuDe = (d: DocLocation, docs: DocLocation[]) => d.type === "bail" ? contenuBail(d.donnees as DonneesBail)
  : contenuEdl(d.donnees as DonneesEdl, d.entree_id ? (docs.find((x) => x.id === d.entree_id)?.donnees as DonneesEdl | undefined) ?? null : null);

function bailInitial(loc: DonneesLocatif, bien: Bien, bail: Bail | null): DonneesBail {
  const sci = bien.structure_id ? loc.structures?.find((x) => x.id === bien.structure_id) : null;
  const locataires = (bail?.locataire ?? "").split(/\s+et\s+|,\s*/).map((x) => x.trim()).filter(Boolean).map((nom) => ({ nom, email: "" }));
  return {
    meuble: bien.meuble,
    bailleur: { nom: sci?.nom ?? loc.bailleur, adresse: loc.adresse_bailleur ?? "", qualite: sci ? "personne_morale" : "personne_physique" },
    locataires: locataires.length ? locataires : [{ nom: "", email: "" }], solidaires: locataires.length > 1,
    logement: { adresse: bien.adresse, type: bien.type, surface: bien.surface ?? null, pieces: bien.type === "studio" ? 1 : null, etage: "", regime_juridique: bien.type === "maison" ? "monopropriete" : "copropriete", periode_construction: "", equipements: "", annexes_privatives: "", chauffage: "individuel", eau_chaude: "individuelle", dpe: bien.dpe ?? null },
    debut: bail?.debut ?? auj(), duree_mois: bien.meuble ? 12 : sci ? 72 : 36, etudiant: false,
    loyer_hc: bail?.loyer_hc ?? 0, charges: bail?.charges ?? 0, charges_mode: "provision", jour_paiement: bail?.jour_paiement ?? 5,
    irl_trimestre: (bail?.irl_trimestre ?? 1) as 1, irl_reference: dernierIrl(), encadrement: null, dernier_loyer_precedent: null,
    depot_garantie: bail?.depot_garantie ?? (bail ? bail.loyer_hc * (bien.meuble ? 2 : 1) : 0), travaux: "", clauses_particulieres: "", lieu_signature: "",
  };
}

/** Bail et états des lieux d'un bien : préparer, relire, envoyer, signer. */
export function DocumentsLocation({ api, bienId, onBack, go, toast }: { api: Api; bienId: string; onBack: () => void; go: (s: string, id?: string) => void; toast: (m: string) => void }) {
  const { data, ferme } = useEspace(api, "locatif");
  const [docs, setDocs] = useState<DocLocation[] | null>(null);
  const [ouvert, setOuvert] = useState<{ doc: DocLocation; vue: "edition" | "lecture" | "signature" } | null>(null);
  const charger = async () => setDocs((await api.docsLocation()).filter((d) => d.bien_id === bienId));
  useEffect(() => { charger().catch((e) => toast((e as Error).message)); }, [bienId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (ferme) return <Verrou module={ferme} go={go} onBack={onBack} />;
  const loc = data?.donnees, bien = loc?.biens.find((b) => b.id === bienId);
  if (!loc || !bien || !docs) return <div className="screen"><Back onClick={onBack} /><p className="note">Chargement…</p></div>;
  const bail = loc.baux.find((b) => b.bien_id === bienId && (!b.fin || b.fin >= auj())) ?? null;
  const maj = (d: DocLocation) => { setDocs((l) => (l ?? []).map((x) => (x.id === d.id ? d : x))); return d; };

  const creer = async (type: TypeDocLocation) => {
    const base = { date: auj(), bailleur: loc.bailleur, locataires: (bail?.locataire ?? "").split(/\s+et\s+|,\s*/).filter(Boolean), adresse: bien.adresse, meuble: bien.meuble, typeBien: bien.type, pieces: bien.type === "studio" ? 1 : 2 };
    const entree = type === "edl_sortie" ? docs.find((d) => d.type === "edl_entree" && d.statut === "signe") ?? docs.find((d) => d.type === "edl_entree") : undefined;
    let donnees: DonneesBail | DonneesEdl = type === "bail" ? bailInitial(loc, bien, bail) : edlVide(type === "edl_entree" ? "entree" : "sortie", base);
    // the exit inventory starts from the entry one: same rooms, ready to compare
    if (entree && type === "edl_sortie") donnees = { ...(donnees as DonneesEdl), pieces: (entree.donnees as DonneesEdl).pieces.map((p) => ({ nom: p.nom, elements: p.elements.map((e) => ({ nom: e.nom, etat: "" as Etat, commentaire: "" })) })), inventaire: (entree.donnees as DonneesEdl).inventaire?.map((x) => ({ ...x, etat: "" as Etat })) };
    const d = await api.creerDocLocation({ type, bien_id: bienId, bail_id: bail?.id ?? null, entree_id: entree?.id ?? null, donnees });
    setDocs([d, ...docs]); setOuvert({ doc: d, vue: "edition" });
  };

  if (ouvert) {
    const d = docs.find((x) => x.id === ouvert.doc.id) ?? ouvert.doc;
    const fermer = () => { setOuvert(null); charger(); };
    return (
      <div className="screen location">
        <Back onClick={fermer} label={bien.nom} />
        {ouvert.vue === "edition" && <EditionDoc api={api} doc={d} onSauve={(x) => { maj(x); setOuvert({ doc: x, vue: "lecture" }); }} toast={toast} />}
        {ouvert.vue === "lecture" && <LectureDoc api={api} doc={d} contenu={contenuDe(d, docs)} onModifier={() => setOuvert({ doc: d, vue: "edition" })} onSigner={() => setOuvert({ doc: d, vue: "signature" })} onChange={(x) => { maj(x); setOuvert({ doc: x, vue: "lecture" }); }} onSupprime={fermer} toast={toast} />}
        {ouvert.vue === "signature" && <SignatureBailleur api={api} doc={d} contenu={contenuDe(d, docs)} onFait={(x) => { maj(x); setOuvert({ doc: x, vue: "lecture" }); toast(x.statut === "signe" ? "Document signé par tous : il est rangé dans vos papiers" : "Votre signature est enregistrée"); }} toast={toast} />}
      </div>
    );
  }

  const aEntree = docs.some((d) => d.type === "edl_entree");
  return (
    <div className="screen espace location">
      <EnTete titre="Bail et états des lieux" sous={`${bien.nom} · ${bien.adresse}`} espace="locatif" onBack={onBack} />
      <p className="note">Lucien prépare le bail sur le modèle officiel et l'état des lieux pièce par pièce. Vous relisez, puis chacun signe en ligne : vous dans l'appli, le locataire depuis un lien personnel. Le document signé est rangé dans vos papiers.</p>
      <div className="pills" style={{ margin: "12px 0 18px" }}>
        <button className="pill" onClick={() => creer("bail")}>+ Préparer le bail</button>
        <button className="pill" onClick={() => creer("edl_entree")}>+ État des lieux d'entrée</button>
        {aEntree && <button className="pill" onClick={() => creer("edl_sortie")}>+ État des lieux de sortie</button>}
      </div>
      {docs.length === 0 ? <p className="note">Aucun document pour ce bien.</p> : (
        <ul className="list">
          {docs.map((d) => (
            <li key={d.id}>
              <button className="row-item" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => setOuvert({ doc: d, vue: d.statut === "brouillon" ? "edition" : "lecture" })}>
                <div><div className="t">{TYPE_TXT[d.type]}</div><div className="s">{d.statut === "a_signer" ? `${d.signatures.filter((s) => s.signe_le).length} signature${d.signatures.filter((s) => s.signe_le).length > 1 ? "s" : ""} sur ${d.signatures.length}` : `Mis à jour le ${dateFr(d.maj_le.slice(0, 10))}`}</div></div>
                <span className={`statut-doc ${d.statut}`}>{STATUT_TXT[d.statut]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="note" style={{ marginTop: 16 }}>Signature électronique simple (article 1367 du Code civil) : Lucien conserve la date, l'heure, l'adresse IP de chaque signataire et l'empreinte du texte signé. Modèle à relire : en cas de doute, faites-le vérifier par un professionnel.</p>
    </div>
  );
}

function EditionDoc({ api, doc, onSauve, toast }: { api: Api; doc: DocLocation; onSauve: (d: DocLocation) => void; toast: (m: string) => void }) {
  const [d, setD] = useState(doc.donnees);
  const [busy, setBusy] = useState(false);
  const sauver = async () => { setBusy(true); try { onSauve(await api.majDocLocation(doc.id, d)); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  return (
    <>
      <h1 className="detail-title">{TYPE_TXT[doc.type]}</h1>
      {doc.type === "bail" ? <FormBail d={d as DonneesBail} set={setD} /> : <FormEdl d={d as DonneesEdl} set={setD} />}
      <div className="barre-actions"><button className="btn" disabled={busy} onClick={sauver}>{busy ? "Enregistrement…" : "Enregistrer et relire"}</button></div>
    </>
  );
}

function FormBail({ d, set }: { d: DonneesBail; set: (d: DonneesBail) => void }) {
  const L = d.logement;
  const setL = (p: Partial<DonneesBail["logement"]>) => set({ ...d, logement: { ...L, ...p } });
  const t = (v: string | null | undefined) => v ?? "";
  return (
    <div className="form-doc">
      <h3>Le bailleur</h3>
      <Champ label="Nom ou dénomination"><input className="in" value={d.bailleur.nom} onChange={(e) => set({ ...d, bailleur: { ...d.bailleur, nom: e.target.value } })} /></Champ>
      <Champ label="Adresse"><input className="in" value={d.bailleur.adresse} onChange={(e) => set({ ...d, bailleur: { ...d.bailleur, adresse: e.target.value } })} /></Champ>
      <Champ label="Qualité"><select className="in" value={d.bailleur.qualite} onChange={(e) => set({ ...d, bailleur: { ...d.bailleur, qualite: e.target.value as DonneesBail["bailleur"]["qualite"] }, duree_mois: d.meuble ? d.duree_mois : e.target.value === "personne_morale" ? 72 : 36 })}>
        <option value="personne_physique">Personne physique</option><option value="sci_familiale">SCI familiale</option><option value="personne_morale">Société (personne morale)</option></select></Champ>

      <h3>Le ou les locataires</h3>
      {d.locataires.map((l, i) => (
        <div key={i} className="ligne-locataire">
          <Champ label={`Locataire ${i + 1}`}><input className="in" value={l.nom} onChange={(e) => set({ ...d, locataires: d.locataires.map((x, k) => (k === i ? { ...x, nom: e.target.value } : x)) })} placeholder="Prénom et nom" /></Champ>
          <Champ label="Email (pour signer)"><input className="in" type="email" value={t(l.email)} onChange={(e) => set({ ...d, locataires: d.locataires.map((x, k) => (k === i ? { ...x, email: e.target.value } : x)) })} /></Champ>
          {d.locataires.length > 1 && <button className="link" type="button" onClick={() => set({ ...d, locataires: d.locataires.filter((_, k) => k !== i) })}>Retirer</button>}
        </div>
      ))}
      <button className="link" type="button" onClick={() => set({ ...d, locataires: [...d.locataires, { nom: "", email: "" }], solidaires: true })}>+ Ajouter un colocataire</button>
      {d.locataires.length > 1 && <label className="case"><input type="checkbox" checked={d.solidaires} onChange={(e) => set({ ...d, solidaires: e.target.checked })} /> Clause de solidarité entre colocataires</label>}

      <h3>Le logement</h3>
      <Champ label="Adresse"><input className="in" value={L.adresse} onChange={(e) => setL({ adresse: e.target.value })} /></Champ>
      <Champ label="Étage, porte"><input className="in" value={t(L.etage)} onChange={(e) => setL({ etage: e.target.value })} placeholder="2e étage, porte gauche" /></Champ>
      <Champ label="Surface habitable (m²)"><input className="in" inputMode="decimal" value={L.surface ?? ""} onChange={(e) => setL({ surface: n(e.target.value) })} /></Champ>
      <Champ label="Pièces principales"><input className="in" inputMode="numeric" value={L.pieces ?? ""} onChange={(e) => setL({ pieces: n(e.target.value) })} /></Champ>
      <Champ label="Immeuble"><select className="in" value={L.regime_juridique} onChange={(e) => setL({ regime_juridique: e.target.value as "copropriete" })}><option value="copropriete">En copropriété</option><option value="monopropriete">Monopropriété (maison, immeuble entier)</option></select></Champ>
      <Champ label="Construit"><input className="in" value={t(L.periode_construction)} onChange={(e) => setL({ periode_construction: e.target.value })} placeholder="avant 1949, entre 1975 et 1989…" /></Champ>
      <Champ label="Équipements"><input className="in" value={t(L.equipements)} onChange={(e) => setL({ equipements: e.target.value })} placeholder="cuisine équipée, placards…" /></Champ>
      <Champ label="Annexes privatives"><input className="in" value={t(L.annexes_privatives)} onChange={(e) => setL({ annexes_privatives: e.target.value })} placeholder="cave, parking, jardin…" /></Champ>
      <Champ label="Chauffage"><select className="in" value={L.chauffage} onChange={(e) => setL({ chauffage: e.target.value as "individuel" })}><option value="individuel">Individuel</option><option value="collectif">Collectif</option></select></Champ>
      <Champ label="Eau chaude"><select className="in" value={L.eau_chaude} onChange={(e) => setL({ eau_chaude: e.target.value as "individuelle" })}><option value="individuelle">Individuelle</option><option value="collective">Collective</option></select></Champ>
      <Champ label="Classe DPE"><select className="in" value={t(L.dpe)} onChange={(e) => setL({ dpe: e.target.value || null })}><option value="">—</option>{["A", "B", "C", "D", "E", "F", "G"].map((x) => <option key={x}>{x}</option>)}</select></Champ>

      <h3>Durée et argent</h3>
      <Champ label="Prise d'effet"><input className="in" type="date" value={d.debut} onChange={(e) => set({ ...d, debut: e.target.value })} /></Champ>
      <Champ label="Durée"><select className="in" value={`${d.duree_mois}${d.etudiant ? "e" : ""}`} onChange={(e) => set({ ...d, duree_mois: parseInt(e.target.value, 10), etudiant: e.target.value.endsWith("e") })}>
        {d.meuble ? <><option value="12">1 an</option><option value="9e">9 mois (étudiant)</option></> : <><option value="36">3 ans</option><option value="72">6 ans</option></>}</select></Champ>
      <Champ label="Loyer hors charges (€)"><input className="in" inputMode="decimal" value={d.loyer_hc || ""} onChange={(e) => set({ ...d, loyer_hc: n(e.target.value) ?? 0 })} /></Champ>
      <Champ label="Charges (€ par mois)"><input className="in" inputMode="decimal" value={d.charges || ""} onChange={(e) => set({ ...d, charges: n(e.target.value) ?? 0 })} /></Champ>
      {d.meuble && <Champ label="Charges payées"><select className="in" value={d.charges_mode} onChange={(e) => set({ ...d, charges_mode: e.target.value as "provision" })}><option value="provision">Par provisions, régularisées</option><option value="forfait">Au forfait</option></select></Champ>}
      <Champ label="Payable le"><input className="in" inputMode="numeric" value={d.jour_paiement} onChange={(e) => set({ ...d, jour_paiement: Math.min(31, Math.max(1, n(e.target.value) ?? 5)) })} /></Champ>
      <Champ label="Trimestre de l'IRL"><select className="in" value={d.irl_trimestre} onChange={(e) => set({ ...d, irl_trimestre: Number(e.target.value) as 1 })}>{[1, 2, 3, 4].map((x) => <option key={x} value={x}>{x === 1 ? "1er" : `${x}e`} trimestre</option>)}</select></Champ>
      <Champ label="Dépôt de garantie (€)"><input className="in" inputMode="decimal" value={d.depot_garantie || ""} onChange={(e) => set({ ...d, depot_garantie: n(e.target.value) ?? 0 })} /></Champ>
      <label className="case"><input type="checkbox" checked={!!d.encadrement} onChange={(e) => set({ ...d, encadrement: e.target.checked ? { loyer_reference: null, loyer_reference_majore: null, complement: null } : null })} /> Commune où les loyers sont encadrés (Paris, Lille, Lyon, Montpellier, Bordeaux…)</label>
      {d.encadrement && <>
        <Champ label="Loyer de référence (€ / mois)"><input className="in" inputMode="decimal" value={d.encadrement.loyer_reference ?? ""} onChange={(e) => set({ ...d, encadrement: { ...d.encadrement!, loyer_reference: n(e.target.value) } })} /></Champ>
        <Champ label="Loyer de référence majoré"><input className="in" inputMode="decimal" value={d.encadrement.loyer_reference_majore ?? ""} onChange={(e) => set({ ...d, encadrement: { ...d.encadrement!, loyer_reference_majore: n(e.target.value) } })} /></Champ>
        <Champ label="Complément de loyer (€)"><input className="in" inputMode="decimal" value={d.encadrement.complement ?? ""} onChange={(e) => set({ ...d, encadrement: { ...d.encadrement!, complement: n(e.target.value) } })} /></Champ>
        {!!d.encadrement.complement && <Champ label="Justification du complément"><input className="in" value={t(d.encadrement.complement_motif)} onChange={(e) => set({ ...d, encadrement: { ...d.encadrement!, complement_motif: e.target.value } })} /></Champ>}
      </>}

      <h3>Le reste</h3>
      <Champ label="Travaux"><textarea className="ta" value={t(d.travaux)} onChange={(e) => set({ ...d, travaux: e.target.value })} placeholder="Laisser vide : aucun travaux réalisés ni convenus" /></Champ>
      <Champ label="Clauses particulières"><textarea className="ta" value={t(d.clauses_particulieres)} onChange={(e) => set({ ...d, clauses_particulieres: e.target.value })} placeholder="Animaux, entretien du jardin… (une clause par ligne)" /></Champ>
      <Champ label="Fait à"><input className="in" value={t(d.lieu_signature)} onChange={(e) => set({ ...d, lieu_signature: e.target.value })} /></Champ>
    </div>
  );
}

function FormEdl({ d, set }: { d: DonneesEdl & { emails?: string[] }; set: (d: DonneesEdl) => void }) {
  const [piece, setPiece] = useState(0);
  const p = d.pieces[piece];
  const setEl = (i: number, patch: Partial<DonneesEdl["pieces"][number]["elements"][number]>) => set({ ...d, pieces: d.pieces.map((x, k) => (k === piece ? { ...x, elements: x.elements.map((e, j) => (j === i ? { ...e, ...patch } : e)) } : x)) });
  return (
    <div className="form-doc">
      <Champ label="Date"><input className="in" type="date" value={d.date} onChange={(e) => set({ ...d, date: e.target.value })} /></Champ>
      {(d.locataires.length ? d.locataires : [""]).map((l, i) => (
        <div key={i} className="ligne-locataire">
          <Champ label={`Locataire ${i + 1}`}><input className="in" value={l} onChange={(e) => { const ls = [...(d.locataires.length ? d.locataires : [""])]; ls[i] = e.target.value; set({ ...d, locataires: ls }); }} /></Champ>
          <Champ label="Email (pour signer)"><input className="in" type="email" value={d.emails?.[i] ?? ""} onChange={(e) => { const em = [...(d.emails ?? [])]; em[i] = e.target.value; set({ ...d, emails: em } as DonneesEdl); }} /></Champ>
        </div>
      ))}
      <h3>Compteurs</h3>
      {(["electricite", "gaz", "eau_froide", "eau_chaude"] as const).map((k) => (
        <Champ key={k} label={{ electricite: "Électricité (index)", gaz: "Gaz (index)", eau_froide: "Eau froide (m³)", eau_chaude: "Eau chaude (m³)" }[k]}><input className="in" inputMode="decimal" value={d.compteurs[k]} onChange={(e) => set({ ...d, compteurs: { ...d.compteurs, [k]: e.target.value } })} /></Champ>
      ))}
      <h3>Pièce par pièce</h3>
      <div className="pieces-onglets">
        {d.pieces.map((x, i) => {
          const fait = x.elements.every((e) => e.etat);
          return <button key={i} type="button" className={`pill ${i === piece ? "actif" : ""}`} onClick={() => setPiece(i)}>{x.nom}{fait ? " ✓" : ""}</button>;
        })}
        <button type="button" className="pill" onClick={() => { const nom = prompt("Nom de la pièce"); if (nom?.trim()) { set({ ...d, pieces: [...d.pieces, { nom: nom.trim(), elements: ["Sol", "Murs", "Plafond", "Porte", "Fenêtres et volets", "Prises et interrupteurs", "Éclairage"].map((e) => ({ nom: e, etat: "" as Etat, commentaire: "" })) }] }); setPiece(d.pieces.length); } }}>+ Pièce</button>
      </div>
      {p && p.elements.map((e, i) => (
        <div key={e.nom} className="element-edl">
          <b>{e.nom}</b>
          <div className="etats">{ETATS.map((x) => <button key={x.v} type="button" className={`etat ${x.v} ${e.etat === x.v ? "choisi" : ""}`} onClick={() => setEl(i, { etat: x.v })}>{x.t}</button>)}</div>
          <input className="in" value={e.commentaire} placeholder="Remarque (tache, rayure, fonctionne…)" onChange={(ev) => setEl(i, { commentaire: ev.target.value })} />
        </div>
      ))}
      {d.inventaire && <>
        <h3>Inventaire du mobilier</h3>
        {d.inventaire.map((x, i) => (
          <div key={x.nom} className="element-edl">
            <b>{x.nom}</b>
            <div className="etats">{ETATS.map((y) => <button key={y.v} type="button" className={`etat ${y.v} ${x.etat === y.v ? "choisi" : ""}`} onClick={() => set({ ...d, inventaire: d.inventaire!.map((z, k) => (k === i ? { ...z, etat: y.v } : z)) })}>{y.t}</button>)}</div>
          </div>
        ))}
      </>}
      <h3>Clés remises</h3>
      {d.cles.map((c, i) => <Champ key={i} label={c.type}><input className="in" inputMode="numeric" value={c.nombre} onChange={(e) => set({ ...d, cles: d.cles.map((x, k) => (k === i ? { ...x, nombre: n(e.target.value) ?? 0 } : x)) })} /></Champ>)}
      <Champ label="Observations"><textarea className="ta" value={d.observations ?? ""} onChange={(e) => set({ ...d, observations: e.target.value })} /></Champ>
    </div>
  );
}

function LectureDoc({ api, doc, contenu, onModifier, onSigner, onChange, onSupprime, toast }: { api: Api; doc: DocLocation; contenu: ContenuDocument; onModifier: () => void; onSigner: () => void; onChange: (d: DocLocation) => void; onSupprime: () => void; toast: (m: string) => void }) {
  const [liens, setLiens] = useState(doc.liens ?? null);
  const [envoi, setEnvoi] = useState(false);
  const [busy, setBusy] = useState(false);
  const moiSigne = doc.signatures.find((s) => s.role === "bailleur")?.signe_le;
  const ouvrirPdf = async () => {
    const b = await api.pdfDocLocation(doc.id).catch((e) => { toast((e as Error).message); return null; });
    if (!b) return toast("Dans la démo, le document s'affiche ici ; avec votre compte, vous obtenez le PDF signé.");
    const url = URL.createObjectURL(b); const f = new File([b], `${TYPE_TXT[doc.type]}.pdf`, { type: "application/pdf" });
    try { if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: TYPE_TXT[doc.type] }); return; } } catch { /* cancelled */ }
    window.open(url, "_blank");
  };
  return (
    <>
      <div className="lecture-tete">
        <span className={`statut-doc ${doc.statut}`}>{STATUT_TXT[doc.statut]}</span>
        {doc.signatures.length > 0 && <ul className="signataires">{doc.signatures.map((s) => <li key={s.id}>{s.signe_le ? "✓" : "…"} {s.nom} <small>{s.role === "bailleur" ? "bailleur" : "locataire"}{s.signe_le ? ` · signé le ${dateFr(s.signe_le.slice(0, 10))}` : " · en attente"}</small></li>)}</ul>}
      </div>
      <Apercu c={contenu} />
      <div className="barre-actions">
        {doc.statut === "brouillon" && <>
          <button className="btn ghost" onClick={onModifier}>Modifier</button>
          {!envoi ? <button className="btn" onClick={() => setEnvoi(true)}>Envoyer pour signature</button> : (
            <div className="envoi-signature">
              <p>Le texte sera figé. Chaque locataire reçoit un lien personnel pour lire et signer{doc.type === "bail" && (doc.donnees as DonneesBail).locataires.every((l) => l.email) ? " par email" : " : ajoutez son email, ou copiez le lien pour le lui transmettre"}. Vous signerez ensuite ici.</p>
              <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { const d = await api.envoyerDocLocation(doc.id, true); setLiens(d.liens ?? null); onChange(d); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Envoi…" : "Confirmer l'envoi"}</button>
            </div>
          )}
        </>}
        {doc.statut === "a_signer" && !moiSigne && <button className="btn" onClick={onSigner}>Signer comme bailleur</button>}
        {doc.statut !== "brouillon" && <button className="btn ghost" onClick={ouvrirPdf}>{doc.statut === "signe" ? "Le PDF signé" : "Voir le PDF"}</button>}
        {doc.statut !== "signe" && <button className="link" style={{ color: "var(--mist)" }} onClick={async () => { await api.supprimerDocLocation(doc.id); toast(doc.statut === "brouillon" ? "Brouillon supprimé" : "Signature annulée"); onSupprime(); }}>{doc.statut === "brouillon" ? "Supprimer le brouillon" : "Annuler la signature"}</button>}
      </div>
      {liens && liens.length > 0 && (
        <div className="liens-signature">
          {liens.map((l) => (
            <div key={l.lien}>
              <b>{l.nom}</b><span>{l.envoye ? `Lien envoyé à ${l.email}` : "Lien à transmettre"}</span>
              <button className="link" onClick={async () => { try { await navigator.clipboard.writeText(l.lien); toast("Lien copié"); } catch { prompt("Lien de signature", l.lien); } }}>Copier le lien</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SignatureBailleur({ api, doc, contenu, onFait, toast }: { api: Api; doc: DocLocation; contenu: ContenuDocument; onFait: (d: DocLocation) => void; toast: (m: string) => void }) {
  const [png, setPng] = useState<string | null>(null);
  const [lu, setLu] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1 className="detail-title">Signer</h1>
      <details className="apercu-replie"><summary>Relire le document</summary><Apercu c={contenu} /></details>
      <label className="case"><input type="checkbox" checked={lu} onChange={(e) => setLu(e.target.checked)} /> J'ai lu et j'accepte ce document</label>
      <PaveSignature onChange={setPng} />
      <button className="btn block" disabled={!png || !lu || busy} onClick={async () => { setBusy(true); try { onFait(await api.signerDocLocation(doc.id, png!)); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Signature…" : "Signer"}</button>
    </>
  );
}

/** The tenant's page, opened from the personal link: no account needed. */
export function PageSignature({ api, jeton }: { api: Api; jeton: string }) {
  const [v, setV] = useState<SignaturePublique | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [lu, setLu] = useState(false);
  const [busy, setBusy] = useState(false);
  const charger = () => api.signaturePublique(jeton).then(setV).catch((e) => setErr((e as Error).message));
  useEffect(() => { charger(); }, [jeton]); // eslint-disable-line react-hooks/exhaustive-deps
  const pdf = api.pdfPublicUrl(jeton);
  return (
    <div className="app"><div className="screen location page-signature">
      <p className="marque-signature">Lucien · signature en ligne</p>
      {err && <p className="note">{err}</p>}
      {v && <>
        <h1 className="detail-title">{v.titre}</h1>
        <p className="detail-sub">Bonjour {v.moi.nom}, voici le document à lire et à signer.</p>
        <ul className="signataires">{v.signatures.map((s, i) => <li key={i}>{s.signe_le ? "✓" : "…"} {s.nom} <small>{s.role}{s.signe_le ? ` · signé le ${dateFr(s.signe_le.slice(0, 10))}` : " · en attente"}</small></li>)}</ul>
        <Apercu c={v} />
        {v.moi.signe_le ? (
          <div className="confidence ok" style={{ display: "block" }}>
            Vous avez signé le {dateFr(v.moi.signe_le.slice(0, 10))}. {v.statut === "signe" ? (pdf ? "Tout le monde a signé : téléchargez votre exemplaire." : "Tout le monde a signé.") : "Vous recevrez le document signé quand tout le monde aura signé, sur ce même lien."}
            {v.statut === "signe" && pdf && <p style={{ marginTop: 10 }}><a className="btn" href={pdf} target="_blank" rel="noreferrer">Télécharger le PDF signé</a></p>}
          </div>
        ) : v.statut === "a_signer" ? (
          <div className="zone-signature">
            <label className="case"><input type="checkbox" checked={lu} onChange={(e) => setLu(e.target.checked)} /> J'ai lu et j'accepte ce document</label>
            <PaveSignature onChange={setPng} />
            <button className="btn block" disabled={!png || !lu || busy} onClick={async () => { setBusy(true); try { await api.signerPublic(jeton, png!, v.empreinte); await charger(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Signature…" : "Signer"}</button>
            <p className="note">En signant, vous acceptez que votre signature électronique ait la même valeur qu'une signature manuscrite (article 1367 du Code civil). La date, l'heure et votre adresse IP sont enregistrées.</p>
          </div>
        ) : <p className="note">Ce document n'est pas ouvert à la signature.</p>}
      </>}
    </div></div>
  );
}
