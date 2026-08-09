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
// 3 : lignes recollées en paragraphes, listes à puces reconnues.
// 2 : plan de notice reconnu à la rédaction, reprises de plan séparées dans
//     les PDF de l’EMA, sommaires écartés, « Informations cliniques » admis.
export const PARSER_VERSION = 3;

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
      html: contenu.trim(),
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
