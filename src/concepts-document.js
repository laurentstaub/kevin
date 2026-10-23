/**
 * Concepts du filtre de document : le mot du comptoir (« sécabilité ») cherche
 * aussi les expressions que les RCP emploient (« barre de cassure », « doses
 * égales », « ne doit pas être divisé »). La table data/concepts-document.json
 * part dans la page ; documents.js l'applique à la saisie entière.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { deaccent } from './text.js';

const { concepts } = JSON.parse(readFileSync(path.join(ROOT, 'data', 'concepts-document.json'), 'utf8'));

export const CONCEPTS_DOCUMENT = concepts.map(({ mots, formes }) => ({ mots, formes }));

const plier = (texte) => ` ${deaccent(String(texte ?? '')).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']+/g, ' ').trim()} `;

/**
 * La rubrique du RCP où se lit une question du comptoir (« méthotrexate
 * allaitement » → 4.6, « surdosage Previscan » → 4.9), d'après les mots de ses
 * concepts. Null si aucune, ou si plusieurs s'opposent.
 */
export function rubriqueDuComptoir(texte) {
  const saisie = plier(texte);
  const rubriques = new Set(concepts
    .filter((concept) => concept.rubrique && concept.mots.some((mot) => saisie.includes(plier(mot))))
    .map((concept) => concept.rubrique));
  return rubriques.size === 1 ? [...rubriques][0] : null;
}

/** Le mot du comptoir reconnu dans une saisie, le plus long (« insuffisance rénale » plutôt que « rénale »). */
export function motDuComptoir(texte) {
  const saisie = plier(texte);
  return concepts.flatMap((concept) => concept.mots)
    .filter((mot) => saisie.includes(plier(mot)))
    .sort((mot1, mot2) => mot2.length - mot1.length)[0] ?? null;
}

/** La table telle que la page la lit (attribut data-concepts du filtre). */
export const CONCEPTS_DOCUMENT_JSON = JSON.stringify(CONCEPTS_DOCUMENT);
