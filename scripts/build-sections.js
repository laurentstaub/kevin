import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { createPool } from '../src/db.js';
import { sanitizeDocument } from '../src/sanitize.js';
import { splitDocument, PARSER_VERSION } from '../src/split.js';

/**
 * build-sections.js — découpe les documents en rubriques et les matérialise
 * dans docs.rcp_sections.
 *
 * Lit dbpm.cis_documents, n'y écrit jamais : les rubriques sont dérivées et
 * rejouables, la source reste la référence.
 *
 * Incrémental par défaut : un document dont l'empreinte et la version du
 * découpeur n'ont pas changé est sauté. Incrémenter PARSER_VERSION suffit à
 * tout rejouer après une amélioration de la détection.
 *
 *   npm run build-sections                 # incrémental
 *   npm run build-sections -- --all        # tout rejouer
 *   npm run build-sections -- --type rcp   # un seul type
 *   npm run build-sections -- --limit 200  # échantillon
 *   npm run build-sections -- --dry-run    # mesurer sans écrire
 */

const args = process.argv.slice(2);
const flag = (nom) => args.includes(`--${nom}`);
const valeur = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : defaut;
};

const TOUT = flag('all');
const SEC = flag('dry-run');
const TYPE = valeur('type', null);
const LIMITE = Number.parseInt(valeur('limit', ''), 10) || null;
const LOT = 200;

const empreinte = (contenu) => createHash('sha1').update(contenu ?? '').digest('hex');

const pool = createPool({ statement_timeout: 0 });

// Prérequis : le schéma et les tables.
await pool.query(await readFile(path.join(ROOT, 'sql', 'sections.sql'), 'utf8'));

// État connu, pour savoir quoi sauter.
const connu = new Map();
if (!TOUT) {
  const { rows } = await pool.query(
    'SELECT code_cis, document_type, source_hash, parser_version FROM docs.document_parse',
  );
  for (const r of rows) {
    connu.set(`${r.code_cis}|${r.document_type}`, `${r.source_hash}|${r.parser_version}`);
  }
}

/**
 * « main » est la fiche info de la BDPM — identité, pictogrammes,
 * présentations. Pas un document à rubriques : le découper n'a pas de sens et
 * fausserait le taux de réussite.
 */
const TYPES_DECOUPABLES = ['rcp', 'rcp_notice', 'notice'];

const conditions = ["coalesce(html_content, '') <> ''"];
const params = [TYPE ? [TYPE] : TYPES_DECOUPABLES];
conditions.push('document_type = ANY($1)');

const { rows: total } = await pool.query(
  `SELECT count(*)::int AS n FROM dbpm.cis_documents WHERE ${conditions.join(' AND ')}`,
  params,
);

console.log(`${total[0].n.toLocaleString('fr-FR')} document(s) avec du HTML`);
console.log(`découpeur v${PARSER_VERSION}${TOUT ? ' — tout rejouer' : ''}${SEC ? ' — à blanc' : ''}\n`);

const bilan = { traites: 0, sautes: 0, ok: 0, partiel: 0, echec: 0, rubriques: 0 };
const manquantesFreq = new Map();
const echecs = [];

let offset = 0;
let restant = LIMITE ?? Infinity;

while (restant > 0) {
  const taille = Math.min(LOT, restant);
  const { rows } = await pool.query(
    `SELECT code_cis, document_type, html_content
     FROM dbpm.cis_documents
     WHERE ${conditions.join(' AND ')}
     ORDER BY code_cis, document_type
     LIMIT ${taille} OFFSET ${offset}`,
    params,
  );
  if (rows.length === 0) break;
  offset += rows.length;
  restant -= rows.length;

  for (const doc of rows) {
    const cle = `${doc.code_cis}|${doc.document_type}`;
    const hash = empreinte(doc.html_content);

    if (connu.get(cle) === `${hash}|${PARSER_VERSION}`) {
      bilan.sautes += 1;
      continue;
    }

    const { sections, statut, manquantes } = splitDocument(
      sanitizeDocument(doc.html_content),
      doc.document_type,
    );

    bilan.traites += 1;
    bilan[statut] += 1;
    bilan.rubriques += sections.length;
    for (const n of manquantes) manquantesFreq.set(n, (manquantesFreq.get(n) ?? 0) + 1);
    if (statut === 'echec' && echecs.length < 20) echecs.push(cle);

    if (SEC) continue;

    // Un document se réécrit en entier : le découpage n'est pas incrémental
    // rubrique par rubrique, et une rubrique disparue doit disparaître.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM docs.rcp_sections WHERE code_cis = $1 AND document_type = $2',
        [doc.code_cis, doc.document_type],
      );

      for (const s of sections) {
        await client.query(
          `INSERT INTO docs.rcp_sections
             (code_cis, document_type, position, numero, libelle, profondeur, canonical, html, texte)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            doc.code_cis, doc.document_type, s.position, s.numero,
            s.libelle, s.profondeur, s.canonical, s.html, s.texte,
          ],
        );
      }

      await client.query(
        `INSERT INTO docs.document_parse
           (code_cis, document_type, source_hash, parser_version, section_count, statut, manquantes, parsed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (code_cis, document_type) DO UPDATE SET
           source_hash = excluded.source_hash,
           parser_version = excluded.parser_version,
           section_count = excluded.section_count,
           statut = excluded.statut,
           manquantes = excluded.manquantes,
           parsed_at = now()`,
        [doc.code_cis, doc.document_type, hash, PARSER_VERSION, sections.length, statut, manquantes],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${cle} : ${err.message}`);
    } finally {
      client.release();
    }
  }

  process.stdout.write(`\r  ${offset.toLocaleString('fr-FR')} parcourus…`);
}

// ------------------------------------------------------------------ bilan

const pct = (n) => (bilan.traites === 0 ? '—' : `${Math.round((n / bilan.traites) * 100)} %`);

console.log(`\n\n${'─'.repeat(52)}`);
console.log(`  sautés (inchangés)      ${bilan.sautes.toLocaleString('fr-FR')}`);
console.log(`  traités                 ${bilan.traites.toLocaleString('fr-FR')}`);
console.log('');
console.log(`  découpage complet       ${bilan.ok.toLocaleString('fr-FR')}  (${pct(bilan.ok)})`);
console.log(`  rubriques socle en moins ${bilan.partiel.toLocaleString('fr-FR')}  (${pct(bilan.partiel)})`);
console.log(`  aucun découpage         ${bilan.echec.toLocaleString('fr-FR')}  (${pct(bilan.echec)})`);
console.log('');
console.log(`  rubriques écrites       ${bilan.rubriques.toLocaleString('fr-FR')}`);
if (bilan.traites) {
  console.log(`  moyenne par document    ${(bilan.rubriques / bilan.traites).toFixed(1)}`);
}

if (manquantesFreq.size > 0) {
  console.log('\n  Rubriques socle les plus souvent absentes :');
  for (const [numero, n] of [...manquantesFreq].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${numero.padEnd(6)} ${n.toLocaleString('fr-FR')}`);
  }
}

if (echecs.length > 0) {
  console.log('\n  Documents sans aucune rubrique (échantillon) :');
  console.log(`    ${echecs.join(', ')}`);
  console.log('\n  Pour inspecter le balisage :');
  console.log(
    `    psql -d $PGDATABASE -c "SELECT left(html_content, 600) FROM dbpm.cis_documents WHERE code_cis = '${echecs[0].split('|')[0]}'"`,
  );
}

console.log('');
await pool.end();
