import { conservation, SOURCE_CONSERVATION } from "../../../server/src/conservation";
import { useEffect, useState } from "react";
import type { Api } from "../api";
import { CATEGORIES, CATEGORY_LABEL, type Category, type Deadline, type DetailsDoc, type Doc } from "../types";
import { Back, DateChip, fmtDate, fmtEuro, PERIOD_LABEL, relative } from "../ui";
import { CoffreSheet } from "./Coffre";
import { CourrierAssistant } from "./Courrier";
import { PagesPdf } from "./PagesPdf";
import { Ico } from "./espacesCommun";

type Full = Doc & { echeances: Deadline[]; texte?: string | null; details?: DetailsDoc | null; relisible?: boolean };

const PERIODICITE: Record<string, string> = { mensuel: "Mensuelle", trimestriel: "Trimestrielle", annuel: "Annuelle", unique: "Paiement unique" };

/**
 * The original photo or PDF, shown inside the app: a link opened outside would lose the session on an installed
 * iPhone app. Shared or saved with the phone's own sheet when it can, downloaded otherwise.
 */
function Original({ api, doc, onClose, toast }: { api: Api; doc: Doc; onClose: () => void; toast: (m: string) => void }) {
  const [fichier, setFichier] = useState<{ url: string; blob: Blob } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    api.fichierDocument(doc.id).then((blob) => { url = URL.createObjectURL(blob); setFichier({ url, blob }); }).catch((e) => setErreur((e as Error).message));
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => { removeEventListener("keydown", k); if (url) URL.revokeObjectURL(url); };
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const type = fichier?.blob.type ?? "";
  const ext = type === "application/pdf" ? ".pdf" : type === "image/png" ? ".png" : type === "image/svg+xml" ? ".svg" : type.startsWith("image/") ? ".jpg" : "";
  const nom = `${doc.title.replace(/[^\p{L}\p{N} ._-]+/gu, "").trim().slice(0, 80) || "document"}${ext}`;
  const partager = async () => {
    if (!fichier) return;
    const f = new File([fichier.blob], nom, { type });
    try {
      if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: doc.title }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const a = document.createElement("a"); a.href = fichier.url; a.download = nom; a.click();
    toast("Document téléchargé");
  };
  return (
    <div className="original-fond" role="dialog" aria-label={`Original : ${doc.title}`}>
      <div className="original-tete">
        <button className="link" onClick={onClose}>Fermer</button>
        <b>{doc.title}</b>
        <button className="link" onClick={partager} disabled={!fichier}>Enregistrer</button>
      </div>
      <div className="original-corps">
        {erreur ? <p className="note">{erreur}</p>
          : !fichier ? <p className="note">Ouverture…</p>
            : type === "application/pdf" ? <PagesPdf blob={fichier.blob} titre={doc.title} />
              : type.startsWith("image/") ? <img src={fichier.url} alt={doc.title} />
                : <p className="note">Ce format ne s'affiche pas ici : touchez « Enregistrer » pour l'ouvrir avec une autre appli.</p>}
      </div>
    </div>
  );
}

export function DocumentDetail({ api, id, onBack, onChanged, toast, membres = [] }: { api: Api; id: string; onBack: () => void; onChanged: () => void; toast: (m: string) => void; membres?: { id: string; prenom: string }[] }) {
  const [doc, setDoc] = useState<Full | null>(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Partial<Doc>>({});
  const [letter, setLetter] = useState<string | null>(null);
  const [letterKind, setLetterKind] = useState<"resiliation" | "reclamation" | "remboursement" | null>(null);
  const [nom, setNom] = useState(() => localStorage.getItem("lucien.nom") ?? "");
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [original, setOriginal] = useState(false);
  const [coffre, setCoffre] = useState(false);

  useEffect(() => { api.document(id).then(setDoc); }, [api, id]);

  if (!doc) return <div className="screen"><Back onClick={onBack} /><p className="note">Chargement…</p></div>;

  const save = async () => {
    const patch: Partial<Doc> = { ...draft, verifie: 1 };
    if (patch.montant !== undefined && patch.montant !== null) patch.montant = Number(patch.montant);
    if (patch.preavis_jours !== undefined && patch.preavis_jours !== null) patch.preavis_jours = Number(patch.preavis_jours);
    await api.updateDocument(doc.id, patch);
    setDoc(await api.document(id));
    setEdit(false); setDraft({});
    onChanged();
    toast("Document mis à jour, échéances recalculées");
  };

  const confirm = async () => {
    await api.updateDocument(doc.id, { verifie: 1 });
    setDoc({ ...doc, verifie: 1 });
    onChanged();
    toast("Vérifié");
  };

  const remove = async () => {
    if (!window.confirm("Supprimer ce document et ses échéances ?")) return;
    await api.deleteDocument(doc.id);
    onChanged();
    toast("Document supprimé");
    onBack();
  };

  const writeLetter = async () => {
    if (!letterKind || !nom.trim()) return;
    setBusy(true);
    localStorage.setItem("lucien.nom", nom);
    try { setLetter(await api.letter({ document_id: doc.id, kind: letterKind, nom, motif: motif || undefined })); }
    finally { setBusy(false); }
  };

  const v = <K extends keyof Doc>(k: K) => (draft[k] !== undefined ? draft[k] : doc[k]) as Doc[K];
  const F = ({ k, label, type = "text", options }: { k: keyof Doc; label: string; type?: string; options?: { value: string; label: string }[] }) => (
    <div className="field">
      <span>{label}</span>
      {edit ? (
        options ? (
          <select value={(v(k) as string) ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value || null })}>
            <option value="">—</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input type={type} value={(v(k) as string | number | null) ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value === "" ? null : e.target.value })} />
        )
      ) : (
        <b>{k === "montant" ? (doc.montant != null ? `${fmtEuro(doc.montant, 2)} ${doc.periodicite ? PERIOD_LABEL[doc.periodicite] : ""}` : "—")
          : k.startsWith("date") ? fmtDate(doc[k] as string | null)
            : k === "periodicite" ? (doc.periodicite ? PERIODICITE[doc.periodicite] ?? doc.periodicite : "—")
              : k === "category" ? CATEGORY_LABEL[doc.category]
                : k === "preavis_jours" ? (doc.preavis_jours != null ? `${doc.preavis_jours} jours` : "—")
                  : ((doc[k] as string | null) ?? "—")}</b>
      )}
    </div>
  );

  const uncertain = !doc.verifie && (doc.confiance ?? 1) < 0.7;

  return (
    <div className="screen">
      <Back onClick={onBack} label="Papiers" />
      {edit
        ? <input className="in detail-title-in" aria-label="Titre" value={(draft.title ?? doc.title) as string} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        : <h1 className="detail-title">{doc.title}</h1>}
      <p className="detail-sub">{[doc.organisme, CATEGORY_LABEL[doc.category]].filter(Boolean).join(" · ")}</p>

      {membres.length > 0 && (
        <div className="pour-qui" role="group" aria-label="Pour qui">
          <span>Pour</span>
          {[{ id: null as string | null, prenom: "Toute la famille" }, ...membres].map((m) => (
            <button key={m.id ?? "foyer"} className="pill" aria-pressed={(doc.member_id ?? null) === m.id} onClick={async () => {
              if ((doc.member_id ?? null) === m.id) return;
              try { await api.updateDocument(doc.id, { member_id: m.id }); setDoc({ ...doc, member_id: m.id }); onChanged(); toast(m.id ? `Rangé pour ${m.prenom}` : "Rangé pour toute la famille"); }
              catch (e) { toast((e as Error).message); }
            }}>{m.prenom}</button>
          ))}
        </div>
      )}

      {doc.au_coffre && (
        <div className={`coffre-bandeau ${doc.verrouille ? "" : "ouvert"}`}>
          <Ico d="M6 11h12v9H6zM8 11V8a4 4 0 018 0v3" size={22} />
          <span>{doc.verrouille ? <><b>Au coffre-fort.</b> L'original, le texte et les numéros complets s'ouvrent après Face ID, empreinte ou un code par email.</> : <><b>Coffre ouvert.</b> Cette consultation est notée dans votre journal des accès.</>}</span>
          {doc.verrouille && <button className="pill-action principal" onClick={() => setCoffre(true)}>Déverrouiller</button>}
        </div>
      )}
      {coffre && <CoffreSheet api={api} toast={toast} onClose={() => setCoffre(false)} onOuvert={async () => { setCoffre(false); setDoc(await api.document(id)); }} />}
      {doc.resume && <p style={{ marginBottom: 16 }}>{doc.resume}</p>}
      {(doc.fichier || api.mode === "demo") && <button className="btn ghost original-btn" onClick={() => (doc.verrouille ? setCoffre(true) : setOriginal(true))}>Voir le document original</button>}
      {original && <Original api={api} doc={doc} onClose={() => setOriginal(false)} toast={toast} />}

      {uncertain ? (
        <div className="confidence">Extraction incertaine ({Math.round((doc.confiance ?? 0) * 100)} %). Vérifiez puis <button className="link" onClick={confirm}>confirmez</button> ou <button className="link" onClick={() => setEdit(true)}>corrigez</button>.</div>
      ) : (
        <div className="confidence ok">{doc.verifie ? "Vérifié par vous" : `Extrait par l'IA avec ${Math.round((doc.confiance ?? 0) * 100)} % de confiance`}</div>
      )}

      {!doc.verrouille && <Coordonnees api={api} doc={doc} toast={toast} onDetails={(details, texte, maj) => { setDoc({ ...doc, ...(maj ?? {}), details, texte: texte ?? doc.texte }); if (maj) onChanged(); }} />}

      <div className="fields">
        <F k="category" label="Catégorie" options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c as Category] }))} />
        <F k="organisme" label="Organisme" />
        <F k="numero_contrat" label={doc.category === "identite" ? "N° du document" : "N° de contrat"} />
        <F k="montant" label="Montant" type="number" />
        <F k="periodicite" label="Périodicité" options={Object.entries(PERIOD_LABEL).map(([value, label]) => ({ value, label }))} />
        <F k="date_document" label="Date du document" type="date" />
        <F k="date_debut" label={doc.category === "identite" ? "Délivré le" : "Début"} type="date" />
        <F k="date_fin" label={doc.category === "identite" ? "Valable jusqu'au" : "Fin / échéance"} type="date" />
        <F k="preavis_jours" label="Préavis (jours)" type="number" />
      </div>

      {(() => {
        const c = conservation(doc);
        return c ? (
          <div className={`garder ${c.peut_jeter ? "jeter" : ""}`}>
            <span className="garder-ico" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={c.peut_jeter ? "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" : "M12 8v4l3 2M12 21a9 9 0 110-18 9 9 0 010 18z"} /></svg></span>
            <div><b>Combien de temps le garder ? {c.garder}</b><span>{c.detail} <a href={SOURCE_CONSERVATION} target="_blank" rel="noreferrer">Source</a></span></div>
          </div>
        ) : null;
      })()}

      {edit ? (
        <div className="actions">
          <button className="btn" onClick={save}>Enregistrer</button>
          <button className="btn ghost" onClick={() => { setEdit(false); setDraft({}); }}>Annuler</button>
        </div>
      ) : (
        <div className="actions">
          <button className="btn ghost" onClick={() => setEdit(true)}>Corriger</button>
          <button className="btn danger" onClick={remove}>Supprimer</button>
        </div>
      )}

      <section className="section">
        <div className="section-head"><h2>Échéances liées</h2></div>
        {doc.echeances.length === 0 ? <p className="note">Aucune échéance déduite. Ajoutez une date de fin pour en créer.</p> : (
          <ul className="list">
            {doc.echeances.map((d) => (
              <li key={d.id} className="row-item">
                <DateChip iso={d.date} />
                <div><div className="t">{d.titre.replace(/:\s.*$/, "")}</div><div className="s">{relative(d.date)}{d.fait ? " · fait" : ""}{d.note ? ` · ${d.note}` : ""}</div></div>
                <span />
              </li>
            ))}
          </ul>
        )}
      </section>

      {!["identite", "impots"].includes(doc.category) && <section className="section">
        <div className="section-head"><h2>Courrier prêt à envoyer</h2></div>
        <div className="pills">
          {(["resiliation", "reclamation", "remboursement"] as const).filter((k) => k !== "resiliation" || (doc.periodicite !== "unique" && !["garantie", "vehicule"].includes(doc.category))).map((k) => (
            <button key={k} className="pill" aria-pressed={letterKind === k} onClick={() => { setLetterKind(k); setLetter(null); }}>
              {k === "resiliation" ? "Résiliation" : k === "reclamation" ? "Réclamation" : "Remboursement"}
            </button>
          ))}
        </div>
        {(letterKind === "reclamation" || letterKind === "remboursement") && <CourrierAssistant api={api} doc={doc} type={letterKind} toast={toast} />}
        {letterKind === "resiliation" && (
          <>
            <label className="lbl" htmlFor="nom">Votre nom</label>
            <input id="nom" className="in" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Prénom Nom" />
            <label className="lbl" htmlFor="motif">Motif (facultatif)</label>
            <input id="motif" className="in" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="ex. hausse de tarif, déménagement…" />
            <div style={{ marginTop: 12 }}>
              <button className="btn block" disabled={busy || !nom.trim()} onClick={writeLetter}>{busy ? <span className="spinner" /> : "Rédiger le courrier"}</button>
            </div>
            {letter && (
              <>
                <div className="letter">{letter}</div>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button className="btn ghost" onClick={() => { navigator.clipboard.writeText(letter); toast("Courrier copié"); }}>Copier</button>
                  {typeof navigator.share === "function" && <button className="btn ghost" onClick={() => navigator.share({ title: doc.title, text: letter })}>Partager</button>}
                </div>
              </>
            )}
          </>
        )}
      </section>}
    </div>
  );
}

const ibanLisible = (x: string) => x.replace(/(.{4})/g, "$1 ").trim();

/** « Coordonnées et références » : what Lucien read on the paper, ready to call, write, pay or quote. */
function Coordonnees({ api, doc, toast, onDetails }: { api: Api; doc: Full; toast: (m: string) => void; onDetails: (d: DetailsDoc | null, texte: string | null, maj?: Doc) => void }) {
  const [busy, setBusy] = useState(false);
  const d = doc.details;
  const copier = (x: string, quoi: string) => { navigator.clipboard?.writeText(x).then(() => toast(`${quoi} copié`)).catch(() => toast(x)); };
  const relire = async () => {
    setBusy(true);
    try { const r = await api.relireDocument(doc.id); onDetails(r.details, r.texte); toast(r.details ? "Lucien a relu le papier" : "Rien de plus à relever sur ce papier"); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  if (doc.category === "identite") return doc.relisible && (!doc.numero_contrat || !doc.date_fin) ? (
    <div className="coord-vide">
      <span>Lucien peut relire cette pièce pour reprendre son numéro et sa date de validité.</span>
      <button className="pill-action" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const r = await api.relireDocument(doc.id); onDetails(null, null, r.doc); toast(r.doc?.numero_contrat ? "Numéro et validité relevés" : "Lucien n'a pas pu lire le numéro"); }
        catch (e) { toast((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? "Lecture…" : "Lucien relit la pièce"}</button>
    </div>
  ) : null;
  if (!d) return doc.relisible ? (
    <div className="coord-vide">
      <span>Adresse, email, téléphone, IBAN, références : Lucien peut les relever sur ce papier pour vos courriers et paiements.</span>
      <button className="pill-action" disabled={busy} onClick={relire}>{busy ? "Lecture…" : "Lucien relit ce papier"}</button>
    </div>
  ) : null;
  const c = d.contact;
  const lignes: { t: string; v: string; lien?: string; copie?: string }[] = [
    ...(c.service || c.nom ? [{ t: "Service", v: [c.nom, c.service].filter(Boolean).join(" — ") }] : []),
    ...(c.adresse ? [{ t: "Adresse", v: c.adresse, copie: [c.service ?? c.nom, c.adresse].filter(Boolean).join("\n") }] : []),
    ...(c.email ? [{ t: "Email", v: c.email, lien: `mailto:${c.email}`, copie: c.email }] : []),
    ...(c.telephone ? [{ t: "Téléphone", v: c.telephone, lien: `tel:${c.telephone.replace(/\s+/g, "")}` }] : []),
    ...(c.site ? [{ t: "Site", v: c.site, lien: /^https?:/.test(c.site) ? c.site : `https://${c.site}` }] : []),
    ...(d.paiement?.iban ? [{ t: "IBAN", v: ibanLisible(d.paiement.iban) + (d.paiement.bic ? ` · BIC ${d.paiement.bic}` : ""), copie: d.paiement.iban }] : []),
    ...(d.paiement?.date_limite ? [{ t: "À payer avant le", v: fmtDate(d.paiement.date_limite) }] : []),
    ...d.references.map((r) => ({ t: r.libelle, v: r.valeur, copie: r.valeur })),
    ...d.dates_cles.map((r) => ({ t: r.libelle, v: fmtDate(r.date) })),
  ];
  return (
    <section className="section coord">
      <div className="section-head"><h2>Coordonnées et références</h2></div>
      <ul className="coord-liste">
        {lignes.map((l, k) => (
          <li key={k}>
            <span className="coord-t">{l.t}</span>
            <span className="coord-v">{l.lien ? <a href={l.lien} target={l.lien.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{l.v}</a> : l.v}</span>
            {l.copie && <button className="link coord-copier" onClick={() => copier(l.copie!, l.t)}>Copier</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
