/**
 * Fiches thématiques : Markdown source, page publiée. L'en-tête porte auteur,
 * date de relecture et source ; sans date de relecture, pas de publication.
 * Ce qui porte sur une molécule est cité depuis les RCP via des blocs
 * déclaratifs (`::: substances …`), calculés dans un JSON versionné et relu.
 * Markdown restreint (titres, paragraphes, listes, gras, italique, liens) :
 * tout est échappé, puis seuls ces motifs sont reconnus.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export const DOSSIER_FICHES = path.join(ROOT, 'fiches');
export const DOSSIER_CALCULS = path.join(ROOT, 'data', 'fiches');
/** Les chapeaux des pages de classe : `fiches/classes/m01a.md` pour M01A. */
export const DOSSIER_CLASSES = path.join(DOSSIER_FICHES, 'classes');
/** Les pages du site (« Pourquoi Médipile », mentions légales) : même format, même règle. */
export const DOSSIER_PAGES = path.join(ROOT, 'pages');

/** Champ laissé à remplir (« [à compléter : SIREN] ») : la page ne se publie pas. */
const A_COMPLETER = /\[à compléter\b/i;

const echapper = (texte) => String(texte)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Un lien n'est accepté que vers le web, le site lui-même ou une adresse de courriel. */
const lienSur = (url) => /^(https?:\/\/|\/|mailto:)/.test(url);

function enLigne(texte) {
  return echapper(texte)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    // Une paire de parenthèses est admise dans l'URL (ANSM, Wikipédia).
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (tout, libelle, url) => {
      const brut = url.replace(/&amp;/g, '&');
      if (!lienSur(brut)) return libelle;
      const externe = /^https?:/.test(brut);
      return `<a href="${url}"${externe ? ' target="_blank" rel="noopener noreferrer"' : ''}>${libelle}</a>`;
    });
}

/** En-tête : lignes `clé: valeur` entre deux `---` (YAML plat, sans dépendance). */
export function lireEnTete(source) {
  const entete = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!entete) return { meta: {}, corps: source };
  const meta = {};
  for (const ligne of entete[1].split(/\r?\n/)) {
    const i = ligne.indexOf(':');
    if (i > 0) meta[ligne.slice(0, i).trim()] = ligne.slice(i + 1).trim();
  }
  return { meta, corps: source.slice(entete[0].length) };
}

/**
 * Un bloc déclaratif : `::: nom argument clé=valeur clé=v1,v2`.
 * @returns {{ nom: string, argument: string|null, options: object }}
 */
export function lireDirective(ligne) {
  const [nom, ...reste] = ligne.replace(/^:::\s*/, '').trim().split(/\s+/);
  const options = {};
  let argument = null;
  for (const morceau of reste) {
    const i = morceau.indexOf('=');
    if (i > 0) options[morceau.slice(0, i)] = morceau.slice(i + 1).split(',').filter(Boolean);
    else if (!argument) argument = morceau;
  }
  return { nom, argument, options };
}

/**
 * Le corps en blocs : du HTML pour le texte, des directives pour le calculé.
 * @returns {Array<{type: 'html', html: string} | {type: 'directive', nom, argument, options}>}
 */
export function decouper(corps) {
  const blocs = [];
  let paragraphe = [];
  let liste = [];

  const vider = () => {
    if (paragraphe.length) blocs.push({ type: 'html', html: `<p>${enLigne(paragraphe.join(' '))}</p>` });
    if (liste.length) blocs.push({ type: 'html', html: `<ul>${liste.map((element) => `<li>${enLigne(element)}</li>`).join('')}</ul>` });
    paragraphe = [];
    liste = [];
  };

  for (const brute of corps.split(/\r?\n/)) {
    const ligne = brute.trim();
    if (!ligne) { vider(); continue; }
    if (ligne.startsWith(':::')) { vider(); blocs.push({ type: 'directive', ...lireDirective(ligne) }); continue; }
    const titre = /^(#{2,3})\s+(.+)$/.exec(ligne);
    if (titre) {
      vider();
      const niveau = titre[1].length;
      blocs.push({ type: 'html', html: `<h${niveau}>${enLigne(titre[2])}</h${niveau}>` });
      continue;
    }
    const puce = /^[-*]\s+(.+)$/.exec(ligne);
    if (puce) { if (paragraphe.length) vider(); liste.push(puce[1]); continue; }
    if (liste.length) vider();
    paragraphe.push(ligne);
  }
  vider();
  return blocs;
}

/** Le nom de fichier fait l'adresse : `torsadogenes.md` → `/fiches/torsadogenes`. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;

export function lireFiche(slug, dossier = DOSSIER_FICHES) {
  if (!SLUG.test(String(slug))) return null;
  const chemin = path.join(dossier, `${slug}.md`);
  if (!existsSync(chemin)) return null;
  const { meta, corps } = lireEnTete(readFileSync(chemin, 'utf8'));
  return { slug, meta, blocs: decouper(corps), aCompleter: A_COMPLETER.test(corps) };
}

export function listerFiches(dossier = DOSSIER_FICHES) {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((fichier) => fichier.endsWith('.md') && !fichier.startsWith('_') && fichier !== 'README.md')
    .map((fichier) => lireFiche(fichier.replace(/\.md$/, ''), dossier))
    .filter(Boolean);
}

/**
 * Publiée seulement si relue et complète ; sinon visible en développement
 * uniquement. Des mentions légales datées mais sans SIREN ne sortent pas.
 */
export const publiee = (fiche) => Boolean(fiche?.meta?.relu) && !fiche.aCompleter;

/** Le calcul de la fiche, écrit par build-fiches et versionné. */
export function lireCalcul(slug, dossier = DOSSIER_CALCULS) {
  if (!SLUG.test(String(slug))) return null;
  const chemin = path.join(dossier, `${slug}.json`);
  return existsSync(chemin) ? JSON.parse(readFileSync(chemin, 'utf8')) : null;
}
