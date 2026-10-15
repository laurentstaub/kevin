import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../../src/config.js';

/**
 * Charge le jeu d'essai dans la base de test, dans l'ordre que demandent les
 * fichiers : tables dbpm et ref, prérequis de l'application, schéma docs et
 * configuration plein texte tels qu'en production, puis les rubriques.
 */
const FICHIERS = [
  ['tests', 'fixtures.sql'],
  ['sql', 'setup.sql'],
  ['sql', 'sections.sql'],
  ['sql', 'recherche.sql'],
  ['tests', 'fixtures-docs.sql'],
];

export async function chargerBase(pool) {
  for (const chemin of FICHIERS) {
    await pool.query(await readFile(path.join(ROOT, ...chemin), 'utf8'));
  }
}
