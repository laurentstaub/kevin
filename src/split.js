import { outline } from './outline.js';
import { socle } from './rcp-plan.js';
import { structurer, renvois } from './typographie.js';

/**
 * Découpe un document en rubriques, entre les titres marqués par `outline()`.
 * L'en-tête avant la première rubrique n'est pas conservé (la source reste dans cis_documents).
 *
 * PARSER_VERSION : à incrémenter dès que la détection change, pour rejouer les documents.
 */
// 14 : titres ignorés dans les tableaux (« 7 kg » d'une table de posologie).
// 13 : infobulle de destination des renvois.  12 : renvois ancrés sur « rubrique ».
// 11 : renvois « voir rubrique 4.6 » en liens.  10 : thésaurus des interactions (4.5).
// 9 : notes par astérisque (QRD).  8 : listes imbriquées, sous-titres QRD, espaces insécables.
// 5 : conduite en vrais points.  4 : conduites de points (rubrique 2).  3 : paragraphes, puces.
// 2 : plan de notice, reprises de plan EMA, sommaires écartés.
export const PARSER_VERSION = 14;

/** Titres posés par outline(), dans l'ordre du document. */
const TITRES_MARQUES = /<(h[1-4]|p|div)[^>]*\sid="([^"]+)"[^>]*class="doc-heading"[^>]*>[\s\S]*?<\/\1>/g;

const decode = (texte) =>
  texte
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** Version indexable : sans balises, sans entités, espaces normalisés. */
export function detaguer(html) {
  return decode(String(html ?? '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recompose les conduites de points de la rubrique 2 (« Anastrozole...... 1,00 mg ») :
 * nom à gauche, dose à droite, points extensibles entre les deux.
 * Une conduite de longueur fixe se replie sur trois lignes dans un navigateur.
 */
const PARAGRAPHE = /<p([^>]*)>([\s\S]*?)<\/p>/gi;
const LEADER = '[.\\u00b7\\u2026]';
const CONDUITE = new RegExp(`${LEADER}{4,}`, 'g');

// Plus long que la plus large mesure ; le conteneur coupe à la largeur exacte.
const POINTS = '.'.repeat(160);

// Balises vides : n'augmentent pas la profondeur.
const VIDES = new Set(['br', 'hr', 'img', 'wbr']);
const BALISE = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;

/**
 * Portions de texte hors de toute balise : couper dans un élément produirait
 * un HTML mal imbriqué, que le navigateur répare mal.
 *
 * @returns {[number, number][]} intervalles [début, fin) hors balise
 */
function horsBalise(contenu) {
  const segments = [];
  let depuis = 0;
  let profondeur = 0;

  BALISE.lastIndex = 0;
  let correspondance;
  while ((correspondance = BALISE.exec(contenu))) {
    if (profondeur === 0 && correspondance.index > depuis) segments.push([depuis, correspondance.index]);
    const autonome = correspondance[3] === '/' || VIDES.has(correspondance[2].toLowerCase());
    if (!autonome) profondeur = Math.max(0, profondeur + (correspondance[1] === '/' ? -1 : 1));
    depuis = BALISE.lastIndex;
  }
  if (profondeur === 0 && depuis < contenu.length) segments.push([depuis, contenu.length]);

  return segments;
}

/** Première conduite avec du texte des deux côtés (nom et dose). */
function coupure(contenu) {
  for (const [debut, fin] of horsBalise(contenu)) {
    const segment = contenu.slice(debut, fin);
    CONDUITE.lastIndex = 0;
    let correspondance;
    while ((correspondance = CONDUITE.exec(segment))) {
      const nom = contenu.slice(0, debut + correspondance.index);
      const dose = contenu.slice(debut + correspondance.index + correspondance[0].length);
      if (detaguer(nom).trim() && detaguer(dose).trim()) return [nom, dose];
    }
  }
  return null;
}

export function composerDoses(html) {
  return String(html ?? '').replace(PARAGRAPHE, (bloc, attrs, contenu) => {
    // Déjà classé par `structurer` : un second attribut `class` serait ignoré.
    if (/\bclass\s*=/.test(attrs)) return bloc;

    const trouve = coupure(contenu);
    if (!trouve) return bloc;

    const [nom, dose] = trouve;

    return (
      `<p${attrs} class="dose">` +
      `<span class="dose-nom">${nom.trim()}</span>` +
      `<span class="dose-liaison" aria-hidden="true">${POINTS}</span>` +
      `<span class="dose-valeur">${dose.trim()}</span>` +
      '</p>'
    );
  });
}

/**
 * @param {string} html - HTML assaini
 * @param {string} type - type de document (préfixe des ancres)
 * @returns {{ sections: object[], statut: string, manquantes: string[] }}
 */
export function splitDocument(html, type = 'doc') {
  const { html: marque, sections: titres } = outline(html, type);

  const attendues = socle(type);

  if (titres.length === 0) {
    return { sections: [], statut: 'echec', manquantes: [...attendues] };
  }

  const bornes = [...marque.matchAll(TITRES_MARQUES)].map((correspondance) => ({
    id: correspondance[2],
    debut: correspondance.index,
    fin: correspondance.index + correspondance[0].length,
  }));

  const parId = new Map(bornes.map((borne) => [borne.id, borne]));

  const sections = titres.map((titre, i) => {
    const borne = parId.get(titre.id);
    const suivante = parId.get(titres[i + 1]?.id);
    const contenu = borne ? marque.slice(borne.fin, suivante?.debut ?? marque.length) : '';

    return {
      position: i,
      // Colonne NOT NULL : '' pour un titre sans numéro (« NOTICE : … »).
      numero: titre.number ?? '',
      libelle: titre.label,
      profondeur: titre.depth,
      canonical: titre.canonical,
      // Structurer d'abord : les puces devenues <li> échappent à la recherche de conduite.
      html: composerDoses(structurer(contenu.trim())),
      texte: detaguer(contenu),
    };
  });

  // Renvois après découpage complet. Ancre `${type}-${position}`, identique à celle de sections.js.
  const ancres = new Map(
    sections
      .filter((section) => section.numero)
      .map((section) => [section.numero, { id: `${type}-${section.position}`, libelle: section.libelle }]),
  );
  for (const section of sections) section.html = renvois(section.html, ancres);

  // Rubrique socle absente : son contenu a fusionné dans la précédente, sans que cela se voie.
  const trouves = new Set(sections.map((section) => section.numero));
  const manquantes = attendues.filter((attendue) => !trouves.has(attendue));

  return {
    sections,
    statut: manquantes.length === 0 ? 'ok' : 'partiel',
    manquantes,
  };
}
