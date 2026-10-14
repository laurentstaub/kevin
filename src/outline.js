import { canonicalLabel, rubriqueReconnue } from './rcp-plan.js';

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

const TABLEAUX = /<table\b[\s\S]*?<\/table>/gi;

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
 * Poids d'un titre qui a la tournure attendue de sa rubrique (rcp-plan.js),
 * contre 1 pour un simple numéro : une liste de onze étapes (« 7. Remplacer
 * l'aiguille », « 8. Chasser l'air ») ne bat plus un plan de six rubriques.
 */
export const POIDS_RECONNU = 10;

/**
 * Garde la sous-suite strictement croissante de numéros de plus grand poids :
 * écarte les faux titres du corps (« 3 ans. » après 6.3, les étapes d'un mode
 * d'emploi, une adresse « 8 RUE … »). Un parcours glouton s'ancrerait sur le
 * premier faux positif. Sans type ni titre reconnu, c'est la plus longue.
 */

export function coherentes(candidats, { type } = {}) {
  const reconnu = (candidat) => rubriqueReconnue(type, candidat.number, candidat.label);
  // Une notice a six rubriques, parfois une septième (instructions d'utilisation) :
  // au-delà, des étapes ou des adresses (« 8 RUE DES GRANDES TERRES »).
  const maximum = (candidat) => (type !== 'notice' ? RUBRIQUE_MAX : reconnu(candidat) ? 7 : 6);
  const eligibles = candidats.filter((candidat) => parts(candidat.number)[0] <= maximum(candidat));
  if (eligibles.length === 0) return [];

  const numeros = eligibles.map((eligible) => parts(eligible.number));
  const poids = eligibles.map((eligible) => (reconnu(eligible) ? POIDS_RECONNU : 1));
  const longueur = [...poids];
  const parent = eligibles.map(() => -1);

  for (let i = 1; i < eligibles.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (compare(numeros[i], numeros[j]) > 0 && longueur[j] + poids[i] > longueur[i]) {
        longueur[i] = longueur[j] + poids[i];
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

/**
 * Écarte un sommaire (« Que contient cette notice ? ») : au moins trois titres
 * qui se suivent (1, 2, 3…) sans texte entre eux, et dont la numérotation
 * reprend plus loin. Sans cela, sommaire et vrais titres font deux suites de
 * même longueur, `coherentes` garde la première, et toute la notice tombe dans
 * la rubrique 6 (628 notices BDPM à titres en paragraphes). Même règle que
 * `sansSommaire` de pdf.js, qui lit des lignes au lieu de balises.
 */
function sansSommaire(html, candidats) {
  const colles = (a, b) => b.number === String(Number(a.number) + 1)
    && stripTags(html.slice(a.index + a.match.length, b.index)) === '';

  const aRetirer = new Set();
  for (let i = 0; i < candidats.length; i += 1) {
    let j = i;
    while (j + 1 < candidats.length && colles(candidats[j], candidats[j + 1])) j += 1;
    const reprise = candidats.slice(j + 1).some((candidat) => candidat.number === candidats[i].number);
    if (j - i >= 2 && reprise) for (let retire = i; retire <= j; retire += 1) aRetirer.add(retire);
    i = j;
  }

  const restants = candidats.filter((_, i) => !aRetirer.has(i));
  return restants.filter((candidat) => candidat.numbered).length >= 3 ? restants : candidats;
}

/** « 4 » -> 1, « 4.2 » -> 2, au-delà on plafonne. */
const depthOf = (number) => Math.min(number.split('.').length, 3);

function renderHeading(number, label, canonical) {
  const cls = canonical || !isAllCaps(label) ? 'lab' : 'lab lab-brut';
  const num = number ? `<span class="num">${escape(number)}</span>` : '';
  return `${num}<span class="${cls}">${escape(label)}</span>`;
}

/**
 * Passe de repérage : liste les titres candidats, sans rien modifier.
 * Une rubrique ne se trouve pas dans une cellule de tableau : « 7 kg », « 8 kg »…
 * d'une table de posologie passeraient sinon pour les rubriques 7 et suivantes.
 * Repli sur les tableaux si le document y range ses titres (mise en page ancienne).
 */
function reperer(html, motif, { exigerNumero, profondeurParDefaut }) {
  const tableaux = [...html.matchAll(TABLEAUX)].map((tableau) => [tableau.index, tableau.index + tableau[0].length]);
  const dansTableau = (index) => tableaux.some(([debut, fin]) => index > debut && index < fin);
  const candidats = [];
  const enTableau = [];

  for (const correspondance of html.matchAll(motif)) {
    const raw = decode(stripTags(correspondance[3])).replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > LONGUEUR_MAX) continue;

    const { number, label, canonical } = splitHeading(raw);
    if (exigerNumero && !number) continue;

    (dansTableau(correspondance.index) ? enTableau : candidats).push({
      match: correspondance[0],
      index: correspondance.index,
      number,
      label,
      canonical,
      depth: number ? depthOf(number) : profondeurParDefaut(correspondance[1]),
      numbered: number !== null,
    });
  }

  const numerotes = (liste) => liste.filter((candidat) => candidat.numbered).length;
  if (numerotes(candidats) >= 3) return candidats;
  return [...candidats, ...enTableau].sort((a, b) => a.index - b.index);
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
    candidats = coherentes(sansSommaire(
      html, reperer(html, BLOCS, { exigerNumero: true, profondeurParDefaut: () => 2 }),
    ), { type });
  }

  if (candidats.filter((candidat) => candidat.numbered).length < 3) return { html, sections: [] };

  // Avant la première rubrique numérotée : titre du document, déjà affiché, retiré.
  const premier = candidats.findIndex((candidat) => candidat.numbered);
  const aRetirer = candidats.slice(0, premier);
  const aPoser = candidats.slice(premier);

  // Le HTML se réécrit par positions, relevées sur l'original, et non par texte :
  // `replace(candidat.match, …)` visait la première occurrence identique (un
  // sommaire semblable au plan, un bloc répété) et interprétait les `$` d'un
  // libellé (`$'` recopiait la suite du document).
  const sections = [];
  const poses = aPoser.map((candidat, i) => {
    const id = `${type}-${i + 1}`;
    const { number, label, canonical, depth, numbered } = candidat;
    const [, tag, attrs] = candidat.match.match(/^<(\w+)([^>]*)>/);
    sections.push({ id, number, label, canonical, depth, numbered });
    return {
      debut: candidat.index,
      fin: candidat.index + candidat.match.length,
      texte: `<${tag}${attrs} id="${id}" class="doc-heading">${renderHeading(number, label, canonical)}</${tag}>`,
    };
  });

  // Un retrait inclus dans un titre posé (un <h2> d'habillage dans le <div>
  // numéroté) est sans objet : retiré d'abord, il empêchait de poser le titre.
  const chevauche = (a, b) => a.debut < b.fin && b.debut < a.fin;
  const retraits = [...habillage, ...aRetirer]
    .map((candidat) => ({ debut: candidat.index, fin: candidat.index + candidat.match.length, texte: '' }))
    .filter((retrait) => !poses.some((pose) => chevauche(pose, retrait)));

  let out = '';
  let curseur = 0;
  for (const modification of [...poses, ...retraits].sort((a, b) => a.debut - b.debut)) {
    if (modification.debut < curseur) continue;
    out += html.slice(curseur, modification.debut) + modification.texte;
    curseur = modification.fin;
  }
  out += html.slice(curseur);

  return { html: out, sections };
}
