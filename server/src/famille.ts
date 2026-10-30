import type { ActiviteRow, HouseholdRow, MemberRow } from "./db.js";

/**
 * Organisation familiale : composition du foyer, agenda de la semaine, coût des enfants, échéances et conseils
 * dérivés de la composition (aides, bourses, dates clés). Tout est calculé, rien n'est stocké : la source de vérité
 * reste les membres et les activités saisis par la famille.
 *
 * Les montants et dates cités sont des repères (ordres de grandeur, calendriers habituels) et renvoient vers la source
 * officielle : ils sont signalés « à vérifier » dans l'appli.
 */

export const JOURS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
export const ROLE_LABEL: Record<string, string> = { adulte: "Adulte", enfant: "Enfant", parent_a_charge: "Parent à charge", autre_a_charge: "Personne à charge" };

export function age(dateNaissance: string | null, today = new Date()): number | null {
  if (!dateNaissance) return null;
  const d = new Date(dateNaissance);
  if (Number.isNaN(d.getTime())) return null;
  let a = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) a--;
  return a;
}

/** Niveau scolaire deviné depuis la classe ("CE2", "4e", "Terminale", "L2", "BTS"…) ou l'âge. */
export type Niveau = "petite_enfance" | "maternelle" | "primaire" | "college" | "lycee" | "terminale" | "superieur" | "adulte" | "inconnu";
export function niveau(m: MemberRow, today = new Date()): Niveau {
  const c = (m.classe ?? "").toLowerCase();
  if (/terminale|\btle\b|\bterm\b/.test(c)) return "terminale";
  if (/\b(cp|ce1|ce2|cm1|cm2)\b/.test(c)) return "primaire";
  if (/\b(ps|ms|gs)\b|maternelle/.test(c)) return "maternelle";
  if (/\b(6e|5e|4e|3e|6ème|5ème|4ème|3ème)\b|coll[eè]ge/.test(c)) return "college";
  if (/\b(2nde|seconde|1[èe]re|premi[èe]re)\b|lyc[ée]e|bac pro|cap\b/.test(c)) return "lycee";
  if (/\b(l1|l2|l3|m1|m2|bts|but|dut|licence|master|pr[ée]pa|[ée]cole|fac|universit|bachelor|iut|paces|pass|doctorat)\b/.test(c) || /universit|fac|iut|[ée]cole sup/.test((m.etablissement ?? "").toLowerCase())) return "superieur";
  const a = age(m.date_naissance, today);
  if (a === null) return m.role === "enfant" ? "inconnu" : "adulte";
  if (a < 3) return "petite_enfance";
  if (a < 6) return "maternelle";
  if (a < 11) return "primaire";
  if (a < 15) return "college";
  if (a < 18) return "lycee";
  if (a < 26 && m.role === "enfant") return "superieur";
  return "adulte";
}

export interface CreneauSemaine { jour: number; heure_debut: string | null; heure_fin: string | null; titre: string; membre: string | null; member_id: string | null; lieu: string | null; type: string; activite_id: string | null }

export function agendaSemaine(members: MemberRow[], activites: ActiviteRow[]): CreneauSemaine[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const out: CreneauSemaine[] = [];
  for (const a of activites) {
    if (!a.jour) continue;
    out.push({ jour: a.jour, heure_debut: a.heure_debut, heure_fin: a.heure_fin, titre: a.titre, membre: a.member_id ? byId.get(a.member_id)?.prenom ?? null : null, member_id: a.member_id, lieu: a.lieu, type: a.type, activite_id: a.id });
  }
  const JOUR_IDX: Record<string, number> = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 7 };
  const cantine = new Map<number, MemberRow[]>();
  for (const m of members) {
    for (const j of (m.cantine_jours ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) {
      const idx = JOUR_IDX[j.slice(0, 3)];
      if (idx) cantine.set(idx, [...(cantine.get(idx) ?? []), m]);
    }
  }
  // One canteen line per day ("Cantine · Léa, Jean") rather than one per child.
  for (const [jour, ms] of cantine) {
    out.push({ jour, heure_debut: "12:00", heure_fin: "13:30", titre: "Cantine", membre: ms.map((m) => m.prenom).join(", "), member_id: ms.length === 1 ? ms[0].id : null, lieu: ms.length === 1 ? ms[0].etablissement : null, type: "cantine", activite_id: null });
  }
  return out.sort((x, y) => x.jour - y.jour || (x.heure_debut ?? "").localeCompare(y.heure_debut ?? ""));
}

export interface CoutMembre { member_id: string; prenom: string; cantine: number; activites: number; total: number; lignes: { titre: string; mensuel: number }[] }

export function coutsParMembre(members: MemberRow[], activites: ActiviteRow[]): CoutMembre[] {
  return members
    .filter((m) => m.role !== "adulte")
    .map((m) => {
      const lignes = activites.filter((a) => a.member_id === m.id && (a.cout_mois ?? 0) > 0).map((a) => ({ titre: a.titre, mensuel: a.cout_mois! }));
      const cantine = m.cantine_cout_mois ?? 0;
      const act = lignes.reduce((s, l) => s + l.mensuel, 0);
      return { member_id: m.id, prenom: m.prenom, cantine, activites: act, total: cantine + act, lignes };
    });
}

export interface EcheanceFamille { cle: string; titre: string; date: string; type: "famille"; rappel_jours: number; note: string | null; member_id: string | null }
export interface Conseil { cle: string; titre: string; detail: string; categorie: "aide" | "impots" | "budget" | "organisation" | "legal"; membre: string | null; source: string; montant_indicatif: number | null }

function nextOccurrence(month: number, day: number, today: Date): string {
  const y = today.getFullYear();
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getTime() < today.getTime() - 864e5) d.setUTCFullYear(y + 1);
  return d.toISOString().slice(0, 10);
}

/** Échéances calculées depuis la composition : anniversaires, campagnes d'aides, réinscriptions, fin de saison des activités. */
export function echeancesFamille(h: HouseholdRow, members: MemberRow[], activites: ActiviteRow[], today = new Date()): EcheanceFamille[] {
  const out: EcheanceFamille[] = [];
  const push = (e: Omit<EcheanceFamille, "type">) => out.push({ ...e, type: "famille" });
  const enfants = members.filter((m) => m.role === "enfant");
  const scolaires = enfants.filter((m) => ["maternelle", "primaire", "college", "lycee", "terminale"].includes(niveau(m, today)));
  const etudiants = enfants.filter((m) => niveau(m, today) === "superieur");
  const terminales = enfants.filter((m) => niveau(m, today) === "terminale");
  const yr = today.getFullYear();

  for (const m of members) {
    if (!m.date_naissance) continue;
    const d = new Date(m.date_naissance);
    if (Number.isNaN(d.getTime())) continue;
    const date = nextOccurrence(d.getMonth() + 1, d.getDate(), today);
    const a = new Date(date).getFullYear() - d.getFullYear();
    push({ cle: `anniv:${m.id}:${date}`, titre: `Anniversaire de ${m.prenom} (${a} ans)`, date, rappel_jours: 10, note: null, member_id: m.id });
  }
  if (scolaires.some((m) => (age(m.date_naissance, today) ?? 10) >= 6)) {
    push({ cle: `ars:${yr}`, titre: "Allocation de rentrée scolaire : vérifier le versement CAF", date: nextOccurrence(8, 20, today), rappel_jours: 7, note: "Versée vers la mi-août aux familles sous conditions de ressources, pour chaque enfant de 6 à 18 ans scolarisé. Si rien n'arrive, vérifiez votre dossier CAF.", member_id: null });
  }
  if (scolaires.some((m) => ["college", "lycee", "terminale"].includes(niveau(m, today)))) {
    push({ cle: `bourse:${yr}`, titre: "Demande de bourse de collège ou de lycée", date: nextOccurrence(10, 15, today), rappel_jours: 21, note: "La campagne se fait en septembre-octobre sur le portail Scolarité Services (ou auprès de l'établissement). Sous conditions de ressources.", member_id: null });
  }
  if (terminales.length) {
    for (const m of terminales) {
      push({ cle: `parcoursup:${m.id}:${yr}`, titre: `Parcoursup : vœux de ${m.prenom} à confirmer`, date: nextOccurrence(3, 12, today), rappel_jours: 30, note: "Inscription et vœux de mi-janvier à mi-mars, dossier à compléter début avril. Dates exactes sur parcoursup.gouv.fr.", member_id: m.id });
    }
  }
  if (terminales.length || etudiants.length) {
    push({ cle: `dse:${yr}`, titre: "Dossier social étudiant (bourse et logement CROUS)", date: nextOccurrence(5, 31, today), rappel_jours: 45, note: "À déposer entre mi-janvier et fin mai sur messervices.etudiant.gouv.fr, avant même de connaître l'affectation.", member_id: null });
  }
  if (scolaires.length || activites.length) {
    push({ cle: `reinscriptions:${yr}`, titre: "Réinscriptions cantine, périscolaire et activités pour la rentrée", date: nextOccurrence(6, 15, today), rappel_jours: 21, note: "Les places partent vite en juin : cantine et garderie en mairie, clubs et conservatoires avant l'été.", member_id: null });
  }
  for (const a of activites) {
    if (a.date_fin) push({ cle: `fin_activite:${a.id}`, titre: `Fin de saison : ${a.titre}`, date: a.date_fin, rappel_jours: 30, note: "Réinscrire, changer ou arrêter ? Les tarifs des clubs se renégocient à la réinscription.", member_id: a.member_id });
  }
  const aCharge = members.filter((m) => m.role === "parent_a_charge" || m.role === "autre_a_charge");
  if (enfants.length || aCharge.length) {
    push({ cle: `impots:${yr}`, titre: "Déclaration de revenus : frais de garde, pensions, personnes à charge", date: nextOccurrence(5, 20, today), rappel_jours: 21, note: "Pensez aux cases souvent oubliées : frais de garde des moins de 6 ans, pension versée à un enfant étudiant ou à un parent, frais d'hébergement d'un parent dépendant.", member_id: null });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

/** Conseils dérivés de la composition. Repères chiffrés = ordres de grandeur, à vérifier sur la source. */
export function conseilsFamille(h: HouseholdRow, members: MemberRow[], activites: ActiviteRow[], today = new Date()): Conseil[] {
  const out: Conseil[] = [];
  const enfants = members.filter((m) => m.role === "enfant");
  const adultes = members.filter((m) => m.role === "adulte");
  const aCharge = members.filter((m) => m.role === "parent_a_charge" || m.role === "autre_a_charge");
  const couts = coutsParMembre(members, activites);

  for (const m of enfants) {
    const n = niveau(m, today), a = age(m.date_naissance, today);
    if (n === "petite_enfance" || n === "maternelle") {
      out.push({ cle: `garde:${m.id}`, titre: `Garde de ${m.prenom} : crédit d'impôt de 50 %`, detail: "Les frais de garde hors domicile (crèche, assistante maternelle, garderie) d'un enfant de moins de 6 ans ouvrent droit à un crédit d'impôt de 50 %, plafonné par enfant. La CAF verse aussi le complément de libre choix du mode de garde (CMG).", categorie: "impots", membre: m.prenom, source: "https://www.caf.fr", montant_indicatif: null });
    }
    if (["primaire", "college", "lycee", "terminale"].includes(n) && (a ?? 10) >= 6) {
      out.push({ cle: `ars:${m.id}`, titre: `Allocation de rentrée scolaire pour ${m.prenom}`, detail: "Versée en août par la CAF, sous conditions de ressources, de 6 à 18 ans. Aucune démarche si vous êtes déjà allocataire (sauf après 16 ans : justifier la scolarité).", categorie: "aide", membre: m.prenom, source: "https://www.caf.fr", montant_indicatif: null });
    }
    if (["college", "lycee", "terminale"].includes(n)) {
      out.push({ cle: `bourse:${m.id}`, titre: `Bourse de ${n === "college" ? "collège" : "lycée"} pour ${m.prenom}`, detail: "Demande en septembre-octobre, sous conditions de ressources. Au lycée, s'y ajoutent parfois une prime d'équipement (filières pro) et une bourse au mérite.", categorie: "aide", membre: m.prenom, source: "https://www.education.gouv.fr/les-aides-financieres-l-ecole-5779", montant_indicatif: null });
    }
    if (n === "terminale") {
      out.push({ cle: `parcoursup:${m.id}`, titre: `Parcoursup pour ${m.prenom} : anticiper le calendrier`, detail: "Vœux de mi-janvier à mi-mars, dossier début avril, réponses à partir de fin mai. Déposez le dossier social étudiant (CROUS) en parallèle, sans attendre l'affectation.", categorie: "organisation", membre: m.prenom, source: "https://www.parcoursup.gouv.fr", montant_indicatif: null });
    }
    if (n === "superieur" || n === "terminale") {
      out.push({ cle: `etudiant:${m.id}`, titre: `${m.prenom} étudiant : rattachement ou pension ?`, detail: "Deux options fiscales : garder l'enfant rattaché au foyer (demi-part) ou le détacher et déduire la pension versée, dans la limite d'un plafond annuel. Comparez les deux chaque année ; l'étudiant détaché peut aussi demander l'APL pour son logement.", categorie: "impots", membre: m.prenom, source: "https://www.impots.gouv.fr/particulier/questions/mon-enfant-majeur-doit-il-faire-sa-propre-declaration", montant_indicatif: null });
      out.push({ cle: `crous:${m.id}`, titre: `Bourse et logement CROUS pour ${m.prenom}`, detail: "Le dossier social étudiant se dépose entre mi-janvier et fin mai. La bourse sur critères sociaux dépend des revenus du foyer, du nombre d'enfants et de l'éloignement.", categorie: "aide", membre: m.prenom, source: "https://www.messervices.etudiant.gouv.fr", montant_indicatif: null });
    }
    if (m.cantine_jours && (m.cantine_cout_mois ?? 0) > 0) {
      out.push({ cle: `cantine:${m.id}`, titre: `Cantine de ${m.prenom} : vérifier le tarif au quotient familial`, detail: "La plupart des communes facturent la cantine selon le quotient familial CAF, parfois avec un tarif à 1 €. Si votre situation a changé (naissance, baisse de revenus), demandez une révision du tarif.", categorie: "budget", membre: m.prenom, source: "https://www.service-public.fr", montant_indicatif: null });
    }
    const act = activites.filter((x) => x.member_id === m.id && x.type === "sport");
    if (act.length && (a ?? 10) >= 6 && (a ?? 10) <= 17) {
      out.push({ cle: `passsport:${m.id}`, titre: `Pass'Sport pour ${m.prenom}`, detail: "Aide de l'État à la rentrée pour l'inscription dans un club sportif, pour les 6-17 ans sous conditions (allocataires ARS, AEEH…). De nombreuses villes et comités d'entreprise ajoutent leur propre aide.", categorie: "aide", membre: m.prenom, source: "https://www.sports.gouv.fr/pass-sport", montant_indicatif: null });
    }
  }
  if (enfants.length >= 3) {
    out.push({ cle: "famille_nombreuse", titre: "Famille nombreuse : carte SNCF et parts fiscales", detail: "À partir de 3 enfants : carte Famille nombreuse (réductions SNCF et partenaires), 1 part fiscale entière dès le 3e enfant, complément familial sous conditions.", categorie: "aide", membre: null, source: "https://www.service-public.fr", montant_indicatif: null });
  }
  for (const m of aCharge) {
    out.push({ cle: `aidant:${m.id}`, titre: `Vous aidez ${m.prenom} : ce qui est déductible`, detail: "La pension versée à un ascendant dans le besoin est déductible, et les frais d'hébergement en établissement ouvrent droit à une réduction d'impôt. Selon l'âge et l'autonomie : APA, aide ménagère, congé de proche aidant indemnisé (AJPA).", categorie: "impots", membre: m.prenom, source: "https://www.pour-les-personnes-agees.gouv.fr", montant_indicatif: null });
    out.push({ cle: `protection:${m.id}`, titre: `Papiers de ${m.prenom} : avec son accord`, detail: "Lucien peut ranger les papiers d'un proche avec son consentement. S'il est sous tutelle ou curatelle, c'est le tuteur ou le curateur qui autorise l'accès, en particulier à la banque. Pensez au mandat de protection future tant que la personne peut le signer.", categorie: "legal", membre: m.prenom, source: "https://www.service-public.fr", montant_indicatif: null });
  }
  if (h.situation === "couple" && adultes.length >= 2) {
    out.push({ cle: "couple_declaration", titre: "En couple : déclaration commune ou séparée ?", detail: "Mariés ou pacsés : déclaration commune par défaut, intéressante quand les revenus sont inégaux. En concubinage : deux déclarations, et les enfants rattachés à l'un ou l'autre ; répartir les enfants peut optimiser les parts.", categorie: "impots", membre: null, source: "https://www.impots.gouv.fr", montant_indicatif: null });
  }
  if (h.situation === "seul" && enfants.length) {
    out.push({ cle: "parent_isole", titre: "Parent seul : demi-part supplémentaire et aides", detail: "Un parent qui élève seul ses enfants bénéficie d'une demi-part fiscale supplémentaire (case T) et, sous conditions, de l'allocation de soutien familial (ASF) de la CAF.", categorie: "aide", membre: null, source: "https://www.caf.fr", montant_indicatif: null });
  }
  const totalEnfants = couts.reduce((s, c) => s + c.total, 0);
  if (totalEnfants > 0) {
    out.push({ cle: "budget_enfants", titre: `Les enfants coûtent ${Math.round(totalEnfants)} € par mois en cantine et activités`, detail: "Fixez une enveloppe par enfant et revoyez-la à chaque réinscription (juin). Les activités non fréquentées depuis deux mois sont des abonnements fantômes comme les autres.", categorie: "budget", membre: null, source: "", montant_indicatif: Math.round(totalEnfants) });
  }
  if (members.length >= 2 && !activites.length) {
    out.push({ cle: "agenda_vide", titre: "Remplissez l'agenda de la semaine", detail: "Activités, cantine, garde alternée : une fois saisies, Lucien vous rappelle les fins de saison, calcule le coût mensuel et affiche qui est où chaque jour.", categorie: "organisation", membre: null, source: "", montant_indicatif: null });
  }
  return out;
}

export function familleReport(h: HouseholdRow, members: MemberRow[], activites: ActiviteRow[], faits: Set<string>, today = new Date()) {
  const membres = members.map((m) => ({ ...m, age: age(m.date_naissance, today), niveau: niveau(m, today), role_label: ROLE_LABEL[m.role] ?? m.role }));
  const couts = coutsParMembre(members, activites);
  return {
    situation: h.situation,
    membres,
    composition: {
      adultes: members.filter((m) => m.role === "adulte").length,
      enfants: members.filter((m) => m.role === "enfant").length,
      a_charge: members.filter((m) => m.role === "parent_a_charge" || m.role === "autre_a_charge").length,
    },
    activites,
    semaine: agendaSemaine(members, activites),
    couts,
    cout_enfants_mois: couts.reduce((s, c) => s + c.total, 0),
    echeances: echeancesFamille(h, members, activites, today).map((e) => ({ ...e, fait: faits.has(e.cle) ? 1 : 0 })),
    conseils: conseilsFamille(h, members, activites, today),
  };
}
