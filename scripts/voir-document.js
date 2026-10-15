/**
 * Début du HTML d'un document, tel que la vue le reçoit (assaini, plan posé).
 * Pour diagnostiquer une mise en page sans copier la base.
 *
 *   node scripts/voir-document.js 60616751 main > _to_delete/doc.html
 *
 * @param cis   code CIS
 * @param type  rcp | notice | rcp_notice | main (défaut : main)
 * @param longueur nombre de caractères (défaut : 3000)
 */
import { createPool } from '../src/db.js';
import { getDocuments } from '../src/documents.js';

const [cis, type = 'main', longueur = '3000'] = process.argv.slice(2);
if (!cis) {
  console.error('usage : node scripts/voir-document.js <cis> [type] [caractères]');
  process.exit(1);
}

const pool = createPool();
const doc = (await getDocuments(pool, cis)).find((candidat) => candidat.type === type);
console.log(doc ? doc.html.slice(0, Number(longueur)) : `aucun document « ${type} » pour ${cis}`);
await pool.end();
