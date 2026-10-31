import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { budgetIa, plafondCentimes } from "./iaBudget.js";
import { categorise } from "./transactions.js";

test("budget IA : 3 € par mois en essai, 10 € abonné, 0 sans formule ; au-delà, plus d'appel IA", () => {
  const db = new Db(":memory:"); createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const essai = db.createHousehold("Essai");
  const abonne = db.createHousehold("Abonné");
  db.raw.prepare("UPDATE households SET plan = 'famille', abonnement_statut = 'active' WHERE id = ?").run(abonne.id);
  const fini = db.createHousehold("Essai fini", 15);
  db.setTrialEnd(fini.id, new Date(0).toISOString());
  assert.equal(plafondCentimes(db, essai.id), 300);
  assert.equal(plafondCentimes(db, abonne.id), 1000);
  assert.equal(plafondCentimes(db, fini.id), 0);

  const b = budgetIa(db, essai.id);
  assert.ok(b.ok(2));
  for (let i = 0; i < 149; i++) b.compter(2, true); // 149 precise readings = 2,98 €
  assert.ok(b.ok(2), "2 cents left");
  b.compter(2, true);
  assert.equal(b.ok(), false, "3 € reached");
  assert.equal(db.iaLecturesMois(essai.id), 150);
  assert.equal(db.iaCentimesMois(abonne.id), 0, "each household has its own budget");
  assert.ok(db.iaDepenseMois().payant_eur + db.iaDepenseMois().gratuit_eur >= 3, "platform total still kept");
});

test("budget IA : la catégorisation bascule sur les règles quand le budget est épuisé", async () => {
  let appels = 0;
  const epuise = { ok: () => false, compter: () => { appels++; }, reste: () => 0 };
  const avant = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = "cle-factice";
  try {
    const cats = await categorise([{ libelle: "CB NETFLIX.COM", montant: -13.49 }, { libelle: "LIBELLE INCONNU XYZ", montant: -12 }], epuise);
    assert.equal(cats.length, 2); assert.equal(cats[1], "autre", "unknown label left to rules");
    assert.equal(appels, 0, "no AI call counted, none made");
  } finally { if (avant === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = avant; }
});

test("dépense IA de la plateforme : réservée à l'administrateur", async () => {
  const avant = process.env.LUCIEN_ADMIN_TOKEN; process.env.LUCIEN_ADMIN_TOKEN = "admin-secret";
  try {
    const api = createApi(new Db(":memory:"), { uploadDir: "/tmp/lucien-test-uploads" });
    assert.ok([401, 403].includes((await api.request("/ia/depense")).status), "refused without the admin token");
    assert.equal((await api.request("/ia/depense", { headers: { authorization: "Bearer admin-secret" } })).status, 200);
  } finally { if (avant === undefined) delete process.env.LUCIEN_ADMIN_TOKEN; else process.env.LUCIEN_ADMIN_TOKEN = avant; }
});
