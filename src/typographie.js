/**
 * Rend au texte de la BDPM la structure qu'il n'a que sous forme de caractères.
 *
 * Les RCP sont du Word exporté : les niveaux hiérarchiques n'y existent pas en
 * balises mais en signes déposés dans des paragraphes ordinaires — « · » pour
 * le premier rang, « o » pour le second, un intitulé nu en guise de titre. Le
 * navigateur les rend donc à plat : une puce sans retrait négatif, dont la
 * deuxième ligne repart sous la puce au lieu de s'aligner sous le texte, et
 * l'œil perd l'entrée de chaque élément.
 *
 * Rien ici ne touche aux mots. On ne réécrit pas un texte réglementaire : on
 * lui donne la forme que sa typographie annonçait déjà. Ce qui est fautif à la
 * source le reste — « (1 à 2 gélule(s))) » garde ses trois parenthèses, sans
 * quoi les deux documents ne se citent plus l'un l'autre.
 *
 * Module pur : du HTML entre, du HTML sort. Employé au découpage, pas au
 * rendu, pour que `PARSER_VERSION` en donne le rejeu et les tests la preuve.
 */

const BALISE = /<\/?([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;

/** Intervalles de texte hors de toute balise. */
function horsBalise(html) {
  const zones = [];
  let depuis = 0;
  BALISE.lastIndex = 0;
  let m;
  while ((m = BALISE.exec(html))) {
    if (m.index > depuis) zones.push([depuis, m.index]);
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
 * Deux rangs, et deux seulement.
 *
 * Word exporte le premier en point médian ou en tiret, le second en « o »
 * minuscule — c'est la puce de la police Courier, tombée en caractère
 * ordinaire au passage en HTML. Aucune phrase française ne commence par « o »
 * suivi d'une espace, ni par un tiret : la reconnaissance ne peut pas se
 * tromper sur du texte courant.
 *
 * Les énumérations « a) » et « 1. » sont volontairement laissées de côté. Le
 * découpeur se sert déjà de la numérotation pour trouver les rubriques ; deux
 * mécanismes qui lisent le même signal finissent par se contredire.
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
 * Retire la puce du HTML, où qu'elle soit nichée.
 *
 * Word l'enferme volontiers dans son propre span : « <span>·</span> arthrose ».
 * Le signe et l'espace qui le suit tombent alors dans deux zones de texte
 * différentes, et chercher « puce + espace » d'un seul tenant ne trouve rien.
 * On ne retire donc que le signe, à la première zone non blanche — le rang a
 * déjà été établi sur le texte détagué, où l'espace est bien là.
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
    // Un second rang qui ouvre la suite n'a pas de parent où se nicher : une
    // <ul> fille d'une <ul> est un balisage invalide. Il prend le premier rang.
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
  let m;
  while ((m = PARAGRAPHE.exec(source))) {
    const avant = source.slice(curseur, m.index);
    const rang = rangDePuce(detaguer(m[2]));

    // Entre deux puces, seul du blanc peut s'intercaler sans rompre la liste.
    if (avant.trim()) { vider(); sortie += avant; }
    else if (paquet.length === 0) sortie += avant;

    if (rang === 0) { vider(); sortie += m[0]; }
    else paquet.push({ rang, html: sansPuce(m[2], rang).trim() });

    curseur = m.index + m[0].length;
  }

  vider();
  return sortie + source.slice(curseur);
}

// ----------------------------------------------------------- les intitulés

const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clef = (s) => sansAccents(s).toLowerCase().replace(/\s*:\s*$/, '').replace(/\s+/g, ' ').trim();

/**
 * Les articulations internes du modèle QRD.
 *
 * Répertoire fermé, et non heuristique : ces intitulés ne sont ni en gras ni
 * balisés dans la source, aucun signe typographique ne permet de les trouver.
 * Une liste close échoue du bon côté — un intitulé qu'elle ignore reste un
 * paragraphe, ce qu'il est aujourd'hui.
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
  // Les quatre niveaux du thésaurus des interactions de l'ANSM, tels que la
  // rubrique 4.5 les reprend. Liste close elle aussi : le thésaurus n'en
  // connaît pas d'autres.
  'associations contre-indiquees', 'associations deconseillees',
  "associations faisant l'objet de precautions d'emploi",
  'associations a prendre en compte', 'a prendre en compte',
]);

/** Un intitulé est court par nature : le garde-fou coûte moins qu'un faux. */
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
 * L'espace avant un signe double doit être insécable.
 *
 * On ne fait que durcir une espace déjà présente : jamais en insérer une.
 * « 50% » et « http://… » restent donc intacts, et l'on ne prend pas le risque
 * de modifier un texte réglementaire pour une question de style.
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
 * Les appels de note en bas de rubrique.
 *
 * Le modèle QRD renvoie hors du tableau d'effets indésirables par un
 * astérisque, doublé au second renvoi : « prises de poids* » plus bas
 * « *Les prises de poids étant un facteur de risque… ». La note est un commentaire
 * sur le texte, pas le texte ; composée à l'identique, elle pèse autant que ce
 * qu'elle commente et allonge la rubrique d'autant.
 *
 * L'appel reste en place : c'est lui qui relie la note à sa mention, et le
 * retirer romprait le renvoi.
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
 * La substance avec laquelle l'interaction se produit.
 *
 * La rubrique 4.5 suit le thésaurus de l'ANSM : sous chacun des quatre niveaux
 * de gravité, chaque substance ouvre un paragraphe préfixé d'un plus —
 * « + Millepertuis », « + Pénems (carbapénèmes) ». Composée comme le
 * commentaire qui la suit, elle s'y noyait ; c'est pourtant le seul mot qu'on
 * cherche quand on tient deux boîtes à la main.
 *
 * Le signe reste : dans le thésaurus il se lit « en association avec », et le
 * retirer ferait dire à la ligne autre chose que ce qu'elle dit.
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

/** Les cinq passes, dans l'ordre où chacune a besoin de la précédente. */
export function structurer(html) {
  return espaces(notes(interactions(sousTitres(listes(html)))));
}
