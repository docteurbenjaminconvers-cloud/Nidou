import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { processInboundEmail, codeFromAddress, cleanBody, boiteAddress } from "./inbox.js";

test("adresse de transfert : un email transféré devient un papier avec ses échéances", async () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 15); // trial → famille
  const to = boiteAddress(h.boite_code)!;
  assert.match(to, /^foyer-[a-z0-9]{6}@in\.monlucien\.fr$/);
  assert.equal(codeFromAddress(to), h.boite_code);
  const mail = {
    message_id: "<m1@example>", to: [to], from: "noreply@maif.fr", subject: "Fwd: Avis d'échéance",
    text: "---------- Message transféré ----------\nMAIF — Avis d'échéance\nContrat n° AUT-4471-8820\nCotisation annuelle : 612 €\nPériode du 01/12/2026 au 30/11/2027\n> ancienne citation\n-- \nEnvoyé de mon iPhone",
    attachments: [],
  };
  const plan = () => "famille" as const;
  const r = await processInboundEmail(db, mail, { plan });
  assert.equal(r.statut, "ok");
  if (r.statut !== "ok") return;
  assert.equal(r.documents.length, 1);
  assert.equal(r.documents[0].source, "email");
  assert.equal(r.documents[0].organisme, "MAIF");
  assert.ok(db.listDeadlines(h.id).length >= 1, "deadlines derived");
  // same message again: ignored
  const again = await processInboundEmail(db, mail, { plan });
  assert.deepEqual(again, { statut: "ignore", raison: "deja_traite" });
  // unknown recipient / free plan
  assert.deepEqual(await processInboundEmail(db, { ...mail, message_id: "m2", to: ["foyer-zzzzzz@in.monlucien.fr"] }, { plan }), { statut: "ignore", raison: "destinataire_inconnu" });
  assert.deepEqual(await processInboundEmail(db, { ...mail, message_id: "m3" }, { plan: () => "gratuit" }), { statut: "ignore", raison: "plan_gratuit" });
});

test("nettoyage du corps : citations et signature retirées", () => {
  assert.equal(cleanBody("Bonjour\n> cité\n> encore\n-- \nSignature"), "Bonjour");
});
