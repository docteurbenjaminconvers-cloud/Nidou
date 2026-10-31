import { modelFor } from "./ia.js";
/** Budget in cents for the month: trial 3 €, paying household 10 €, free plan 0 (overridable by env). */
export function plafondCentimes(db, householdId) {
    const h = db.getHousehold(householdId);
    if (!h)
        return 0;
    if (db.effectivePlan(h) === "gratuit")
        return 0;
    const essai = h.plan === "gratuit"; // the stored plan is still free: the trial is what makes it complete
    return Number(essai ? process.env.LUCIEN_IA_PLAFOND_ESSAI_CENTIMES ?? 300 : process.env.LUCIEN_IA_PLAFOND_FOYER_CENTIMES ?? 1000);
}
export function budgetIa(db, householdId) {
    const plafond = plafondCentimes(db, householdId);
    const gratuit = db.getHousehold(householdId) ? db.effectivePlan(db.getHousehold(householdId)) === "gratuit" : true;
    const reste = () => Math.max(0, plafond - db.iaCentimesMois(householdId));
    return {
        ok: (cout = 0) => reste() > 0 && reste() >= cout,
        compter: (centimes, lecture = false) => (lecture ? db.recordIaLecture(householdId, gratuit, centimes) : db.recordIaCout(householdId, gratuit, centimes)),
        reste,
    };
}
/** Estimated cost of one call at this tier, in cents (0 when no AI provider is configured). */
export const coutAppel = (tier, facteur = 1) => (modelFor(tier)?.cout_lecture_centimes ?? 0) * facteur;
