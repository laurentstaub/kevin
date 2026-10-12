/**
 * Reconnaît un médicament dans une saisie courte (« paracetamol allaitement »)
 * sans IA : la base dit si un mot est une substance active ou le début d'un
 * nom de spécialité. Le reste de la saisie se cherche alors dans les documents
 * de ce seul médicament. Rien ne se passe si la saisie n'est qu'un nom
 * (« doliprane 1000 ») ou n'en contient aucun.
 */

import { deaccent } from './text.js';
import { substituer } from './synonymes.js';

/** Au-delà, le mot est un composant générique (« sodium », « chlorhydrate »), pas une molécule. */
const SUBSTANCES_MAX = 40;
/** Un mot plus court est trop ambigu (« eau », « fer » → formes, sels). */
const LONGUEUR_MIN = 4;

const UNITES = new Set(['mg', 'g', 'ml', 'l', 'ui', 'mcg', 'kg', 'mmol', 'meq', 'gbq', 'mbq', 'cp', 'lp']);
const FORMES = new Set([
  'comprime', 'comprimes', 'gelule', 'gelules', 'capsule', 'capsules', 'sirop', 'solution',
  'suspension', 'injectable', 'buvable', 'pellicule', 'pellicules', 'suppositoire',
  'suppositoires', 'sachet', 'sachets', 'poudre', 'creme', 'pommade', 'collyre', 'gouttes',
  'ampoule', 'ampoules', 'patch', 'orodispersible', 'effervescent', 'effervescents',
  'retard', 'gel', 'spray', 'inhalation', 'perfusion', 'flacon', 'boite',
]);

/** Mot comparable à la base : minuscules, sans accents ni ponctuation. */
export const normaliser = (mot) => deaccent(String(mot ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Mot qui vaut une recherche dans le texte : ni nombre, ni unité, ni forme. */
export const motDeTexte = (mot) => /^[a-z]{2,}$/.test(mot) && !UNITES.has(mot) && !FORMES.has(mot);

/**
 * Compte, pour chaque candidat, les substances dont il est un mot entier, et dit
 * s'il ouvre un nom de spécialité. Une seule requête ; les index trigrammes servent.
 */
async function mesurer(pool, candidats) {
  const { rows } = await pool.query(
    `SELECT mot,
            (SELECT count(DISTINCT c.code_substance)
             FROM dbpm.cis_compo_bdpm c
             WHERE c.nature_composant = 'SA'
               AND public.f_unaccent(lower(c.denomination_substance)) LIKE '%' || mot || '%'
               AND ' ' || regexp_replace(public.f_unaccent(lower(c.denomination_substance)), '[^a-z0-9]+', ' ', 'g') || ' '
                   LIKE '% ' || mot || ' %')::int AS substances,
            EXISTS (SELECT 1 FROM dbpm.cis_bdpm m
                    WHERE public.f_unaccent(lower(m.denomination_medicament)) LIKE mot || '%'
                      AND regexp_replace(public.f_unaccent(lower(m.denomination_medicament)), '[^a-z0-9]+', ' ', 'g') || ' '
                          LIKE mot || ' %') AS marque
     FROM unnest($1::text[]) AS mot`,
    [candidats],
  );
  const reconnus = new Set();
  for (const ligne of rows) {
    const substances = Number(ligne.substances);
    if (ligne.marque || (substances > 0 && substances <= SUBSTANCES_MAX)) reconnus.add(ligne.mot);
  }
  return reconnus;
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} saisie
 * @returns {Promise<{ molecule: string, reste: string }|null>} null : aucun médicament ;
 *   reste vide : un nom seul (dosage, forme), à chercher par nom
 */
export async function reconnaitreMedicament(pool, saisie) {
  // « aspirine allaitement » : la base ne connaît que l'acide acétylsalicylique.
  const originaux = substituer(saisie).split(/\s+/).filter(Boolean);
  const mots = originaux.map(normaliser);
  if (mots.length < 2) return null;

  // Paires d'abord (« acide folique »), puis mots seuls ; les mots trop courts restent du texte.
  const eligible = (mot) => mot.length >= LONGUEUR_MIN && /^[a-z]/.test(mot);
  const paires = mots.slice(0, -1).map((mot, i) => (eligible(mot) && eligible(mots[i + 1]) ? `${mot} ${mots[i + 1]}` : null));
  const candidats = [...new Set([...paires, ...mots.filter(eligible)].filter(Boolean))];
  if (candidats.length === 0) return null;

  const reconnus = await mesurer(pool, candidats);
  if (reconnus.size === 0) return null;

  const pris = new Array(mots.length).fill(false);
  const molecule = [];
  for (let i = 0; i < mots.length; i += 1) {
    if (pris[i]) continue;
    if (paires[i] && reconnus.has(paires[i])) {
      molecule.push(paires[i]);
      pris[i] = pris[i + 1] = true;
    } else if (reconnus.has(mots[i])) {
      molecule.push(mots[i]);
      pris[i] = true;
    }
  }
  if (molecule.length === 0) return null;

  const reste = originaux.filter((_, i) => !pris[i]).map((mot) => mot.replace(/[?!]+$/, '')).filter(Boolean);
  // Que des nombres, unités ou formes : c'est un nom de spécialité, pas une question sur elle.
  const texte = reste.some((mot) => motDeTexte(normaliser(mot)));

  return { molecule: molecule.join(' '), reste: texte ? reste.join(' ') : '' };
}
