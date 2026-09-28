/**
 * Biosimilaires : liste ANSM des groupes biologiques similaires (CSP, art.
 * R. 5121-9-1), absente de la BDPM et du Répertoire des génériques. Relevée à
 * la main dans data/biosimilaires.json (noms commerciaux, sans dosage), datée.
 * Une spécialité est reconnue au début de sa dénomination, suivi d'une espace,
 * d'une virgule ou de rien (LANTUS ne doit pas reconnaître LANTUSX).
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
 * Le groupe biologique d'une spécialité, et s'il est substituable au comptoir
 * (arrêté du 20 février 2025 modifié le 10 avril 2026). Les conditions propres
 * à certaines molécules ne sont pas recopiées : la page renvoie à l'arrêté.
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
