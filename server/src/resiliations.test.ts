import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { lettreRemboursement, verifier } from "./resiliations.js";
import { rappelsAbonnements } from "./rappels.js";

const tx = (date: string, marchand = "netflix", montant = -13.49) => ({ date, marchand, montant });
const S = { cle: "netflix", marchand: "Netflix", montant: 13.49, frequence: "mensuel" as const, demande_le: "2026-11-03" };

test("boucle des abonnements : en cours, dernier prélèvement toléré, confirmée, ou encore prélevée", () => {
  const hist = [tx("2026-09-08"), tx("2026-10-08")];
  assert.equal(verifier(S, hist, "2026-11-20").statut, "en_cours");
  assert.equal(verifier(S, [...hist, tx("2026-11-08")], "2026-11-20").statut, "en_cours", "one last debit within the month is normal");
  assert.equal(verifier(S, [...hist, tx("2026-11-08")], "2026-12-11").statut, "confirmee", "nothing for a month and a week");
  const r = verifier(S, [...hist, tx("2026-11-08"), tx("2026-12-08")], "2026-12-11");
  assert.equal(r.statut, "encore_prelevee"); assert.equal(r.dernier_preleve, "2026-12-08");
  assert.equal(verifier(S, [...hist, tx("2026-12-08", "spotify")], "2026-12-11").statut, "confirmee", "other merchants ignored");
  const l = lettreRemboursement({ marchand: "Netflix", demande_le: "2026-11-03", prelevements: [{ date: "2026-12-08", montant: 13.49 }], expediteur: "Camille" });
  assert.match(l, /résilié mon abonnement le 03\/11\/2026/); assert.match(l, /08\/12\/2026 : 13,49 €/);
});

test("boucle des abonnements par l'appli : aide, « j'ai résilié », économie prouvée, rappels", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "0";
  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
    const h = db.firstHousehold() ?? db.createHousehold("Famille");
    const mois = (n: number) => { const d = new Date(); d.setUTCDate(8); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
    db.insertTransactions([4, 3, 2].map((n, i) => ({ household_id: h.id, compte: null, date: mois(n), libelle: "PRLV NETFLIX.COM", marchand: "netflix", montant: -13.49, categorie: "abonnements", empreinte: `n${i}` })) as never);
    const aide = await (await api.request("/resiliations/aide?cle=netflix")).json();
    assert.equal(aide.economie_annuelle, 161.88); assert.match(aide.lettre, /Résiliation de mon abonnement/); assert.equal(aide.etapes.length, 4);
    // cancelled two months ago (backdated in the table), no debit since: proven
    assert.equal((await api.request("/resiliations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cle: "netflix" }) })).status, 201);
    db.raw.prepare("UPDATE resiliations SET demande_le = ? WHERE cle = 'netflix'").run(mois(2));
    const b = await (await api.request("/budget")).json();
    assert.equal(b.resiliations[0].statut, "confirmee"); assert.equal(b.economies_prouvees, 161.88);
    const r = rappelsAbonnements(db, db.getHousehold(h.id)!);
    assert.ok(r.some((x) => x.cle === "resiliation:netflix:confirmee"), "the person is told the saving is proven");
    assert.equal((await api.request("/resiliations/inconnu", { method: "DELETE" })).status, 200);
    assert.equal((await api.request("/resiliations/aide?cle=inconnu")).status, 404);
  } finally { if (avant === undefined) delete process.env.LUCIEN_AUTH; else process.env.LUCIEN_AUTH = avant; }
});
