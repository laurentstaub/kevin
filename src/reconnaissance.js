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

/** Unités de dose : le nombre qui les précède est un dosage (« 1000 mg de paracétamol »). */
const UNITES_DOSE = new Set(['mg', 'g', 'ug', 'mcg', 'ui']);

/**
 * Formes que porte la dénomination (« suppositoire », « poudre pour solution
 * buvable ») : elles restreignent le médicament au lieu d'être cherchées dans
 * le texte. Pas « retard », « flacon », « lp » : absents des noms BDPM.
 */
const FORMES_NOM = new Set([
  'comprime', 'gelule', 'capsule', 'sirop', 'solution', 'suspension', 'injectable', 'buvable',
  'suppositoire', 'sachet', 'poudre', 'creme', 'pommade', 'collyre', 'goutte', 'ampoule', 'patch',
  'orodispersible', 'effervescent', 'gel', 'inhalation', 'perfusion',
]);

/** « suppositoires » → « suppositoire » ; null si ce n'est pas une forme du nom. */
const formeDuNom = (mot) => {
  if (FORMES_NOM.has(mot)) return mot;
  const singulier = mot.replace(/s$/, '');
  return FORMES_NOM.has(singulier) ? singulier : null;
};

/** « 300 », « 2,4 », « 1000mg » → le nombre, virgule décimale ; null sinon. */
const NOMBRE = /^(\d+(?:[.,]\d+)?)(mg|g|µg|ug|mcg|ui|%)?$/i;

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

/** « 1000mg », « 2.4 » → « 1000 », « 2,4 » : le nombre tel que l'écrit la BDPM. */
const enChiffres = (mot) => mot.match(NOMBRE)[1].replace('.', ',');

/** Texte → ses nombres entiers entre espaces : « 500 mg/4 mg » → « 500 mg 4 mg ». */
const enNombres = (expr) => `' ' || regexp_replace(regexp_replace(public.f_unaccent(lower(${expr})),
  '([0-9])([a-z])', '\\1 \\2', 'g'), '[^a-z0-9,]+', ' ', 'g') || ' '`;

/** Tous les mots du médicament figurent dans `expr`. */
const tousLesMots = (expr) => `(SELECT bool_and(public.f_unaccent(lower(${expr})) LIKE '%' || mot || '%')
  FROM unnest(mots.liste) AS mot)`;

/**
 * Parmi `nombres`, les dosages connus du médicament. Une substance
 * (« paracetamol ») : son propre dosage dans la composition, pas celui d'une
 * autre substance de l'association (HUMEXLIB 500 mg/4 mg n'est pas un
 * paracétamol 4). Une marque (« doliprane ») : un nombre entier de sa
 * dénomination (300, pas 3). Dans les deux cas, la dénomination porte le
 * nombre, car c'est sur elle que filtre la recherche dans les documents.
 *
 * @param {string} molecule - mots reconnus, « doliprane », « acide folique »
 * @returns {Promise<Set<string>>}
 */
async function dosagesConnus(pool, molecule, nombres) {
  // Le mot le plus long, sélectif, passe par l'index trigramme ; les autres ensuite.
  const pivot = molecule.split(' ').reduce((long, mot) => (mot.length > long.length ? mot : long), '');
  const { rows } = await pool.query(
    `WITH mots AS (SELECT array_remove(string_to_array($1::text, ' '), '') AS liste),
     substance AS (
       SELECT EXISTS (SELECT 1 FROM dbpm.cis_compo_bdpm s
                      WHERE s.nature_composant = 'SA'
                        AND public.f_unaccent(lower(s.denomination_substance)) LIKE '%' || $3 || '%'
                        AND ${tousLesMots('s.denomination_substance')}) AS oui
       FROM mots
     ),
     candidats AS MATERIALIZED (
       SELECT m.denomination_medicament AS nom, NULL::text AS dosage
       FROM dbpm.cis_bdpm m, mots, substance
       WHERE NOT substance.oui
         AND public.f_unaccent(lower(m.denomination_medicament)) LIKE '%' || $3 || '%'
         AND ${tousLesMots('m.denomination_medicament')}
       UNION ALL
       SELECT m.denomination_medicament, coalesce(c.dosage_substance, '')
       FROM dbpm.cis_compo_bdpm c
       JOIN dbpm.cis_bdpm m ON m.code_cis = c.code_cis, mots, substance
       WHERE substance.oui
         AND public.f_unaccent(lower(c.denomination_substance)) LIKE '%' || $3 || '%'
         AND ${tousLesMots('c.denomination_substance')}
     )
     SELECT n AS nombre FROM unnest($2::text[]) AS n
     WHERE EXISTS (
       SELECT 1 FROM candidats k
       WHERE ${enNombres('k.nom')} LIKE '% ' || n || ' %'
         AND (k.dosage IS NULL OR ${enNombres('k.dosage')} LIKE '% ' || n || ' %'))`,
    [molecule, nombres, pivot],
  );
  return new Set(rows.map((ligne) => ligne.nombre));
}

/** Élisions (« l'acide », « d'aspirine ») : le mot seul, sans son article. */
const sansElision = (mot) => mot.replace(/^(?:[ldjmnstc]|qu)['’](?=\S)/, '');

/** Mot qui peut désigner un médicament : un mot plus court reste du texte. */
const eligible = (mot) => mot.length >= LONGUEUR_MIN && /^[a-z]/.test(mot);

/**
 * Noms courants remplacés par leur substance (« aspirine allaitement » →
 * « acide acetylsalicylique allaitement »), sauf dans une paire de mots que la
 * base connaît telle quelle, début de nom de spécialité surtout : « aspirine
 * upsa » est ASPIRINE UPSA, pas l'acide acétylsalicylique suivi d'un mot à
 * chercher dans les documents. La base n'est interrogée que si un nom courant
 * jouxte un autre mot.
 */
export async function substituerHorsMarques(pool, saisie) {
  const bruts = String(saisie ?? '').split(/\s+/).filter(Boolean).map(sansElision);
  const mots = bruts.map(normaliser);
  const paires = mots.slice(0, -1).map((mot, i) => {
    const paire = `${mot} ${mots[i + 1]}`;
    return eligible(mot) && eligible(mots[i + 1]) && substituer(paire) !== paire ? paire : null;
  });
  const marques = paires.some(Boolean) ? await mesurer(pool, [...new Set(paires.filter(Boolean))]) : new Set();

  // Les marques telles que saisies ; entre elles, la substitution habituelle.
  const morceaux = [];
  let courant = [];
  for (let i = 0; i < bruts.length; i += 1) {
    if (paires[i] && marques.has(paires[i])) {
      if (courant.length) morceaux.push(substituer(courant.join(' ')));
      morceaux.push(`${mots[i]} ${mots[i + 1]}`);
      courant = [];
      i += 1;
    } else {
      courant.push(bruts[i]);
    }
  }
  if (courant.length) morceaux.push(substituer(courant.join(' ')));
  return morceaux.join(' ');
}

/**
 * Repère, dans l'ordre de la saisie, les mots ou paires de mots que la base
 * connaît comme substance ou début de nom de spécialité.
 * @returns {Promise<{ originaux: string[], pris: boolean[], molecule: string[] }|null>}
 */
async function reperer(pool, saisie) {
  // « aspirine allaitement » : la base ne connaît que l'acide acétylsalicylique.
  const originaux = (await substituerHorsMarques(pool, saisie)).split(/\s+/).filter(Boolean).map(sansElision);
  const mots = originaux.map(normaliser);
  if (mots.length < 2) return null;

  // Paires d'abord (« acide folique »), puis mots seuls ; les mots trop courts restent du texte.
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
  return { originaux, pris, molecule };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} saisie
 * @returns {Promise<{ molecule: string, reste: string }|null>} null : aucun médicament ;
 *   reste vide : un nom seul (dosage, forme), à chercher par nom
 */
export async function reconnaitreMedicament(pool, saisie) {
  const repere = await reperer(pool, saisie);
  if (!repere) return null;
  const { originaux, pris, molecule } = repere;

  const restant = originaux.map((mot, i) => (pris[i] ? null : mot.replace(/[?!,;.]+$/, '')));
  // Que des nombres, unités ou formes : c'est un nom de spécialité, pas une question sur elle.
  const texte = restant.some((mot) => mot && motDeTexte(normaliser(mot)));
  if (!texte) return { molecule: molecule.join(' '), reste: '' };

  // Dosage et forme précisent le médicament : « doliprane 300 excipients » cherche
  // « excipients » dans les seuls Doliprane 300. Un nombre suivi d'une unité de
  // dose est un dosage ; un nombre seul juste après le nom ne l'est que si la base
  // connaît ce dosage pour ce médicament : « doliprane 3 ans » garde « 3 ans ».
  const dose = (i) => {
    const suivant = restant[i + 1];
    return Boolean(restant[i].match(NOMBRE)[2]) || suivant === '%' || UNITES_DOSE.has(normaliser(suivant));
  };
  const nus = restant
    .map((mot, i) => (mot && NOMBRE.test(mot) && pris[i - 1] && !dose(i) ? i : null))
    .filter((i) => i !== null);
  const connus = nus.length > 0
    ? await dosagesConnus(pool, molecule.join(' '), nus.map((i) => enChiffres(restant[i])))
    : new Set();

  const precisions = [];
  restant.forEach((mot, i) => {
    if (!mot) return;
    const nombre = mot.match(NOMBRE);
    if (nombre) {
      if (dose(i) || connus.has(enChiffres(mot))) {
        const suivant = restant[i + 1];
        precisions.push(enChiffres(mot));
        restant[i] = null;
        if (!nombre[2] && (suivant === '%' || UNITES.has(normaliser(suivant)))) restant[i + 1] = null;
      }
      return;
    }
    const forme = formeDuNom(normaliser(mot));
    if (forme) {
      precisions.push(forme);
      restant[i] = null;
    }
  });

  return { molecule: [...molecule, ...precisions].join(' '), reste: restant.filter(Boolean).join(' ') };
}

/** Mots qui lient deux médicaments sans rien demander d'autre : « doliprane et kardegic ». */
const LIAISONS = new Set([
  'et', 'avec', 'plus', 'ou', 'vs', 'versus', 'entre', 'associe', 'associes', 'associer',
  'association', 'interaction', 'interactions',
]);

/**
 * Plusieurs médicaments nommés séparément (« kardegic previscan », « tramadol +
 * sertraline ») et rien d'autre que des liaisons, dosages ou formes.
 * Une paire connue comme un seul nom (« acide folique ») reste un médicament.
 *
 * @returns {Promise<string[]|null>} les médicaments dans l'ordre de la saisie, ou null
 */
export async function reconnaitreMedicaments(pool, saisie) {
  // Les liaisons sont retirées avant la reconnaissance : « avec » figure dans
  // des noms de substance (« … avec adjuvant ») et serait pris pour un médicament.
  const sansLiaisons = String(saisie ?? '').replace(/[+,;/&]/g, ' ').split(/\s+/)
    .filter((mot) => !LIAISONS.has(normaliser(mot))).join(' ');
  const repere = await reperer(pool, sansLiaisons);
  if (!repere) return null;
  const medicaments = [...new Set(repere.molecule)];
  if (medicaments.length < 2) return null;
  const autres = repere.originaux
    .filter((_, i) => !repere.pris[i])
    .map(normaliser)
    .filter((mot) => mot && !NOMBRE.test(mot) && motDeTexte(mot));
  return autres.length === 0 ? medicaments : null;
}
