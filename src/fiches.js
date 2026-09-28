/**
 * Fiches thématiques : un fichier Markdown, publié sur le site.
 *
 * Le Markdown est le format source, la page est la publication. Trois règles
 * en découlent, et tout ce module les sert.
 *
 * **La fiche dit qui l'a écrite, quand, et d'après quoi.** L'en-tête porte
 * l'auteur, la date de relecture et la source ; une fiche sans date de
 * relecture n'est pas publiée.
 *
 * **Tout ce qui porte sur une molécule est cité, jamais réécrit.** Le texte
 * libre de la fiche est court et signé ; les listes et les phrases viennent de
 * blocs déclaratifs (`::: substances …`, `::: citations …`) que le script de
 * construction calcule depuis les RCP. La phrase du RCP, pas une réécriture.
 *
 * **Le calcul se relit avant de paraître.** Il est écrit dans un fichier JSON
 * versionné : ce qui change d'un millésime à l'autre se lit dans un diff avant
 * de partir en ligne.
 *
 * Le Markdown accepté est un sous-ensemble volontaire — titres, paragraphes,
 * listes, gras, italique, liens — plutôt qu'une dépendance de plus pour un
 * format dont on n'utilisera jamais les tableaux, le HTML brut ni les notes.
 * Tout est échappé d'abord, puis seuls ces motifs sont reconnus.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export const DOSSIER_FICHES = path.join(ROOT, 'fiches');
export const DOSSIER_CALCULS = path.join(ROOT, 'data', 'fiches');

const echapper = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Un lien n'est accepté que vers le web ou le site lui-même. */
const lienSur = (url) => /^(https?:\/\/|\/)/.test(url);

function enLigne(texte) {
  return echapper(texte)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    // Une paire de parenthèses est admise dans l'URL — les pages de l'ANSM et
    // de Wikipédia en portent — sans quoi la capture s'arrête trop tôt et
    // laisse une parenthèse orpheline dans le texte.
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (tout, libelle, url) => {
      const brut = url.replace(/&amp;/g, '&');
      if (!lienSur(brut)) return libelle;
      const externe = /^https?:/.test(brut);
      return `<a href="${url}"${externe ? ' target="_blank" rel="noopener noreferrer"' : ''}>${libelle}</a>`;
    });
}

/**
 * L'en-tête : des lignes `clé: valeur` entre deux `---`. Un sous-ensemble de
 * YAML, suffisant pour des métadonnées plates, sans dépendance.
 */
export function lireEnTete(source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return { meta: {}, corps: source };
  const meta = {};
  for (const ligne of m[1].split(/\r?\n/)) {
    const i = ligne.indexOf(':');
    if (i > 0) meta[ligne.slice(0, i).trim()] = ligne.slice(i + 1).trim();
  }
  return { meta, corps: source.slice(m[0].length) };
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
    if (liste.length) blocs.push({ type: 'html', html: `<ul>${liste.map((l) => `<li>${enLigne(l)}</li>`).join('')}</ul>` });
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
      const n = titre[1].length;
      blocs.push({ type: 'html', html: `<h${n}>${enLigne(titre[2])}</h${n}>` });
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
  return { slug, meta, blocs: decouper(corps) };
}

export function listerFiches(dossier = DOSSIER_FICHES) {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md')
    .map((f) => lireFiche(f.replace(/\.md$/, ''), dossier))
    .filter(Boolean);
}

/**
 * Publiée seulement si relue. Une fiche sans date de relecture existe dans le
 * dépôt et se prévisualise en développement ; elle ne paraît pas en ligne.
 */
export const publiee = (fiche) => Boolean(fiche?.meta?.relu);

/** Le calcul de la fiche, tel que build-fiches l'a écrit et que git l'a gardé. */
export function lireCalcul(slug, dossier = DOSSIER_CALCULS) {
  if (!SLUG.test(String(slug))) return null;
  const chemin = path.join(dossier, `${slug}.json`);
  return existsSync(chemin) ? JSON.parse(readFileSync(chemin, 'utf8')) : null;
}
