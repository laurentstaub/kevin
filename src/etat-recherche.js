/**
 * L'état d'une recherche, en un seul objet.
 *
 * Onze URL étaient écrites à la main dans trois gabarits, chacune ré-encodant
 * la requête et ré-assemblant les paramètres de mémoire. C'est le mécanisme
 * par lequel l'état se fragmente : un lien qui reconstruit l'état en oublie
 * toujours une partie, et l'oubli ne se voit qu'à l'usage — le filtre par
 * rubrique perdu en changeant de mode, la page 3 conservée alors qu'on vient
 * de changer de filtre et qu'il n'y a plus que deux pages.
 *
 * Le principe : **l'URL est l'état**. Tout ce qui change ce qu'on voit y
 * figure, et rien d'autre n'existe. Pas de magasin côté client, pas de
 * session. On y gagne le partage d'un résultat, un bouton retour juste, et
 * des états qui se testent parce qu'un état est une chaîne de caractères.
 *
 * Le décompte n'en fait pas partie : c'est un dérivé, et le mettre dans l'URL
 * autoriserait une URL qui ment.
 */

import { parseQuery, parseFilter } from './validate.js';
import { normaliserRubrique } from './recherche-texte.js';

/**
 * Les deux modes, et ce que chacun sait porter.
 *
 * Le mode reste encodé par la page — une page, une question — plutôt que par
 * un paramètre. Passer de l'un à l'autre abandonne donc ce qui n'a pas cours
 * dans le mode d'arrivée : la recherche par nom ne connaît pas les rubriques,
 * la recherche plein texte ne connaît pas la distinction dénomination /
 * principe actif. Cet abandon est volontaire et énoncé ici ; c'est tout ce qui
 * le sépare de l'oubli qu'on avait.
 */
export const MODES = {
  nom: { chemin: '/search', porte: ['filtre'] },
  documents: { chemin: '/documents', porte: ['rubrique', 'page'] },
};

/** Ce qui ne s'écrit pas dans l'URL parce que c'est déjà le défaut. */
const DEFAUTS = { filtre: 'all', page: 1 };

/**
 * Les noms de paramètres restent ceux d'aujourd'hui — `q`, `filter`,
 * `rubrique`, `page`.
 *
 * J'avais proposé de les uniformiser en français ; c'est une dépense sans
 * recette. Renommer `filter` en `filtre` casserait les liens déjà partagés et
 * les favoris pour un gain qui n'existe que dans le code — or le code, lui,
 * ne voit que l'objet d'état, où le vocabulaire est déjà unique.
 */
const CLE_URL = { filtre: 'filter', rubrique: 'rubrique', page: 'page' };

/**
 * Lit l'état d'une requête HTTP.
 *
 * @param {object} query - `req.query`
 * @param {'nom'|'documents'} mode - la page, qui porte le mode
 */
export function lireEtat(query = {}, mode = 'nom') {
  const requete = parseQuery(query.q);
  const page = Math.trunc(Number(query.page));

  return {
    mode: MODES[mode] ? mode : 'nom',
    requete: requete.raw,
    tropCourt: requete.tooShort,
    filtre: parseFilter(query.filter),
    rubrique: normaliserRubrique(query.rubrique),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/**
 * Une URL, dérivée de l'état et non écrite de mémoire.
 *
 * `lien(etat, { rubrique: '4.5' })` repart de l'état courant et n'en change
 * qu'une clé. Passer `null` retire une clé — c'est ainsi que le jeton de
 * filtre se défait.
 *
 * Tout changement autre que la page remet la page à 1 : changer de rubrique
 * en restant à la page 3 mène sur une page vide, et une page vide au milieu
 * d'un jeu de résultats se lit comme une panne.
 */
export function lien(etat, changements = {}) {
  const suite = { ...etat, ...changements };
  const cles = Object.keys(changements);
  if (cles.length > 0 && !cles.every((c) => c === 'page')) suite.page = 1;

  const mode = MODES[suite.mode] ? suite.mode : 'nom';
  const params = new URLSearchParams();
  if (suite.requete) params.set('q', suite.requete);

  for (const champ of MODES[mode].porte) {
    const valeur = suite[champ];
    if (valeur === null || valeur === undefined || valeur === '') continue;
    if (valeur === DEFAUTS[champ]) continue;
    params.set(CLE_URL[champ], String(valeur));
  }

  const chaine = params.toString();
  return chaine ? `${MODES[mode].chemin}?${chaine}` : MODES[mode].chemin;
}

/**
 * Le titre de la page, déduit de l'état.
 *
 * Aucune route n'en passait : toutes les recherches s'appelaient « Demander à
 * Kevin » dans l'historique, les onglets et les favoris.
 */
export function titre(etat) {
  if (!etat.requete) return 'Demander à Kevin';
  const restriction = etat.mode === 'documents' && etat.rubrique
    ? ` — rubrique ${etat.rubrique}`
    : '';
  return `« ${etat.requete} »${restriction} · Demander à Kevin`;
}
