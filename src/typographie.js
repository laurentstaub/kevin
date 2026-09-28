/**
 * Rend au texte de la BDPM (Word exporté) la structure qu'il ne porte qu'en
 * caractères : puces, intitulés, espaces, notes, interactions, renvois.
 * Aucun mot n'est modifié, fautes de la source comprises. Module pur, appliqué
 * au découpage pour être rejoué via `PARSER_VERSION`.
 */

const BALISE = /<\/?([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;

/** Intervalles de texte hors de toute balise. */
function horsBalise(html) {
  const zones = [];
  let depuis = 0;
  BALISE.lastIndex = 0;
  let correspondance;
  while ((correspondance = BALISE.exec(html))) {
    if (correspondance.index > depuis) zones.push([depuis, correspondance.index]);
    depuis = BALISE.lastIndex;
  }
  if (depuis < html.length) zones.push([depuis, html.length]);
  return zones;
}

const detaguer = (html) => String(html ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// --------------------------------------------------------------- les puces

/**
 * Deux rangs : « · » ou tiret, puis « o » (puce Courier devenue caractère) ;
 * aucune phrase ne commence ainsi. « a) » et « 1. » sont ignorés : le
 * découpeur s'en sert déjà pour trouver les rubriques.
 */
const RANGS = [
  { rang: 1, motif: /^([·•▪●◦‣]|[-–—])\s+/ },
  { rang: 2, motif: /^(o)\s+/ },
];

/** Le rang d'un paragraphe, ou 0 s'il n'est pas un élément de liste. */
export function rangDePuce(texte) {
  for (const { rang, motif } of RANGS) if (motif.test(texte)) return rang;
  return 0;
}

/**
 * Signe de puce par rang. Word l'isole souvent dans un span, loin de son
 * espace : seul le signe est retiré, le rang est établi sur le texte détagué.
 */
const SIGNES = { 1: /^[·•▪●◦‣\u2010-\u2015-]/, 2: /^o/ };

function sansPuce(interieur, rang) {
  for (const [debut, fin] of horsBalise(interieur)) {
    const segment = interieur.slice(debut, fin);
    if (!segment.trim()) continue;
    const decale = segment.length - segment.trimStart().length;
    if (!SIGNES[rang].test(segment.slice(decale))) return interieur;
    const coupe = debut + decale + 1;
    return interieur.slice(0, debut) + interieur.slice(coupe);
  }
  return interieur;
}

/** Assemble une suite d'éléments de rangs 1 et 2 en listes imbriquées. */
function assembler(elements) {
  let sortie = '<ul>';
  let ouvert = false;
  let premier = true;

  for (const { rang, html } of elements) {
    // Un second rang en tête n'a pas de parent (<ul> dans <ul> invalide) : rang 1.
    const effectif = premier && rang === 2 ? 1 : rang;
    premier = false;

    if (effectif === 2) {
      if (!ouvert) { sortie += '<ul>'; ouvert = true; }
      sortie += `<li>${html}</li>`;
      continue;
    }
    if (ouvert) { sortie += '</ul></li>'; ouvert = false; }
    else if (sortie !== '<ul>') sortie += '</li>';
    sortie += `<li>${html}`;
  }

  if (ouvert) sortie += '</ul>';
  return `${sortie}</li></ul>`;
}

const PARAGRAPHE = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;

/** Paragraphes marqués d'une puce → vraies listes, imbriquées sur deux rangs. */
export function listes(html) {
  const source = String(html ?? '');
  let sortie = '';
  let curseur = 0;
  let paquet = [];

  const vider = () => {
    if (paquet.length > 0) sortie += assembler(paquet);
    paquet = [];
  };

  PARAGRAPHE.lastIndex = 0;
  let correspondance;
  while ((correspondance = PARAGRAPHE.exec(source))) {
    const avant = source.slice(curseur, correspondance.index);
    const rang = rangDePuce(detaguer(correspondance[2]));

    // Entre deux puces, seul du blanc peut s'intercaler sans rompre la liste.
    if (avant.trim()) { vider(); sortie += avant; }
    else if (paquet.length === 0) sortie += avant;

    if (rang === 0) { vider(); sortie += correspondance[0]; }
    else paquet.push({ rang, html: sansPuce(correspondance[2], rang).trim() });

    curseur = correspondance.index + correspondance[0].length;
  }

  vider();
  return sortie + source.slice(curseur);
}

// ----------------------------------------------------------- les intitulés

const sansAccents = (texte) => texte.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clef = (texte) => sansAccents(texte).toLowerCase().replace(/\s*:\s*$/, '').replace(/\s+/g, ' ').trim();

/**
 * Intitulés internes du modèle QRD. Liste close : rien ne les signale dans la
 * source, et un intitulé absent reste un simple paragraphe.
 */
export const SOUS_TITRES = new Set([
  'posologie', 'mode d\'administration', 'voie d\'administration',
  'duree du traitement', 'frequence d\'administration',
  'population pediatrique', 'populations particulieres', 'population agee',
  'personnes agees', 'sujet age', 'patients ages',
  'insuffisance renale', 'insuffisance hepatique',
  'adulte', 'adultes', 'enfant', 'enfants', 'nourrisson', 'nourrissons',
  'grossesse', 'allaitement', 'fertilite',
  'resume du profil de securite', 'liste tabulee des effets indesirables',
  'description de certains effets indesirables',
  'declaration des effets indesirables suspectes',
  'symptomes', 'conduite a tenir', 'traitement',
  'mecanisme d\'action', 'effets pharmacodynamiques',
  'efficacite et securite cliniques',
  'absorption', 'distribution', 'biotransformation', 'metabolisme',
  'elimination', 'excretion', 'linearite/non-linearite',
  // Les quatre niveaux du thésaurus des interactions de l'ANSM (rubrique 4.5).
  'associations contre-indiquees', 'associations deconseillees',
  "associations faisant l'objet de precautions d'emploi",
  'associations a prendre en compte', 'a prendre en compte',
]);

/** Garde-fou contre un faux intitulé. */
const LONGUEUR_MAX = 60;

export function sousTitres(html) {
  return String(html ?? '').replace(PARAGRAPHE, (bloc, attrs, interieur) => {
    const texte = detaguer(interieur);
    if (!texte || texte.length > LONGUEUR_MAX) return bloc;
    if (!SOUS_TITRES.has(clef(texte))) return bloc;
    return `<h5 class="sous-titre">${interieur.trim()}</h5>`;
  });
}

// ------------------------------------------------------------- les espaces

/**
 * Rend insécable l'espace avant un signe double, sans jamais en insérer une :
 * « 50% » et « http:// » restent intacts.
 */
export function espaces(html) {
  const source = String(html ?? '');
  let sortie = '';
  let depuis = 0;

  for (const [debut, fin] of horsBalise(source)) {
    sortie += source.slice(depuis, debut);
    sortie += source.slice(debut, fin)
      .replace(/ ([:;?!%»])/g, ' $1')
      .replace(/(«) /g, '$1 ');
    depuis = fin;
  }
  return sortie + source.slice(depuis);
}

// -------------------------------------------------------------- les notes

/**
 * Appels de note du modèle QRD (« prises de poids* » → « *Les prises… ») : la
 * note est marquée pour peser moins que le texte. L'appel reste, il la relie
 * à sa mention.
 */
const APPEL = /^[*†‡]{1,3}(?=\s*\S)/;

export function notes(html) {
  return String(html ?? '').replace(PARAGRAPHE, (bloc, attrs, interieur) => {
    // Un paragraphe déjà classé a été pris en charge par une autre passe.
    if (/\bclass\s*=/.test(attrs)) return bloc;
    return APPEL.test(detaguer(interieur)) ? `<p class="note"${attrs}>${interieur}</p>` : bloc;
  });
}

// -------------------------------------------------------- les interactions

/**
 * Rubrique 4.5 (thésaurus ANSM) : met en évidence la substance en interaction
 * (« + Millepertuis »). Le « + » reste : il se lit « en association avec ».
 */
const INTERACTION = /^\+\s+(?=\S)/;

export function interactions(html) {
  return String(html ?? '').replace(PARAGRAPHE, (bloc, attrs, interieur) => {
    if (/\bclass\s*=/.test(attrs)) return bloc;
    const texte = detaguer(interieur);
    if (!INTERACTION.test(texte)) return bloc;
    return `<p class="interaction"${attrs}>${interieur}</p>`;
  });
}

// ------------------------------------------------------------ les renvois

/**
 * Change les numéros de « (voir rubrique 4.6) » en liens, avec l'intitulé de la
 * cible en infobulle. Seul le numéro est cliquable ; un renvoi vers une
 * rubrique absente reste du texte.
 *
 * @param {Map<string, {id:string, libelle:string}>} cibles - par numéro
 */
const echapper = (texte) => String(texte ?? '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');
/**
 * Ancré sur « rubrique(s) » + numéro, pas sur le verbe : les tournures varient
 * (« voir la rubrique », « à la rubrique », « rubrique 4.3 et 4.4 »).
 */
const RENVOI = /\brubriques?\s+\d{1,2}(?:\.\d{1,2})?(?:\s*(?:,|et|ou|à)\s*\d{1,2}(?:\.\d{1,2})?)*/gi;
const NUMERO = /\d{1,2}(?:\.\d{1,2})?/g;

export function renvois(html, cibles) {
  const source = String(html ?? '');
  if (!(cibles instanceof Map) || cibles.size === 0) return source;

  let sortie = '';
  let depuis = 0;

  // Hors balise seulement ; une phrase coupée par une balise reste du texte.
  for (const [debut, fin] of horsBalise(source)) {
    sortie += source.slice(depuis, debut);
    sortie += source.slice(debut, fin).replace(RENVOI, (phrase) => phrase.replace(NUMERO, (numero) => {
      const cible = cibles.get(numero);
      if (!cible?.id) return numero;
      const titre = cible.libelle ? ` title="${echapper(`${numero} — ${cible.libelle}`)}"` : '';
      return `<a class="renvoi" href="#${cible.id}"${titre}>${numero}</a>`;
    }));
    depuis = fin;
  }

  return sortie + source.slice(depuis);
}

/** Les cinq passes, dans l'ordre où chacune a besoin de la précédente. */
export function structurer(html) {
  return espaces(notes(interactions(sousTitres(listes(html)))));
}
