/**
 * Casse d'affichage des noms venus de la BDPM, qui écrit tout en capitales.
 *
 * Convention OMS : la DCI est un nom commun, en bas de casse (paracétamol) ;
 * la spécialité est un nom propre, avec capitale (Doliprane). Les sigles
 * (B12, NPH, IgG) gardent leur forme ; la liste est dans data/sigles.json.
 * Les accents que la BDPM omet (EZETIMIBE) sont rendus d'après data/accents.json,
 * déduit des RCP par scripts/accents.js.
 * Les données ne changent pas, la recherche non plus : tout se joue à l'affichage.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const lireJson = (nom) => {
  const fichier = path.join(ROOT, 'data', nom);
  return existsSync(fichier) ? JSON.parse(readFileSync(fichier, 'utf8')) : {};
};

const SIGLES = lireJson('sigles.json');
const ACCENTS = lireJson('accents.json');

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

/** Rend ses accents à un mot crié, segment par segment : CO-TRIMOXAZOLE. */
const accentuer = (mot) => mot.split('-')
  .map((segment) => (ACCENTS[segment] ? ACCENTS[segment].toUpperCase() : segment))
  .join('-');

/** Traite chaque mot crié ; laisse le reste (dosage, forme, déjà en bas de casse). */
function parMot(texte, regle) {
  // NFC : un accent combinant (E + ◌́) ne serait pas une capitale pour la règle.
  // La ponctuation sépare aussi : « PLAQUETTAIRE, HEPARINE » garde sinon sa virgule et reste crié.
  return String(texte ?? '').normalize('NFC').split(/(\s+|\+|\/|\(|\)|,|;|:)/).map((mot) => {
    if (!CRIE.test(mot)) return mot;
    return sigle(mot) ?? regle(accentuer(mot));
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

/**
 * Libellé de classe ATC : une phrase, capitale initiale. « Médicaments en cardiologie ».
 * La préposition que la source écrit « A » redevient « à » devant un mot
 * (« corticoïdes à usage systémique »), jamais après « vitamine » (« vitamine A non associée »).
 */
export function phrase(texte) {
  // « À » seul, que la règle des mots criés ne voit pas, est aussi la préposition.
  const bas = dci(texte).replace(/(?<!vitamines?) [AÀ] (?=\p{L}{3,})/gu, ' à ');
  return bas.charAt(0).toUpperCase() + bas.slice(1);
}
