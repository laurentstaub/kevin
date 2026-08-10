import { deaccent } from './text.js';

/**
 * Plan type du RCP (modèle QRD, version française ANSM).
 *
 * Les documents scrapés arrivent en capitales et souvent sans accents
 * (« 4. DONNEES CLINIQUES »). Cette table sert uniquement à rétablir la casse
 * et les accents : le libellé canonique n'est retenu que s'il correspond,
 * mot pour mot, au libellé source une fois normalisé. Jamais de substitution
 * de contenu sur une page médicale — une rubrique dont le titre a changé de
 * rédaction garde le sien.
 *
 * Certaines rubriques ont deux rédactions selon l'ancienneté de l'AMM :
 * elles sont toutes listées, et c'est celle qui correspond qui est retenue.
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
 * Rubriques qu'un RCP complet comporte toujours. Leur absence après découpage
 * ne veut pas dire que le médicament n'a pas de contre-indications : elle veut
 * dire qu'on a raté le titre, et que son contenu a fusionné dans la rubrique
 * précédente. C'est le contrôle qualité du découpage.
 *
 * Volontairement restreint aux rubriques non facultatives : 4.7, 4.9, 5.3,
 * 6.2, 6.4 et suivantes peuvent légitimement manquer.
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

/**
 * La notice suit un plan différent — six rubriques, dont les libellés
 * contiennent le nom du produit et ne peuvent donc pas être normalisés.
 * Seule la numérotation fait foi.
 */
export const RUBRIQUES_SOCLE_NOTICE = ['1', '2', '3', '4', '5', '6'];

/**
 * Tournure attendue de chaque rubrique de notice.
 *
 * Le libellé contient le nom du produit : impossible de le comparer mot pour
 * mot comme pour le RCP. On reconnaît seulement sa tournure — ce qui suffit à
 * écarter les listes numérotées du corps. Une procédure de reconstitution en
 * six étapes a exactement la forme d'un plan, et le filtre de cohérence n'a
 * aucun moyen de les distinguer par la seule numérotation.
 */
const NOTICE = {
  // « Qu'est-ce que X… », mais aussi « Qu'est ce X… » : le tiret manque ou se
  // dédouble selon l'extraction du PDF, et le « que » saute parfois.
  '1': /qu.{0,2}est.{0,3}ce /,
  '2': /informations? a connaitre/,
  '3': /comment/, // « Comment prendre X », « Comment X est-il administré ? »
  '4': /(effets|evenements) (indesirables|secondaires)/,
  '5': /comment.*conserv|^conservation/, // « Comment X est-il conservé ? »
  '6': /contenu de (l.?emballage|la boite)|informations? supplementaires/,
  '7': /instructions? d.?utilisation|mode d.?emploi/,
};

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

/** Forme comparable : sans accents, sans casse, sans ponctuation ni espaces. */
const key = (text) =>
  deaccent(String(text ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Libellé de référence d'une rubrique, si et seulement s'il correspond au
 * libellé source. Sinon null : la source fait foi.
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
