/**
 * Creates (once) every Stripe product and price of the Lucien offer and prints the environment variables to set
 * on the server. Idempotent: each price has a lookup_key; an existing one is reused.
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/stripe-prix.ts
 */
import Stripe from "stripe";
import { MODULES, PACKS, SOCLE, type Formule, type ModuleId, type Periode } from "../src/offre.js";
import { envBien, envModule, envPack, lignesModules } from "../src/stripeModules.js";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error("STRIPE_SECRET_KEY manquant"); process.exit(1); }
const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" as never });
const PERIODES: Periode[] = ["mensuel", "annuel"];
const cents = (mensuel: number, p: Periode) => Math.round(mensuel * (p === "annuel" ? 10 : 1) * 100);

async function prix(env: string, produit: string, mensuel: number, p: Periode) {
  const lookup = `lucien_${env.replace(/^STRIPE_PRICE_/, "").toLowerCase()}`;
  const deja = await stripe.prices.list({ lookup_keys: [lookup], limit: 1 });
  if (deja.data[0]) return console.log(`${env}=${deja.data[0].id}`);
  const prod = (await stripe.products.search({ query: `metadata['lucien']:'${produit}'` })).data[0]
    ?? await stripe.products.create({ name: `Lucien · ${produit}`, metadata: { lucien: produit } });
  const pr = await stripe.prices.create({
    product: prod.id, currency: "eur", unit_amount: cents(mensuel, p), tax_behavior: "inclusive", lookup_key: lookup,
    recurring: { interval: p === "annuel" ? "year" : "month" }, metadata: { lucien: env },
  });
  console.log(`${env}=${pr.id}`);
}

for (const p of PERIODES) {
  for (const f of Object.keys(SOCLE) as Formule[]) await prix(`STRIPE_PRICE_${f.toUpperCase()}_${p.toUpperCase()}`, SOCLE[f].nom, SOCLE[f].mensuel, p);
  for (const m of Object.keys(MODULES) as ModuleId[]) await prix(envModule(m, p), MODULES[m].nom, MODULES[m].mensuel, p);
  await prix(envBien(p), "Bien supplémentaire", 1.5, p);
  for (const pk of PACKS) for (const f of Object.keys(SOCLE) as Formule[]) {
    const ligne = lignesModules({ formule: f, periode: p, modules: [], pack: pk.id })[0];
    await prix(envPack(pk.id, f, p), `Pack ${pk.nom} (${SOCLE[f].nom})`, ligne.mensuel, p);
  }
}
