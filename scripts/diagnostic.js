import { createPool } from '../src/db.js';
import { config } from '../src/config.js';
import { sanitizeDocument } from '../src/sanitize.js';
import { outline } from '../src/outline.js';

/**
 * État des lieux de la base : ce qu'elle contient, dans quels formats, et
 * quelle part des documents l'application sait réellement structurer.
 *
 * Lecture seule. Aucune écriture, aucun appel réseau.
 * Exécution : npm run diagnostic
 */

const ECHANTILLON = Number(process.env.DIAG_SAMPLE ?? 300);

const pool = createPool({ statement_timeout: 0 });

const titre = (texte) => console.log(`\n\x1b[1m${texte}\x1b[0m\n${'─'.repeat(texte.length)}`);
const ligne = (cle, valeur) => console.log(`  ${String(cle).padEnd(38)} ${valeur}`);
const pourcent = (n, total) => (total === 0 ? '—' : `${Math.round((n / total) * 100)} %`);

async function essayer(sql, params = []) {
  try {
    return (await pool.query(sql, params)).rows;
  } catch (err) {
    return { erreur: err.message };
  }
}

async function compter(table) {
  const r = await essayer(`SELECT count(*)::int AS n FROM ${table}`);
  return Array.isArray(r) ? r[0].n : null;
}

// ---------------------------------------------------------------- schémas

titre('Schémas et tables');

const tables = await essayer(`
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY table_schema, table_name
`);

if (tables.erreur) {
  console.error(`  base injoignable : ${tables.erreur}`);
  await pool.end();
  process.exit(1);
}

const parSchema = new Map();
for (const t of tables) {
  if (!parSchema.has(t.table_schema)) parSchema.set(t.table_schema, []);
  parSchema.get(t.table_schema).push(t.table_name);
}

for (const [schema, noms] of parSchema) {
  ligne(schema, `${noms.length} table(s) : ${noms.slice(0, 8).join(', ')}${noms.length > 8 ? '…' : ''}`);
}

// ------------------------------------------------------------ volumétrie

titre('Volumétrie BDPM');

for (const table of [
  'dbpm.cis_bdpm',
  'dbpm.cis_compo_bdpm',
  'dbpm.cis_cip_bdpm',
  'dbpm.cis_gener_bdpm',
  'dbpm.cis_documents',
]) {
  const n = await compter(table);
  ligne(table, n === null ? '\x1b[33mabsente\x1b[0m' : n.toLocaleString('fr-FR'));
}

// -------------------------------------------------------------- documents

const aDocuments = (await compter('dbpm.cis_documents')) !== null;

if (!aDocuments) {
  console.log('\n  Pas de table dbpm.cis_documents : rien à analyser côté documents.');
} else {
  titre('Documents — types et formats');

  const types = await essayer(`
    SELECT document_type, count(*)::int AS n
    FROM dbpm.cis_documents GROUP BY 1 ORDER BY 2 DESC
  `);
  for (const t of types) ligne(t.document_type ?? '(null)', t.n.toLocaleString('fr-FR'));

  const formats = await essayer(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE coalesce(html_content, '') <> '')::int AS avec_html,
      count(*) FILTER (WHERE coalesce(file_path, '') <> '')::int AS avec_url,
      count(*) FILTER (WHERE coalesce(html_content, '') = ''
                         AND coalesce(file_path, '') <> '')::int AS pdf_seul,
      count(*) FILTER (WHERE coalesce(html_content, '') = ''
                         AND coalesce(file_path, '') = '')::int AS vides
    FROM dbpm.cis_documents
  `);

  const f = formats[0];
  console.log('');
  ligne('total', f.total.toLocaleString('fr-FR'));
  ligne('avec contenu HTML', `${f.avec_html.toLocaleString('fr-FR')}  (${pourcent(f.avec_html, f.total)})`);
  ligne('avec URL de document', `${f.avec_url.toLocaleString('fr-FR')}  (${pourcent(f.avec_url, f.total)})`);
  ligne(
    'URL seule, sans HTML  → cas PDF',
    `\x1b[33m${f.pdf_seul.toLocaleString('fr-FR')}\x1b[0m  (${pourcent(f.pdf_seul, f.total)})`,
  );
  ligne('ni HTML ni URL', f.vides.toLocaleString('fr-FR'));

  const tailles = await essayer(`
    SELECT
      min(length(html_content))::int AS mini,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY length(html_content))::int AS median,
      max(length(html_content))::int AS maxi
    FROM dbpm.cis_documents WHERE coalesce(html_content, '') <> ''
  `);
  if (Array.isArray(tailles) && tailles[0].median !== null) {
    const t = tailles[0];
    console.log('');
    ligne('longueur HTML (min / médiane / max)', `${t.mini} / ${t.median} / ${t.maxi} signes`);
  }

  const domaines = await essayer(`
    SELECT substring(file_path from '^https?://([^/]+)') AS hote, count(*)::int AS n
    FROM dbpm.cis_documents
    WHERE file_path LIKE 'http%'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `);
  if (Array.isArray(domaines) && domaines.length > 0) {
    titre('Domaines des documents (à reporter dans DOCUMENT_HOSTS)');
    const autorises = config.documentHosts;
    for (const d of domaines) {
      const ok = autorises.some((a) => d.hote === a || d.hote?.endsWith(`.${a}`));
      ligne(d.hote ?? '(?)', `${d.n.toLocaleString('fr-FR')}  ${ok ? '✓ autorisé' : '\x1b[33m✗ bloqué\x1b[0m'}`);
    }
  }

  // ------------------------------------------- structuration réelle

  titre(`Structuration du plan (échantillon de ${ECHANTILLON} documents HTML)`);

  const docs = await essayer(
    `SELECT code_cis, document_type, html_content
     FROM dbpm.cis_documents
     WHERE coalesce(html_content, '') <> ''
     ORDER BY random() LIMIT $1`,
    [ECHANTILLON],
  );

  if (!Array.isArray(docs) || docs.length === 0) {
    console.log('  Aucun document HTML à analyser.');
  } else {
    let avecPlan = 0;
    let totalRubriques = 0;
    let normalisees = 0;
    const echecs = [];

    for (const doc of docs) {
      const { sections } = outline(sanitizeDocument(doc.html_content), doc.document_type);
      if (sections.length > 0) {
        avecPlan += 1;
        totalRubriques += sections.length;
        normalisees += sections.filter((s) => s.canonical).length;
      } else if (echecs.length < 5) {
        echecs.push(doc);
      }
    }

    ligne('documents analysés', docs.length);
    ligne(
      'plan détecté',
      `${avecPlan}  (${pourcent(avecPlan, docs.length)})${avecPlan < docs.length * 0.8 ? '  \x1b[33m← à regarder\x1b[0m' : ''}`,
    );
    if (avecPlan > 0) {
      ligne('rubriques par document (moyenne)', (totalRubriques / avecPlan).toFixed(1));
      ligne(
        'libellés normalisés sur le plan type',
        `${normalisees}  (${pourcent(normalisees, totalRubriques)})`,
      );
    }

    if (echecs.length > 0) {
      titre('Documents sans plan détecté — début du HTML');
      for (const doc of echecs) {
        console.log(`\n  \x1b[2mCIS ${doc.code_cis} · ${doc.document_type}\x1b[0m`);
        console.log(
          `  ${doc.html_content.replace(/\s+/g, ' ').slice(0, 400).replace(/(.{100})/g, '$1\n  ')}`,
        );
      }
      console.log(
        '\n  Copie ce bloc si le taux de détection est bas : le balisage y est visible.',
      );
    }
  }
}

// ------------------------------------------------------------- ruptures

titre('Tables hors BDPM (projet ruptures)');

for (const table of ['public.incidents', 'public.produits']) {
  const n = await compter(table);
  ligne(table, n === null ? 'absente' : `${n.toLocaleString('fr-FR')}  (non utilisée par cette application)`);
}

console.log('');
await pool.end();
