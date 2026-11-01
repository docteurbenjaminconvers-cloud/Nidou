import { test } from "node:test";
import assert from "node:assert/strict";
import { langueNavigateur, traduire } from "./traduire.js";

test("emails en anglais : traduits ligne par ligne, inchangés en français", () => {
  const texte = "Bonjour,\n\nVoici votre lien pour ouvrir Lucien : https://monlucien.fr/x\n\nIl est valable 30 minutes et ne sert qu'une fois. Si vous n'avez rien demandé, ignorez cet email.";
  assert.equal(traduire(texte, "fr"), texte);
  assert.equal(traduire(texte, "en"), "Hello,\n\nHere is your link to open Lucien: https://monlucien.fr/x\n\nIt is valid for 30 minutes and works only once. If you did not ask for it, just ignore this email.");
  assert.equal(traduire("Demain : Taxe foncière 2026", "en"), "Tomorrow: Property tax 2026");
  assert.equal(traduire("Une phrase que le dictionnaire ne connaît pas du tout", "en"), "Une phrase que le dictionnaire ne connaît pas du tout", "unknown lines stay in French");
  assert.equal(langueNavigateur("en-GB,en;q=0.9"), "en"); assert.equal(langueNavigateur("fr-FR"), "fr"); assert.equal(langueNavigateur(undefined), "fr");
});
