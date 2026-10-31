/**
 * Monthly AI budget per household, so that no single account (a trial opened with any email, a heavy user) can run
 * up the AI bill. Every AI call is counted here: paper readings, bank-label categorisation, letters, PDF statements.
 * Over the budget, Lucien falls back to what it does without AI (local reading, rules, letter templates) until the
 * 1st of next month. Amounts in cents of euro, estimated per call (LUCIEN_COUT_* in ia.ts).
 */
import type { Db } from "./db.js";
import { modelFor, type Tier } from "./ia.js";

/** Budget in cents for the month: trial 3 €, paying household 10 €, free plan 0 (overridable by env). */
export function plafondCentimes(db: Db, householdId: string): number {
  const h = db.getHousehold(householdId);
  if (!h) return 0;
  if (db.effectivePlan(h) === "gratuit") return 0;
  const essai = h.plan === "gratuit"; // the stored plan is still free: the trial is what makes it complete
  return Number(essai ? process.env.LUCIEN_IA_PLAFOND_ESSAI_CENTIMES ?? 300 : process.env.LUCIEN_IA_PLAFOND_FOYER_CENTIMES ?? 1000);
}

export interface BudgetIa {
  /** Can an AI call of this estimated cost (cents) still be made this month? */
  ok(cout?: number): boolean;
  /** Records a call that was made (lecture = a paper reading, also counted in the monthly readings). */
  compter(centimes: number, lecture?: boolean): void;
  reste(): number;
}

export function budgetIa(db: Db, householdId: string): BudgetIa {
  const plafond = plafondCentimes(db, householdId);
  const gratuit = db.getHousehold(householdId) ? db.effectivePlan(db.getHousehold(householdId)!) === "gratuit" : true;
  const reste = () => Math.max(0, plafond - db.iaCentimesMois(householdId));
  return {
    ok: (cout = 0) => reste() > 0 && reste() >= cout,
    compter: (centimes, lecture = false) => (lecture ? db.recordIaLecture(householdId, gratuit, centimes) : db.recordIaCout(householdId, gratuit, centimes)),
    reste,
  };
}

/** Estimated cost of one call at this tier, in cents (0 when no AI provider is configured). */
export const coutAppel = (tier: Tier, facteur = 1) => (modelFor(tier)?.cout_lecture_centimes ?? 0) * facteur;
