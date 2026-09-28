/**
 * Collecte les RCP et notices manquants, en partant de `dbpm.cis_bdpm` (qui fait
 * autorité) et non de `cis_documents`, pour découvrir les nouvelles spécialités.
 *
 *   npm run collect-documents -- --dry-run --limit 5   voir sans écrire
 *   npm run collect-documents -- --limit 100           un premier lot
 *   npm run collect-documents                          tout ce qui manque
 *   npm run collect-documents -- --cis 60151544 --montrer   inspecter un cas
 * Incrémental ; `.cache/documents/vus.json` retient les CIS sans document selon la BDPM.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, config } from '../src/config.js';
import { createPool } from '../src/db.js';
import { extraireDocument, lienPdf, pageSansDocument } from '../src/document-bdpm.js';

const args = process.argv.slice(2);
const flag = (option) => args.includes(`--${option}`);
const valeur = (option, defaut) => {
  const i = args.indexOf(`--${option}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : defaut;
};

const SEC = flag('dry-run');
const MONTRER = flag('montrer');
const LIMITE = Number.parseInt(valeur('limit', ''), 10) || null;
const PAUSE = Number.parseInt(valeur('pause', '400'), 10);
const CIS = valeur('cis', '').split(',').map((cis) => cis.trim()).filter(Boolean);

const CACHE = path.join(ROOT, '.cache', 'documents');
const VUS = path.join(CACHE, 'vus.json');
const UA = { 'User-Agent': 'dr-kevin/2.0 (collecte de RCP, usage interne)' };
const dormir = (ms) => new Promise((reveil) => setTimeout(reveil, ms));

// /medicament/<CIS>/extrait porte RCP et notice : une seule requête, « N » en repli si la notice manque.
const TYPES = [
  { document_type: 'rcp', plan: 'rcp' },
  { document_type: 'notice', plan: 'notice' },
];

await mkdir(CACHE, { recursive: true });
const pool = createPool({ statement_timeout: 0 });

let vus = {};
try {
  vus = JSON.parse(await readFile(VUS, 'utf8'));
} catch { /* premier passage */ }

// ------------------------------------------------------------- la liste

const { rows: cibles } = await pool.query(
  `SELECT m.code_cis, m.denomination_medicament AS denomination
   FROM dbpm.cis_bdpm m
   WHERE ($1::text[] IS NOT NULL AND m.code_cis = ANY($1))
      OR ($1::text[] IS NULL
          AND EXISTS (SELECT 1 FROM dbpm.cis_cip_bdpm p
                      WHERE p.code_cis = m.code_cis
                        AND p.etat_commercialisation ILIKE 'Déclaration de commercialisation%')
          AND coalesce(m.type_procedure_amm, '') !~* 'importation\\s+parall'
          AND NOT EXISTS (SELECT 1 FROM dbpm.cis_documents d WHERE d.code_cis = m.code_cis))
   ORDER BY m.date_amm DESC NULLS LAST, m.code_cis
   ${LIMITE ? `LIMIT ${LIMITE}` : ''}`,
  [CIS.length > 0 ? CIS : null],
);

const restants = cibles.filter((cible) => CIS.length > 0 || !vus[cible.code_cis]);
console.log(`\n${cibles.length.toLocaleString('fr-FR')} spécialité(s) sans document`
  + `${restants.length !== cibles.length ? `, ${cibles.length - restants.length} déjà constatée(s) sans` : ''}`
  + `${SEC ? ' — à blanc' : ''}\n`);

const bilan = { html: 0, pdf: 0, absents: 0, illisibles: 0, erreurs: 0, redirections: 0 };
const soucis = [];

// L'ancienne forme d'URL ne sert qu'au repli « notice à part ».
const fiche = (cis, typedoc) => (typedoc === 'R'
  ? `${config.documentBaseUrl}/medicament/${encodeURIComponent(cis)}/extrait`
  : `${config.documentBaseUrl}/affichageDoc.php?specid=${encodeURIComponent(cis)}&typedoc=${typedoc}`);

// --------------------------------------------------------------- collecte

for (const [i, cible] of restants.entries()) {
  const cis = cible.code_cis;
  const trouves = [];
  let pdf = null;
  let absent = false;

  /** Récupère une page et signale une redirection plutôt que de l'avaler. */
  const demander = async (typedoc) => {
    const url = fiche(cis, typedoc);
    const reponse = await fetch(url, { headers: UA, redirect: 'follow' });
    await dormir(PAUSE);

    // Une redirection signale que la source a bougé : la compter, pas la suivre en silence.
    if (reponse.redirected && reponse.url !== url) {
      bilan.redirections += 1;
      if (bilan.redirections === 1) {
        console.log(`  redirection : ${url}\n             -> ${reponse.url}\n`);
      }
    }

    if (reponse.status === 404) return null;
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    return reponse.text();
  };

  try {
    const page = await demander('R');
    if (page === null) absent = true;
    else if (pageSansDocument(page)) absent = true;
    else {
      for (const type of TYPES) {
        const doc = extraireDocument(page, type.plan);
        if (doc) trouves.push({ ...type, ...doc });
      }

      // Notice à part (ancienne forme) : seulement si le RCP HTML a été trouvé, sinon rien à espérer.
      if (trouves.length > 0 && !trouves.some((trouve) => trouve.document_type === 'notice')) {
        const autre = await demander('N');
        const doc = autre && extraireDocument(autre, 'notice');
        if (doc) trouves.push({ document_type: 'notice', plan: 'notice', ...doc });
      }

      // Rien d'extrait : peut-être une centralisée ; le lien PDF est laissé à build-pdf-sections.
      if (trouves.length === 0) pdf = lienPdf(page);

      if (MONTRER && trouves.length === 0) {
        console.log(`\n--- ${cis} : rien d'extrait, ${page.length} signes de page ---`);
        console.log(page.replace(/\s+/g, ' ').slice(0, 1200));
      }
    }
  } catch (err) {
    bilan.erreurs += 1;
    soucis.push(`${cis} — ${err.message}`);
    continue;
  }

  if (trouves.length > 0) {
    bilan.html += trouves.length;
    if (!SEC) {
      for (const trouve of trouves) {
        await pool.query(
          `INSERT INTO dbpm.cis_documents (code_cis, document_type, html_content, last_updated)
           VALUES ($1, $2, $3, now())`,
          [cis, trouve.document_type, trouve.html],
        );
      }
    }
    console.log(`  ${cis}  ${trouves.map((trouve) => `${trouve.document_type} ${trouve.rubriques} rub. `
      + `${trouve.signes.toLocaleString('fr-FR')} signes`).join('  |  ')}`);
  } else if (pdf) {
    bilan.pdf += 1;
    if (!SEC) {
      await pool.query(
        `INSERT INTO dbpm.cis_documents (code_cis, document_type, html_content, file_path, last_updated)
         VALUES ($1, 'rcp_notice', '', $2, now())`,
        [cis, pdf],
      );
    }
    console.log(`  ${cis}  PDF européen — build-pdf-sections prendra la suite`);
  } else {
    // Absence dite par la BDPM : mise en cache. Page non reconnue : défaut de lecture
    // local, jamais mise en cache pour qu'elle revienne à la passe suivante.
    if (absent) {
      bilan.absents += 1;
      vus[cis] = 'absent';
      console.log(`  ${cis}  aucun document publié`);
    } else {
      bilan.illisibles += 1;
      soucis.push(`${cis} — page non reconnue`);
      console.log(`  ${cis}  page non reconnue`);
    }
  }

  if ((i + 1) % 25 === 0 && !SEC) await writeFile(VUS, JSON.stringify(vus, null, 1));
}

if (!SEC) await writeFile(VUS, JSON.stringify(vus, null, 1));

console.log(`\n${bilan.html} document(s) en HTML, ${bilan.pdf} renvoi(s) vers un PDF, `
  + `${bilan.absents} sans document, ${bilan.illisibles} page(s) non reconnue(s), `
  + `${bilan.erreurs} erreur(s)`);
if (bilan.redirections > 0) {
  console.log(`${bilan.redirections} redirection(s) — vérifier config.documentBaseUrl`);
}
for (const souci of soucis.slice(0, 10)) console.log(`  ${souci}`);
if (!SEC && bilan.html > 0) console.log('\nEnsuite : npm run build-sections');

await pool.end();
