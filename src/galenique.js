/**
 * Sécabilité d'un comprimé, lue dans la rubrique 3 du RCP (forme
 * pharmaceutique). La phrase source est rendue telle quelle : la bande n'en
 * affiche qu'un mot, l'infobulle cite. Rien n'est déduit d'une simple « barre
 * de cassure », qui peut ne servir qu'à faciliter la prise.
 */
import { deaccent } from './text.js';

/** Barre de cassure qui ne divise pas en doses égales : à vérifier avant tout « sécable ». */
const PRISE_SEULE = [
  /ne (?:le |la |les )?divise(?:nt)? pas en (?:deux )?(?:demi-)?doses egales/,
  /(?:et )?non (?:pas )?(?:pour |de )?(?:le |la )?diviser en (?:deux )?(?:demi-)?doses egales/,
  /n'est pas destinee a (?:briser|casser|diviser|couper)/,
  /(?:seulement|uniquement) (?:a |de |pour )?faciliter la (?:prise|deglutition)/,
];
const QUADRI = /quadrisecable/;
const SECABLE = /(?<!non[ -])\bsecables?\b|peut etre (?:divise|coupe) en (?:deux )?(?:demi-)?doses egales/;
const NON_SECABLE = /\bnon[ -]secables?\b/;

/** Phrases d'un texte, sans couper sur les décimales. */
const phrases = (texte) => texte.split(/(?<=[.!?])\s+(?=\S)/).map((phrase) => phrase.trim()).filter(Boolean);

/**
 * @param {string|null} texte  texte de la rubrique 3
 * @returns {{ valeur: 'secable'|'quadrisecable'|'prise-seule'|'non-secable', phrase: string }|null}
 *   null quand le RCP ne dit rien, ou se contredit (plusieurs dosages dans un même RCP)
 */
export function lireSecabilite(texte) {
  if (!texte) return null;
  const trouve = (motif) => phrases(texte).find((phrase) => motif.test(deaccent(phrase).toLowerCase().replaceAll('’', "'")));

  const priseSeule = PRISE_SEULE.map(trouve).find(Boolean);
  if (priseSeule) return { valeur: 'prise-seule', phrase: priseSeule };

  const quadri = trouve(QUADRI);
  const secable = trouve(SECABLE);
  const non = trouve(NON_SECABLE);
  // « 50 mg : non sécables … 100 mg : sécables » : la bande ne tranche pas.
  if ((quadri || secable) && non) return null;
  if (quadri) return { valeur: 'quadrisecable', phrase: quadri };
  if (secable) return { valeur: 'secable', phrase: secable };
  if (non) return { valeur: 'non-secable', phrase: non };
  return null;
}

/** Libellés courts de la bande. */
export const SECABILITE = {
  secable: 'sécable',
  quadrisecable: 'quadrisécable',
  'prise-seule': 'barre de prise seule',
  'non-secable': 'non sécable',
};

/** Sécabilité d'une spécialité d'après sa rubrique 3 déjà découpée ; null si muette. */
export async function getSecabilite(pool, cis) {
  const { rows } = await pool.query(
    `SELECT texte FROM docs.rcp_sections
      WHERE code_cis = $1 AND numero = '3' AND document_type <> 'notice'
      ORDER BY (document_type = 'rcp') DESC, position
      LIMIT 1`,
    [cis],
  );
  return lireSecabilite(rows[0]?.texte ?? null);
}
