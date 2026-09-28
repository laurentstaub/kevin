import { canonicalLabel } from './rcp-plan.js';

/**
 * Extrait le plan d'un RCP ou d'une notice (numéro, libellé) et pose les ancres.
 * Les titres BDPM sont des paragraphes, pas des h1-h4 : détection par motif,
 * puis contrôle de la progression des numéros (« 3 ans. » n'est pas la rubrique 3).
 * Entrée : HTML assaini. Identifiants générés ici, jamais repris du document.
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

/** Découpe un titre en numéro et libellé ; libellé du plan type rétabli s'il correspond. */
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
 * Garde la plus longue sous-suite strictement croissante de numéros : écarte
 * les faux titres du corps (« 3 ans. » après 6.3). Un parcours glouton
 * s'ancrerait sur le premier faux positif.
 */
export function coherentes(candidats) {
  const eligibles = candidats.filter((candidat) => parts(candidat.number)[0] <= RUBRIQUE_MAX);
  if (eligibles.length === 0) return [];

  const numeros = eligibles.map((eligible) => parts(eligible.number));
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

  for (const correspondance of html.matchAll(motif)) {
    const raw = decode(stripTags(correspondance[3])).replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > LONGUEUR_MAX) continue;

    const { number, label, canonical } = splitHeading(raw);
    if (exigerNumero && !number) continue;

    candidats.push({
      match: correspondance[0],
      number,
      label,
      canonical,
      depth: number ? depthOf(number) : profondeurParDefaut(correspondance[1]),
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

  // 1. Vrais titres, retenus seulement s'ils sont numérotés (le <h1> BDPM n'est que le titre de page).
  let candidats = reperer(html, TITRES, {
    exigerNumero: false,
    profondeurParDefaut: (tag) => Number(tag[1]) - 1,
  });

  // 2. Sinon, blocs filtrés par progression des numéros ; les titres de la passe 1
  //    sont alors de l'habillage, retiré du corps.
  const habillage = [];
  if (candidats.filter((candidat) => candidat.numbered).length < 3) {
    habillage.push(...candidats.filter((candidat) => !candidat.numbered));
    candidats = coherentes(
      reperer(html, BLOCS, { exigerNumero: true, profondeurParDefaut: () => 2 }),
    );
  }

  if (candidats.filter((candidat) => candidat.numbered).length < 3) return { html, sections: [] };

  // Avant la première rubrique numérotée : titre du document, déjà affiché, retiré.
  const premier = candidats.findIndex((candidat) => candidat.numbered);
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
