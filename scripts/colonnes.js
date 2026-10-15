/**
 * Colonnes, volume et trois lignes d'exemple des tables demandées, ou la liste
 * des tables d'un schéma. Pour écrire une requête sans copier la base.
 *
 *   node scripts/colonnes.js dbpm                      → tables du schéma
 *   node scripts/colonnes.js dbpm.cis_has_smr_bdpm …   → détail de chaque table
 */
import { createPool } from '../src/db.js';

const cibles = process.argv.slice(2);
if (cibles.length === 0) {
  console.error('usage : node scripts/colonnes.js <schéma> | <schéma.table> …');
  process.exit(1);
}

const pool = createPool();
const court = (valeur) => {
  const texte = valeur === null ? 'null' : String(valeur);
  return texte.length > 80 ? `${texte.slice(0, 77)}…` : texte;
};

for (const cible of cibles) {
  const [schema, table] = cible.split('.');
  if (!table) {
    const { rows } = await pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1', [schema]);
    console.log(`# ${schema}\n${rows.map((ligne) => `  ${ligne.table_name}`).join('\n')}\n`);
    continue;
  }
  const { rows: colonnes } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [schema, table]);
  if (colonnes.length === 0) { console.log(`# ${cible} : absente\n`); continue; }
  // Identifiants validés par information_schema ci-dessus : pas d'injection.
  const nom = `"${schema}"."${table}"`;
  const [{ rows: [{ total }] }, { rows: exemples }] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total FROM ${nom}`),
    pool.query(`SELECT * FROM ${nom} LIMIT 3`),
  ]);
  console.log(`# ${cible} — ${total} lignes`);
  for (const { column_name: colonne, data_type: type } of colonnes) {
    console.log(`  ${colonne} (${type}) : ${exemples.map((ligne) => court(ligne[colonne])).join(' | ')}`);
  }
  console.log();
}
await pool.end();
