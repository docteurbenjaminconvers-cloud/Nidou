import { useEffect, useState } from "react";
import type { Api } from "../api";
import type { BrouillonCourrier, ChampsCourrier, Doc } from "../types";
import { MOTIFS, type TypeCourrier } from "../../../server/src/courriersMotifs";
import { Ico } from "./espacesCommun";

const EXEMPLES: Record<string, string> = {
  deja_paye: "Ex. J'ai payé cette facture le 20 août par virement (référence …). Je joins la preuve si besoin.",
  montant: "Ex. Le montant facturé ne correspond pas au tarif prévu : je devais payer … et on me réclame ….",
  pas_concerne: "Ex. Je n'habite plus à cette adresse depuis … / ce contrat n'est pas à mon nom.",
  non_recu: "Ex. Je n'ai jamais reçu la facture d'origine, seulement cette relance avec des frais.",
  service: "Ex. L'intervention prévue le … n'a pas eu lieu / le problème n'est toujours pas réglé.",
  trop_preleve: "Ex. On m'a prélevé … le … alors que mon abonnement est à ….",
  double: "Ex. La facture du … a été prélevée deux fois, le … et le ….",
  resilie: "Ex. J'ai résilié le … (lettre envoyée le …) et vous avez encore prélevé … le ….",
  non_livre: "Ex. Commande du … jamais livrée malgré mes relances du ….",
  trop_percu: "Ex. Ma régularisation annuelle fait apparaître un trop-perçu de … en ma faveur.",
  autre: "Racontez simplement : les dates, les montants, ce que vous avez déjà fait.",
};

type Etape = "motif" | "recit" | "relecture" | "confirmer" | "envoye";

/**
 * « Réclamation » / « Remboursement » on a paper: Lucien asks why, the person tells what happened, Lucien writes the
 * letter with the addressee read in the paper (email included), then it leaves by email or as a PDF.
 */
export function CourrierAssistant({ api, doc, type, toast }: { api: Api; doc: Doc; type: TypeCourrier; toast: (m: string) => void }) {
  const [etape, setEtape] = useState<Etape>("motif");
  const [motif, setMotif] = useState<string | null>(null);
  const [recit, setRecit] = useState("");
  const [busy, setBusy] = useState(false);
  const [b, setB] = useState<BrouillonCourrier | null>(null);
  const [champs, setChamps] = useState<Omit<ChampsCourrier, "document_id"> | null>(null);
  const [email, setEmail] = useState("");
  const [envois, setEnvois] = useState<{ destinataire: string; objet: string; envoye_le: string }[]>([]);
  useEffect(() => { setEtape("motif"); setMotif(null); setB(null); }, [type]);
  useEffect(() => { api.envoisCourrier(doc.id).then((r) => setEnvois(r.envois)).catch(() => {}); }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rediger = async () => {
    setBusy(true);
    try {
      const r = await api.redigerCourrier({ document_id: doc.id, type, motif: motif ?? "autre", explication: recit });
      setB(r);
      setChamps({ expediteur: { nom: r.expediteur.nom, adresse: r.expediteur.adresse ?? "" }, destinataire: r.lettre.destinataire, objet: r.lettre.objet, reference: r.lettre.reference, corps: r.corps });
      setEmail(r.emails[0] ?? "");
      setEtape("relecture");
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const tout = (): ChampsCourrier => ({ document_id: doc.id, ...champs! });
  const pret = !!champs && champs.expediteur.nom.trim().length >= 2 && champs.expediteur.adresse.trim().length >= 5;
  const pdf = async () => {
    setBusy(true);
    try {
      const blob = await api.courrierPdf(tout());
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `Courrier-${(champs!.destinataire.nom || "lettre").replace(/[^\w]+/g, "-")}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const envoyer = async () => {
    setBusy(true);
    try { const r = await api.envoyerCourrier({ ...tout(), email }); setEnvois([{ destinataire: r.envoye_a, objet: champs!.objet, envoye_le: new Date().toISOString() }, ...envois]); setEtape("envoye"); toast(`Courrier envoyé à ${r.envoye_a}`); }
    catch (e) { toast((e as Error).message); setEtape("relecture"); } finally { setBusy(false); }
  };
  const texte = champs ? [champs.expediteur.nom, champs.expediteur.adresse, "", champs.destinataire.nom, champs.destinataire.adresse ?? "", "", `Objet : ${champs.objet}`, champs.reference ? `Références : ${champs.reference}` : "", "", champs.corps, "", champs.expediteur.nom].join("\n").replace(/\n{3,}/g, "\n\n") : "";
  const set = (f: (c: Omit<ChampsCourrier, "document_id">) => Omit<ChampsCourrier, "document_id">) => setChamps((c) => (c ? f(c) : c));
  const motifLibelle = MOTIFS[type].find((m) => m.cle === motif)?.libelle;

  return (
    <div className="courrier-assist">
      {envois.length > 0 && etape !== "envoye" && (
        <p className="note courrier-deja">Déjà envoyé : {envois.map((e) => `« ${e.objet} » à ${e.destinataire} le ${new Date(e.envoye_le).toLocaleDateString("fr-FR")}`).join(" · ")}</p>
      )}

      <div className="cbulle lucien"><b>Lucien</b>{type === "reclamation" ? "Pour quel motif voulez-vous contester ce courrier ?" : "Pourquoi demandez-vous un remboursement ?"}</div>
      <div className="courrier-motifs">
        {MOTIFS[type].map((m) => (
          <button key={m.cle} className="pill" aria-pressed={motif === m.cle} disabled={etape !== "motif" && etape !== "recit"} onClick={() => { setMotif(m.cle); setEtape("recit"); }}>{m.libelle}</button>
        ))}
      </div>

      {etape !== "motif" && (
        <>
          <div className="cbulle lucien"><b>Lucien</b>{motif === "autre" ? "Expliquez-moi la situation" : `« ${motifLibelle} » : racontez-moi`} en quelques phrases. Dates, montants, ce que vous avez déjà fait : je m'occupe de la tournure et des références.</div>
          {etape === "recit" ? (
            <>
              <textarea className="in courrier-recit" rows={4} maxLength={2000} value={recit} autoFocus placeholder={EXEMPLES[motif ?? "autre"]} onChange={(e) => setRecit(e.target.value)} />
              <button className="btn block" disabled={busy || recit.trim().length < 10} onClick={rediger}>{busy ? <><span className="spinner" /> Lucien lit le courrier et rédige…</> : "Rédiger le courrier"}</button>
            </>
          ) : <div className="cbulle moi">{recit}</div>}
        </>
      )}

      {champs && b && (etape === "relecture" || etape === "confirmer") && (
        <>
          <div className="cbulle lucien"><b>Lucien</b>Voici le courrier{b.avec_ia ? "" : " (modèle, sans l'IA)"}. J'ai lu le destinataire dans « {b.source} »{b.emails.length ? <>, avec son adresse email <b>{b.emails[0]}</b></> : " ; je n'y ai pas trouvé d'adresse email"}. Relisez, corrigez si besoin, puis choisissez comment l'envoyer.</div>

          <div className="courrier-carte">
            <p className="reg-titre">Destinataire</p>
            <input className="in" value={champs.destinataire.nom} maxLength={200} onChange={(e) => set((c) => ({ ...c, destinataire: { ...c.destinataire, nom: e.target.value } }))} aria-label="Destinataire" />
            <textarea className="in" rows={3} value={champs.destinataire.adresse ?? ""} maxLength={300} placeholder="Adresse postale" onChange={(e) => set((c) => ({ ...c, destinataire: { ...c.destinataire, adresse: e.target.value } }))} aria-label="Adresse du destinataire" />
            {b.emails.length > 0 && (
              <>
                <span className="courrier-lbl">Email lu dans le papier</span>
                <div className="pills">{b.emails.map((m) => <button key={m} className="pill" aria-pressed={email === m} onClick={() => setEmail(m)}>{m}</button>)}</div>
              </>
            )}
          </div>

          <div className="courrier-carte">
            <p className="reg-titre">Expéditeur</p>
            <input className="in" value={champs.expediteur.nom} maxLength={80} placeholder="Prénom Nom" autoComplete="name" onChange={(e) => set((c) => ({ ...c, expediteur: { ...c.expediteur, nom: e.target.value } }))} aria-label="Votre nom" />
            <textarea className="in" rows={2} value={champs.expediteur.adresse} maxLength={200} placeholder={"Votre adresse postale\n12 rue des Lilas, 34000 Montpellier"} autoComplete="street-address" onChange={(e) => set((c) => ({ ...c, expediteur: { ...c.expediteur, adresse: e.target.value } }))} aria-label="Votre adresse" />
          </div>

          <div className="courrier-carte papier">
            <label className="courrier-lbl" htmlFor="c-objet">Objet</label>
            <input id="c-objet" className="in" value={champs.objet} maxLength={200} onChange={(e) => set((c) => ({ ...c, objet: e.target.value }))} />
            <label className="courrier-lbl" htmlFor="c-ref">Références</label>
            <input id="c-ref" className="in" value={champs.reference ?? ""} maxLength={300} onChange={(e) => set((c) => ({ ...c, reference: e.target.value || null }))} />
            <label className="courrier-lbl" htmlFor="c-corps">Le courrier</label>
            <textarea id="c-corps" className="in courrier-corps" rows={14} value={champs.corps} maxLength={8000} onChange={(e) => set((c) => ({ ...c, corps: e.target.value }))} />
          </div>

          {etape === "confirmer" ? (
            <div className="courrier-carte confirmer">
              <b>Envoyer ce courrier par email ?</b>
              <ul className="apercu-detail">
                <li>À <b>{email}</b>, au nom de {champs.expediteur.nom.trim()}, le courrier joint en PDF.</li>
                <li>Vous êtes en copie{b.email_client ? ` (${b.email_client})` : ""} et la réponse vous arrive directement.</li>
              </ul>
              <div className="feuille-actions">
                <button className="btn ghost" disabled={busy} onClick={() => setEtape("relecture")}>Retour</button>
                <button className="btn" disabled={busy} onClick={envoyer}>{busy ? "Envoi…" : "Envoyer"}</button>
              </div>
            </div>
          ) : (
            <>
              <p className="courrier-q">Comment l'envoyer ?</p>
              <div className="courrier-canaux">
                <button className="canal" disabled={busy || !pret || !email} onClick={() => setEtape("confirmer")}>
                  <span className="canal-ico"><Ico d="M4 6h16v12H4zM4 7l8 6 8-6" /></span>
                  <span><b>Par email</b><small>{email ? `À ${email}, vous en copie · gratuit` : "Aucune adresse email dans ce papier"}</small></span>
                </button>
                <button className="canal" disabled title="Bientôt : Lucien l'envoie en recommandé avec avis de réception">
                  <span className="canal-ico"><Ico d="M4 7h16v11H4zM8 7V5h8v2" /></span>
                  <span><b>Recommandé avec AR</b><small>8,90 € · bientôt disponible</small></span>
                </button>
              </div>
              {!pret && <p className="note">Ajoutez votre nom et votre adresse postale : ils figurent en haut du courrier, Lucien les retient pour les prochains.</p>}
              <div className="actions-abo">
                <button className="pill-action" disabled={busy || !pret} onClick={pdf}><Ico d="M12 4v11M7 10l5 5 5-5M5 20h14" />PDF</button>
                <button className="pill-action" onClick={() => { navigator.clipboard.writeText(texte); toast("Courrier copié"); }}><Ico d="M8 8h11v12H8zM5 16V4h11" />Copier</button>
                {typeof navigator.share === "function" && <button className="pill-action" onClick={() => navigator.share({ title: champs.objet, text: texte }).catch(() => {})}><Ico d="M12 4v12M7 9l5-5 5 5M5 20h14" />Partager</button>}
                <button className="pill-action" onClick={() => { setEtape("recit"); setB(null); setChamps(null); }}><Ico d="M4 12a8 8 0 1 0 3-6.3M4 4v4h4" />Réécrire</button>
              </div>
            </>
          )}
        </>
      )}

      {etape === "envoye" && (
        <div className="courrier-carte envoye">
          <b>Courrier envoyé à {email}</b>
          <span>Vous l'avez reçu en copie. La réponse arrivera directement dans votre boîte mail.</span>
          <button className="link" onClick={() => { setEtape("motif"); setMotif(null); setRecit(""); setB(null); setChamps(null); }}>Écrire un autre courrier</button>
        </div>
      )}
    </div>
  );
}
