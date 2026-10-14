/**
 * Noms courants des substances : « aspirine » n'est le nom d'aucune substance
 * de la BDPM, qui ne connaît que l'acide acétylsalicylique. La table
 * data/synonymes.json donne, pour un nom courant, la substance telle que la
 * base la nomme ; recherche, reconnaissance et IA s'y réfèrent.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { deaccent } from './text.js';

const TABLE = JSON.parse(readFileSync(path.join(ROOT, 'data', 'synonymes.json'), 'utf8'));
delete TABLE._;

const lisser = (texte) => deaccent(String(texte ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();

/** Clés du plus long au plus court : « vitamine b12 » avant « vitamine b1 ». */
const CLES = Object.keys(TABLE).sort((a, b) => b.length - a.length);

/** La substance d'un nom courant pris en entier, ou null. */
export function canonique(nom) {
  return TABLE[lisser(nom)] ?? null;
}

/** Remplace, dans une saisie, chaque nom courant (mots entiers) par sa substance. */
export function substituer(saisie) {
  let texte = lisser(saisie);
  for (const cle of CLES) {
    const motif = new RegExp(`(^|[^a-z0-9])${cle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'g');
    texte = texte.replace(motif, (_, avant) => `${avant}${TABLE[cle]}`);
  }
  return texte;
}

/** Couples (nom courant, substance), pour les correspondances par racine (interactions.js). */
export function correspondances() {
  return Object.entries(TABLE);
}
