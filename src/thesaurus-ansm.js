/**
 * Groupes du thésaurus des interactions médicamenteuses de l'ANSM (version
 * finale du 15 septembre 2023), repris tels quels : le nom du groupe, ses
 * membres, sa description. C'est l'ANSM qui dit qu'une substance appartient à
 * un groupe, jamais Médipile. Module pur : il lit le texte de `pdftotext -layout`.
 *
 * Un groupe s'écrit, dans le thésaurus, en capitales à la marge, suivi d'une
 * description éventuelle puis de la liste de ses membres entre parenthèses,
 * avant ses interactions (« + … »). Une substance a la même tête, sans liste.
 */
import { deaccent } from './text.js';

/** Tête d'entrée : capitales à la marge (le nom d'un groupe peut tenir sur deux lignes). */
const TETE = /^[A-ZÀ-ÖØ-Ý0-9][A-ZÀ-ÖØ-Ý0-9 '’\-(),./&]*$/;

const estTete = (ligne) => TETE.test(ligne.trimEnd()) && ligne.trim().length > 2;

/** Découpe aux virgules de premier niveau : « sodium (bicarbonate de), trometamol ». */
function membresDe(liste) {
  const membres = [];
  let courant = '';
  let profondeur = 0;
  for (const car of liste) {
    if (car === '(') profondeur += 1;
    if (car === ')') profondeur -= 1;
    if (car === ',' && profondeur === 0) {
      membres.push(courant.trim());
      courant = '';
    } else {
      courant += car;
    }
  }
  if (courant.trim()) membres.push(courant.trim());
  return membres.filter(Boolean);
}

/**
 * @param {string} texte  sortie de `pdftotext -layout` du thésaurus
 * @returns {{ nom: string, membres: string[], description: string }[]} dans l'ordre du thésaurus
 */
export function lireGroupes(texte) {
  const lignes = String(texte ?? '').split('\n');
  const groupes = new Map();
  // Le thésaurus commence à sa première interaction ; avant, la page de garde.
  const premiere = lignes.findIndex((ligne) => ligne.startsWith('+'));

  for (let i = Math.max(0, premiere - 1); i < lignes.length; i += 1) {
    if (!estTete(lignes[i]) || estTete(lignes[i - 1] ?? '')) continue;
    // Nom sur une ou plusieurs lignes en capitales.
    let nom = lignes[i].trim();
    let j = i + 1;
    while (j < lignes.length && estTete(lignes[j])) {
      nom = `${nom} ${lignes[j].trim()}`;
      j += 1;
    }
    const bloc = [];
    for (; j < lignes.length && !lignes[j].startsWith('+') && !estTete(lignes[j]); j += 1) bloc.push(lignes[j]);
    const corps = bloc.join('\n');

    // La liste des membres : la première parenthèse en début de ligne, jusqu'à sa fermante.
    const debut = corps.search(/(^|\n)\s*\(/);
    if (debut < 0) continue;
    const ouvrante = corps.indexOf('(', debut);
    let profondeur = 0;
    let fermante = -1;
    for (let pos = ouvrante; pos < corps.length; pos += 1) {
      if (corps[pos] === '(') profondeur += 1;
      if (corps[pos] === ')') profondeur -= 1;
      if (profondeur === 0) { fermante = pos; break; }
    }
    if (fermante < 0) continue;
    const interieur = corps.slice(ouvrante + 1, fermante).replace(/\s+/g, ' ').trim();
    // « (voir aussi "bradycardisants") » renvoie ailleurs, ce n'est pas une liste.
    if (/^voir aussi/i.test(interieur)) continue;

    const description = `${corps.slice(0, debut)} ${corps.slice(fermante + 1)}`
      .replace(/Voir aussi :[\s\S]*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!groupes.has(nom)) groupes.set(nom, { nom, membres: membresDe(interieur), description });
  }
  return [...groupes.values()];
}

/** Identifiant stable d'un groupe : son nom, sans accents ni ponctuation. */
export const idGroupe = (nom) => deaccent(nom).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Mentions d'un nom qui précisent le groupe sans le nommer : « (SAUF SPIRAMYCINE) », « (Y COMPRIS COLLYRES) ». */
const PRECISION = /^(sauf|y compris|hors|voie|voies|doses?|sujet|et, par extrapolation|seuls|associ)/i;

/**
 * Formulations d'un groupe à chercher dans les RCP, toutes tirées du thésaurus :
 * son nom sans les précisions entre parenthèses, l'autre nom que la parenthèse
 * lui donne (« INHIBITEURS DE L'HMG-COA RÉDUCTASE (STATINES) »), et les
 * abréviations que le thésaurus emploie pour lui (`abreviations`).
 */
export function formulations(nom, abreviations = []) {
  const termes = [];
  const sansParentheses = nom.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim();
  if (sansParentheses) termes.push(sansParentheses);
  for (const [, dedans] of nom.matchAll(/\(([^()]*)\)/g)) {
    const alias = dedans.trim();
    if (!PRECISION.test(alias) && /^[A-ZÀ-ÖØ-Ý-]{5,}$/.test(alias)) termes.push(alias);
  }
  return [...new Set([...termes, ...abreviations])];
}

// ---------------------------------------------------------------- les couples

/** Niveaux du thésaurus, tels qu'il les écrit, du plus grave au moins grave. */
const NIVEAUX_ANSM = [
  ['ci', /^(?:CONTRE-INDICATION|CI)$/i],
  ['deconseillee', /^(?:ASSOCIATIONS? D[ÉE]CONSEILL[ÉE]ES?|ASDEC)$/i],
  ['pe', /^(?:PR[ÉE]CAUTIONS? D'EMPLOI|PE)$/i],
  ['apec', /^(?:[AÀ] PRENDRE EN COMPTE|APEC)$/i],
];

/** Codes d'un intitulé de niveau : « CI - ASDEC - APEC », « Association DECONSEILLEE ». */
export function niveauxAnsm(intitule) {
  return String(intitule ?? '').replace(/’/g, "'").split(/\s+-\s+/)
    .map((morceau) => NIVEAUX_ANSM.find(([, motif]) => motif.test(morceau.trim()))?.[0])
    .filter(Boolean);
}

/** Ligne de service : numéro de page seul, saut de page. */
const SERVICE = /^\s*\d{1,3}\s*$/;

/** Tête d'un couple : celle des groupes, plus les associations (« OMBITASVIR + PARITAPRÉVIR »). */
const TETE_COUPLE = /^[A-ZÀ-ÖØ-Ý0-9][A-ZÀ-ÖØ-Ý0-9 '’\-(),./&+]*$/;
const estTeteCouple = (ligne) => TETE_COUPLE.test(ligne.trimEnd()) && ligne.trim().length > 2;
/** Suite d'un nom « + … » trop long, en capitales, légèrement en retrait. */
const SUITE_NOM = /^ {1,4}[A-ZÀ-ÖØ-Ý0-9][A-ZÀ-ÖØ-Ý0-9 '’\-(),./&]*$/;

/**
 * Couples du thésaurus : sous une tête (substance ou groupe), chaque « + AUTRE »
 * avec, en deux colonnes, le mécanisme (gauche) et le niveau suivi de la
 * conduite à tenir (droite). Le texte est rendu tel quel, lignes recollées.
 *
 * @param {string} texte  sortie de `pdftotext -layout`
 * @returns {{ de: string, avec: string, niveau: string, niveaux: string[], mecanisme: string, conduite: string }[]}
 */
export function lireCouples(texte) {
  const lignes = String(texte ?? '').replace(/\f/g, '').split('\n');
  const couples = [];
  const premiere = lignes.findIndex((ligne) => ligne.startsWith('+'));
  let tete = null;

  for (let i = Math.max(0, premiere - 1); i < lignes.length; i += 1) {
    const ligne = lignes[i];
    if (estTeteCouple(ligne) && !ligne.startsWith('+')) {
      // Tête sur une ou plusieurs lignes.
      tete = estTeteCouple(lignes[i - 1] ?? '') && !lignes[i - 1].startsWith('+') && tete ? `${tete} ${ligne.trim()}` : ligne.trim();
      continue;
    }
    if (!ligne.startsWith('+') || !tete) continue;

    let avec = ligne.slice(1).trim();
    let j = i + 1;
    while (j < lignes.length && SUITE_NOM.test(lignes[j])) {
      avec = `${avec} ${lignes[j].trim()}`;
      j += 1;
    }
    const corps = [];
    for (; j < lignes.length; j += 1) {
      const suite = lignes[j];
      if (suite.startsWith('+') || (estTeteCouple(suite) && !/^\s/.test(suite)) || /^\s*Voir aussi/.test(suite)) break;
      if (!SERVICE.test(suite)) corps.push(suite);
    }

    // Colonne de droite : là où commence le niveau, sur la première ligne non vide.
    const premiereLigne = corps.find((suite) => suite.trim());
    const repere = premiereLigne?.match(/^(.*\S)\s{3,}(\S.*)$/);
    const colonne = repere ? repere[1].length + (premiereLigne.length - repere[1].length - repere[2].length) : null;
    const gauche = [];
    const droite = [];
    for (const suite of corps) {
      if (!suite.trim()) continue;
      if (colonne === null) { gauche.push(suite.trim()); continue; }
      const indent = suite.search(/\S/);
      if (indent >= colonne - 4) { droite.push(suite.trim()); continue; }
      const dernierBlanc = suite.lastIndexOf('  ', colonne + 2);
      if (suite.length > colonne - 2 && dernierBlanc > indent) {
        const debutDroite = suite.slice(dernierBlanc).search(/\S/) + dernierBlanc;
        if (debutDroite >= colonne - 4) {
          gauche.push(suite.slice(0, debutDroite).trim());
          droite.push(suite.slice(debutDroite).trim());
          continue;
        }
      }
      gauche.push(suite.trim());
    }

    const recoller = (morceaux) => morceaux.join(' ').replace(/(\p{L})- (\p{Ll})/gu, '$1$2').replace(/\s+/g, ' ').trim();
    const [niveau = '', ...conduite] = droite;
    couples.push({
      de: tete, avec, niveau: niveau.trim(), niveaux: niveauxAnsm(niveau),
      mecanisme: recoller(gauche), conduite: recoller(conduite),
    });
  }
  return couples;
}
