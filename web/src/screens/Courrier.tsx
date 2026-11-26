import { useEffect, useState } from "react";
import type { Api, SuiviCourrier } from "../api";
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
const jourFr = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/**
 * Where the letters sent about this paper stand: waiting for the answer, time for the reminder (15 days), then the
 * mediator. Lucien prepares, the person sends.
 */
export function SuiviCourrierCarte({ api, doc, version, onRelance, onChange, toast }: { api: Api; doc: Doc; version: number; onRelance: (b: BrouillonCourrier) => void; onChange?: () => void; toast: (m: string) => void }) {
  const [s, setS] = useState<SuiviCourrier | null>(null);
  const [busy, setBusy] = useState(false);
  const charger = () => api.suiviCourriers().then((r) => setS(r.suivis.find((x) => x.document_id === doc.id) ?? null)).catch(() => {});
  useEffect(() => { charger(); }, [doc.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const repondu = async (v: boolean) => { setBusy(true); try { await api.courrierRepondu(doc.id, v); await charger(); onChange?.(); if (v) toast("Noté : réponse reçue"); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const relancer = async () => { setBusy(true); try { onRelance(await api.relancerCourrier(doc.id)); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const m = s.mediateur;
  const tot = s.mediateur_des_le && s.mediateur_des_le > new Date().toISOString().slice(0, 10) ? s.mediateur_des_le : null;
  return (
    <div className={`courrier-carte suivi suivi-${s.statut}`}>
      <p className="reg-titre">Suivi de votre courrier</p>
      <ol className="suivi-fil">
        {s.envois.map((e, k) => <li key={e.id} className="fait"><b>{k === 0 ? "Courrier envoyé" : "Relance envoyée"}</b><span>le {jourFr(e.envoye_le)} à {e.destinataire}</span></li>)}
        {s.statut === "repondu" && <li className="fait"><b>Réponse reçue</b><span>{s.repondu_le ? `notée le ${jourFr(s.repondu_le)}` : ""}</span></li>}
        {s.statut === "attente" && <li className="encours"><b>Réponse attendue</b><span>Sans nouvelles le {jourFr(s.prochaine_etape_le)}, je vous propose {s.envois.length === 1 ? "la relance, déjà rédigée" : "de saisir le médiateur"}. C'est noté dans votre agenda.</span></li>}
        {s.statut === "relancer" && <li className="encours"><b>{s.depuis_jours} jours sans réponse</b><span>Il est temps de relancer. J'ai préparé la lettre : vous la relisez, puis elle part au même destinataire.</span></li>}
        {s.statut === "mediateur" && <li className="encours"><b>Toujours sans réponse après la relance</b><span>L'étape suivante est gratuite : saisir {m.dans_lettre}.</span></li>}
      </ol>
      {s.statut === "mediateur" && (
        <div className="suivi-med">
          <b>{m.nom}</b>
          <span>{m.conditions}</span>
          {tot && <span>Dans votre cas, à partir du <b>{jourFr(tot)}</b>.</span>}
          <span>À joindre : ce papier et vos {s.envois.length} courriers (vous les avez reçus en copie par email).</span>
          {m.site && <a className="btn" href={m.site} target="_blank" rel="noreferrer">Ouvrir le site du médiateur</a>}
        </div>
      )}
      <div className="suivi-actions">
        {s.statut === "relancer" && <button className="btn" disabled={busy} onClick={relancer}>Relire la relance</button>}
        {s.statut === "attente" && s.envois.length === 1 && <button className="link" disabled={busy} onClick={relancer}>Relancer sans attendre</button>}
        {s.statut === "repondu"
          ? <button className="link" disabled={busy} onClick={() => repondu(false)}>Finalement, pas de vraie réponse</button>
          : <button className="btn ghost" disabled={busy} onClick={() => repondu(true)}>J'ai reçu une réponse</button>}
      </div>
    </div>
  );
}

export function CourrierAssistant({ api, doc, type, toast, relance = null, onEnvoye }: { api: Api; doc: Doc; type: TypeCourrier; toast: (m: string) => void; relance?: BrouillonCourrier | null; onEnvoye?: () => void }) {
  const [etape, setEtape] = useState<Etape>("motif");
  const [motif, setMotif] = useState<string | null>(null);
  const [recit, setRecit] = useState("");
  const [busy, setBusy] = useState(false);
  const [b, setB] = useState<BrouillonCourrier | null>(null);
  const [champs, setChamps] = useState<Omit<ChampsCourrier, "document_id"> | null>(null);
  const [email, setEmail] = useState("");
  const [envois, setEnvois] = useState<{ destinataire: string; objet: string; envoye_le: string }[]>([]);
  const charge = (r: BrouillonCourrier) => {
    setB(r);
    setChamps({ expediteur: { nom: r.expediteur.nom, adresse: r.expediteur.adresse ?? "" }, destinataire: r.lettre.destinataire, objet: r.lettre.objet, reference: r.lettre.reference, corps: r.corps });
    setEmail(r.emails[0] ?? "");
    setEtape("relecture");
  };
  useEffect(() => { if (relance) charge(relance); else { setEtape("motif"); setMotif(null); setB(null); } }, [type, relance]);
  useEffect(() => { api.envoisCourrier(doc.id).then((r) => setEnvois(r.envois)).catch(() => {}); }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rediger = async () => {
    setBusy(true);
    try {
      const r = await api.redigerCourrier({ document_id: doc.id, type, motif: motif ?? "autre", explication: recit });
      charge(r);
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
    try { const r = await api.envoyerCourrier({ ...tout(), email }); setEnvois([{ destinataire: r.envoye_a, objet: champs!.objet, envoye_le: new Date().toISOString() }, ...envois]); setEtape("envoye"); toast(`Courrier envoyé à ${r.envoye_a}`); onEnvoye?.(); }
    catch (e) { toast((e as Error).message); setEtape("relecture"); } finally { setBusy(false); }
  };
  const texte = champs ? [champs.expediteur.nom, champs.expediteur.adresse, "", champs.destinataire.nom, champs.destinataire.adresse ?? "", "", `Objet : ${champs.objet}`, champs.reference ? `Références : ${champs.reference}` : "", "", champs.corps, "", champs.expediteur.nom].join("\n").replace(/\n{3,}/g, "\n\n") : "";
  const set = (f: (c: Omit<ChampsCourrier, "document_id">) => Omit<ChampsCourrier, "document_id">) => setChamps((c) => (c ? f(c) : c));
  const motifLibelle = MOTIFS[type].find((m) => m.cle === motif)?.libelle;

  return (
    <div className="courrier-assist">
      {!relance && <><div className="cbulle lucien"><b>Lucien</b>{type === "reclamation" ? "Pour quel motif voulez-vous contester ce courrier ?" : "Pourquoi demandez-vous un remboursement ?"}</div>
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
      )}</>}

      {champs && b && (etape === "relecture" || etape === "confirmer") && (
        <>
          <div className="cbulle lucien"><b>Lucien</b>{relance ? "Voici la relance : elle rappelle votre premier courrier, fixe quinze jours pour répondre et annonce le médiateur. Même destinataire" : <>Voici le courrier{b.avec_ia ? "" : " (modèle, sans l'IA)"}. J'ai lu le destinataire dans « {b.source} »{b.emails.length ? <>, avec son adresse email <b>{b.emails[0]}</b></> : " ; je n'y ai pas trouvé d'adresse email"}</>}. Relisez, corrigez si besoin, puis choisissez comment l'envoyer.</div>

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
                {!relance && <button className="pill-action" onClick={() => { setEtape("recit"); setB(null); setChamps(null); }}><Ico d="M4 12a8 8 0 1 0 3-6.3M4 4v4h4" />Réécrire</button>}
              </div>
            </>
          )}
        </>
      )}

      {etape === "envoye" && (
        <div className="courrier-carte envoye">
          <b>Courrier envoyé à {email}</b>
          <span>Vous l'avez reçu en copie. La réponse arrivera directement dans votre boîte mail. Je surveille avec vous : sans nouvelles dans 15 jours, je vous le rappelle{relance ? "" : " et la relance sera prête"}.</span>
          {!relance && <button className="link" onClick={() => { setEtape("motif"); setMotif(null); setRecit(""); setB(null); setChamps(null); }}>Écrire un autre courrier</button>}
        </div>
      )}
    </div>
  );
}
