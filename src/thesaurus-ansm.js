/**
 * Groupes du thésaurus des interactions médicamenteuses de l'ANSM (version
 * finale du 15 septembre 2023), repris tels quels : le nom du groupe, ses
 * membres, sa description. C'est l'ANSM qui dit qu'une substance appartient à
 * un groupe, jamais Dr Kevin. Module pur : il lit le texte de `pdftotext -layout`.
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
