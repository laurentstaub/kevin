/**
 * collect-documents.js — va chercher les RCP et notices qui manquent.
 *
 * La table `dbpm.cis_documents` n'a plus été alimentée depuis le 6 mai 2025, et
 * la collecte d'alors *rafraîchissait* ce qu'elle connaissait déjà sans jamais
 * découvrir les nouvelles spécialités. D'où une table datée d'un jour précis et
 * pourtant amputée de deux années d'AMM : 971 spécialités commercialisées sans
 * le moindre document, dont toutes celles autorisées en 2025 et 2026.
 *
 * Ce script part donc de `dbpm.cis_bdpm` — la liste qui fait autorité — et non
 * de `cis_documents`, qui n'est que son propre reflet.
 *
 *   npm run collect-documents -- --dry-run --limit 5   voir sans écrire
 *   npm run collect-documents -- --limit 100           un premier lot
 *   npm run collect-documents                          tout ce qui manque
 *   npm run collect-documents -- --cis 60151544 --montrer   inspecter un cas
 *
 * Incrémental : ne demande que ce qui n'est pas en base, et retient dans
 * `.cache/documents/vus.json` les CIS dont la BDPM a dit qu'ils n'ont rien —
 * sans quoi chaque passe les redemanderait indéfiniment.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, config } from '../src/config.js';
import { createPool } from '../src/db.js';
import { extraireDocument, lienPdf, pageSansDocument } from '../src/document-bdpm.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const valeur = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};

const SEC = flag('dry-run');
const MONTRER = flag('montrer');
const LIMITE = Number.parseInt(valeur('limit', ''), 10) || null;
const PAUSE = Number.parseInt(valeur('pause', '400'), 10);
const CIS = valeur('cis', '').split(',').map((s) => s.trim()).filter(Boolean);

const CACHE = path.join(ROOT, '.cache', 'documents');
const VUS = path.join(CACHE, 'vus.json');
const UA = { 'User-Agent': 'dr-kevin/2.0 (collecte de RCP, usage interne)' };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = [
  { typedoc: 'R', document_type: 'rcp', plan: 'rcp' },
  { typedoc: 'N', document_type: 'notice', plan: 'notice' },
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

const restants = cibles.filter((c) => CIS.length > 0 || !vus[c.code_cis]);
console.log(`\n${cibles.length.toLocaleString('fr-FR')} spécialité(s) sans document`
  + `${restants.length !== cibles.length ? `, ${cibles.length - restants.length} déjà constatée(s) sans` : ''}`
  + `${SEC ? ' — à blanc' : ''}\n`);

const bilan = { html: 0, pdf: 0, absents: 0, erreurs: 0, redirections: 0 };
const soucis = [];

const fiche = (cis, typedoc) =>
  `${config.documentBaseUrl}/affichageDoc.php?specid=${encodeURIComponent(cis)}&typedoc=${typedoc}`;

// --------------------------------------------------------------- collecte

for (const [i, cible] of restants.entries()) {
  const cis = cible.code_cis;
  const trouves = [];
  let pdf = null;
  let absent = false;

  try {
    for (const t of TYPES) {
      const url = fiche(cis, t.typedoc);
      const reponse = await fetch(url, { headers: UA, redirect: 'follow' });
      await dormir(PAUSE);

      // Une redirection n'est pas un succès : c'est le signe que la source a
      // bougé. L'ancien collecteur est probablement mort d'une migration
      // d'URL qu'il a suivie sans rien dire.
      if (reponse.redirected && reponse.url !== url) {
        bilan.redirections += 1;
        if (bilan.redirections === 1) {
          console.log(`  redirection : ${url}\n             -> ${reponse.url}\n`);
        }
      }

      if (reponse.status === 404) { absent = true; continue; }
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);

      const page = await reponse.text();

      if (pageSansDocument(page)) { absent = true; continue; }

      const doc = extraireDocument(page, t.plan);
      if (doc) {
        trouves.push({ ...t, ...doc });
        continue;
      }

      // Pas de texte : c'est peut-être une centralisée, dont la BDPM ne sert
      // qu'un lien vers le PDF de l'EMA. On note l'adresse, build-pdf-sections
      // fera le reste — il sait déjà.
      pdf = pdf ?? lienPdf(page);

      if (MONTRER) {
        console.log(`\n--- ${cis} ${t.typedoc} : rien d'extrait, ${page.length} signes de page ---`);
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
      for (const d of trouves) {
        await pool.query(
          `INSERT INTO dbpm.cis_documents (code_cis, document_type, html_content, last_updated)
           VALUES ($1, $2, $3, now())`,
          [cis, d.document_type, d.html],
        );
      }
    }
    console.log(`  ${cis}  ${trouves.map((d) => `${d.document_type} ${d.rubriques} rub. `
      + `${d.signes.toLocaleString('fr-FR')} signes`).join('  |  ')}`);
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
    bilan.absents += 1;
    vus[cis] = absent ? 'absent' : 'illisible';
    console.log(`  ${cis}  ${absent ? 'aucun document publié' : 'page non reconnue'}`);
  }

  if ((i + 1) % 25 === 0 && !SEC) await writeFile(VUS, JSON.stringify(vus, null, 1));
}

if (!SEC) await writeFile(VUS, JSON.stringify(vus, null, 1));

console.log(`\n${bilan.html} document(s) en HTML, ${bilan.pdf} renvoi(s) vers un PDF, `
  + `${bilan.absents} sans document, ${bilan.erreurs} erreur(s)`);
if (bilan.redirections > 0) {
  console.log(`${bilan.redirections} redirection(s) — vérifier config.documentBaseUrl`);
}
for (const s of soucis.slice(0, 10)) console.log(`  ${s}`);
if (!SEC && bilan.html > 0) console.log('\nEnsuite : npm run build-sections');

await pool.end();
