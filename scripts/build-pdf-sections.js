import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { ROOT, config } from '../src/config.js';
import { createPool } from '../src/db.js';
import { safeDocumentUrl } from '../src/sanitize.js';
import { pdfEnDocuments } from '../src/pdf.js';
import { splitDocument, PARSER_VERSION } from '../src/split.js';

/**
 * build-pdf-sections.js — traite les spécialités dont le RCP n'existe qu'en PDF.
 *
 * Les produits enregistrés en procédure centralisée n'ont pas de RCP en HTML :
 * la BDPM renvoie vers le PDF de l'EMA, qui regroupe les annexes de la décision
 * européenne. Ce script résout le lien, télécharge, extrait le texte, le ramène
 * au format des documents scrapés, puis alimente la même table de rubriques.
 *
 * Le `file_path` stocké en base (« /documents/<CIS>/rcp_notice.pdf ») ne
 * désigne rien : c'est un emplacement local que l'ancien scraper n'a jamais
 * rempli. Il ne sert donc que de drapeau « ce produit n'a que du PDF » — la
 * vraie adresse se lit sur la fiche document de la BDPM.
 *
 *   npm run build-pdf-sections                # incrémental
 *   npm run build-pdf-sections -- --limit 20  # échantillon
 *   npm run build-pdf-sections -- --dry-run   # mesurer sans écrire en base
 *   npm run build-pdf-sections -- --all       # rejouer tout
 *   npm run build-pdf-sections -- --cis 62474215,66747729 --all   # rejouer ceux-là
 *
 * Deux caches dans .cache/pdf : les liens résolus et les PDF eux-mêmes. Une
 * reprise après interruption ne redemande rien à la BDPM.
 */

const execFileP = promisify(execFile);

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const valeur = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};

const TOUT = flag('all');
const SEC = flag('dry-run');
const LIMITE = Number.parseInt(valeur('limit', ''), 10) || null;
// Rejouer quelques spécialités nommément, sans reparcourir les deux mille autres.
const CIS = valeur('cis', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PAUSE = Number.parseInt(valeur('pause', '400'), 10); // ms entre deux fiches BDPM
// L'EMA sert les PDF beaucoup moins volontiers que la BDPM ne sert ses fiches.
let pausePdf = Number.parseInt(valeur('pause-pdf', '1000'), 10);
const PAUSE_PDF_MAX = 8000;
const TENTATIVES = 6;
// Quand l'EMA a fermé la porte, insister ne sert qu'à faire tourner la boucle.
const ABANDONS_AVANT_ARRET = 40;
const CACHE = path.join(ROOT, '.cache', 'pdf');
const LIENS = path.join(CACHE, 'liens.json');

const UA = { 'User-Agent': 'dr-kevin/2.0 (découpage de RCP, usage interne)' };

const empreinte = (buf) => createHash('sha1').update(buf).digest('hex');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- prérequis

try {
  await execFileP('pdftotext', ['-v']);
} catch {
  console.error('pdftotext est introuvable — il vient de poppler.');
  console.error('  macOS  : brew install poppler');
  console.error('  Debian : apt install poppler-utils');
  process.exit(1);
}

await mkdir(CACHE, { recursive: true });

const pool = createPool({ statement_timeout: 0 });
await pool.query(await readFile(path.join(ROOT, 'sql', 'sections.sql'), 'utf8'));

// ------------------------------------------------------------- documents

const connu = new Map();
if (!TOUT) {
  const { rows } = await pool.query(
    `SELECT code_cis, source_hash, parser_version
     FROM docs.document_parse WHERE source = 'bdpm_pdf'`,
  );
  for (const r of rows) connu.set(r.code_cis, `${r.source_hash}|${r.parser_version}`);
}

// La dénomination sert à choisir la bonne forme dans un PDF qui les décrit
// toutes : « Keppra 250 mg, comprimé » et « Keppra 100 mg/ml, solution buvable »
// ont des posologies différentes.
const { rows: cibles } = await pool.query(
  `SELECT d.code_cis, s.denomination_medicament AS denomination
   FROM dbpm.cis_documents d
   LEFT JOIN dbpm.cis_bdpm s USING (code_cis)
   WHERE d.document_type = 'rcp_notice'
     AND coalesce(d.html_content, '') = ''
     AND ($1::text[] IS NULL OR d.code_cis = ANY($1))
   ORDER BY d.code_cis
   ${LIMITE ? `LIMIT ${LIMITE}` : ''}`,
  [CIS.length > 0 ? CIS : null],
);

console.log(`${cibles.length.toLocaleString('fr-FR')} spécialité(s) sans HTML`);
console.log(`découpeur v${PARSER_VERSION}${SEC ? ' — à blanc' : ''}\n`);

const bilan = {
  sautes: 0, traites: 0, ok: 0, partiel: 0, echec: 0, retires: 0,
  rubriques: 0, pages: 0, telecharges: 0, mutualises: 0, freine: 0,
};
const soucis = [];

// -------------------------------------------------- résolution du lien réel

/** Fiche document de la BDPM : c'est elle qui porte le lien vers le PDF. */
const fiche = (cis) =>
  `${config.documentBaseUrl}/affichageDoc.php?specid=${encodeURIComponent(cis)}&typedoc=R`;

const PDF_DANS_PAGE = /https?:\/\/[^\s"'<>]+?\.pdf/gi;

/** cis -> URL du PDF, conservé entre deux exécutions. */
let liens = {};
try {
  liens = JSON.parse(await readFile(LIENS, 'utf8'));
} catch {
  /* premier passage */
}
let liensModifies = 0;

const enregistrerLiens = async () => {
  if (liensModifies === 0) return;
  await writeFile(LIENS, JSON.stringify(liens, null, 1));
  liensModifies = 0;
};

async function resoudreLien(cis) {
  if (cis in liens) return liens[cis]; // null = fiche sans PDF, déjà constaté

  const reponse = await fetch(fiche(cis), { headers: UA, redirect: 'follow' });
  await dormir(PAUSE);

  // 404 : le CIS n'existe plus côté BDPM. C'est la même situation qu'une fiche
  // sans lien, pas une panne — on l'enregistre pour ne plus la redemander.
  if (reponse.status === 404) {
    liens[cis] = null;
    liensModifies += 1;
    return null;
  }
  if (!reponse.ok) throw new Error(`fiche BDPM HTTP ${reponse.status}`);

  const page = await reponse.text();
  bilan.pages += 1;

  // Le premier PDF d'un domaine autorisé est le bon : la fiche ne porte que le
  // lien « Vers le RCP et la notice ». Son absence n'est pas une anomalie : la
  // BDPM répond « le médicament demandé n'existe pas ou n'entre pas dans le
  // périmètre » pour des AMM retirées dont le CIS traîne encore en base.
  const url = [...page.matchAll(PDF_DANS_PAGE)].map((m) => safeDocumentUrl(m[0])).find(Boolean);

  liens[cis] = url ?? null;
  liensModifies += 1;
  if (liensModifies >= 25) await enregistrerLiens();
  return liens[cis];
}

// --------------------------------------------------------- téléchargement

/**
 * Un même PDF de l'EMA couvre tous les dosages d'une spécialité.
 *
 * Le nom local dérive de l'URL **entière**, pas de son nom de fichier : l'EMA
 * range ses PDF par principe actif, et deux médicaments différents y portent le
 * même nom de fichier dans deux répertoires différents —
 * « …/emtricitabine/tenofovir-disoproxil-mylan… » et
 * « …/efavirenz/emtricitabine/tenofovir-disoproxil-mylan… ». Indexé sur le seul
 * nom de fichier, le cache les confondait : le premier téléchargé était relu
 * pour l'autre, et le second CIS se voyait servir le RCP d'une autre
 * association. Le nom de fichier reste en tête, pour que le cache se lise.
 */
const nomLocal = (url) => {
  const base = path
    .basename(new URL(url).pathname, '.pdf')
    .replace(/[^\w.-]/g, '_')
    .slice(0, 80);
  return path.join(CACHE, `${base}-${createHash('sha1').update(url).digest('hex').slice(0, 12)}.pdf`);
};

/** URL abandonnées pour cette exécution : inutile de les redemander. */
const perdues = new Map();

async function recupererPdf(url) {
  const fichier = nomLocal(url);
  try {
    return { buffer: await readFile(fichier), fichier };
  } catch {
    /* absent du cache */
  }

  // Un PDF sert en moyenne deux CIS : sans cette garde, un refus se paie autant
  // de fois qu'il y a de spécialités derrière le même document.
  if (perdues.has(url)) throw new Error(perdues.get(url));

  for (let essai = 1; essai <= TENTATIVES; essai += 1) {
    const reponse = await fetch(url, { headers: UA, redirect: 'follow' });

    // L'EMA limite le débit. On respecte son Retry-After quand il est là, et on
    // ralentit durablement : le refus vient du rythme, pas du document.
    if (reponse.status === 429 || reponse.status === 503) {
      bilan.freine += 1;
      pausePdf = Math.min(pausePdf + 1000, PAUSE_PDF_MAX);
      const entete = Number.parseInt(reponse.headers.get('retry-after') ?? '', 10);
      await dormir(Number.isFinite(entete) ? entete * 1000 : essai * 8000);
      continue;
    }

    if (!reponse.ok) {
      const motif = `PDF HTTP ${reponse.status}`;
      perdues.set(url, motif);
      throw new Error(motif);
    }

    const buffer = Buffer.from(await reponse.arrayBuffer());
    if (buffer.subarray(0, 4).toString() !== '%PDF') {
      const motif = 'la réponse n’est pas un PDF';
      perdues.set(url, motif);
      throw new Error(motif);
    }

    await writeFile(fichier, buffer);
    await dormir(pausePdf);
    bilan.telecharges += 1;
    return { buffer, fichier };
  }

  const motif = `refus répété de l’EMA après ${TENTATIVES} tentatives`;
  perdues.set(url, motif);
  throw new Error(motif);
}

async function extraireTexte(fichier) {
  const sortie = `${fichier}.txt`;
  await execFileP('pdftotext', ['-layout', '-enc', 'UTF-8', fichier, sortie]);
  const texte = await readFile(sortie, 'utf8');
  await unlink(sortie).catch(() => {});
  return texte;
}

// ------------------------------------------------------------- traitement

/** Un PDF sert plusieurs CIS : on ne le découpe qu'une fois. */
const dejaDecoupe = new Map();

let abandonsSuite = 0;
let arreteTot = false;
let n = 0;
for (const cible of cibles) {
  n += 1;
  process.stdout.write(`\r  ${n} / ${cibles.length}…`);

  let url;
  try {
    url = await resoudreLien(cible.code_cis);
  } catch (err) {
    soucis.push({ cis: cible.code_cis, motif: err.message });
    bilan.echec += 1;
    continue;
  }

  // Produit sorti du périmètre de la BDPM : ce n'est pas un échec de découpage.
  if (!url) {
    bilan.retires += 1;
    continue;
  }

  let pdf;
  try {
    pdf = await recupererPdf(url);
    abandonsSuite = 0;
  } catch (err) {
    soucis.push({ cis: cible.code_cis, motif: `téléchargement : ${err.message}` });
    bilan.echec += 1;
    abandonsSuite += 1;
    // Rien ne passe plus : on s'arrête proprement plutôt que de parcourir le
    // reste de la liste pour rien. Tout ce qui précède est déjà en base.
    if (abandonsSuite >= ABANDONS_AVANT_ARRET) {
      arreteTot = true;
      break;
    }
    continue;
  }

  const hash = empreinte(pdf.buffer);
  if (connu.get(cible.code_cis) === `${hash}|${PARSER_VERSION}`) {
    bilan.sautes += 1;
    continue;
  }

  // Le découpage dépend du PDF et de la forme retenue : deux CIS d'une même
  // spécialité ne donnent pas le même RCP.
  const cle = `${hash}|${cible.denomination ?? ''}`;

  let resultats = dejaDecoupe.get(cle);
  if (resultats) {
    bilan.mutualises += 1;
  } else {
    try {
      const documents = pdfEnDocuments(await extraireTexte(pdf.fichier), {
        denomination: cible.denomination,
      });
      // Un PDF donne jusqu'à deux documents : le RCP et la notice.
      resultats = documents.map((doc) => ({ type: doc.type, ...splitDocument(doc.html, doc.type) }));
    } catch (err) {
      soucis.push({ cis: cible.code_cis, motif: `extraction : ${err.message}` });
      bilan.echec += 1;
      continue;
    }
    dejaDecoupe.set(cle, resultats);
  }

  bilan.traites += 1;

  const rcp = resultats.find((r) => r.type === 'rcp');
  const statut = rcp?.statut ?? 'echec';
  bilan[statut] += 1;
  bilan.rubriques += resultats.reduce((s, r) => s + r.sections.length, 0);

  if (statut !== 'ok') {
    soucis.push({
      cis: cible.code_cis,
      motif: `RCP ${statut}${rcp?.manquantes.length ? ` — manque ${rcp.manquantes.join(', ')}` : ''}`,
    });
  }

  if (SEC) continue;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const r of resultats) {
      await client.query(
        'DELETE FROM docs.rcp_sections WHERE code_cis = $1 AND document_type = $2',
        [cible.code_cis, r.type],
      );

      for (const s of r.sections) {
        await client.query(
          `INSERT INTO docs.rcp_sections
             (code_cis, document_type, position, numero, libelle, profondeur, canonical, html, texte, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'bdpm_pdf')`,
          [
            cible.code_cis, r.type, s.position, s.numero,
            s.libelle, s.profondeur, s.canonical, s.html, s.texte,
          ],
        );
      }

      await client.query(
        `INSERT INTO docs.document_parse
           (code_cis, document_type, source_hash, parser_version, section_count, statut, manquantes, source, parsed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'bdpm_pdf', now())
         ON CONFLICT (code_cis, document_type) DO UPDATE SET
           source_hash = excluded.source_hash,
           parser_version = excluded.parser_version,
           section_count = excluded.section_count,
           statut = excluded.statut,
           manquantes = excluded.manquantes,
           source = excluded.source,
           parsed_at = now()`,
        [cible.code_cis, r.type, hash, PARSER_VERSION, r.sections.length, r.statut, r.manquantes],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    soucis.push({ cis: cible.code_cis, motif: `écriture : ${err.message}` });
  } finally {
    client.release();
  }
}

await enregistrerLiens();

// ------------------------------------------------------------------ bilan

if (arreteTot) {
  console.log(
    `\n\n  Arrêt : ${ABANDONS_AVANT_ARRET} refus consécutifs de l'EMA.` +
      '\n  Relancer plus tard reprend où on en est — rien n\'est perdu.',
  );
}

const pct = (x) => (bilan.traites === 0 ? '—' : `${Math.round((x / bilan.traites) * 100)} %`);
const nb = (x) => x.toLocaleString('fr-FR');

console.log(`\n\n${'─'.repeat(52)}`);
console.log(`  fiches BDPM lues        ${nb(bilan.pages)}`);
console.log(`  hors périmètre BDPM     ${nb(bilan.retires)}`);
console.log(`  PDF téléchargés         ${nb(bilan.telecharges)}${bilan.freine ? `  (${nb(bilan.freine)} refus de débit, pause portée à ${pausePdf} ms)` : ''}`);
console.log(`  sautés (inchangés)      ${nb(bilan.sautes)}`);
console.log(`  traités                 ${nb(bilan.traites)}  dont ${nb(bilan.mutualises)} sur un PDF déjà découpé`);
console.log('');
console.log(`  RCP complet             ${nb(bilan.ok)}  (${pct(bilan.ok)})`);
console.log(`  RCP partiel             ${nb(bilan.partiel)}  (${pct(bilan.partiel)})`);
console.log(`  échec                   ${nb(bilan.echec)}`);
console.log('');
console.log(`  rubriques écrites       ${nb(bilan.rubriques)}`);

if (soucis.length > 0) {
  console.log(`\n  ${soucis.length} document(s) à regarder (20 premiers) :`);
  for (const s of soucis.slice(0, 20)) console.log(`    ${s.cis}  ${s.motif}`);
}

console.log(`\n  Cache dans ${path.relative(ROOT, CACHE)} — supprimable sans risque.\n`);
await pool.end();
