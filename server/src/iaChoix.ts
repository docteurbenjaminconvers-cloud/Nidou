/**
 * What the household lets the AI read. Two choices, both the owner's:
 * - « papiers » (on by default): papers are read by the AI; off, every paper is read on the server, without AI;
 * - « identite » (off by default): identity papers (passport, identity card, driving licence…) never leave Lucien
 *   unless the household asks for it.
 * A paper is known to be an identity paper before any reading when the person says so while adding it, or when its
 * file name or its text says so. A photo with a plain name that nobody labelled cannot be told apart beforehand.
 */
export interface ChoixIa { ia_papiers?: number | null; ia_identite?: number | null }

const RE_IDENTITE = /passeport|passport|carte[\s_-]*(nationale|d['’e]?[\s_-]*identit)|\bcni\b|pi[eè]ce[\s_-]*d['’e]?[\s_-]*identit|permis[\s_-]*de[\s_-]*conduire|titre[\s_-]*de[\s_-]*s[eé]jour|livret[\s_-]*de[\s_-]*famille/i;

export function semblePieceIdentite(p: { categorie?: string | null; nomFichier?: string | null; texte?: string | null }): boolean {
  return p.categorie === "identite" || RE_IDENTITE.test(`${(p.nomFichier ?? "").replace(/[_.-]+/g, " ")} ${(p.texte ?? "").slice(0, 3000)}`);
}

/** May this paper be read by the AI? `raison`: why not (the household reads without AI / an identity paper). */
export function iaPourPapier(h: ChoixIa | null | undefined, p: { categorie?: string | null; nomFichier?: string | null; texte?: string | null }): { ia: boolean; raison: "foyer" | "identite" | null } {
  if (h && h.ia_papiers === 0) return { ia: false, raison: "foyer" };
  if (!h?.ia_identite && semblePieceIdentite(p)) return { ia: false, raison: "identite" };
  return { ia: true, raison: null };
}

export const RESUME_SANS_IA = {
  foyer: "Papier lu sans IA, comme vous l'avez choisi dans Réglages : il n'a pas quitté Lucien. Vérifiez et complétez les champs.",
  identite: "Pièce d'identité : rangée sans passer par l'IA, elle n'a pas quitté Lucien. Indiquez sa date d'expiration pour être prévenu à temps.",
} as const;
