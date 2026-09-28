/**
 * Biosimilaires : la liste de référence de l'ANSM, que la BDPM ne porte pas.
 *
 * Le Répertoire des génériques ne connaît que les molécules de synthèse. Une
 * énoxaparine d'Arrow ou de Biogaran n'y figure pas : la page de l'énoxaparine
 * annonçait « 0 % génériques », juste et trompeur. Les biosimilaires ont leur
 * propre liste, les groupes biologiques similaires (CSP, art. R. 5121-9-1),
 * que l'ANSM publie sans fichier téléchargeable. Elle est donc relevée dans
 * data/biosimilaires.json — noms commerciaux, sans dosage — et datée.
 *
 * On reconnaît une spécialité par le début de sa dénomination : « INHIXA
 * 4 000 UI… » commence par INHIXA. Le nom doit être suivi d'une espace, d'une
 * virgule ou de rien, pour que LANTUS ne reconnaisse pas un LANTUSX.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { deaccent } from './text.js';

const normal = (s) => deaccent(String(s ?? '')).toUpperCase().trim();

let liste = null;
export function chargerBiosimilaires(chemin = path.join(ROOT, 'data', 'biosimilaires.json')) {
  const brut = JSON.parse(readFileSync(chemin, 'utf8'));
  liste = {
    source: brut.source,
    references: brut.groupes.flatMap((g) => g.references.map(normal)),
    biosimilaires: brut.groupes.flatMap((g) => g.biosimilaires.map(normal)),
  };
  return liste;
}

const lire = () => liste ?? chargerBiosimilaires();

const commencePar = (denomination, nom) => {
  const d = normal(denomination);
  return d === nom || d.startsWith(`${nom} `) || d.startsWith(`${nom},`);
};

/** @returns {'reference'|'biosimilaire'|null} */
export function statutBiologique(denomination) {
  const l = lire();
  if (l.biosimilaires.some((n) => commencePar(denomination, n))) return 'biosimilaire';
  if (l.references.some((n) => commencePar(denomination, n))) return 'reference';
  return null;
}

/** Les noms des biosimilaires, normalisés, pour la requête du portrait. */
export const nomsBiosimilaires = () => lire().biosimilaires;
export const sourceBiosimilaires = () => lire().source;
