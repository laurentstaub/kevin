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

const normal = (texte) => deaccent(String(texte ?? '')).toUpperCase().trim();

let liste = null;
export function chargerBiosimilaires(chemin = path.join(ROOT, 'data', 'biosimilaires.json')) {
  const brut = JSON.parse(readFileSync(chemin, 'utf8'));
  liste = {
    source: brut.source,
    substitution: brut.substitution,
    groupes: brut.groupes.map((groupe) => ({
      ...groupe,
      references: groupe.references.map(normal),
      biosimilaires: groupe.biosimilaires.map(normal),
    })),
  };
  liste.references = liste.groupes.flatMap((groupe) => groupe.references);
  liste.biosimilaires = liste.groupes.flatMap((groupe) => groupe.biosimilaires);
  return liste;
}

const lire = () => liste ?? chargerBiosimilaires();

const commencePar = (denomination, nom) => {
  const normalisee = normal(denomination);
  return normalisee === nom || normalisee.startsWith(`${nom} `) || normalisee.startsWith(`${nom},`);
};

/** @returns {'reference'|'biosimilaire'|null} */
export function statutBiologique(denomination) {
  const listes = lire();
  if (listes.biosimilaires.some((biosimilaire) => commencePar(denomination, biosimilaire))) return 'biosimilaire';
  if (listes.references.some((reference) => commencePar(denomination, reference))) return 'reference';
  return null;
}

/** Les noms des biosimilaires, normalisés, pour la requête du portrait. */
export const nomsBiosimilaires = () => lire().biosimilaires;
export const sourceBiosimilaires = () => lire().source;

/**
 * Le groupe biologique d'une spécialité, et s'il est substituable au comptoir.
 *
 * Onze groupes sur vingt-six le sont (arrêté du 20 février 2025, modifié en
 * dernier lieu le 10 avril 2026). La règle commune tient en une phrase ; les
 * conditions propres à certaines molécules — dosage, dispositif — ne sont pas
 * recopiées ici : elles changent d'un arrêté à l'autre, et la page renvoie au
 * texte plutôt que d'en afficher une version qui aurait vieilli.
 *
 * @returns {null | { substance, substituable, role: 'reference'|'biosimilaire' }}
 */
export function groupeBiologique(denomination) {
  for (const groupe of lire().groupes) {
    if (groupe.biosimilaires.some((biosimilaire) => commencePar(denomination, biosimilaire))) {
      return { substance: groupe.substance, substituable: Boolean(groupe.substituable), role: 'biosimilaire' };
    }
    if (groupe.references.some((reference) => commencePar(denomination, reference))) {
      return { substance: groupe.substance, substituable: Boolean(groupe.substituable), role: 'reference' };
    }
  }
  return null;
}

export const substitutionBiosimilaires = () => lire().substitution;
