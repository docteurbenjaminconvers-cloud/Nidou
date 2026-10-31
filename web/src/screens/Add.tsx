import { useRef, useState } from "react";
import type { Api } from "../api";
import { ApiError } from "../api";
import { Back } from "../ui";
import type { Doc, Household } from "../types";
import { etatDossiers, piecesSouhaitees } from "../../../server/src/dossiers";

const minus = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function Add({ api, onBack, onAdded, toast, household, docs = [], go }: { api: Api; onBack: () => void; onAdded: (id: string) => void; toast: (m: string) => void; household?: Household; docs?: Doc[]; go?: (s: string, id?: string) => void }) {
  const souhaits = piecesSouhaitees(etatDossiers(docs));
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
      setErr(e instanceof ApiError && e.code === "limite_plan" ? e.message + " Passez à la formule complète pour continuer." : "L'extraction a échoué. Réessayez, ou collez le texte du document.");
    } finally { setBusy(false); }
  };

  return (
    <div className="screen">
      <Back onClick={onBack} />
      <div className="top"><div><h1>Ajouter un papier</h1><p className="sub">Lucien lit le document, range la catégorie, extrait les dates et crée les rappels.</p></div></div>

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
          <><b>Photo, PDF ou capture d'écran</b><p>Un courrier, une facture, un contrat, une carte d'identité… Pas de document médical : Lucien ne les garde pas.</p></>
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
            ? "Votre essai est terminé : choisissez une formule dans Réglages pour ajouter des papiers. Ceux que vous avez restent consultables et exportables."
            : household?.ia_gratuit_en_pause
              ? "Les lectures IA du plan gratuit sont en pause jusqu'au mois prochain : la lecture se fait sans IA, vous complétez les champs. La formule complète n'a pas cette limite."
              : restantes > 0
                ? `Plan gratuit : ${restantes} lecture${restantes > 1 ? "s" : ""} par l'IA ce mois-ci. Ensuite, la lecture se fait sans IA et vous complétez les champs.`
                : "Plan gratuit : quota mensuel de lectures IA atteint. La lecture se fait sans IA ; complétez les champs manquants. La formule complète lit chaque document avec l'IA."}
        </p>
      )}

      {souhaits.length > 0 && (
        <section className="section souhaits" style={{ marginTop: 26 }}>
          <div className="section-head"><h2>Ce qui me manque</h2>{go && <button className="link" onClick={() => go("dossiers")}>Dossiers</button>}</div>
          <p className="note" style={{ marginBottom: 10 }}>Avec ces papiers, vos dossiers seront prêts le jour où on vous les demande.</p>
          <ul className="list">
            {souhaits.map((s) => (
              <li key={s.cle} className="souhait">
                <b>{s.libelle}</b>
                <span className="souhait-pour">{s.statut === "ancien" ? "Le mien est trop ancien · " : s.statut === "expire" ? "Le mien est expiré · " : ""}Pour {s.pour.length > 2 ? `${s.pour.slice(0, 2).map(minus).join(", ")} et ${s.pour.length - 2} autre${s.pour.length - 2 > 1 ? "s" : ""}` : s.pour.map(minus).join(" et ")}</span>
                <span className="souhait-ou">{s.obtenir}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
