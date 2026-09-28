/**
 * Élargissement d'une requête par un thésaurus de termes équivalents.
 *
 * La recherche est lexicale : « QT » ne trouve pas « torsade de pointes »,
 * « CYP3A4 » écrit soudé ne trouve pas « CYP 3A4 » — ce sont deux jetons pour
 * Postgres. Un pharmacien tape le sigle qu'il a en tête ; le RCP a écrit la
 * forme longue. Le thésaurus tient la correspondance.
 *
 * Pourquoi ici et non dans Postgres. Postgres a un dictionnaire de synonymes,
 * mais c'est un fichier posé sur le disque du serveur, dans $SHAREDIR — sur
 * Heroku, on n'y a pas accès. Et il aurait un défaut plus grave que
 * l'hébergement : il s'applique à l'indexation, si bien que tout ajout au
 * thésaurus imposerait de recalculer la colonne tsvector, soit 280 secondes de
 * verrou exclusif. Ici l'élargissement se fait sur la requête : le thésaurus
 * change, la base ne bouge pas.
 *
 * Le résultat n'est pas une chaîne — `websearch_to_tsquery` donne à « OR » la
 * précédence inverse de celle qu'il nous faut : « sertraline QT OR torsade »
 * devient (sertraline & QT) | torsade. On rend des *atomes*, listes
 * d'alternatives, que recherche-texte.js compose avec les opérateurs tsquery
 * `&&` et `||`. Chaque alternative passe séparément par websearch_to_tsquery
 * et en garde la sûreté : un atome hostile devient une requête vide, absorbée
 * par la composition, jamais une erreur.
 *
 * Le thésaurus est un fichier JSON versionné, relu par un pharmacien. C'est
 * la place de l'intelligence artificielle dans ce projet : proposer des
 * groupes à la construction, jamais répondre au comptoir.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { deaccent } from './text.js';

/** Au-delà, un mot ne se cherche plus, il se noie. */
const ALTERNATIVES_MAX = 8;
/** Longueur maximale, en mots, d'un terme du thésaurus qu'on tente de reconnaître. */
const MOTS_MAX = 6;

/**
 * Forme de comparaison d'un terme : sans accents, sans casse, et sans les
 * séparateurs qui distinguent « anti-vitamine K » de « antivitamine K » ou
 * « CYP 3A4 » de « CYP3A4 ». On compare des squelettes, pas des graphies.
 */
const cle = (texte) => deaccent(String(texte)).toLowerCase().replace(/[\s'’\-–.]+/g, '');

function charger(chemin = path.join(ROOT, 'data', 'thesaurus.json')) {
  const { groupes } = JSON.parse(readFileSync(chemin, 'utf8'));
  const parCle = new Map();
  for (const groupe of groupes) {
    const membres = groupe.map((terme) => String(terme).trim()).filter(Boolean);
    if (membres.length < 2) continue;
    for (const terme of membres) {
      // Un terme présent dans deux groupes rejoint le premier : le fichier
      // est relu, un doublon y est une erreur à corriger, pas à arbitrer.
      if (!parCle.has(cle(terme))) parCle.set(cle(terme), membres);
    }
  }
  return parCle;
}

let INDEX = null;
const index = () => (INDEX ??= charger());

/** Pour les tests : recharger depuis un autre fichier, ou oublier. */
export function chargerThesaurus(chemin) {
  INDEX = chemin ? charger(chemin) : null;
}

/**
 * Un terme de plusieurs mots se cite pour que websearch_to_tsquery en fasse
 * une locution — « torsade de pointes » cherché comme suite, pas comme trois
 * mots indépendants.
 */
const citer = (terme) => (/\s/.test(terme) ? `"${terme.replace(/"/g, '')}"` : terme);

/**
 * Élargit une requête.
 *
 * @param {string} requete - la saisie, telle quelle
 * @returns {{ atomes: string[][], elargissements: {terme: string, vers: string[]}[] }}
 *   `atomes` : une liste par concept, chaque liste étant des alternatives à
 *   passer une à une à websearch_to_tsquery ; `elargissements` : ce qu'on a
 *   reconnu et remplacé, pour le dire au lecteur.
 */
export function elargir(requete) {
  const saisie = String(requete ?? '').trim();
  if (!saisie) return { atomes: [], elargissements: [] };

  // Des guillemets, c'est une demande d'exactitude : on la respecte à la
  // lettre et on laisse websearch_to_tsquery faire la locution.
  if (saisie.includes('"')) return { atomes: [[saisie]], elargissements: [] };

  const mots = saisie.split(/\s+/).slice(0, config.search.maxTerms + MOTS_MAX);
  const atomes = [];
  const elargissements = [];
  let i = 0;

  while (i < mots.length && atomes.length < config.search.maxTerms) {
    // Le terme le plus long d'abord : « intervalle QT » avant « QT ».
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
