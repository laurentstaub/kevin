import { createPool } from '../src/db.js';

/**
 * Répare le double encodage UTF-8 (« polyÃ©thylÃ¨ne ») en refaisant le chemin Latin-1 à l'envers.
 *
 *   npm run reparer-encodage              # constat, n'écrit rien
 *   npm run reparer-encodage -- --ecrire  # applique
 *   npm run reparer-encodage -- --cis 61018059 [--ecrire]
 *       une spécialité, tables dbpm seulement, réparation séquence par séquence
 *       (document mêlant texte sain et texte abîmé) ; relancer ensuite build-sections.
 * ATTENTION : rattrapage seulement ; le chargeur des CIS_*.txt réintroduira le défaut.
 */

const ECRIRE = process.argv.includes('--ecrire');
const CIS = (() => {
  const i = process.argv.indexOf('--cis');
  return i !== -1 && /^\d{8}$/.test(process.argv[i + 1] ?? '') ? process.argv[i + 1] : null;
})();
// Ciblé : les sources (dbpm) seulement, le dérivé (docs) se reconstruit.
const SCHEMAS = CIS ? ['dbpm'] : ['dbpm', 'docs'];

// Les 27 caractères de Windows-1252 absents de Latin-1 (sinon « â€™ » reste tel quel).
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
 * Le test est le décodage : une chaîne saine ne donne pas d'UTF-8 valide.
 */
export function reparer(texte) {
  if (!texte || !/[ÃÂ]|â€/.test(texte)) return null;

  const octets = [];
  for (const caractere of texte) {
    const point = CP1252.get(caractere) ?? caractere.codePointAt(0);
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

/** Un octet de continuation UTF-8 (0x80–0xBF) tel que lu en Windows-1252 ou Latin-1. */
const SUITE = `[\\u0080-\\u00bf${[...CP1252.keys()].filter((car) => CP1252.get(car) <= 0xbf).join('')}]`;
const SEQUENCE = new RegExp(`[\\u00c2-\\u00df]${SUITE}|[\\u00e0-\\u00ef]${SUITE}{2}`, 'g');
const RESTE_A = new RegExp(`Ã(?!${SUITE})`, 'g');
const RESTE_NBSP = new RegExp(`Â(?!${SUITE})`, 'g');

/**
 * Réparation séquence par séquence, pour un texte qui mêle caractères sains et
 * abîmés (reparer() renonce alors) : chaque suite « octet de tête + octets de
 * continuation » qui forme de l'UTF-8 valide est remise en clair. Puis les
 * restes dont le second octet, une espace insécable (0xA0), s'est perdu :
 * « Ã » seul était « à », « Â » seul une espace insécable. Ces restes ne se
 * réparent qu'en mode ciblé, relu : ailleurs, « Âge » est légitime.
 *
 * @returns {string|null} le texte réparé, ou null s'il n'y avait rien à réparer
 */
export function reparerSequences(texte) {
  if (!texte || !/[ÃÂ]|â€/.test(texte)) return null;
  let sequences = 0;
  const clair = String(texte)
    .replace(SEQUENCE, (sequence) => {
      try {
        const lu = decodeur.decode(Uint8Array.from([...sequence].map((car) => CP1252.get(car) ?? car.codePointAt(0))));
        sequences += 1;
        return lu;
      } catch {
        return sequence;
      }
    });
  // Sans séquence abîmée, le texte n'est pas doublement encodé : ses « Â » sont vrais.
  if (sequences === 0) return null;
  return clair.replace(RESTE_A, 'à').replace(RESTE_NBSP, '\u00a0');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool({ statement_timeout: 0 });

  const { rows: colonnes } = await pool.query(
    `SELECT table_schema AS s, table_name AS t, column_name AS c
     FROM information_schema.columns k
     WHERE table_schema = ANY($1)
       AND data_type IN ('text', 'character varying')
       -- Ciblé : les seules tables qui portent le CIS.
       AND ($2::boolean IS NOT TRUE OR EXISTS (
             SELECT 1 FROM information_schema.columns i
             WHERE i.table_schema = k.table_schema AND i.table_name = k.table_name AND i.column_name = 'code_cis'))
     ORDER BY 1, 2, 3`,
    [SCHEMAS, Boolean(CIS)],
  );

  console.log(`${colonnes.length} colonne(s) texte examinée(s)${CIS ? ` pour le CIS ${CIS}` : ''}${ECRIRE ? '' : ' — constat seul'}\n`);

  let total = 0;
  const exemples = [];

  for (const { s: schema, t: nomTable, c: nomColonne } of colonnes) {
    // Identifiants issus d'information_schema, cités par précaution.
    const table = `"${schema}"."${nomTable}"`;
    const colonne = `"${nomColonne}"`;

    // Présélection large en SQL — le tri fin se fait dans reparer().
    const { rows } = await pool.query(
      `SELECT ctid, ${colonne} AS v
       FROM ${table}
       WHERE (${colonne} LIKE '%Ã%' OR ${colonne} LIKE '%Â%' OR ${colonne} LIKE '%â€%')
         ${CIS ? 'AND code_cis = $1' : ''}`,
      CIS ? [CIS] : [],
    );

    const atraiter = rows
      .map((row) => ({ ctid: row.ctid, clair: reparer(row.v) ?? (CIS ? reparerSequences(row.v) : null), avant: row.v }))
      .filter((ligne) => ligne.clair !== null);

    if (atraiter.length === 0) continue;

    total += atraiter.length;
    console.log(`  ${`${schema}.${nomTable}.${nomColonne}`.padEnd(46)} ${atraiter.length.toLocaleString('fr-FR').padStart(8)}`);
    if (exemples.length < 5) {
      exemples.push({ ou: `${schema}.${nomTable}.${nomColonne}`, ...atraiter[0] });
    }

    if (!ECRIRE) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const ligne of atraiter) {
        await client.query(`UPDATE ${table} SET ${colonne} = $1 WHERE ctid = $2`, [ligne.clair, ligne.ctid]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`    échec sur ${schema}.${nomTable}.${nomColonne} : ${err.message}`);
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
