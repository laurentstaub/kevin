import { socle } from './rcp-plan.js';

/**
 * Lecture des rubriques déjà découpées (schéma `docs`).
 *
 * Jusqu'ici la fiche produit redécoupait le HTML à chaque requête : le travail
 * était refait pour chaque lecteur, et le résultat n'était consultable que de
 * haut en bas. Le découpage étant maintenant stocké, la page se construit
 * rubrique par rubrique — on peut en ouvrir cinq et laisser les vingt autres
 * fermées.
 *
 * `organiser` est pure : c'est elle qui décide de ce qui s'ouvre et de ce qui
 * n'est qu'une charnière. Le SQL ne fait que fournir les lignes.
 */

/** D'où vient le texte affiché — une page médicale doit le dire. */
export const SOURCES = {
  bdpm_html: 'texte officiel de la BDPM',
  bdpm_pdf: 'reconstruit depuis le PDF européen',
};

/**
 * @param {object[]} rubriques - lignes de docs.rcp_sections, triées par position
 * @param {object[]} etats - lignes de docs.document_parse
 * @returns {Map<string, object>} type de document -> document prêt à afficher
 */
export function organiser(rubriques, etats) {
  const parType = new Map();

  const creer = (type) => ({
    type,
    statut: 'ok',
    manquantes: [],
    source: null,
    parsedAt: null,
    rubriques: [],
  });

  for (const etat of etats) {
    parType.set(etat.document_type, {
      ...creer(etat.document_type),
      statut: etat.statut,
      manquantes: etat.manquantes ?? [],
      source: etat.source,
      parsedAt: etat.parsed_at ?? null,
    });
  }

  for (const r of rubriques) {
    if (!parType.has(r.document_type)) parType.set(r.document_type, creer(r.document_type));

    const essentielles = socle(r.document_type);
    const texte = r.texte ?? '';

    parType.get(r.document_type).rubriques.push({
      id: `${r.document_type}-${r.position}`,
      numero: r.numero,
      libelle: r.libelle,
      profondeur: r.profondeur,
      canonical: r.canonical,
      html: r.html,
      // « 4. Données cliniques » n'a pas de contenu propre : c'est une
      // charnière avant 4.1. Elle sépare, elle ne se déplie pas.
      charniere: texte.trim() === '',
      // Le socle : ce qu'un RCP complet comporte toujours. Sert au contraste
      // du libellé, pas à l'ouverture.
      essentielle: essentielles.includes(r.numero),
      // La rubrique 4 est la partie clinique du RCP : indications, posologie,
      // contre-indications, mises en garde, interactions, grossesse, conduite,
      // effets indésirables, surdosage. C'est tout ce qu'on vient lire devant
      // un patient — elle est dépliée d'office, à sa place dans le document.
      clinique: /^4(\.|$)/.test(r.numero),
    });
  }

  // Un document sans rubrique n'a rien à montrer : l'état d'échec est un
  // renseignement pour l'exploitant, pas pour le lecteur.
  for (const [type, doc] of parType) {
    if (doc.rubriques.length === 0) parType.delete(type);
  }

  return parType;
}

/** Rubriques d'une spécialité, par type de document. */
export async function getSections(pool, cis) {
  const [rubriques, etats] = await Promise.all([
    pool.query(
      `SELECT document_type, position, numero, libelle, profondeur, canonical, html, texte
       FROM docs.rcp_sections
       WHERE code_cis = $1
       ORDER BY document_type, position`,
      [cis],
    ),
    pool.query(
      `SELECT document_type, statut, manquantes, source, parsed_at
       FROM docs.document_parse
       WHERE code_cis = $1`,
      [cis],
    ),
  ]);

  return organiser(rubriques.rows, etats.rows);
}

/**
 * Entrées de sommaire d'un document découpé, plan entier.
 */
export function planDe(doc) {
  return doc.rubriques.map((r) => ({
    id: r.id,
    number: r.numero,
    label: r.libelle,
    depth: r.profondeur,
    canonical: r.canonical,
  }));
}
