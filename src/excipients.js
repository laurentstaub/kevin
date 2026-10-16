/**
 * Excipients à effet notoire, lus dans le RCP. La liste est celle de l'annexe
 * européenne (EMA/CHMP/302620/2017 Rev. 1), reprise telle quelle
 * (data/excipients-ema/annexe.json) ; seuls les termes français qui servent à
 * les chercher sont une traduction (data/excipients-ema/francais.json).
 * Deux sources dans le RCP, deux rôles :
 *   - la rubrique 2, à partir de « excipient(s) à effet notoire », est la
 *     déclaration du RCP : c'est elle que la fiche affiche, citée ;
 *   - la rubrique 6.1 est la liste complète des excipients : elle dit
 *     « contient » et, lue, « sans », pour filtrer les alternatives.
 * Un RCP sans rubrique 6.1 découpée n'autorise aucune conclusion : « non lu ».
 * Sodium et potassium, que la 6.1 cite partout à l'état de traces, ne sont
 * retenus que déclarés avec une teneur d'au moins 1 mmol par dose (le seuil de
 * l'annexe).
 *
 * Les motifs servent tels quels à Postgres (ARE) et à JavaScript, sur texte
 * minuscule sans accents ; un terme commence un mot.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { deaccent } from './text.js';
import { phrases } from './citations.js';

const lireDonnees = (fichier) => JSON.parse(readFileSync(path.join(ROOT, 'data', 'excipients-ema', fichier), 'utf8'));

/** L'annexe européenne, telle qu'extraite. */
export const ANNEXE = lireDonnees('annexe.json');
const FRANCAIS = lireDonnees('francais.json').excipients;

/** « E 951 » de l'annexe → motif qui trouve « E 951 » comme « E951 » dans un RCP plié. */
const motifNumero = (numero) => `e ?${numero.replace(/^E\s*/, '')}`;

/**
 * Un excipient de l'annexe, avec ses termes français et ses numéros E.
 * `filtre` : proposé dans « sans … » des alternatives quand l'annexe le dit
 * notoire dès la moindre quantité (seuil « Zero ») pour une voie au moins.
 */
const decrire = (entree) => {
  const francais = FRANCAIS[entree.nom];
  if (!francais) throw new Error(`excipient de l'annexe sans correspondance française : ${entree.nom}`);
  return {
    id: francais.id,
    nom: entree.nom,
    libelle: francais.libelle,
    court: francais.court,
    termes: [...(francais.termes ?? []), ...entree.numeros.map(motifNumero)],
    voies: entree.lignes,
    filtre: entree.lignes.some((ligne) => ligne.seuil === 'Zero'),
    teneur: Boolean(francais.teneur),
  };
};

const TOUS = ANNEXE.excipients.map(decrire);

/** Excipients cherchés par leur nom ; l'ordre est celui de l'annexe. */
export const EXCIPIENTS = TOUS.filter((excipient) => !excipient.teneur);

/** Excipients lus par leur teneur déclarée : sodium et potassium, 1 mmol par dose. */
const TENEURS = TOUS.filter((excipient) => excipient.teneur).map((excipient) => ({
  ...excipient,
  // Masse d'une mmole : 23 mg de sodium, 39 mg de potassium.
  mgParMmol: excipient.id === 'sodium' ? 23 : 39,
}));

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
 * Teneur déclarée d'un ion : « 456 mg de sodium », « sodium : 1,2 mmol ». Le
 * nombre vise l'ion lui-même : « 3 mg de benzoate de sodium » n'en est pas une.
 */
const motifsTeneur = (ion) => [
  new RegExp(`(\\d+(?:[  ]\\d{3})*(?:[,.]\\d+)?)\\s*(mg|g|mmol)\\s+(?:de\\s+|d['’]\\s*)?${ion}`, 'i'),
  new RegExp(`${ion}\\s*(?::|\\()\\s*(\\d+(?:[  ]\\d{3})*(?:[,.]\\d+)?)\\s*(mg|g|mmol)`, 'i'),
];

/**
 * Quantité qui accompagne le terme trouvé : la plus proche avant lui (« 45 mg
 * de lactose »), sinon juste après (« lactose (100 mg/comprimé) »).
 */
export function quantite(phrase, regex) {
  const position = plier(phrase).search(regex);
  if (position < 0) return null;
  const trouvees = [...phrase.matchAll(QUANTITE)].map((qte) => ({ texte: qte[0].replace(/\s+/g, ' '), debut: qte.index, fin: qte.index + qte[0].length }));
  // Une quantité séparée du terme par « et », une virgule ou un point-virgule
  // appartient à l'excipient précédent : « sorbitol (500 mg/ml) et benzoate (3 mg/ml) ».
  const avant = trouvees
    .filter((qte) => qte.fin <= position + 1 && position - qte.fin <= 40)
    .filter((qte) => !/(\bet\b|[,;])/.test(phrase.slice(qte.fin, position)))
    .pop();
  if (avant) return avant.texte;
  const apres = trouvees.find((qte) => qte.debut >= position && qte.debut - position <= 40);
  return apres?.texte ?? null;
}

/** Teneur d'un ion dans une phrase, en milligrammes, et son libellé ; null sans teneur lisible. */
function teneur(phrase, ion) {
  const trouve = motifsTeneur(ion.id).map((motif) => motif.exec(phrase)).find(Boolean);
  if (!trouve) return null;
  const [, nombre, unite] = trouve;
  const valeur = Number(nombre.replace(/[  ]/g, '').replace(',', '.'));
  if (!Number.isFinite(valeur)) return null;
  const mg = /^mmol$/i.test(unite) ? valeur * ion.mgParMmol : /^g$/i.test(unite) ? valeur * 1000 : valeur;
  return { mg, texte: `${nombre} ${unite}`.replace(/\s+/g, ' ') };
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

  // Sodium, potassium : déclarés, chiffrés, au moins 1 mmol, et pas « essentiellement sans sodium ».
  for (const ion of TENEURS) {
    for (const phrase of phrasesNotoire) {
      if (new RegExp(`sans ${ion.id}`).test(plier(phrase))) continue;
      const lue = teneur(phrase, ion);
      if (!lue || lue.mg < ion.mgParMmol) continue;
      presents.push({ id: ion.id, libelle: ion.libelle, court: ion.court, source: 'notoire', quantite: lue.texte, phrase });
      break;
    }
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

/**
 * Voies de la BDPM (« orale », « cutanée », « sous-cutanée »…) → mots des voies
 * de l'annexe (« Oral », « Topical », « Parenteral »…). Ce qui n'est ni oral,
 * ni local, ni inhalé est une injection ou une voie extracorporelle : parentérale.
 */
const VOIES = [
  [/^(orale|gastrique|gastro)/, ['oral']],
  [/^(sublinguale|voie buccale|buccogingivale|gingivale|dentaire)/, ['oral', 'oromucosal']],
  [/^(intraveineuse|intraarterielle|intracoronaire)/, ['parenteral', 'intravenous']],
  [/^(cutanee|transdermique)/, ['cutaneous', 'topical']],
  [/^ophtalmique/, ['ocular', 'topical']],
  [/^(nasale|endosinusale)/, ['nasal', 'topical']],
  [/^(inhalee|endotracheobronchique)/, ['inhalation']],
  [/^rectale/, ['rectal']],
  [/^vaginale/, ['vaginal']],
  [/^(auriculaire|urethrale)/, ['topical']],
  [/./, ['parenteral']],
];

/** Mots de voie de l'annexe pour les voies BDPM d'une spécialité (« orale;sublinguale »). */
export function voiesAnnexe(voiesBdpm) {
  const mots = new Set();
  for (const voie of String(voiesBdpm ?? '').split(';').map((nom) => plier(nom).trim()).filter(Boolean)) {
    for (const mot of VOIES.find(([motif]) => motif.test(voie))[1]) mots.add(mot);
  }
  return mots;
}

/**
 * L'annexe dit-elle cet excipient notoire dès la moindre quantité (« Zero »)
 * pour l'une de ces voies ? Sans voie connue, une seule ligne « Zero » suffit.
 */
export function notoirePour(excipient, mots) {
  return excipient.voies.some((ligne) => {
    if (ligne.seuil !== 'Zero') return false;
    const voie = ligne.voie.toLowerCase();
    return mots.size === 0 || /\ball\b/.test(voie) || [...mots].some((mot) => voie.includes(mot));
  });
}

/** `?sans=lactose,gluten` → identifiants filtrables connus, dans l'ordre de la table. */
export function lireSans(parametre) {
  const demandes = new Set([parametre].flat().join(',').split(',').map((id) => id.trim()));
  return FILTRABLES.filter((excipient) => demandes.has(excipient.id)).map((excipient) => excipient.id);
}

/** Lien des filtres d'alternatives : chaque lien garde les autres filtres actifs. */
export function lienAlternatives(sans, deglutition) {
  const parties = [sans.length ? `sans=${sans.join(',')}` : null, deglutition ? 'deglutition=1' : null].filter(Boolean);
  return `?${parties.join('&')}#alternatives`;
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
 * @param {string} [voiesProduit]  voies BDPM du produit consulté : un filtre n'est proposé que
 *   pour un excipient que l'annexe dit notoire par l'une d'elles ; de même, l'étiquette d'un
 *   candidat ne nomme que ce qui est notoire par ses propres voies
 */
export function filtrerAlternatives(categories, profils, sans, duProduit = new Set(), voiesProduit = '') {
  const profil = (item) => profils.get(String(item.id)) ?? { lu: false, presents: new Set() };
  const marquer = (item) => {
    const { lu, presents } = profil(item);
    const mots = voiesAnnexe(item.voies);
    const notoires = FILTRABLES.filter((excipient) => presents.has(excipient.id) && notoirePour(excipient, mots));
    return { ...item, excipients: { lu, courts: notoires.map((excipient) => excipient.court) } };
  };
  const ecarte = (item) => sans.some((id) => profil(item).presents.has(id));

  const candidats = cisDesAlternatives(categories).map((id) => profil({ id }));
  const motsProduit = voiesAnnexe(voiesProduit);
  const filtres = FILTRABLES
    .filter((excipient) => sans.includes(excipient.id) || notoirePour(excipient, motsProduit))
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
