export type Category =
  | "assurance" | "energie" | "telecom" | "logement" | "banque" | "impots" | "abonnement"
  | "sante" | "identite" | "garantie" | "education" | "vehicule" | "autre";

export interface Doc {
  id: string;
  title: string;
  category: Category;
  organisme: string | null;
  numero_contrat: string | null;
  montant: number | null;
  periodicite: "mensuel" | "trimestriel" | "annuel" | "unique" | null;
  date_document: string | null;
  date_debut: string | null;
  date_fin: string | null;
  preavis_jours: number | null;
  resume: string | null;
  source?: string | null;
  confiance: number | null;
  verifie: number;
  member_id: string | null;
  cree_le: string;
  fichier?: string | null;
  mime?: string | null;
}

export interface Deadline {
  id: string;
  document_id: string | null;
  titre: string;
  type: string;
  date: string;
  rappel_jours: number;
  fait: number;
  note: string | null;
  member_id?: string | null;
}

export type Role = "adulte" | "enfant" | "parent_a_charge" | "autre_a_charge";
export interface Member {
  id: string; prenom: string; role: Role;
  date_naissance?: string | null; etablissement?: string | null; classe?: string | null;
  cantine_jours?: string | null; cantine_cout_mois?: number | null; notes?: string | null;
  photo?: string | null;
}
export interface Activite {
  id: string; member_id: string | null; titre: string; type: string; jour: number | null; heure_debut: string | null; heure_fin: string | null;
  lieu: string | null; cout_mois: number | null; date_debut: string | null; date_fin: string | null; note: string | null;
}
export interface Creneau { jour: number; heure_debut: string | null; heure_fin: string | null; titre: string; membre: string | null; member_id: string | null; lieu: string | null; type: string; activite_id: string | null }
export interface Conseil { cle: string; titre: string; detail: string; categorie: "aide" | "impots" | "budget" | "organisation" | "legal"; membre: string | null; source: string; montant_indicatif: number | null }
export interface FamilleReport {
  situation: "seul" | "couple" | null;
  membres: (Member & { age: number | null; niveau: string; role_label: string })[];
  composition: { adultes: number; enfants: number; a_charge: number };
  activites: Activite[];
  semaine: Creneau[];
  couts: { member_id: string; prenom: string; cantine: number; activites: number; total: number; lignes: { titre: string; mensuel: number }[] }[];
  cout_enfants_mois: number;
  echeances: { cle: string; titre: string; date: string; type: "famille"; rappel_jours: number; note: string | null; member_id: string | null; fait: number }[];
  conseils: Conseil[];
}

export interface Household {
  id: string;
  nom: string;
  situation?: "seul" | "couple" | null;
  plan: "gratuit" | "famille";
  plan_souscrit?: "gratuit" | "famille";
  membres: Member[];
  documents: number;
  limites: { documents: number; comptes: number; lettersPerMonth: number; iaLecturesParMois: number; importReleves: boolean; banque: boolean; notifications: "push" } | null;
  essai?: { fin: string; jours_restants: number | null; actif: boolean } | null;
  ia_lectures_utilisees?: number;
  ia_lectures_restantes?: number | null;
  ia_gratuit_en_pause?: boolean;
  boite_email?: string | null;
  mcp_token?: string | null;
  capacite_comptes?: number;
  abonnement?: { stripe: boolean; paiement?: boolean; statut: string | null; formule?: "solo" | "duo" | "tribu" | null; periode: "mensuel" | "annuel" | null; fin: string | null; prix: { mensuel: number; annuel: number }; gerable: boolean };
  utilisateur?: { id: string; email: string; prenom: string | null } | null;
  comptes?: number;
  modules?: string[];
  boite_recus?: { message_id: string; expediteur: string | null; objet: string | null; documents: number; quand: string }[];
  notifications?: "push" | "push+email";
  hebdo?: boolean;
  assistant?: AssistantEtat;
}

export interface AssistantEtat {
  disponible: boolean; acces: "option" | "essai" | "aucun"; quota: number; utilisees: number; restantes: number;
  en_pause: boolean; prix: { mensuel: number; annuel: number }; option: boolean;
}
export interface AssistantMessage { role: "user" | "assistant"; content: string }
export interface AssistantReponse {
  reponse: string; liens: { type: "doc" | "ecran"; id: string; titre: string }[]; courrier: { titre: string; texte: string } | null; etat: AssistantEtat;
}

export interface Charge {
  document_id: string; titre: string; category: string; organisme: string | null;
  montant_periode: number; periodicite: string; montant_mensuel: number; montant_annuel: number; date_fin: string | null;
}

export interface Alert {
  type: "doublon" | "hausse" | "non_renegocie" | "fin_engagement" | "resiliable" | "echeance_proche" | "poids";
  gravite: "info" | "attention" | "important";
  titre: string; detail: string; economie_estimee: number | null; document_ids: string[];
}

export interface ChargesReport {
  total_mensuel: number; total_annuel: number;
  par_categorie: { category: string; mensuel: number; part: number }[];
  charges: Charge[]; alertes: Alert[]; apercu: boolean; alertes_total: number;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  assurance: "Assurance", energie: "Énergie", telecom: "Télécom", logement: "Logement", banque: "Banque",
  impots: "Impôts", abonnement: "Abonnement", sante: "Santé", identite: "Identité", garantie: "Garantie",
  education: "École", vehicule: "Véhicule", autre: "Autre",
};

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

export interface BudgetAction {
  cle: string;
  type: "fantome" | "hausse" | "sans_contrat" | "contrat_sans_prelevement" | "frais" | "derive" | "doublon" | "timing";
  priorite: 1 | 2 | 3;
  effort: string;
  titre: string;
  detail: string;
  economie_annuelle: number;
  marchand: string | null;
  document_id: string | null;
  decision: "garde" | "resilie" | "a_faire" | null;
}

export interface BudgetReport {
  periode: { de: string; a: string; mois: number };
  depenses_mois_courant: number;
  depenses_moyenne_mensuelle: number;
  revenus_moyenne_mensuelle: number;
  reste_a_vivre_moyen: number;
  par_categorie: { categorie: string; libelle: string; mois_courant: number; moyenne: number; variation: number | null }[];
  recurrences: { cle: string; marchand: string; categorie: string; mensuel_equivalent: number; jour_du_mois: number | null; contrat_id: string | null; occurrences: number }[];
  actions: BudgetAction[];
  actions_total: number;
  apercu: boolean;
  economies_possibles: number;
  economies_decidees: number;
  nb_transactions: number;
}

export interface ImportResult { lues: number; ajoutees: number; doublons: number; de?: string; a?: string }

export interface BankStatus {
  fournisseur: "enablebanking" | "bridge" | "simule";
  connecte: boolean;
  expire_le?: string | null;
  statut: "aucune" | "en_attente" | "connecte" | "erreur";
  derniere_synchro: string | null;
  comptes: { id: string; nom: string; banque: string | null; solde: number | null; devise: string | null; maj_le: string | null }[];
}

export interface Banque { name: string; country: string; logo?: string; maximum_consent_validity?: number }
export interface BanquesReport { fournisseur: BankStatus["fournisseur"]; banques: Banque[] }

// ---------- veille bancaire d'un proche ----------
export type Mesure = "aucune" | "curatelle" | "tutelle" | "habilitation_familiale" | "mandat_protection_future";
export interface Temoin { nom: string; email: string | null }
export interface VeilleAlerte { id: string; type: string; gravite: "urgente" | "attention"; titre: string; detail: string; quand: string; vue: number }
export interface Veille {
  id: string; member_id: string; prenom: string; statut: "attente_consentement" | "active" | "suspendue" | "terminee";
  mesure: Mesure; mesure_label: string; aidant: string; aidant_qualite: string | null; temoins: Temoin[];
  consentement_le: string | null; consentement_expire: string | null; accords: string[];
  qui_consent: { personne: boolean; representant: boolean; texte: string } | null;
  banque_connectee: boolean; alertes_non_vues: number; alertes_urgentes: number; lien_personne: string | null;
  fin_le: string | null; motif_fin: string | null;
  alertes?: VeilleAlerte[]; journal?: { intact: boolean; lignes: number; rupture: number | null };
}
export interface VeillesReport { ouverte: boolean; capacite: number; en_cours: number; prix: { mensuel: number; annuel: number }; veilles: Veille[] }
export interface VuePersonne {
  prenom: string; nid: string; aidant: string; aidant_qualite: string | null; mesure: Mesure; mesure_label: string;
  statut: Veille["statut"]; qui_consent: { personne: boolean; representant: boolean; texte: string }; accords_donnes: string[];
  consentement_le: string | null; consentement_expire: string | null; temoins: Temoin[]; banque_connectee: boolean;
  acces: { nom: string; role: string }[]; engagements: string[]; derniers_acces: { quand: string; qui: string }[];
}
