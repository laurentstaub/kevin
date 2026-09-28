/**
 * Élargit une requête par un thésaurus de termes équivalents (« QT » → « torsade de pointes »).
 * Côté requête et non dictionnaire Postgres : inaccessible sur Heroku, et tout
 * ajout imposerait de réindexer (280 s de verrou).
 * Rend des atomes (listes d'alternatives) : « OR » de websearch_to_tsquery a la mauvaise précédence.
 * data/thesaurus.json est versionné et relu par un pharmacien.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { deaccent } from './text.js';

/** Alternatives maximales par terme. */
const ALTERNATIVES_MAX = 8;
/** Longueur maximale, en mots, d'un terme reconnu. */
const MOTS_MAX = 6;

/** Clé de comparaison : sans accents, casse ni séparateurs (« CYP 3A4 » = « CYP3A4 »). */
const cle = (texte) => deaccent(String(texte)).toLowerCase().replace(/[\s'’\-–.]+/g, '');

function charger(chemin = path.join(ROOT, 'data', 'thesaurus.json')) {
  const { groupes } = JSON.parse(readFileSync(chemin, 'utf8'));
  const parCle = new Map();
  for (const groupe of groupes) {
    const membres = groupe.map((terme) => String(terme).trim()).filter(Boolean);
    if (membres.length < 2) continue;
    for (const terme of membres) {
      // Doublon entre groupes : le premier l'emporte (erreur à corriger dans le fichier).
      if (!parCle.has(cle(terme))) parCle.set(cle(terme), membres);
    }
  }
  return parCle;
}

let INDEX = null;
const index = () => (INDEX ??= charger());

/** Tests : recharger depuis un autre fichier, ou vider. */
export function chargerThesaurus(chemin) {
  INDEX = chemin ? charger(chemin) : null;
}

/** Guillemets autour d'un terme de plusieurs mots : cherché comme locution. */
const citer = (terme) => (/\s/.test(terme) ? `"${terme.replace(/"/g, '')}"` : terme);

/**
 * @param {string} requete - la saisie, telle quelle
 * @returns {{ atomes: string[][], elargissements: {terme: string, vers: string[]}[] }}
 *   `atomes` : alternatives par concept, chacune passée à websearch_to_tsquery ;
 *   `elargissements` : termes reconnus, à afficher.
 */
export function elargir(requete) {
  const saisie = String(requete ?? '').trim();
  if (!saisie) return { atomes: [], elargissements: [] };

  // Guillemets : recherche exacte, sans élargissement.
  if (saisie.includes('"')) return { atomes: [[saisie]], elargissements: [] };

  const mots = saisie.split(/\s+/).slice(0, config.search.maxTerms + MOTS_MAX);
  const atomes = [];
  const elargissements = [];
  let i = 0;

  while (i < mots.length && atomes.length < config.search.maxTerms) {
    // Terme le plus long d'abord : « intervalle QT » avant « QT ».
    let trouve = null;
    for (let taille = Math.min(MOTS_MAX, mots.length - i); taille >= 1 && !trouve; taille -= 1) {
      const candidat = mots.slice(i, i + taille).join(' ');
      const groupe = index().get(cle(candidat));
      if (groupe) trouve = { n: taille, candidat, groupe };
    }

    if (trouve) {
      const alternatives = [...new Set(trouve.groupe)].slice(0, ALTERNATIVES_MAX);
      atomes.push(alternatives.map(citer));
      elargissements.push({
        terme: trouve.candidat,
        vers: alternatives.filter((alternative) => cle(alternative) !== cle(trouve.candidat)),
      });
      i += trouve.n;
    } else {
      atomes.push([mots[i]]);
      i += 1;
    }
  }

  return { atomes, elargissements };
}
