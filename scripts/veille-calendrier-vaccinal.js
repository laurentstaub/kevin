/**
 * Veille sur le calendrier des vaccinations publié par le ministère de la santé.
 *
 *   npm run veille-vaccins
 *
 * sante.gouv.fr protège ses PDF par un défi anti-robot : le script ne télécharge
 * pas. Il lit la page sante.fr, relève l'adresse du calendrier complet — son nom
 * porte la version (2026_07_..._v11.pdf) — et la compare à celle d'où viennent
 * les données (`data/calendrier-vaccinal.json` → source.url).
 *
 * Le PDF se télécharge à la main, dans le navigateur, et se dépose sous son nom
 * d'origine dans `sources/vaccins/`. Au passage suivant, le script le trouve,
 * vérifie que c'est un PDF, calcule son empreinte SHA-256 et extrait son texte
 * (pdftotext) pour comparer deux versions.
 *
 * Dernière ligne de la sortie : un objet JSON lisible par n8n, statut =
 *   a_jour              les données viennent du PDF publié
 *   a_telecharger       nouvelle version publiée, PDF absent de sources/vaccins/
 *   a_relire            nouvelle version déposée, données à mettre à jour
 *   erreur              code de sortie 1
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT } from '../src/config.js';

const PAGE = 'https://www.sante.fr/le-calendrier-des-vaccinations';
const DOSSIER = path.join(ROOT, 'sources', 'vaccins');
const DONNEES = path.join(ROOT, 'data', 'calendrier-vaccinal.json');
const UA = { 'User-Agent': 'medipile/2.0 (veille du calendrier vaccinal, usage interne)' };

// Le calendrier complet, pas le simplifié ni les déclinaisons outre-mer ou voyageurs.
const EXCLUS = /simplifi|drom|outre|guyane|mayotte|antilles|voyage|affiche|carte/i;

const existe = (fichier) => access(fichier).then(() => true, () => false);

async function lienPublie() {
  const reponse = await fetch(PAGE, { headers: UA });
  if (!reponse.ok) throw new Error(`Page ${PAGE} : HTTP ${reponse.status}`);
  const html = await reponse.text();

  const liens = [...html.matchAll(/<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(([, href, texte]) => ({
      url: new URL(href.replaceAll('&amp;', '&'), PAGE).href,
      texte: texte.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter(({ url, texte }) => /calendrier/i.test(`${decodeURIComponent(url)} ${texte}`))
    .filter(({ url, texte }) => !EXCLUS.test(`${decodeURIComponent(url)} ${texte}`))
    .filter(({ url }, i, tous) => tous.findIndex((lien) => lien.url === url) === i);

  if (liens.length === 0) throw new Error(`Aucun lien PDF du calendrier sur ${PAGE} : la page a changé.`);
  if (liens.length > 1) {
    console.warn('Plusieurs liens possibles, le premier est retenu :');
    for (const lien of liens) console.warn(`  ${lien.url}  « ${lien.texte} »`);
  }
  return liens[0].url;
}

async function sourceDesDonnees() {
  try {
    return JSON.parse(await readFile(DONNEES, 'utf8')).source ?? {};
  } catch {
    return {}; // données pas encore saisies
  }
}

async function examinerPdf(fichier) {
  const octets = await readFile(fichier);
  if (octets.subarray(0, 4).toString() !== '%PDF') {
    throw new Error(`${path.relative(ROOT, fichier)} n'est pas un PDF : téléchargement à refaire dans le navigateur.`);
  }
  const texte = fichier.replace(/\.pdf$/i, '.txt');
  if (!await existe(texte)) {
    await promisify(execFile)('pdftotext', ['-layout', fichier, texte])
      .catch(() => console.warn('pdftotext absent : texte non extrait (brew install poppler).'));
  }
  return {
    sha256: createHash('sha256').update(octets).digest('hex'),
    texte_extrait: await existe(texte) ? path.relative(ROOT, texte) : null,
  };
}

try {
  const url = await lienPublie();
  const nom = decodeURIComponent(path.basename(new URL(url).pathname));
  const fichier = path.join(DOSSIER, nom);
  const source = await sourceDesDonnees();

  const resultat = { url, fichier: path.relative(ROOT, fichier), url_donnees: source.url ?? null };

  if (url === source.url) {
    resultat.statut = 'a_jour';
    console.log('Données à jour : elles viennent du calendrier publié.');
  } else if (!await existe(fichier)) {
    resultat.statut = 'a_telecharger';
    console.log(`NOUVELLE VERSION publiée. À télécharger dans le navigateur :\n  ${url}\npuis à déposer sous :\n  ${resultat.fichier}`);
  } else {
    Object.assign(resultat, await examinerPdf(fichier), { statut: 'a_relire' });
    console.log(`PDF présent, données à mettre à jour depuis ${resultat.fichier}.`);
  }

  resultat.verifie_le = new Date().toISOString();
  console.log(JSON.stringify(resultat));
} catch (erreur) {
  console.error(erreur.message);
  console.log(JSON.stringify({ statut: 'erreur', message: erreur.message }));
  process.exit(1);
}
