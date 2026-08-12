/**
 * diag-atc.js — pourquoi une page de classe montre ce qu'elle montre.
 *
 * La page assemble trois requêtes ; quand elle paraît vide, on ne sait pas
 * laquelle n'a rien rendu. Ce script les rejoue une par une, sur la connexion
 * de l'application, et dit où la chaîne se rompt.
 *
 *   node scripts/diag-atc.js         examine « J »
 *   node scripts/diag-atc.js N02     examine une autre classe
 */

import { createPool } from '../src/db.js';
import { getClasse, getMoleculesDeClasse, FEUILLE } from '../src/atc.js';

const code = (process.argv[2] ?? 'J').toUpperCase();
const pool = createPool();

const dit = (etiquette, valeur) => console.log(`  ${etiquette.padEnd(34)} ${valeur}`);

try {
  console.log(`\n=== La base répond-elle, et que contient-elle ? ===\n`);
  for (const [nom, sql] of [
    ['ref.atc_classification', 'SELECT count(*)::int n FROM ref.atc_classification'],
    ['  dont niveau 5', "SELECT count(*)::int n FROM ref.atc_classification WHERE atc_level = 5"],
    ['ref.cis_atc_mapping', 'SELECT count(*)::int n FROM ref.cis_atc_mapping'],
    ['  codes de 7 signes', "SELECT count(*)::int n FROM ref.cis_atc_mapping WHERE length(atc_code) = 7"],
  ]) {
    try {
      const { rows } = await pool.query(sql);
      dit(nom, rows[0].n.toLocaleString('fr-FR'));
    } catch (err) {
      dit(nom, `ERREUR — ${err.message}`);
    }
  }

  // La longueur du code par niveau : si elle ne suit pas 1, 3, 4, 5, 7, la
  // navigation par préfixe ne tient pas, et rien d'autre ne tiendra non plus.
  console.log(`\n=== Longueur des codes par niveau ===\n`);
  const { rows: niveaux } = await pool.query(
    `SELECT atc_level AS niveau, min(length(atc_code)) AS mini,
            max(length(atc_code)) AS maxi, count(*)::int AS codes
     FROM ref.atc_classification GROUP BY 1 ORDER BY 1`,
  );
  for (const n of niveaux) {
    dit(`niveau ${n.niveau}`, `${n.codes} codes, longueur ${n.mini}${n.mini === n.maxi ? '' : ` à ${n.maxi}`}`);
  }

  console.log(`\n=== Ce que la page « ${code} » reçoit ===\n`);
  const classe = await getClasse(pool, code);
  if (!classe) {
    dit('classe', 'INTROUVABLE — la page rendrait un 404');
  } else {
    dit('libellé', classe.label);
    dit('niveau', classe.level);
    dit('produits (total)', classe.produits.toLocaleString('fr-FR'));
    dit('enfants', classe.enfants.length);
    if (classe.enfants.length > 0) {
      dit('niveau des enfants', classe.enfants[0].level);
      dit('premier enfant', `${classe.enfants[0].code} — ${classe.enfants[0].label}`);
    }

    const feuille = classe.level === FEUILLE || classe.enfants.length === 0;
    const enfantsMolecules = classe.enfants[0]?.level === FEUILLE;
    dit('feuille ?', feuille);
    dit('enfants déjà molécules ?', enfantsMolecules);
    dit('la page appelle les molécules ?', !feuille && !enfantsMolecules);

    const molecules = await getMoleculesDeClasse(pool, code);
    dit('molécules rendues', molecules.length);
    for (const m of molecules.slice(0, 5)) {
      console.log(`     ${m.code}  ${String(m.produits).padStart(4)} produits  ${m.label}`);
    }
  }

  // Si la liste est vide, c'est ici qu'on voit pourquoi : soit aucun code de
  // niveau 5 sous ce préfixe, soit aucune correspondance vers une spécialité.
  console.log(`\n=== Décomposition, préfixe « ${code} » ===\n`);
  const { rows: [d] } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM ref.atc_classification
        WHERE atc_level = 5 AND atc_code LIKE $1 || '%')                      AS codes_n5,
       (SELECT count(DISTINCT a.atc_code)::int FROM ref.cis_atc_mapping a
        WHERE a.atc_code LIKE $1 || '%')                                      AS codes_utilises,
       (SELECT count(*)::int FROM ref.cis_atc_mapping a
        JOIN ref.atc_classification c ON c.atc_code = a.atc_code AND c.atc_level = 5
        WHERE a.atc_code LIKE $1 || '%')                                      AS jointure_exacte,
       (SELECT count(*)::int FROM ref.cis_atc_mapping a
        JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
        WHERE a.atc_code LIKE $1 || '%')                                      AS avec_specialite`,
    [code],
  );
  dit('codes de niveau 5 sous ce préfixe', d.codes_n5);
  dit('codes portés par une spécialité', d.codes_utilises);
  dit('jointure exacte niveau 5', d.jointure_exacte);
  dit('correspondances vers cis_bdpm', d.avec_specialite);
  console.log('');
} finally {
  await pool.end();
}
