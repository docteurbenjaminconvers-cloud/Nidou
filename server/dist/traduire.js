/**
 * The French → English translator shared by the app (display time) and the server (emails and notifications of
 * people who use Lucien in English). One dictionary, server/src/i18n/en.json: fixed texts and patterns with
 * variable parts ("{0} documents dans le foyer" → "{0} documents in the household").
 */
import { readFileSync } from "node:fs";
import { traducteur } from "./traducteur.js";
let enCache = null;
/** The English translator, the dictionary read once from disk (copied next to the compiled server). */
function en() {
    if (!enCache) {
        const d = JSON.parse(readFileSync(new URL("./i18n/en.json", import.meta.url), "utf8"));
        const t = traducteur(d);
        enCache = (x) => t(x);
    }
    return enCache;
}
export const langueDe = (l) => (l === "en" ? "en" : "fr");
/** From a browser's Accept-Language header, before the person has an account. */
export const langueNavigateur = (h) => ((h ?? "").trim().slice(0, 2).toLowerCase() === "en" ? "en" : "fr");
/**
 * Text for a person: unchanged in French; in English, translated line by line (a line the dictionary does not know
 * stays in French rather than being half translated).
 */
export function traduire(texte, langue) {
    if (langue !== "en" || !texte)
        return texte;
    const t = en();
    return texte.split("\n").map((ligne) => t(ligne) ?? ligne).join("\n");
}
