import { useRef, useState } from "react";
import type { Api } from "../api";
import { ApiError } from "../api";
import { Back } from "../ui";
import type { Household } from "../types";

export function Add({ api, onBack, onAdded, toast, household }: { api: Api; onBack: () => void; onAdded: (id: string) => void; toast: (m: string) => void; household?: Household }) {
  const restantes = household?.ia_lectures_restantes ?? null;
  const [file, setFile] = useState<File | null>(null);
  const [texte, setTexte] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file && !texte.trim()) return;
    setBusy(true); setErr(null);
    try {
      const d = await api.addDocument({ file: file ?? undefined, texte: texte.trim() || undefined, nomFichier: file ? undefined : "note.txt" });
      toast(d.echeances.length ? `${d.echeances.length} échéance${d.echeances.length > 1 ? "s" : ""} créée${d.echeances.length > 1 ? "s" : ""}` : "Document ajouté");
      onAdded(d.id);
    } catch (e) {
      setErr(e instanceof ApiError && e.code === "limite_plan" ? e.message + " Passez au plan Famille pour continuer." : "L'extraction a échoué. Réessayez, ou collez le texte du document.");
    } finally { setBusy(false); }
  };

  return (
    <div className="screen">
      <Back onClick={onBack} />
      <div className="top"><div><h1>Ajouter un papier</h1><p className="sub">Nidou lit le document, range la catégorie, extrait les dates et crée les rappels.</p></div></div>

      <div
        className={`dropzone ${drag ? "active" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h3l2-2h6l2 2h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
        {file ? (
          <><b>{file.name}</b><p>{(file.size / 1024).toFixed(0)} Ko · <button className="link" onClick={() => setFile(null)}>retirer</button></p></>
        ) : (
          <><b>Photo, PDF ou capture d'écran</b><p>Un courrier, une facture, un contrat, une carte d'identité…</p></>
        )}
        <div className="actions" style={{ marginTop: 14, marginBottom: 0 }}>
          <button className="btn" onClick={() => cam.current?.click()}>Prendre en photo</button>
          <button className="btn ghost" onClick={() => pick.current?.click()}>Choisir un fichier</button>
        </div>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <input ref={pick} type="file" accept="image/*,application/pdf,text/plain" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>

      <p className="or">ou</p>
      <label className="lbl" htmlFor="texte">Collez le texte d'un email ou d'un document</label>
      <textarea id="texte" className="ta" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={"Ex. : MAIF — Avis d'échéance\nContrat n° AUT-4471-8820\nCotisation annuelle : 612 €\nPériode du 01/12/2026 au 30/11/2027"} />

      {err && <p className="note" style={{ color: "var(--ember)", marginTop: 10 }}>{err}</p>}
      <div style={{ marginTop: 16 }}>
        <button className="btn block" disabled={busy || (!file && !texte.trim())} onClick={submit}>{busy ? <><span className="spinner" /> Lecture du document…</> : "Lire et ranger"}</button>
      </div>
      <p className="note" style={{ marginTop: 12 }}>Vous pourrez corriger chaque champ extrait avant de le valider. Rien n'est partagé avec une IA externe sans votre accord.</p>
      {restantes !== null && (
        <p className="note" style={{ marginTop: 8 }}>
          {(household?.limites?.iaLecturesParMois ?? 0) === 0
            ? "Plan gratuit : le document est lu localement, sans IA. Vous complétez les champs manquants. Le plan Famille lit chaque photo, PDF ou email avec l'IA et range tout seul."
            : household?.ia_gratuit_en_pause
              ? "Les lectures IA du plan gratuit sont en pause jusqu'au mois prochain : la lecture se fait sans IA, vous complétez les champs. Le plan Famille n'a pas cette limite."
              : restantes > 0
                ? `Plan gratuit : ${restantes} lecture${restantes > 1 ? "s" : ""} par l'IA ce mois-ci. Ensuite, la lecture se fait sans IA et vous complétez les champs.`
                : "Plan gratuit : quota mensuel de lectures IA atteint. La lecture se fait sans IA ; complétez les champs manquants. Le plan Famille lit chaque document avec l'IA."}
        </p>
      )}
    </div>
  );
}
