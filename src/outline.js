import { canonicalLabel } from './rcp-plan.js';

/**
 * Extrait le plan d'un RCP ou d'une notice, découpe chaque titre en numéro et
 * libellé, et pose les ancres correspondantes.
 *
 * Un RCP fait quinze à quarante mille signes en rubriques numérotées. Servi
 * d'un bloc, c'est un mur. Servi avec son plan, il se parcourt comme un
 * sommaire — c'est là que le document devient consultable au comptoir.
 *
 * Les documents scrapés de la BDPM n'utilisent pas h1-h4 : leurs titres sont
 * des paragraphes, parfois enveloppés dans une ancre. On ne se fie donc pas à
 * la balise mais au motif, ce qui impose de vérifier ensuite que la suite des
 * numéros se tient — sans quoi « 3 ans. » passe pour une rubrique 3.
 *
 * L'entrée est du HTML déjà assaini ; les identifiants sont générés ici,
 * jamais repris du document.
 */

// « 4.2 Posologie », « 6.3. Durée de conservation », « 10. Date de mise à jour »
const NUMBERED = /^(\d{1,2}(?:\.\d{1,2})*)\.?\s+(\S[\s\S]*)$/;

const TITRES = /<(h[1-4])([^>]*)>([\s\S]*?)<\/\1>/gi;
const BLOCS = /<(p|div)([^>]*)>([\s\S]{0,400}?)<\/\1>/gi;

const LONGUEUR_MAX = 250; // un titre de notice contient le nom complet du produit
const RUBRIQUE_MAX = 12; // le plan type s'arrête à 12

const stripTags = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const decode = (text) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const escape = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const isAllCaps = (text) => text === text.toUpperCase() && /[A-ZÀ-Þ]/.test(text);

/**
 * Découpe un titre en numéro et libellé, et rétablit casse et accents quand
 * le libellé correspond à une rubrique du plan type.
 */
export function splitHeading(text) {
  const match = text.match(NUMBERED);
  if (!match) return { number: null, label: text, canonical: false };

  const [, number, rest] = match;
  const canonical = canonicalLabel(number, rest);

  return { number, label: canonical ?? rest, canonical: canonical !== null };
}

const parts = (number) => number.split('.').map(Number);

const compare = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? -1) - (b[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
};

/**
 * Ne garde que les numéros qui forment une progression cohérente.
 *
 * Le motif seul ne suffit pas : dans le corps d'un RCP, « 3 ans. » (contenu de
 * la rubrique 6.3) et « 30 comprimés sous plaquettes » (contenu de la 6.5)
 * ressemblent à des titres. Ce qui les trahit, c'est la place — une rubrique 3
 * ne vient pas après la 6.3.
 *
 * On retient donc la plus longue sous-suite strictement croissante. Les vrais
 * titres en forment une longue ; le bruit, isolé, en est exclu. Un simple
 * parcours de proche en proche ne suffirait pas : le premier faux positif
 * rencontré ancrerait la suite au mauvais endroit.
 */
export function coherentes(candidats) {
  const eligibles = candidats.filter((c) => parts(c.number)[0] <= RUBRIQUE_MAX);
  if (eligibles.length === 0) return [];

  const numeros = eligibles.map((c) => parts(c.number));
  const longueur = eligibles.map(() => 1);
  const parent = eligibles.map(() => -1);

  for (let i = 1; i < eligibles.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (compare(numeros[i], numeros[j]) > 0 && longueur[j] + 1 > longueur[i]) {
        longueur[i] = longueur[j] + 1;
        parent[i] = j;
      }
    }
  }

  let fin = 0;
  for (let i = 1; i < eligibles.length; i += 1) {
    if (longueur[i] > longueur[fin]) fin = i;
  }

  const suite = [];
  for (let i = fin; i !== -1; i = parent[i]) suite.unshift(eligibles[i]);
  return suite;
}

/** « 4 » -> 1, « 4.2 » -> 2, au-delà on plafonne. */
const depthOf = (number) => Math.min(number.split('.').length, 3);

function renderHeading(number, label, canonical) {
  const cls = canonical || !isAllCaps(label) ? 'lab' : 'lab lab-brut';
  const num = number ? `<span class="num">${escape(number)}</span>` : '';
  return `${num}<span class="${cls}">${escape(label)}</span>`;
}

/** Passe de repérage : liste les titres candidats, sans rien modifier. */
function reperer(html, motif, { exigerNumero, profondeurParDefaut }) {
  const candidats = [];

  for (const m of html.matchAll(motif)) {
    const raw = decode(stripTags(m[3])).replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > LONGUEUR_MAX) continue;

    const { number, label, canonical } = splitHeading(raw);
    if (exigerNumero && !number) continue;

    candidats.push({
      match: m[0],
      number,
      label,
      canonical,
      depth: number ? depthOf(number) : profondeurParDefaut(m[1]),
      numbered: number !== null,
    });
  }

  return candidats;
}

/**
 * @param {string} html - HTML assaini
 * @param {string} [type] - type de document, pour préfixer les ancres
 * @returns {{ html: string, sections: object[] }}
 */
export function outline(html, type = 'doc') {
  if (!html) return { html: '', sections: [] };

  // 1. Vrais titres — mais ils ne font foi que s'ils portent la numérotation.
  //    Une page de la BDPM contient un <h1>, son titre, et rien d'autre : s'y
  //    fier ferait conclure « ce document a des titres » et manquer les
  //    rubriques, qui sont des <p class="AmmAnnexeTitre*">.
  let candidats = reperer(html, TITRES, {
    exigerNumero: false,
    profondeurParDefaut: (tag) => Number(tag[1]) - 1,
  });

  // 2. Sinon, titres déguisés en blocs : le motif désigne les candidats,
  //    la progression des numéros tranche. Les titres de la première passe
  //    sont alors l'habillage de la page — le <h1> reprend la dénomination
  //    déjà affichée au-dessus — et sont retirés du corps.
  const habillage = [];
  if (candidats.filter((c) => c.numbered).length < 3) {
    habillage.push(...candidats.filter((c) => !c.numbered));
    candidats = coherentes(
      reperer(html, BLOCS, { exigerNumero: true, profondeurParDefaut: () => 2 }),
    );
  }

  if (candidats.filter((c) => c.numbered).length < 3) return { html, sections: [] };

  // Tout ce qui précède la première rubrique numérotée est le titre du
  // document : déjà affiché au-dessus, il est retiré du corps comme du plan.
  const premier = candidats.findIndex((c) => c.numbered);
  const aRetirer = candidats.slice(0, premier);
  const aPoser = candidats.slice(premier);

  let out = html;
  const sections = [];

  for (const candidat of [...habillage, ...aRetirer]) {
    out = out.replace(candidat.match, '');
  }

  aPoser.forEach((candidat, i) => {
    const id = `${type}-${i + 1}`;
    const { number, label, canonical, depth, numbered } = candidat;
    const balise = candidat.match.match(/^<(\w+)([^>]*)>/);
    const [, tag, attrs] = balise;

    out = out.replace(
      candidat.match,
      `<${tag}${attrs} id="${id}" class="doc-heading">${renderHeading(number, label, canonical)}</${tag}>`,
    );

    sections.push({ id, number, label, canonical, depth, numbered });
  });

  return { html: out, sections };
}
