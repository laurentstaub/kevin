/**
 * La phrase du RCP.
 *
 * Une fiche ne résume pas un RCP, elle le cite. Cette unité isole, dans le
 * texte d'une rubrique, les phrases qui portent un terme, et les rend telles
 * quelles — sans coupe au milieu, sans reformulation. Ce que `ts_headline`
 * fait pour un aperçu de recherche, fenêtre de mots arbitraire, ne convient
 * pas à une publication : un fragment qui commence par « …supérieur à 500 ms »
 * a perdu son sujet.
 */

import { deaccent } from './text.js';
import { elargir } from './thesaurus.js';

/** Au-delà, la citation devient un extrait de RCP, et le RCP est à un clic. */
export const PHRASES_MAX = 2;
/** Une phrase plus longue est presque toujours une énumération mal ponctuée. */
const LONGUEUR_MAX = 600;

const normal = (texte) => deaccent(String(texte)).toLowerCase();

/**
 * Découpe en phrases, sans couper sur « p. ex. », « 50 mg. Chez… » ni sur les
 * décimales. On coupe sur un point, un point d'exclamation ou d'interrogation
 * suivi d'un espace et d'une majuscule — la règle la plus prudente qui marche
 * sur le texte des RCP.
 */
export function phrases(texte) {
  return String(texte ?? '')
    .replace(/\s+/g, ' ')
    // Une puce coupe aussi : les contre-indications sont souvent une liste
    // sans point final, qui restait sinon d'un seul bloc.
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý«(])|\s*[•▪]\s*/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

/**
 * Les motifs à chercher pour un terme, élargis par le thésaurus : « QT »
 * cherche aussi « torsade de pointes ». Chaque motif est borné aux limites de
 * mot — sans quoi « QT » trouverait « QTc », ce qui est voulu, mais aussi
 * n'importe quelle suite de lettres.
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
