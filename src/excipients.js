/**
 * Excipients qui comptent au comptoir (intolérance, allergie, régime, enfant),
 * lus dans le RCP. Deux sources, deux rôles :
 *   - la rubrique 6.1 est la liste complète des excipients : c'est elle qui
 *     permet de dire « contient » et, lue, « sans » ;
 *   - la rubrique 2, à partir de « excipient(s) à effet notoire », donne la
 *     déclaration officielle, souvent avec la quantité : elle est citée.
 * Un RCP sans rubrique 6.1 découpée n'autorise aucune conclusion : « non lu ».
 * Le sodium n'est retenu que déclaré avec sa quantité (au moins 1 mmol, soit
 * 23 mg) : la 6.1 en cite partout à l'état de traces (croscarmellose sodique).
 *
 * Les motifs servent tels quels à Postgres (ARE) et à JavaScript, sur texte
 * minuscule sans accents ; un terme commence un mot.
 */
import { deaccent } from './text.js';
import { phrases } from './citations.js';

/**
 * `court` : la bande et les étiquettes ; `filtre` : proposé dans « sans … »
 * des alternatives. L'ordre est celui de l'affichage.
 */
export const EXCIPIENTS = [
  { id: 'lactose', libelle: 'Lactose', court: 'lactose', termes: ['lactose'], filtre: true },
  { id: 'gluten', libelle: 'Gluten (amidon de blé)', court: 'gluten', termes: ['amidon de ble', 'gluten'], filtre: true },
  { id: 'saccharose', libelle: 'Saccharose', court: 'saccharose', termes: ['saccharose', 'sucrose'], filtre: true },
  {
    id: 'fructose', libelle: 'Fructose ou polyols (sorbitol, maltitol…)', court: 'fructose/sorbitol',
    termes: ['fructose', 'sorbitol', 'maltitol', 'isomalt', 'e420', 'e953', 'e965'], filtre: true,
  },
  { id: 'aspartam', libelle: 'Aspartam (source de phénylalanine)', court: 'aspartam', termes: ['aspartam', 'e951'], filtre: true },
  { id: 'alcool', libelle: 'Alcool (éthanol)', court: 'alcool', termes: ['ethanol', 'alcool ethylique'], filtre: true },
  { id: 'arachide', libelle: 'Arachide', court: 'arachide', termes: ['arachide'], filtre: true },
  { id: 'soja', libelle: 'Soja', court: 'soja', termes: ['soja'], filtre: true },
  { id: 'gelatine', libelle: 'Gélatine (origine animale)', court: 'gélatine', termes: ['gelatine'], filtre: true },
  {
    id: 'parabens', libelle: 'Parahydroxybenzoates (parabens)', court: 'parabens',
    termes: ['parahydroxybenzoate', 'e214', 'e215', 'e216', 'e217', 'e218', 'e219'], filtre: true,
  },
  {
    id: 'azoiques', libelle: 'Colorants azoïques', court: 'colorant azoïque',
    termes: ['tartrazine', 'jaune orange s', 'azorubine', 'carmoisine', 'ponceau 4r', 'rouge allura',
      'noir brillant', 'e102', 'e110', 'e122', 'e124', 'e129', 'e151'],
    filtre: true,
  },
  { id: 'sulfites', libelle: 'Sulfites', court: 'sulfites', termes: ['sulfite', 'bisulfite', 'metabisulfite', 'disulfite'], filtre: true },
  { id: 'propylene', libelle: 'Propylène glycol', court: 'propylène glycol', termes: ['propylene glycol', 'propyleneglycol', 'e1520'], filtre: false },
];

/** Libellé du sodium déclaré, hors table : il ne se lit qu'avec sa quantité. */
export const SODIUM = { id: 'sodium', libelle: 'Sodium', court: 'sodium' };

/** Seuil de déclaration du sodium : 1 mmol par dose, soit 23 mg. */
const SODIUM_SEUIL_MG = 23;

/** Motif d'un excipient, commun à Postgres et à JavaScript (texte minuscule sans accents). */
export const motifExcipient = (excipient) => `(^|[^a-z0-9])(${excipient.termes.join('|')})`;

const REGEX = new Map(EXCIPIENTS.map((excipient) => [excipient.id, new RegExp(motifExcipient(excipient))]));

/** Minuscules sans accents, apostrophe droite, même longueur que l'entrée. */
const plier = (texte) => String(texte ?? '').split('')
  .map((car) => (car === '’' ? "'" : deaccent(car).toLowerCase()[0] ?? car))
  .join('');

/** Partie de la rubrique 2 qui déclare les excipients à effet notoire, ou ''. */
export function partieNotoire(texte) {
  const source = String(texte ?? '').replace(/\s+/g, ' ');
  const debut = plier(source).search(/effets? notoires?/);
  if (debut < 0) return '';
  // Jusqu'au renvoi vers la 6.1, qui clôt la déclaration.
  const fin = plier(source).indexOf('pour la liste complete', debut);
  return source.slice(debut, fin < 0 ? undefined : fin).trim();
}

/** Quantités d'une phrase, avec leur base : « 167,17 mg », « 500 mg/ml », « 100 mg/comprimé ». */
const QUANTITE = /(\d+(?:[  ]\d{3})*(?:[,.]\d+)?)\s*(?:mg|g|µg|microgrammes?|mmol|ml)(?![a-z])(?:\s*\/\s*(?:\d+(?:[,.]\d+)?\s*)?[a-zà-ÿ]+)?/gi;

/**
 * Teneur en sodium déclarée : « 456 mg de sodium », « sodium : 1,2 mmol ». Le
 * nombre vise le sodium lui-même : « 3 mg de benzoate de sodium » n'en est pas une.
 */
const TENEUR_SODIUM = [
  /(\d+(?:[  ]\d{3})*(?:[,.]\d+)?)\s*(mg|g|mmol)\s+(?:de\s+|d['’]\s*)?sodium/i,
  /sodium\s*(?::|\()\s*(\d+(?:[  ]\d{3})*(?:[,.]\d+)?)\s*(mg|g|mmol)/i,
];

/**
 * Quantité qui accompagne le terme trouvé : la plus proche avant lui (« 45 mg
 * de lactose »), sinon juste après (« lactose (100 mg/comprimé) »).
 */
export function quantite(phrase, regex) {
  const position = plier(phrase).search(regex);
  if (position < 0) return null;
  const trouvees = [...phrase.matchAll(QUANTITE)].map((qte) => ({ texte: qte[0].replace(/\s+/g, ' '), debut: qte.index, fin: qte.index + qte[0].length }));
  const avant = trouvees.filter((qte) => qte.fin <= position + 1 && position - qte.fin <= 40).pop();
  if (avant) return avant.texte;
  const apres = trouvees.find((qte) => qte.debut >= position && qte.debut - position <= 40);
  return apres?.texte ?? null;
}

/** Teneur en sodium d'une phrase, en milligrammes, et son libellé ; null sans teneur lisible. */
function teneurSodium(phrase) {
  const trouve = TENEUR_SODIUM.map((motif) => motif.exec(phrase)).find(Boolean);
  if (!trouve) return null;
  const [texte, nombre, unite] = trouve;
  const mg = enMg(nombre, unite);
  return mg === null ? null : { mg, texte: `${nombre} ${unite}`.replace(/\s+/g, ' '), brut: texte };
}

/** Valeur en milligrammes ; null si illisible. */
function enMg(nombre, unite) {
  const valeur = Number(nombre.replace(/[  ]/g, '').replace(',', '.'));
  if (!Number.isFinite(valeur)) return null;
  if (/^mmol$/i.test(unite)) return valeur * 23;
  return /^g$/i.test(unite) ? valeur * 1000 : valeur;
}

/**
 * Excipients d'un RCP.
 * @param {string|null} rubrique2   texte de la rubrique 2
 * @param {string|null} rubrique61  texte de la rubrique 6.1
 * @returns {{ lu: boolean, declares: boolean, presents: Array<{ id, libelle, court, source: 'notoire'|'6.1', quantite: string|null, phrase: string|null }> }}
 *   `lu` : la 6.1 a été lue, une absence vaut « sans » ; `declares` : la rubrique 2 déclare des excipients à effet notoire
 */
export function lireExcipients(rubrique2, rubrique61) {
  const notoire = partieNotoire(rubrique2);
  const phrasesNotoire = notoire ? phrases(notoire) : [];
  const liste = plier(rubrique61 ?? '');
  const presents = [];

  for (const excipient of EXCIPIENTS) {
    const regex = REGEX.get(excipient.id);
    const phrase = phrasesNotoire.find((candidate) => regex.test(plier(candidate))) ?? null;
    if (!phrase && !regex.test(liste)) continue;
    presents.push({
      id: excipient.id, libelle: excipient.libelle, court: excipient.court,
      source: phrase ? 'notoire' : '6.1',
      quantite: phrase ? quantite(phrase, regex) : null,
      phrase,
    });
  }

  // Sodium : déclaré, chiffré, au-dessus du seuil, et pas « essentiellement sans sodium ».
  for (const phrase of phrasesNotoire) {
    if (/sans sodium/.test(plier(phrase))) continue;
    const teneur = teneurSodium(phrase);
    if (!teneur || teneur.mg < SODIUM_SEUIL_MG) continue;
    presents.push({ ...SODIUM, source: 'notoire', quantite: teneur.texte, phrase });
    break;
  }

  return { lu: liste.trim() !== '', declares: notoire !== '', presents };
}

/** Rubriques 2 et 6.1 d'une spécialité, le RCP HTML de préférence au PDF converti. */
export async function getExcipients(pool, cis) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (numero) numero, texte
     FROM docs.rcp_sections
     WHERE code_cis = $1 AND numero IN ('2', '6.1') AND document_type <> 'notice'
     ORDER BY numero, (document_type = 'rcp') DESC, position`,
    [cis],
  );
  const texte = (numero) => rows.find((row) => row.numero === numero)?.texte ?? null;
  return lireExcipients(texte('2'), texte('6.1'));
}

/**
 * Excipients filtrables de plusieurs spécialités, calculés en base : une
 * fiche peut proposer quatre cents alternatives, on ne rapatrie pas leurs textes.
 * @returns {Promise<Map<string, { lu: boolean, presents: Set<string> }>>}
 */
export async function excipientsDe(pool, cisListe) {
  if (cisListe.length === 0) return new Map();
  const { rows } = await pool.query(
    `WITH t AS (
       SELECT code_cis,
              string_agg(CASE WHEN numero = '6.1' THEN public.f_unaccent(lower(texte)) END, ' ') AS liste,
              string_agg(CASE WHEN numero = '2' THEN public.f_unaccent(lower(texte)) END, ' ') AS r2
       FROM docs.rcp_sections
       WHERE code_cis = ANY($1::text[]) AND numero IN ('2', '6.1') AND document_type <> 'notice'
       GROUP BY code_cis
     )
     SELECT t.code_cis, t.liste IS NOT NULL AS lu,
            ARRAY(SELECT e.id FROM unnest($2::text[], $3::text[]) AS e(id, motif)
                  WHERE coalesce(t.liste, '') || ' '
                        || coalesce(substring(t.r2 from 'effets? notoires?.*'), '') ~ e.motif) AS presents
     FROM t`,
    [cisListe, EXCIPIENTS.map((excipient) => excipient.id), EXCIPIENTS.map(motifExcipient)],
  );
  return new Map(rows.map((row) => [row.code_cis, { lu: row.lu, presents: new Set(row.presents) }]));
}

// ------------------------------------------------------- les alternatives

const FILTRABLES = EXCIPIENTS.filter((excipient) => excipient.filtre);

/** `?sans=lactose,gluten` → identifiants filtrables connus, dans l'ordre de la table. */
export function lireSans(parametre) {
  const demandes = new Set([parametre].flat().join(',').split(',').map((id) => id.trim()));
  return FILTRABLES.filter((excipient) => demandes.has(excipient.id)).map((excipient) => excipient.id);
}

/** Spécialités proposées par les alternatives, hors écartées. */
export function cisDesAlternatives(categories) {
  return (categories ?? [])
    .filter((categorie) => categorie.cle !== 'BLOQUE')
    .flatMap((categorie) => [
      ...(categorie.lignes ?? []),
      ...(categorie.molecules ?? []).flatMap((molecule) => molecule.specialites),
    ])
    .map((item) => String(item.id));
}

/**
 * Excipients des alternatives et filtre « sans … ». Chaque candidat porte ses
 * excipients filtrables ; ceux qui contiennent un excipient écarté sont retirés
 * et comptés. Un candidat dont la 6.1 n'a pas été lue reste, marqué « non lu » :
 * on ne le dit ni avec ni sans.
 *
 * Un filtre n'est proposé que s'il sépare les candidats (certains en
 * contiennent, d'autres non), ou s'il est déjà actif.
 *
 * @param {object[]} categories  sortie de regrouperAlternatives
 * @param {Map<string, { lu: boolean, presents: Set<string> }>} profils  sortie de excipientsDe
 * @param {string[]} sans  sortie de lireSans
 * @param {Set<string>} [duProduit]  excipients du produit consulté, signalés dans les filtres
 */
export function filtrerAlternatives(categories, profils, sans, duProduit = new Set()) {
  const profil = (item) => profils.get(String(item.id)) ?? { lu: false, presents: new Set() };
  const marquer = (item) => {
    const { lu, presents } = profil(item);
    return { ...item, excipients: { lu, courts: FILTRABLES.filter((excipient) => presents.has(excipient.id)).map((excipient) => excipient.court) } };
  };
  const ecarte = (item) => sans.some((id) => profil(item).presents.has(id));

  const candidats = cisDesAlternatives(categories).map((id) => profil({ id }));
  const filtres = FILTRABLES
    .map((excipient) => ({
      id: excipient.id,
      court: excipient.court,
      actif: sans.includes(excipient.id),
      dansProduit: duProduit.has(excipient.id),
      avec: candidats.filter((candidat) => candidat.presents.has(excipient.id)).length,
      sans: candidats.filter((candidat) => candidat.lu && !candidat.presents.has(excipient.id)).length,
    }))
    .filter((filtre) => filtre.actif || (filtre.avec > 0 && filtre.sans > 0))
    // Ce que contient le produit consulté d'abord : c'est la question posée.
    .sort((f1, f2) => Number(f2.dansProduit) - Number(f1.dansProduit));

  let masques = 0;
  const garder = (items) => items.filter((item) => {
    if (!ecarte(item)) return true;
    masques += 1;
    return false;
  }).map(marquer);

  const filtrees = (categories ?? []).map((categorie) => {
    if (categorie.cle === 'BLOQUE') return categorie;
    if (categorie.molecules) {
      const molecules = categorie.molecules
        .map((molecule) => ({ ...molecule, specialites: garder(molecule.specialites) }))
        .filter((molecule) => molecule.specialites.length > 0);
      const total = molecules.reduce((somme, molecule) => somme + molecule.specialites.length, 0);
      return total > 0 ? { ...categorie, molecules, total } : null;
    }
    const lignes = garder(categorie.lignes ?? []);
    return lignes.length > 0 ? { ...categorie, lignes } : null;
  }).filter(Boolean);

  return { categories: filtrees, filtres, sans, masques };
}
