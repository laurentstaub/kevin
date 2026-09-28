/**
 * Rejoue une à une les trois requêtes d'une page de classe ATC pour trouver celle qui ne rend rien.
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

  // La navigation par préfixe suppose des longueurs 1, 3, 4, 5, 7 par niveau.
  console.log(`\n=== Longueur des codes par niveau ===\n`);
  const { rows: niveaux } = await pool.query(
    `SELECT atc_level AS niveau, min(length(atc_code)) AS mini,
            max(length(atc_code)) AS maxi, count(*)::int AS codes
     FROM ref.atc_classification GROUP BY 1 ORDER BY 1`,
  );
  for (const niveau of niveaux) {
    dit(`niveau ${niveau.niveau}`, `${niveau.codes} codes, longueur ${niveau.mini}${niveau.mini === niveau.maxi ? '' : ` à ${niveau.maxi}`}`);
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
    for (const molecule of molecules.slice(0, 5)) {
      console.log(`     ${molecule.code}  ${String(molecule.produits).padStart(4)} produits  ${molecule.label}`);
    }
  }

  // Liste vide : aucun code de niveau 5 sous ce préfixe, ou aucune spécialité correspondante.
  console.log(`\n=== Décomposition, préfixe « ${code} » ===\n`);
  const { rows: [detail] } = await pool.query(
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
  dit('codes de niveau 5 sous ce préfixe', detail.codes_n5);
  dit('codes portés par une spécialité', detail.codes_utilises);
  dit('jointure exacte niveau 5', detail.jointure_exacte);
  dit('correspondances vers cis_bdpm', detail.avec_specialite);
  console.log('');
} finally {
  await pool.end();
}
