/**
 * Table des accents manquants de la BDPM, déduite des RCP eux-mêmes.
 *
 *   node scripts/accents.js            complète data/accents.json (l'existant prime)
 *   node scripts/accents.js --refaire  repart de zéro
 *
 * La BDPM écrit les substances, les dénominations et les classes ATC en
 * capitales sans accent (EZETIMIBE, MEDICAMENTS). Le texte des RCP, lui, est
 * accentué. Pour chaque mot crié, on cherche dans ce texte les graphies qui
 * lui correspondent une fois désaccentuées, et on retient la plus fréquente
 * si elle est accentuée et l'emporte nettement. Le fichier se relit et se
 * corrige à la main : une clé déjà présente n'est jamais réécrite.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createPool } from '../src/db.js';
import { ROOT } from '../src/config.js';

const FICHIER = path.join(ROOT, 'data', 'accents.json');
const refaire = process.argv.includes('--refaire');
const pool = createPool({ statement_timeout: 0 });

const desaccentuer = (mot) => mot.normalize('NFD').replace(/[̀-ͯ]/g, '');
const MOT = /[a-zà-öø-ÿœ]{3,}/g;

/** Mots criés à accentuer : substances, dénominations, libellés ATC. */
async function cibles() {
  const { rows } = await pool.query(`
    SELECT DISTINCT mot FROM (
      SELECT regexp_split_to_table(upper(denomination_substance), '[^A-Z]+') AS mot
      FROM dbpm.cis_compo_bdpm
      UNION ALL
      SELECT regexp_split_to_table(upper(denomination_medicament), '[^A-Z]+')
      FROM dbpm.cis_bdpm
      UNION ALL
      SELECT regexp_split_to_table(upper(atc_label), '[^A-Z]+')
      FROM ref.atc_classification
    ) m WHERE length(mot) >= 3`);
  return new Set(rows.map((ligne) => ligne.mot));
}

/** Fréquence des graphies dans les RCP : composition et dénomination de tous,
 * texte entier d'un échantillon pour le vocabulaire courant. */
async function frequences() {
  const compte = new Map();
  const compter = (texte) => {
    for (const mot of texte.toLowerCase().matchAll(MOT)) {
      compte.set(mot[0], (compte.get(mot[0]) ?? 0) + 1);
    }
  };
  const tetes = await pool.query(`
    SELECT texte FROM docs.rcp_sections
    WHERE document_type = 'rcp' AND numero IN ('1', '2', '3')`);
  tetes.rows.forEach((ligne) => compter(ligne.texte));
  const echantillon = await pool.query(`
    SELECT texte FROM docs.rcp_sections
    WHERE document_type = 'rcp' AND code_cis IN (
      SELECT code_cis FROM docs.rcp_sections WHERE document_type = 'rcp'
      GROUP BY code_cis ORDER BY random() LIMIT 600)`);
  echantillon.rows.forEach((ligne) => compter(ligne.texte));
  return compte;
}

const mots = await cibles();
const compte = await frequences();
await pool.end();

// Graphies regroupées par forme désaccentuée.
const parBase = new Map();
for (const [graphie, nombre] of compte) {
  const base = desaccentuer(graphie);
  if (base === graphie) continue;
  if (!parBase.has(base)) parBase.set(base, []);
  parBase.get(base).push([graphie, nombre]);
}

const existant = !refaire && existsSync(FICHIER) ? JSON.parse(readFileSync(FICHIER, 'utf8')) : {};
const table = { ...existant };
let ajouts = 0;
for (const mot of mots) {
  if (table[mot]) continue;
  const base = mot.toLowerCase();
  const candidats = parBase.get(base);
  if (!candidats) continue;
  const [graphie, nombre] = candidats.sort((a, b) => b[1] - a[1])[0];
  const sans = compte.get(base) ?? 0;
  // Au moins trois occurrences, et plus que la graphie sans accent.
  if (nombre >= 3 && nombre > sans) {
    table[mot] = graphie;
    ajouts += 1;
  }
}

const trie = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(FICHIER, `${JSON.stringify(trie, null, 2)}\n`);
console.log(`${mots.size} mots criés, ${ajouts} accentuations ajoutées, ${Object.keys(trie).length} au total → data/accents.json`);
