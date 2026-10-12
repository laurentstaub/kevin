/**
 * Casse d'affichage des noms venus de la BDPM, qui écrit tout en capitales.
 *
 * Convention OMS : la DCI est un nom commun, en bas de casse (paracétamol) ;
 * la spécialité est un nom propre, avec capitale (Doliprane). Les sigles
 * (B12, NPH, IgG) gardent leur forme ; la liste est dans data/sigles.json.
 * Les données ne changent pas, la recherche non plus : tout se joue à l'affichage.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const SIGLES = JSON.parse(readFileSync(path.join(ROOT, 'data', 'sigles.json'), 'utf8'));

/** Mots-outils d'un nom propre composé : « Chlorhydrate de Tramadol Mylan ». */
const OUTILS = new Set(['DE', 'DU', 'DES', 'D\'', 'L\'', 'LA', 'LE', 'LES', 'ET', 'EN', 'AU', 'AUX',
  'POUR', 'SANS', 'AVEC', 'SUR', 'PAR']);

/** Tout en capitales, au moins deux lettres : ce que la BDPM a crié. */
const CRIE = /^[\p{Lu}][\p{Lu}'’-]+$/u;

/** Un chiffre ou une lettre seule : B12, vitamine A, D3. */
const sigle = (mot) => {
  const cle = mot.replace(/[’]/g, '\'');
  if (SIGLES[cle]) return SIGLES[cle];
  if (/\d/.test(mot) || mot.length === 1) return mot;
  return null;
};

const capitale = (mot) => mot.charAt(0).toUpperCase() + mot.slice(1).toLowerCase();

/** Traite chaque mot crié ; laisse le reste (dosage, forme, déjà en bas de casse). */
function parMot(texte, regle) {
  return String(texte ?? '').split(/(\s+|\+|\/|\(|\))/).map((mot) => {
    if (!CRIE.test(mot)) return mot;
    return sigle(mot) ?? regle(mot);
  }).join('');
}

/** DCI, substance, signature de molécule : « chlorhydrate de tramadol + paracétamol ». */
export function dci(texte) {
  return parMot(texte, (mot) => mot.toLowerCase());
}

/** Dénomination de spécialité : « Paracétamol Teva 500 mg, comprimé ».
 * Un mot de trois lettres au plus est un sigle de laboratoire (CCD, EG, BGR),
 * sauf mot-outil. */
export function specialite(texte) {
  let premier = true;
  return parMot(texte, (mot) => {
    let resultat = mot;
    if (!premier && OUTILS.has(mot)) resultat = mot.toLowerCase();
    else if (mot.length > 3) resultat = mot.split('-').map(capitale).join('-');
    premier = false;
    return resultat;
  });
}

/** Libellé de classe ATC : une phrase, capitale initiale. « Médicaments en cardiologie ». */
export function phrase(texte) {
  const bas = dci(texte);
  return bas.charAt(0).toUpperCase() + bas.slice(1);
}
