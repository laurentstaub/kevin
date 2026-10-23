/**
 * État d'une recherche, en un seul objet. L'URL est l'état : ni magasin client,
 * ni session. Les liens se dérivent de l'état au lieu d'être recomposés à la main.
 * Le décompte, dérivé, n'y figure pas.
 */

import { parseQuery, parseFilter } from './validate.js';
import { normaliserRubrique } from './recherche-texte.js';
import { MARQUE } from './referencement.js';

/**
 * Modes (encodés par la page) et paramètres que chacun porte. Changer de mode
 * abandonne volontairement les paramètres que le mode d'arrivée ne connaît pas.
 */
export const MODES = {
  nom: { chemin: '/search', porte: ['filtre'] },
  documents: { chemin: '/documents', porte: ['rubrique', 'page', 'molecule', 'question', 'ia', 'brut'] },
};

/** Valeurs par défaut, omises de l'URL. */
const DEFAUTS = { filtre: 'all', page: 1 };

/** Noms des paramètres d'URL, inchangés pour ne pas casser les liens partagés. */
const CLE_URL = {
  filtre: 'filter', rubrique: 'rubrique', page: 'page',
  // Saisie réorientée : médicament reconnu, saisie d'origine, par l'IA ou non, refus (« tel quel »).
  molecule: 'molecule', question: 'question', ia: 'ia', brut: 'brut',
};

/** Texte libre d'URL, borné ; vide → null (omis). */
const borne = (valeur, max) => String(valeur ?? '').trim().slice(0, max) || null;

/**
 * Lit l'état d'une requête HTTP.
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
    molecule: borne(query.molecule, 80),
    question: borne(query.question, 300),
    ia: query.ia === '1' ? '1' : null,
    brut: query.brut === '1' ? '1' : null,
  };
}

/**
 * URL dérivée de l'état courant, ex. `lien(etat, { rubrique: '4.5' })` ; `null` retire une clé.
 * Tout changement autre que la page remet la page à 1 (sinon page vide).
 */
export function lien(etat, changements = {}) {
  const suite = { ...etat, ...changements };
  const cles = Object.keys(changements);
  if (cles.length > 0 && !cles.every((cle) => cle === 'page')) suite.page = 1;

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

/** Titre de la page (historique, onglets, favoris), déduit de l'état. */
export function titre(etat) {
  if (etat.question) return `« ${etat.question} » · ${MARQUE}`;
  if (!etat.requete) return MARQUE;
  const restriction = etat.mode === 'documents' && etat.rubrique
    ? ` — rubrique ${etat.rubrique}`
    : '';
  return `« ${etat.requete} »${restriction} · ${MARQUE}`;
}
