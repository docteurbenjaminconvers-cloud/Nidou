import type { ApercuModules, ModuleId } from "../api";
import { MODULES } from "../../../server/src/offre";
import { eur } from "./espacesCommun";

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");

/** What a change of an existing subscription costs, before the customer confirms it. */
export function ConfirmationPaiement({ apercu, periode, envoi, titre = "Confirmer le changement", nouveau, onAnnuler, onConfirmer }: {
  apercu: ApercuModules & { mode?: "maintenant" | "echeance" }; periode: "mensuel" | "annuel"; envoi: boolean; titre?: string; nouveau?: string;
  onAnnuler: () => void; onConfirmer: () => void;
}) {
  const echeance = apercu.mode === "echeance";
  return (
    <div className="feuille-fond" role="dialog" aria-modal="true" aria-labelledby="apercu-titre" onClick={(e) => { if (e.target === e.currentTarget) onAnnuler(); }}>
      <div className="feuille apercu">
        <h2 id="apercu-titre">{titre}</h2>
        {echeance
          ? <p className="apercu-montant"><b>Rien à payer aujourd'hui</b></p>
          : apercu.aujourdhui > 0
            ? <p className="apercu-montant"><b>{eur(apercu.aujourdhui, true)}</b> débités aujourd'hui sur votre carte enregistrée</p>
            : <p className="apercu-montant"><b>Rien à payer aujourd'hui</b></p>}
        <ul className="apercu-detail">
          {echeance && <li>{nouveau ?? "Le changement"} commence à votre échéance du {date(apercu.prochain.date)}. D'ici là, rien ne change et rien n'est remboursé.</li>}
          {!echeance && apercu.aujourdhui > 0 && <li>Au prorata, jusqu'à votre échéance du {date(apercu.prochain.date)}.</li>}
          {apercu.credit > 0 && <li>Les options remplacées par le pack sont déduites : {eur(apercu.credit, true)}.</li>}
          {apercu.avoir > 0 && <li>Il vous reste un avoir de {eur(apercu.avoir, true)}, déduit de vos prochaines factures.</li>}
          {apercu.retraits.map((r) => <li key={r.module}>{MODULES[r.module as ModuleId].nom} reste ouvert jusqu'au {date(r.jusqu_au)}, puis s'arrête (sans remboursement).</li>)}
          <li>Ensuite : <b>{eur(apercu.prochain.montant, true)}</b> {periode === "annuel" ? "par an" : "par mois"}{apercu.prochain.date ? ` à partir du ${date(apercu.prochain.date)}` : ""}.</li>
          {!echeance && apercu.aujourdhui > 0 && <li>Le changement s'applique dès que le paiement est accepté. Si votre banque demande une validation, vous passez par la page de paiement sécurisée Stripe.</li>}
        </ul>
        <div className="feuille-actions">
          <button className="btn ghost" onClick={onAnnuler} disabled={envoi}>Annuler</button>
          <button className="btn" onClick={onConfirmer} disabled={envoi}>{!echeance && apercu.aujourdhui > 0 ? `Payer ${eur(apercu.aujourdhui, true)}` : "Confirmer"}</button>
        </div>
      </div>
    </div>
  );
}
