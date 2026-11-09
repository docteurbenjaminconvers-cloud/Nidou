import { test } from "node:test";
import assert from "node:assert/strict";
import { aGarder, detailsDe, ibanValide, lireCoordonnees } from "./details.js";

const RELANCE = `SERVICE DE GESTION COMPTABLE D'UZES
1 RUE 19 MARS 1962 BP55
30701 UZES CEDEX
Tél : 04 66 03 47 39
Mél : sgc.uzes@dgfip.finances.gouv.fr
BIC/IBAN : BDFEFRPPCCT/FR76 3000 6000 0112 3456 7890 189`;

test("détails d'un papier : email, téléphone et IBAN lus dans le texte, l'IA complète l'adresse et les références", () => {
  assert.ok(ibanValide("FR7630006000011234567890189"));
  assert.ok(!ibanValide("FR7630006000011234567890188"), "a wrong key is refused");
  const lu = lireCoordonnees(RELANCE);
  assert.deepEqual(lu.emails, ["sgc.uzes@dgfip.finances.gouv.fr"]);
  assert.deepEqual(lu.telephones, ["04 66 03 47 39"]);
  assert.deepEqual(lu.ibans, ["FR7630006000011234567890189"]);
  const d = detailsDe({ organisme: "Centre des Finances Publiques", contact: { service: "Service de gestion comptable d'Uzès", adresse: "1 rue du 19 mars 1962, BP 55\n30701 Uzès Cedex", email: "sgc.uzes@dgfip.finances.gouv.fr" }, references: [{ libelle: "Numéro d'acte", valeur: "53894425132" }] }, RELANCE)!;
  assert.equal(d.contact.email, "sgc.uzes@dgfip.finances.gouv.fr");
  assert.equal(d.contact.telephone, "04 66 03 47 39");
  assert.equal(d.paiement?.iban, "FR7630006000011234567890189");
  assert.equal(d.references[0].valeur, "53894425132");
  // a photo: the AI's transcription becomes the text kept; an identity paper keeps nothing more
  const g = aGarder({ category: "autre", transcription: RELANCE }, null);
  assert.equal(g.texte, RELANCE);
  assert.match(g.details!, /sgc\.uzes/);
  assert.deepEqual(aGarder({ category: "identite", transcription: "PASSEPORT …" }, null), { texte: null, details: null });
  assert.equal(detailsDe({}, "rien d'utile"), null);
});
