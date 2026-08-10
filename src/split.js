import { outline } from './outline.js';
import { socle } from './rcp-plan.js';

/**
 * Découpe un document en rubriques exploitables.
 *
 * `outline()` repère les titres et les réécrit avec un identifiant ; il ne
 * reste qu'à couper entre deux titres. Le contenu qui précède la première
 * rubrique est l'en-tête du document (titre, date de mise à jour) : il n'est
 * rattaché à aucune rubrique et n'est pas conservé ici — la source, elle,
 * reste intacte dans cis_documents.
 *
 * À incrémenter dès que la détection change : le suivi rejoue alors les
 * documents dont le contenu n'a pourtant pas bougé.
 */
// 5 : conduite reposée en vrais points, et reconnue à travers les retours
//     à la ligne du HTML indenté de la BDPM.
// 4 : conduites de points de la rubrique 2 rendues à la largeur.
// 3 : lignes recollées en paragraphes, listes à puces reconnues.
// 2 : plan de notice reconnu à la rédaction, reprises de plan séparées dans
//     les PDF de l’EMA, sommaires écartés, « Informations cliniques » admis.
export const PARSER_VERSION = 6;

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
 * Recompose les lignes de composition en conduite de points.
 *
 * La BDPM écrit la rubrique 2 comme dans un document imprimé :
 * « Anastrozole........................... 1,00 mg », les points servant à
 * mener l'œil du nom jusqu'au dosage. Une conduite de points a une longueur
 * fixe, calculée pour une largeur de page ; dans un navigateur elle déborde,
 * se replie, et la substance, les points et la dose finissent sur trois lignes
 * séparées, ce qui rompt précisément le lien qu'elle devait établir.
 *
 * On rend donc le rôle à sa forme : le nom à gauche, la dose à droite, et
 * entre les deux un filet qui prend la place qui reste, quelle que soit la
 * largeur.
 */
const PARAGRAPHE = /<p([^>]*)>([\s\S]*?)<\/p>/gi;
const LEADER = '[.\\u00b7\\u2026]';
const CONDUITE = new RegExp(`${LEADER}{4,}`, 'g');

// Une conduite assez longue pour la plus large des mesures ; le conteneur la
// coupe à la largeur exacte. Ce sont de vrais points, dans la police du texte,
// et non un pointillé dessiné par le navigateur — c'est la conduite du
// document, pas son imitation.
const POINTS = '.'.repeat(160);

// Balises sans contenu : elles n'ouvrent rien, donc elles ne comptent pas.
const VIDES = new Set(['br', 'hr', 'img', 'wbr']);
const BALISE = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;

/**
 * Portions de texte situées hors de toute balise.
 *
 * On ne coupe qu'à la profondeur zéro. Le document de l'ANSM enveloppe parfois
 * la ligne entière — nom, points et dose — dans un seul élément ; y trancher
 * laissait une balise ouverte d'un côté et une fermante de l'autre. Le
 * navigateur répare comme il l'entend, en clonant l'ouvrante, et les trois
 * cases se retrouvent chacune dans un élément intercalé qui n'a aucune de nos
 * règles : le nom s'écrase, le filet déborde. Mieux vaut renoncer à la
 * conduite que rendre un document déchiré.
 *
 * @returns {[number, number][]} intervalles [début, fin) hors balise
 */
function horsBalise(contenu) {
  const segments = [];
  let depuis = 0;
  let profondeur = 0;

  BALISE.lastIndex = 0;
  let m;
  while ((m = BALISE.exec(contenu))) {
    if (profondeur === 0 && m.index > depuis) segments.push([depuis, m.index]);
    const autonome = m[3] === '/' || VIDES.has(m[2].toLowerCase());
    if (!autonome) profondeur = Math.max(0, profondeur + (m[1] === '/' ? -1 : 1));
    depuis = BALISE.lastIndex;
  }
  if (profondeur === 0 && depuis < contenu.length) segments.push([depuis, contenu.length]);

  return segments;
}

/**
 * Où couper : la première conduite qui laisse un nom et une dose.
 *
 * Un paragraphe fait de points seuls n'est pas une composition, et une ligne
 * qui se termine par des points non plus — d'où l'exigence des deux côtés.
 */
function coupure(contenu) {
  for (const [debut, fin] of horsBalise(contenu)) {
    const segment = contenu.slice(debut, fin);
    CONDUITE.lastIndex = 0;
    let m;
    while ((m = CONDUITE.exec(segment))) {
      const nom = contenu.slice(0, debut + m.index);
      const dose = contenu.slice(debut + m.index + m[0].length);
      if (detaguer(nom).trim() && detaguer(dose).trim()) return [nom, dose];
    }
  }
  return null;
}

export function composerDoses(html) {
  return String(html ?? '').replace(PARAGRAPHE, (bloc, attrs, contenu) => {
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

  // Bornes de chaque titre dans le HTML réécrit.
  const bornes = [...marque.matchAll(TITRES_MARQUES)].map((m) => ({
    id: m[2],
    debut: m.index,
    fin: m.index + m[0].length,
  }));

  const parId = new Map(bornes.map((b) => [b.id, b]));

  const sections = titres.map((titre, i) => {
    const borne = parId.get(titre.id);
    const suivante = parId.get(titres[i + 1]?.id);
    const contenu = borne ? marque.slice(borne.fin, suivante?.debut ?? marque.length) : '';

    return {
      position: i,
      numero: titre.number,
      libelle: titre.label,
      profondeur: titre.depth,
      canonical: titre.canonical,
      html: composerDoses(contenu.trim()),
      texte: detaguer(contenu),
    };
  });

  // Une rubrique socle absente signale un découpage incomplet : son contenu a
  // silencieusement fusionné dans la précédente. Sur un RCP, « 4.3
  // Contre-indications » avalée par la posologie ne se voit pas à la lecture.
  const trouves = new Set(sections.map((s) => s.numero));
  const manquantes = attendues.filter((n) => !trouves.has(n));

  return {
    sections,
    statut: manquantes.length === 0 ? 'ok' : 'partiel',
    manquantes,
  };
}
