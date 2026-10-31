import { useEffect, useState } from "react";
import type { Api } from "../api";
import { CATEGORIES, CATEGORY_LABEL, type Category, type Deadline, type Doc } from "../types";
import { Back, DateChip, fmtDate, fmtEuro, PERIOD_LABEL, relative } from "../ui";

type Full = Doc & { echeances: Deadline[]; texte?: string | null };

export function DocumentDetail({ api, id, onBack, onChanged, toast }: { api: Api; id: string; onBack: () => void; onChanged: () => void; toast: (m: string) => void }) {
  const [doc, setDoc] = useState<Full | null>(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Partial<Doc>>({});
  const [letter, setLetter] = useState<string | null>(null);
  const [letterKind, setLetterKind] = useState<"resiliation" | "reclamation" | "remboursement" | null>(null);
  const [nom, setNom] = useState(() => localStorage.getItem("lucien.nom") ?? "");
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);

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
            : k === "periodicite" ? (doc.periodicite ? PERIOD_LABEL[doc.periodicite] : "—")
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
      <h1 className="detail-title">{doc.title}</h1>
      <p className="detail-sub">{[doc.organisme, CATEGORY_LABEL[doc.category]].filter(Boolean).join(" · ")}{doc.fichier && api.mode !== "demo" ? <> · <a href={`/api/documents/${doc.id}/fichier`} target="_blank" rel="noreferrer">Voir l'original</a></> : null}</p>

      {doc.resume && <p style={{ marginBottom: 16 }}>{doc.resume}</p>}

      {uncertain ? (
        <div className="confidence">Extraction incertaine ({Math.round((doc.confiance ?? 0) * 100)} %). Vérifiez puis <button className="link" onClick={confirm}>confirmez</button> ou <button className="link" onClick={() => setEdit(true)}>corrigez</button>.</div>
      ) : (
        <div className="confidence ok">{doc.verifie ? "Vérifié par vous" : `Extrait par l'IA avec ${Math.round((doc.confiance ?? 0) * 100)} % de confiance`}</div>
      )}

      <div className="fields">
        <F k="category" label="Catégorie" options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c as Category] }))} />
        <F k="organisme" label="Organisme" />
        <F k="numero_contrat" label="N° de contrat" />
        <F k="montant" label="Montant" type="number" />
        <F k="periodicite" label="Périodicité" options={Object.entries(PERIOD_LABEL).map(([value, label]) => ({ value, label }))} />
        <F k="date_document" label="Date du document" type="date" />
        <F k="date_debut" label="Début" type="date" />
        <F k="date_fin" label="Fin / échéance" type="date" />
        <F k="preavis_jours" label="Préavis (jours)" type="number" />
      </div>

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

      <section className="section">
        <div className="section-head"><h2>Courrier prêt à envoyer</h2></div>
        <div className="pills">
          {(["resiliation", "reclamation", "remboursement"] as const).map((k) => (
            <button key={k} className="pill" aria-pressed={letterKind === k} onClick={() => { setLetterKind(k); setLetter(null); }}>
              {k === "resiliation" ? "Résiliation" : k === "reclamation" ? "Réclamation" : "Remboursement"}
            </button>
          ))}
        </div>
        {letterKind && (
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
      </section>
    </div>
  );
}
