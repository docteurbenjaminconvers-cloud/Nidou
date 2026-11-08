import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { coordonnees, lettreResiliationStructuree, papiersDe, pdfLettre, texteLettre } from "./lettres.js";

const facture = {
  organisme: "Leocare", title: "Leocare — contrat assurance smartphone", numero_contrat: null,
  texte: `LEOCARE SAS\nService Résiliation\n12 rue de la Paix\n75002 Paris\nContact : noreply@leocare.eu ou service-client@leocare.eu\nN° de contrat : LC-2045-889\nVous pouvez aussi écrire à info@partenaire.fr`,
};

test("coordonnées : l'email du service client, l'adresse postale et la référence sont lus dans les papiers de la société", () => {
  const c = coordonnees([facture, { organisme: "EDF", title: "EDF", numero_contrat: "X", texte: "edf@edf.fr" }], "Leocare");
  assert.equal(c.emails[0], "service-client@leocare.eu", "the customer service address first, never a no-reply");
  assert.ok(!c.emails.includes("noreply@leocare.eu"));
  assert.ok(!c.emails.includes("edf@edf.fr"), "only the papers of this company");
  assert.equal(c.adresse, "12 rue de la Paix\n75002 Paris");
  assert.equal(c.reference, "LC-2045-889");
  assert.equal(c.source, facture.title);
  assert.deepEqual(coordonnees([], "Leocare"), { emails: [], adresse: null, reference: null, source: null });
  assert.equal(papiersDe([{ organisme: "ORANGE SA", title: "Facture" }], "Orange").length, 1);
});

test("lettre : texte et PDF d'une page, avec l'expéditeur, la référence et le destinataire", async () => {
  const l = lettreResiliationStructuree({ marchand: "Leocare", montant: 101.83, expediteur: { nom: "Benjamin Convers", adresse: "1 rue X\n34000 Montpellier" }, destinataire: "12 rue de la Paix\n75002 Paris", reference: "LC-2045-889", aujourdhui: "2026-11-08" });
  const t = texteLettre(l);
  assert.match(t, /Benjamin Convers\n1 rue X/);
  assert.match(t, /Référence client : LC-2045-889/);
  assert.match(t, /101,83 €/);
  assert.match(t, /Le 8 novembre 2026/);
  const pdf = await PDFDocument.load(await pdfLettre(l));
  assert.equal(pdf.getPageCount(), 1);
  assert.match(pdf.getTitle() ?? "", /Résiliation/);
});
