import { useRef, useState } from "react";
import type { Api } from "../api";
import { ApiError } from "../api";
import { Back } from "../ui";
import type { Doc, Household } from "../types";
import { etatDossiers, piecesSouhaitees } from "../../../server/src/dossiers";

const MAX = 20;
type Suivi = { nom: string; etat: "attente" | "lecture" | "ok" | "erreur"; id?: string; titre?: string; echeances?: number; message?: string };
const minus = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function Add({ api, onBack, onAdded, toast, household, docs = [], go }: { api: Api; onBack: () => void; onAdded: (id: string) => void; toast: (m: string) => void; household?: Household; docs?: Doc[]; go?: (s: string, id?: string) => void }) {
  const souhaits = piecesSouhaitees(etatDossiers(docs));
  const restantes = household?.ia_lectures_restantes ?? null;
  const [files, setFiles] = useState<File[]>([]);
  const [suivi, setSuivi] = useState<Suivi[] | null>(null); // several papers: where each one is
  const ajouter = (l: FileList | File[] | null | undefined) => { if (l?.length) setFiles((f) => [...f, ...Array.from(l)].slice(0, MAX)); };
  const file = files.length === 1 ? files[0] : null;
  const [texte, setTexte] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);

  /** Several papers: read one after the other (each one its own paper), then a summary. */
  const plusieurs = async () => {
    const items: Suivi[] = [...files.map((f) => ({ nom: f.name, etat: "attente" as const })), ...(texte.trim() ? [{ nom: "Texte collé", etat: "attente" as const }] : [])];
    setSuivi(items); setBusy(true); setErr(null);
    const maj = (i: number, x: Partial<Suivi>) => setSuivi((s) => s && s.map((it, k) => (k === i ? { ...it, ...x } : it)));
    for (let i = 0; i < items.length; i++) {
      maj(i, { etat: "lecture" });
      try {
        const f = files[i];
        const d = await api.addDocument(f ? { file: f } : { texte: texte.trim(), nomFichier: "note.txt" });
        maj(i, { etat: "ok", id: d.id, titre: d.title, echeances: d.echeances.length });
      } catch (e) {
        const fin = e instanceof ApiError && e.code === "limite_plan";
        maj(i, { etat: "erreur", message: fin ? e.message : "Lecture impossible : réessayez ce papier seul." });
        if (fin) { for (let k = i + 1; k < items.length; k++) maj(k, { etat: "erreur", message: "Non lu" }); break; }
      }
    }
    setFiles([]); setTexte(""); setBusy(false);
  };

  const submit = async () => {
    if (files.length + (texte.trim() ? 1 : 0) > 1) return plusieurs();
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
        onDrop={(e) => { e.preventDefault(); setDrag(false); ajouter(e.dataTransfer.files); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h3l2-2h6l2 2h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
        {files.length ? (
          <>
            <b>{files.length === 1 ? "1 papier prêt" : `${files.length} papiers prêts`}</b>
            <ul className="lot">
              {files.map((f, k) => <li key={k}><span>{f.name}</span><small>{(f.size / 1024).toFixed(0)} Ko</small><button className="link" aria-label={`Retirer ${f.name}`} onClick={() => setFiles((l) => l.filter((_, j) => j !== k))}>retirer</button></li>)}
            </ul>
            {files.length < MAX && <p>Un papier par photo ou par fichier : Lucien les lit l'un après l'autre.</p>}
          </>
        ) : (
          <><b>Photos, PDF ou captures d'écran</b><p>Un ou plusieurs à la fois : courriers, factures, contrats, carte d'identité… Pas de document médical : Lucien ne les garde pas.</p></>
        )}
        <div className="actions" style={{ marginTop: 14, marginBottom: 0 }}>
          <button className="btn" disabled={busy || files.length >= MAX} onClick={() => cam.current?.click()}>{files.length ? "Photo suivante" : "Prendre en photo"}</button>
          <button className="btn ghost" disabled={busy || files.length >= MAX} onClick={() => pick.current?.click()}>{files.length ? "Ajouter des fichiers" : "Choisir des fichiers"}</button>
        </div>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { ajouter(e.target.files); e.target.value = ""; }} />
        <input ref={pick} type="file" accept="image/*,application/pdf,text/plain" multiple hidden onChange={(e) => { ajouter(e.target.files); e.target.value = ""; }} />
      </div>

      <p className="or">ou</p>
      <label className="lbl" htmlFor="texte">Collez le texte d'un email ou d'un document</label>
      <textarea id="texte" className="ta" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={"Ex. : MAIF — Avis d'échéance\nContrat n° AUT-4471-8820\nCotisation annuelle : 612 €\nPériode du 01/12/2026 au 30/11/2027"} />

      {err && <p className="note" style={{ color: "var(--ember)", marginTop: 10 }}>{err}</p>}
      <div style={{ marginTop: 16 }}>
        <button className="btn block" disabled={busy || (!files.length && !texte.trim())} onClick={submit}>{busy ? <><span className="spinner" /> {suivi ? `Lecture ${Math.min(suivi.filter((x) => x.etat !== "attente").length, suivi.length)} sur ${suivi.length}…` : "Lecture du document…"}</> : files.length + (texte.trim() ? 1 : 0) > 1 ? `Lire et ranger les ${files.length + (texte.trim() ? 1 : 0)} papiers` : "Lire et ranger"}</button>
      </div>
      {suivi && (
        <section className="section lot-suivi">
          <ul className="list">
            {suivi.map((x, k) => (
              <li key={k} className={`lot-${x.etat}`} onClick={() => x.id && onAdded(x.id)} style={x.id ? { cursor: "pointer" } : undefined}>
                <span className="lot-ico" aria-hidden>{x.etat === "ok" ? "✓" : x.etat === "erreur" ? "!" : x.etat === "lecture" ? <span className="spinner" /> : "·"}</span>
                <span className="lot-txt"><b>{x.titre ?? x.nom}</b><small>{x.etat === "ok" ? (x.echeances ? `${x.echeances} échéance${x.echeances > 1 ? "s" : ""} créée${x.echeances > 1 ? "s" : ""}` : "Rangé") : x.etat === "lecture" ? "Lucien lit…" : x.etat === "erreur" ? x.message : "En attente"}</small></span>
              </li>
            ))}
          </ul>
          {!busy && <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={() => go ? go("docs") : onBack()}>Voir mes papiers</button><button className="btn ghost" onClick={() => setSuivi(null)}>En ajouter d'autres</button></div>}
        </section>
      )}
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
