/**
 * Citation du RCP : isole les phrases entières d'une rubrique qui portent un
 * terme, sans coupe ni reformulation (contrairement à `ts_headline`, dont la
 * fenêtre de mots peut perdre le sujet de la phrase).
 */

import { deaccent } from './text.js';
import { elargir } from './thesaurus.js';

/** Au-delà, la citation devient un extrait de RCP, et le RCP est à un clic. */
export const PHRASES_MAX = 2;
/** Une phrase plus longue est presque toujours une énumération mal ponctuée. */
const LONGUEUR_MAX = 600;

const normal = (texte) => deaccent(String(texte)).toLowerCase();

/**
 * Découpe en phrases : ponctuation finale suivie d'une espace et d'une
 * majuscule, pour ne pas couper sur « p. ex. » ni sur les décimales.
 */
export function phrases(texte) {
  return String(texte ?? '')
    .replace(/\s+/g, ' ')
    // Une puce coupe aussi : les listes de contre-indications n'ont souvent pas de point.
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý«(])|\s*[•▪]\s*/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

/**
 * Motifs d'un terme élargis par le thésaurus (« QT » → « torsade de pointes »),
 * bornés en début de mot : « QT » trouve « QTc » mais pas une suite quelconque.
 */
export function motifs(termes) {
  const alternatives = termes.flatMap((terme) => elargir(terme).atomes.flat())
    .map((atome) => atome.replace(/"/g, ''));
  return [...new Set(alternatives)].map((atome) => {
    const echappe = normal(atome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${echappe}`, 'i');
  });
}

/** Les phrases d'un texte qui portent l'un des motifs, dans leur ordre. */
export function phrasesPertinentes(texte, regexes, max = PHRASES_MAX) {
  return phrases(texte)
    .filter((phrase) => phrase.length <= LONGUEUR_MAX && regexes.some((regex) => regex.test(normal(phrase))))
    .slice(0, max);
}
