/**
 * Banc des questions du comptoir : chaque question de tests/banc/questions.json
 * est tapée dans la barre de l'application, contre la base réelle, redirections
 * suivies. Réussie si la page finale est du bon type et contient le fragment
 * attendu. Les questions appellent l'IA quand elle est configurée (.env).
 *
 *   npm run banc              # tableau et score
 *   npm run banc -- 12 41     # seulement ces questions
 *   npm run banc -- --strict  # code de sortie 1 au premier échec (CI)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { createPool } from '../src/db.js';
import { createApp } from '../src/app.js';
import { deaccent } from '../src/text.js';

const { questions } = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'banc', 'questions.json'), 'utf8'));
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const choisies = args.filter((arg) => /^\d+$/.test(arg)).map(Number);
const aJouer = choisies.length ? questions.filter((question) => choisies.includes(question.n)) : questions;

const ENTITES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
/** Texte de la page : balises retirées, entités rendues, marques collées. */
const texteDe = (html) => html.replace(/<\/?mark>/g, '').replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entite) => ENTITES[entite]);
const plier = (texte) => deaccent(String(texte)).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');

/** Type de la page finale, d'après son adresse. */
function typeDe(url) {
  if (url.pathname === '/interactions') return 'interactions';
  if (url.pathname.startsWith('/product/') && url.searchParams.has('sans')) return 'alternatives';
  if (url.pathname === '/documents') return 'documents';
  return url.pathname.split('/')[1] || 'accueil';
}

const pool = createPool();
const serveur = createApp(pool).listen(0);
const base = `http://127.0.0.1:${serveur.address().port}`;

const resultats = [];
for (const cas of aJouer) {
  const depart = Date.now();
  const reponse = await fetch(`${base}/search?q=${encodeURIComponent(cas.question)}`);
  const url = new URL(reponse.url);
  const texte = plier(texteDe(await reponse.text()));
  const type = typeDe(url);
  const bonnePage = type === cas.page;
  const trouve = !cas.attendu || texte.includes(plier(cas.attendu));
  resultats.push({
    ...cas, ok: bonnePage && trouve, ms: Date.now() - depart,
    raison: !bonnePage ? `page ${type}` : (trouve ? '' : 'fragment absent'),
    adresse: `${url.pathname}${url.search}`.replace(/&question=[^&]*/, ''),
  });
}
serveur.close();
await pool.end();

for (const res of resultats) {
  const ligne = `${res.ok ? '✓' : '✗'} ${String(res.n).padStart(2)} ${res.question.padEnd(48)}`;
  console.log(res.ok ? ligne : `${ligne} ${res.raison.padEnd(16)} ${decodeURIComponent(res.adresse).slice(0, 90)}`);
}
const reussies = resultats.filter((res) => res.ok).length;
const parTheme = new Map();
for (const res of resultats) {
  const [ok, total] = parTheme.get(res.theme) ?? [0, 0];
  parTheme.set(res.theme, [ok + Number(res.ok), total + 1]);
}
console.log(`\n${reussies}/${resultats.length} réussies · ${[...parTheme].map(([theme, [ok, total]]) => `${theme} ${ok}/${total}`).join(' · ')}`);
if (strict && reussies < resultats.length) process.exitCode = 1;
