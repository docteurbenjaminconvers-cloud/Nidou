import { test } from "node:test";
import assert from "node:assert/strict";
import { devis, droits, PACKS, prixModule } from "./offre.js";

test("offre : socle seul, modules à la carte, annuel = 10 mois", () => {
  const d = devis({ formule: "solo", periode: "mensuel", modules: [] });
  assert.equal(d.mensuel, 6.9);
  const m = devis({ formule: "duo", periode: "annuel", modules: ["budget_expert", "locatif"], biens: 4 });
  assert.equal(prixModule("locatif", { biens: 4 }), 7.9, "2 included, +1,50 each beyond");
  assert.equal(m.mensuel, 21.7);
  assert.equal(m.total, 217);
});

test("offre : Indépendant inclut Salarié, jamais facturés deux fois", () => {
  const d = devis({ formule: "solo", periode: "mensuel", modules: ["vie_pro_salarie", "vie_pro_independant"] });
  assert.deepEqual(d.modules, ["vie_pro_independant"]);
  assert.equal(d.mensuel, 14.8);
});

test("offre : un pack coûte moins cher que ses modules, et Lucien le conseille", () => {
  for (const p of PACKS) {
    const d = devis({ formule: "duo", periode: "mensuel", modules: [], pack: p.id });
    assert.ok(d.mensuel < d.alaCarte, p.id);
    assert.match(d.mensuel.toFixed(2), /\.90$/, "prices end in ,90");
  }
  const sansPack = devis({ formule: "solo", periode: "mensuel", modules: ["budget_expert", "vie_pro_independant", "assistant"] });
  assert.equal(sansPack.conseil?.pack, "independant");
  assert.ok(sansPack.conseil!.gain > 0);
  const integral = devis({ formule: "solo", periode: "annuel", modules: [], pack: "integral" });
  assert.equal(integral.economie, Math.round((integral.alaCarte - integral.mensuel) * 1000) / 100);
});

test("offre : droits — essai complet, gratuit sans module, Indépendant ouvre Salarié", () => {
  assert.equal(droits({ plan: "famille", essai_actif: true, modules: [] }).has("locatif"), true);
  assert.equal(droits({ plan: "gratuit", essai_actif: false, modules: ["locatif"] }).size, 0);
  const d = droits({ plan: "famille", essai_actif: false, modules: ["vie_pro_independant"] });
  assert.ok(d.has("vie_pro_salarie") && !d.has("locatif"));
});
