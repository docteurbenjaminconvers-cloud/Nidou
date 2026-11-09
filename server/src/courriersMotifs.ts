/** Why one writes (asked by Lucien before the letter): shared by the server and the app. */
export type TypeCourrier = "reclamation" | "remboursement";

export const MOTIFS: Record<TypeCourrier, { cle: string; libelle: string }[]> = {
  reclamation: [
    { cle: "deja_paye", libelle: "C'est déjà payé" },
    { cle: "montant", libelle: "Le montant est faux" },
    { cle: "pas_concerne", libelle: "Je ne suis pas concerné(e)" },
    { cle: "non_recu", libelle: "Je n'ai jamais reçu la facture" },
    { cle: "service", libelle: "Service non rendu ou mal fait" },
    { cle: "autre", libelle: "Autre chose" },
  ],
  remboursement: [
    { cle: "trop_preleve", libelle: "Prélevé en trop" },
    { cle: "double", libelle: "Payé deux fois" },
    { cle: "resilie", libelle: "Prélevé après résiliation" },
    { cle: "non_livre", libelle: "Pas livré, pas rendu" },
    { cle: "trop_percu", libelle: "Trop-perçu, avoir dû" },
    { cle: "autre", libelle: "Autre chose" },
  ],
};

