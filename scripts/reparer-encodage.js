import { createPool } from '../src/db.js';

/**
 * reparer-encodage.js — répare le double encodage UTF-8.
 *
 * « polyÃ©thylÃ¨ne » au lieu de « polyéthylène » : des octets UTF-8 corrects
 * ont été relus comme du Latin-1 (ou du Windows-1252) puis réencodés en UTF-8.
 * L'opération est réversible — on refait le chemin à l'envers.
 *
 *   npm run reparer-encodage              # constat, n'écrit rien
 *   npm run reparer-encodage -- --ecrire  # applique
 *
 * Ceci est un rattrapage, pas un correctif : la cause est dans le chargeur qui
 * lit les fichiers CIS_*.txt de la BDPM avec le mauvais jeu de caractères. Sans
 * correction là-bas, le prochain rechargement réintroduira le défaut.
 */

const ECRIRE = process.argv.includes('--ecrire');
const SCHEMAS = ['dbpm', 'docs'];

// Les 27 caractères que Windows-1252 place là où Latin-1 n'a que des contrôles.
// Sans eux, « â€™ » ne se ramène pas à l'apostrophe typographique.
const CP1252 = new Map(
  Object.entries({
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84,
    '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
    '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
    'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93,
    '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
    '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
    'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
  }),
);

const decodeur = new TextDecoder('utf-8', { fatal: true });

/**
 * Retour au texte d'origine, ou null si la chaîne n'est pas du mojibake.
 *
 * Le contrôle est le décodage lui-même : une chaîne saine ne forme pas une
 * séquence UTF-8 valide une fois ramenée à ses octets. C'est plus sûr que
 * n'importe quelle heuristique sur les accents.
 */
export function reparer(texte) {
  if (!texte || !/[ÃÂ]|â€/.test(texte)) return null;

  const octets = [];
  for (const c of texte) {
    const point = CP1252.get(c) ?? c.codePointAt(0);
    if (point > 0xff) return null; // hors d'atteinte : ce n'est pas du mojibake
    octets.push(point);
  }

  try {
    const clair = decodeur.decode(Uint8Array.from(octets));
    return clair === texte ? null : clair;
  } catch {
    return null; // séquence UTF-8 invalide : la chaîne était déjà correcte
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool({ statement_timeout: 0 });

  const { rows: colonnes } = await pool.query(
    `SELECT table_schema AS s, table_name AS t, column_name AS c
     FROM information_schema.columns
     WHERE table_schema = ANY($1)
       AND data_type IN ('text', 'character varying')
     ORDER BY 1, 2, 3`,
    [SCHEMAS],
  );

  console.log(`${colonnes.length} colonne(s) texte examinée(s)${ECRIRE ? '' : ' — constat seul'}\n`);

  let total = 0;
  const exemples = [];

  for (const { s, t, c } of colonnes) {
    // Les identifiants viennent d'information_schema, pas d'une entrée : ils
    // sont mis entre guillemets par précaution, pas par méfiance.
    const table = `"${s}"."${t}"`;
    const colonne = `"${c}"`;

    // Présélection large en SQL — le tri fin se fait dans reparer().
    const { rows } = await pool.query(
      `SELECT ctid, ${colonne} AS v
       FROM ${table}
       WHERE ${colonne} LIKE '%Ã%' OR ${colonne} LIKE '%Â%' OR ${colonne} LIKE '%â€%'`,
    );

    const atraiter = rows
      .map((r) => ({ ctid: r.ctid, clair: reparer(r.v), avant: r.v }))
      .filter((r) => r.clair !== null);

    if (atraiter.length === 0) continue;

    total += atraiter.length;
    console.log(`  ${`${s}.${t}.${c}`.padEnd(46)} ${atraiter.length.toLocaleString('fr-FR').padStart(8)}`);
    if (exemples.length < 5) {
      exemples.push({ ou: `${s}.${t}.${c}`, ...atraiter[0] });
    }

    if (!ECRIRE) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of atraiter) {
        await client.query(`UPDATE ${table} SET ${colonne} = $1 WHERE ctid = $2`, [r.clair, r.ctid]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`    échec sur ${s}.${t}.${c} : ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  ${total.toLocaleString('fr-FR')} valeur(s) à réparer`);

  for (const e of exemples) {
    console.log(`\n  ${e.ou}`);
    console.log(`    avant  ${e.avant.slice(0, 90)}`);
    console.log(`    après  ${e.clair.slice(0, 90)}`);
  }

  if (total > 0 && !ECRIRE) {
    console.log('\n  Relancer avec --ecrire pour appliquer.');
  }
  console.log('');

  await pool.end();
}
