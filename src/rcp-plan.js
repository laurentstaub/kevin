import { deaccent } from './text.js';

/**
 * Plan type du RCP (modèle QRD, version française ANSM), pour rétablir casse et
 * accents uniquement : retenu seulement s'il correspond mot pour mot à la source
 * normalisée. Plusieurs rédactions possibles selon l'ancienneté de l'AMM.
 */
const RCP = {
  '1': ['Dénomination du médicament'],
  '2': ['Composition qualitative et quantitative'],
  '3': ['Forme pharmaceutique'],
  '4': ['Données cliniques', 'Informations cliniques'],
  '4.1': ['Indications thérapeutiques'],
  '4.2': ["Posologie et mode d'administration"],
  '4.3': ['Contre-indications'],
  '4.4': ["Mises en garde spéciales et précautions d'emploi"],
  '4.5': ["Interactions avec d'autres médicaments et autres formes d'interactions"],
  '4.6': ['Fertilité, grossesse et allaitement', 'Grossesse et allaitement'],
  '4.7': ["Effets sur l'aptitude à conduire des véhicules et à utiliser des machines"],
  '4.8': ['Effets indésirables'],
  '4.9': ['Surdosage'],
  '5': ['Propriétés pharmacologiques'],
  '5.1': ['Propriétés pharmacodynamiques'],
  '5.2': ['Propriétés pharmacocinétiques'],
  '5.3': ['Données de sécurité préclinique'],
  '6': ['Données pharmaceutiques'],
  '6.1': ['Liste des excipients'],
  '6.2': ['Incompatibilités'],
  '6.3': ['Durée de conservation'],
  '6.4': ['Précautions particulières de conservation'],
  '6.5': ["Nature et contenu de l'emballage extérieur"],
  '6.6': [
    "Précautions particulières d'élimination et de manipulation",
    "Précautions particulières d'élimination",
  ],
  '7': ["Titulaire de l'autorisation de mise sur le marché"],
  '8': ["Numéro(s) d'autorisation de mise sur le marché"],
  '9': ["Date de première autorisation/de renouvellement de l'autorisation"],
  '10': ['Date de mise à jour du texte'],
  '11': ['Dosimétrie'],
  '12': ['Instructions pour la préparation des radiopharmaceutiques'],
};

/**
 * Rubriques toujours présentes dans un RCP complet : une absence signale un
 * titre raté (contrôle qualité du découpage). Les rubriques facultatives en sont exclues.
 */
export const RUBRIQUES_SOCLE = [
  '1', // dénomination
  '2', // composition
  '3', // forme pharmaceutique
  '4.1', // indications
  '4.2', // posologie
  '4.3', // contre-indications
  '4.4', // mises en garde
  '4.8', // effets indésirables
  '6.1', // excipients
];

/** Notice : six rubriques ; libellés non normalisables (nom du produit), seule la numérotation compte. */
export const RUBRIQUES_SOCLE_NOTICE = ['1', '2', '3', '4', '5', '6'];

/**
 * Tournure attendue de chaque rubrique de notice : écarte les listes numérotées
 * du corps (une procédure en six étapes a la forme d'un plan).
 */
const NOTICE = {
  // Tolère tiret manquant ou doublé et « que » absent (extraction PDF).
  '1': /qu.{0,2}est.{0,3}ce /,
  '2': /informations? a connaitre/,
  '3': /comment/, // « Comment prendre X », « Comment X est-il administré ? »
  '4': /(effets|evenements) (indesirables|secondaires)/,
  '5': /comment.*conserv|^conservation/, // « Comment X est-il conservé ? »
  '6': /contenu de (l.?emballage|la boite)|informations? supplementaires/,
  '7': /instructions? d.?utilisation|mode d.?emploi/,
};

/**
 * Mots attendus dans le titre de chaque rubrique du RCP, plus tolérants que le
 * libellé QRD exact (rédactions anciennes) : distinguent le plan d'une liste
 * numérotée du corps (« 7. Remplacer l'aiguille » n'est pas la rubrique 7).
 */
const RCP_MOTS = {
  '1': /denomination/, '2': /composition/, '3': /forme pharmaceutique/,
  '4': /donnees cliniques|informations cliniques/, '4.1': /indication/, '4.2': /posologie/,
  '4.3': /contre.?indication/, '4.4': /mises? en garde|precautions? d.?emploi/, '4.5': /interaction/,
  '4.6': /grossesse|allaitement|fecondite|fertilite/, '4.7': /conduire|aptitude/,
  '4.8': /effets? indesirable/, '4.9': /surdosage/, '5': /proprietes pharmacologiques/,
  '5.1': /pharmacodynamique/, '5.2': /pharmacocinetique/, '5.3': /preclinique/,
  '6': /donnees pharmaceutiques/, '6.1': /excipient/, '6.2': /incompatibilite/, '6.3': /duree de conservation/,
  '6.4': /conservation/, '6.5': /emballage|conditionnement|recipient/, '6.6': /elimination|manipulation/,
  '7': /titulaire/, '8': /autorisation/, '9': /premiere autorisation|renouvellement/,
  '10': /mise a jour|revision/, '11': /dosimetrie/, '12': /radiopharmaceutique|preparation/,
};

/**
 * Longueur au-delà de laquelle un libellé est une phrase du corps (« 4.2 La
 * posologie doit être adaptée… »), pas un titre. Le plus long libellé QRD du
 * RCP fait 74 caractères ; un titre de notice porte le nom complet du produit.
 */
const TITRE_MAX = { rcp: 100, rcp_notice: 100, notice: 320 };

/** Ce titre a-t-il la tournure attendue de sa rubrique, selon le type de document ? */
export function rubriqueReconnue(type, numero, libelle) {
  const plan = type === 'notice' ? NOTICE : type === 'rcp' || type === 'rcp_notice' ? RCP_MOTS : null;
  const motif = plan?.[numero];
  const texte = String(libelle ?? '');
  return motif ? texte.length <= TITRE_MAX[type] && motif.test(deaccent(texte).toLowerCase()) : false;
}

/** Ce libellé peut-il être la rubrique `numero` d'une notice ? */
export function rubriqueNotice(numero, libelle) {
  const motif = NOTICE[numero];
  return motif ? motif.test(deaccent(String(libelle ?? '')).toLowerCase()) : false;
}

/** Socle attendu selon la famille de document. */
export function socle(type) {
  if (type === 'notice') return RUBRIQUES_SOCLE_NOTICE;
  if (type === 'rcp' || type === 'rcp_notice') return RUBRIQUES_SOCLE;
  return []; // « main » est une fiche info, pas un document à rubriques
}

/** Clé de comparaison : sans accents, casse, ponctuation ni espaces. */
const key = (text) =>
  deaccent(String(text ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Libellé de référence s'il correspond au libellé source, sinon null.
 *
 * @param {string} number - « 4.1 », sans point final
 * @param {string} label - libellé tel qu'il figure dans le document
 * @returns {string|null}
 */
export function canonicalLabel(number, label) {
  const candidates = RCP[number];
  if (!candidates) return null;

  const source = key(label);
  return candidates.find((candidate) => key(candidate) === source) ?? null;
}
