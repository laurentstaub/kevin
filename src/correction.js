/**
 * Fautes de frappe (« poso macogol », « paracetamol alaitement ») : un mot que
 * rien ne connaît (ni les noms de la BDPM, ni les mots du comptoir, ni le texte
 * des RCP) est rapproché du mot connu le plus ressemblant, par trigrammes,
 * comme pg_trgm. La correction n'est faite que si un candidat se détache
 * nettement ; la page l'annonce et propose la saisie telle quelle.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { deaccent } from './text.js';
import { CONCEPTS_DOCUMENT } from './concepts-document.js';
import { MOTS_HORS_RCP } from './interactions.js';

/** Ressemblance minimale, et écart minimal avec le second candidat. */
const SEUIL = 0.4;
const ECART = 0.08;
/**
 * Au-delà, un mot presque identique à un nom est corrigé même si un RCP
 * l'écrit : les RCP ont aussi leurs coquilles (« amoxiciline » y figure).
 */
const QUASI = 0.7;
/** En deçà, un mot n'est pas corrigé : trop court pour que la ressemblance veuille dire quelque chose. */
const LONGUEUR_MIN = 4;

const plier = (mot) => deaccent(String(mot ?? '')).toLowerCase();
/** Mots d'un texte, pliés, lettres seules. */
const motsDe = (texte) => plier(texte).split(/[^a-z]+/).filter((mot) => mot.length >= LONGUEUR_MIN);

/** Trigrammes d'un mot, à la manière de pg_trgm : deux blancs devant, un derrière. */
function trigrammes(mot) {
  const borde = `  ${mot} `;
  const ensemble = new Set();
  for (let i = 0; i < borde.length - 2; i += 1) ensemble.add(borde.slice(i, i + 3));
  return ensemble;
}

/** Ressemblance de deux mots : trigrammes communs sur trigrammes de l'un ou l'autre. */
export function ressemblance(mot1, mot2) {
  const [a, b] = [trigrammes(mot1), trigrammes(mot2)];
  let communs = 0;
  for (const tri of a) if (b.has(tri)) communs += 1;
  return communs / (a.size + b.size - communs);
}

/**
 * Le mot connu le plus proche, s'il se détache : au-dessus du seuil, et plus
 * proche que le second d'un écart net. Les mots d'une même famille
 * (« doliprane », « dolipranetabs ») ne se concurrencent pas.
 * @param {string} mot  plié
 * @param {string[]} connus
 */
export function plusProche(mot, connus, seuil = SEUIL) {
  const scores = connus
    .map((connu) => ({ connu, score: ressemblance(mot, connu) }))
    .filter(({ score }) => score >= SEUIL / 2)
    .sort((score1, score2) => score2.score - score1.score);
  const [premier] = scores;
  if (!premier || premier.score < seuil) return null;
  const second = scores.find(({ connu }) => !connu.startsWith(premier.connu) && !premier.connu.startsWith(connu));
  return !second || premier.score - second.score >= ECART ? premier.connu : null;
}

// ------------------------------------------------------------ les dictionnaires

/** Mots du comptoir et du thésaurus : peu nombreux, essayés d'abord. */
const COMPTOIR = (() => {
  const { groupes } = JSON.parse(readFileSync(path.join(ROOT, 'data', 'thesaurus.json'), 'utf8'));
  return [...new Set([
    ...CONCEPTS_DOCUMENT.flatMap(({ mots, formes }) => [...mots, ...formes]),
    ...groupes.flat(),
    ...MOTS_HORS_RCP,
  ].flatMap(motsDe))];
})();
const COMPTOIR_CONNUS = new Set(COMPTOIR);

/** Noms de la BDPM : premier mot des dénominations, mots des substances. Lus une fois. */
let noms = null;
async function nomsDe(pool) {
  if (noms) return noms;
  const { rows } = await pool.query(
    `SELECT DISTINCT mot FROM (
       SELECT public.f_unaccent(lower(split_part(denomination_medicament, ' ', 1))) AS mot FROM dbpm.cis_bdpm
       UNION
       SELECT unnest(regexp_split_to_array(public.f_unaccent(lower(denomination_substance)), '[^a-z]+'))
       FROM dbpm.cis_compo_bdpm WHERE nature_composant = 'SA'
     ) m
     WHERE mot ~ '^[a-z]{4,}$'`,
  );
  noms = rows.map((row) => row.mot).filter(Boolean);
  noms.connus = new Set(noms);
  return noms;
}

/** Pour les tests. */
export function oublierNoms() {
  noms = null;
}

/** En deçà de ce nombre de rubriques, un mot des RCP peut être une de leurs coquilles. */
const RARE = 5;

/**
 * Ce que le texte des RCP dit des mots : courants (mots vides compris) ou
 * rares. Un mot courant n'est pas une faute, même absent des noms
 * (« combien », « thyroïde ») ; un mot rare peut être une coquille d'un RCP.
 * @returns {Promise<{ courants: Set<string>, rares: Set<string> }>}
 */
async function connusDesRcp(pool, mots) {
  if (mots.length === 0) return { courants: new Set(), rares: new Set() };
  const { rows } = await pool.query(
    `SELECT mot, numnode(plainto_tsquery('french_nu', mot)) = 0 AS vide,
            (SELECT count(*) FROM (SELECT 1 FROM docs.rcp_sections
                                   WHERE vecteur @@ plainto_tsquery('french_nu', mot) LIMIT ${RARE}) t)::int AS nombre
     FROM unnest($1::text[]) AS mot`,
    [mots],
  );
  return {
    courants: new Set(rows.filter((row) => row.vide || row.nombre >= RARE).map((row) => row.mot)),
    rares: new Set(rows.filter((row) => !row.vide && row.nombre > 0 && row.nombre < RARE).map((row) => row.mot)),
  };
}

/**
 * La saisie corrigée, ou null si rien n'est à corriger.
 * @returns {Promise<{ texte: string, corrections: { de: string, vers: string }[] }|null>}
 */
export async function corriger(pool, saisie) {
  const morceaux = String(saisie ?? '').split(/(\s+)/);
  const dictionnaire = await nomsDe(pool);
  // Sans les noms de la base, impossible de juger ce qui est une faute.
  if (dictionnaire.length === 0) {
    noms = null;
    return null;
  }
  const candidats = [...new Set(morceaux
    .map((morceau) => plier(morceau).replace(/[^a-z]/g, ''))
    .filter((mot) => mot.length >= LONGUEUR_MIN && !dictionnaire.connus.has(mot) && !COMPTOIR_CONNUS.has(mot)))];
  if (candidats.length === 0) return null;
  const { courants, rares } = await connusDesRcp(pool, candidats);

  const corrections = [];
  const texte = morceaux.map((morceau) => {
    const mot = plier(morceau).replace(/[^a-z]/g, '');
    if (!candidats.includes(mot) || courants.has(mot)) return morceau;
    // Les mots du comptoir d'abord (« alaitement »), puis les noms (« macogol ») ;
    // un mot rare des RCP seulement s'il est presque un nom.
    const vers = rares.has(mot)
      ? plusProche(mot, dictionnaire, QUASI)
      : plusProche(mot, COMPTOIR) ?? plusProche(mot, dictionnaire);
    if (!vers) return morceau;
    corrections.push({ de: morceau.trim(), vers });
    return vers;
  }).join('');
  return corrections.length ? { texte, corrections } : null;
}
