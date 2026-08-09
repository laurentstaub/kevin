import { splitHeading, coherentes } from './outline.js';
import { deaccent } from './text.js';
import { rubriqueNotice } from './rcp-plan.js';

/**
 * Conversion d'un PDF de la BDPM en documents exploitables.
 *
 * Les spécialités enregistrées en procédure centralisée n'ont pas de RCP en
 * HTML : la BDPM sert un PDF unique regroupant les annexes de la décision
 * européenne. Ce module ne fait pas le téléchargement ni l'extraction — il
 * part du texte produit par `pdftotext -layout` et le ramène au même format
 * HTML que les documents scrapés, pour que le découpeur soit le même.
 *
 * Toutes les fonctions sont pures : ni réseau, ni base, ni fichier.
 */

/** Un même PDF contient le RCP, l'étiquetage et la notice. */
const ANNEXES = [
  { motif: /^\s*ANNEXE\s+I\b(?!\s*I)/i, type: 'rcp' },
  { motif: /^\s*ANNEXE\s+II\b(?!\s*I)/i, type: null }, // fabricant, conditions
  { motif: /^\s*ANNEXE\s+III\s*A\b/i, type: null }, // étiquetage
  { motif: /^\s*ANNEXE\s+III\s*B\b/i, type: 'notice' },
  { motif: /^\s*ANNEXE\s+III\b(?!\s*[AB])/i, type: 'etiquetage-notice' },
];

/** Repères de repli quand le PDF n'affiche pas les en-têtes d'annexe. */
const DEBUT_NOTICE = /^\s*NOTICE\s*:/i;
const DEBUT_ETIQUETAGE = /^\s*(ETIQUETAGE|ÉTIQUETAGE)\s*$/i;
const DEBUT_RCP = /^\s*(RESUME|RÉSUMÉ)\s+DES\s+CARACT/i;

const LONGUEUR_TITRE_MAX = 250;

/**
 * Une rubrique porte un numéro ponctué : « 1. », « 4.2 », « 6.3. ». Un nombre
 * nu suivi de mots n'en est pas une — « 12 ans présentant une épilepsie… »,
 * coupé en début de ligne, passerait sinon pour la rubrique 12 et avalerait
 * tout le reste du document.
 */
const NUMERO_TITRE = /^\d{1,2}(?:\.\d{1,2})*\.\s|^\d{1,2}(?:\.\d{1,2})+\s/;

/**
 * Début d'un élément de liste. La BDPM et l'EMA emploient indifféremment le
 * point médian, le tiret ou la lettre parenthésée ; `pdftotext` rend le tout
 * suivi d'un alignement en espaces qu'il ne faut pas prendre pour un tableau.
 */
const PUCE = /^\s*([\u2022\u25AA\u25CF\u00B7\u25E6\u2023\-\u2013\u2014]|\(?[a-z]\)|\d{1,2}\))\s+/;

/** Reprises du plan à l'intérieur d'une même annexe. */
const REPRISE = {
  rcp: /^\s*1\s*\.\s+D[E\u00c9]NOMINATION\b/i,
  notice: /^\s*NOTICE\s*:/i,
};

/** `pdftotext` sépare les pages par un saut de page. */
export const pages = (texte) => String(texte ?? '').split('\f');

/**
 * Retire l'habillage de page : en-têtes et pieds répétés, numéros isolés.
 *
 * Plutôt que de deviner ce qui est un en-tête, on compte — mais seulement en
 * haut et en bas de page. La dénomination du produit revient sur chaque page
 * en en-tête, et constitue aussi le contenu de la rubrique 1 : sans la
 * contrainte de position, on l'effacerait de la rubrique.
 */
export function retirerHabillage(texte) {
  const feuillets = pages(texte);
  if (feuillets.length < 3) return feuillets.join('\n');

  const BORD = 3; // nombre de lignes examinées en haut et en bas de page

  /** Indices des lignes situées sur un bord de page. */
  const bords = (lignes) => {
    const set = new Set();
    for (let i = 0; i < Math.min(BORD, lignes.length); i += 1) set.add(i);
    for (let i = Math.max(0, lignes.length - BORD); i < lignes.length; i += 1) set.add(i);
    return set;
  };

  // Seules les lignes de bord entrent dans le décompte : le nom du produit
  // figure aussi en rubrique 1, et il ne faut pas l'y effacer.
  const frequence = new Map();
  for (const feuillet of feuillets) {
    const lignes = feuillet.split('\n');
    const auBord = bords(lignes);
    const vues = new Set(
      lignes
        .map((l, i) => (auBord.has(i) ? l.trim() : ''))
        .filter((l) => l && l.length <= 90),
    );
    for (const l of vues) frequence.set(l, (frequence.get(l) ?? 0) + 1);
  }

  const seuil = Math.max(3, Math.ceil(feuillets.length / 3));
  const habillage = new Set([...frequence].filter(([, n]) => n >= seuil).map(([l]) => l));

  return feuillets
    .map((feuillet) => {
      const lignes = feuillet.split('\n');
      const auBord = bords(lignes);
      return lignes
        .filter((l, i) => {
          const t = l.trim();
          if (!t) return true;
          if (!auBord.has(i)) return true;
          if (habillage.has(t)) return false;
          return !/^\d{1,4}(\s*\/\s*\d{1,4})?$/.test(t); // numéro de page
        })
        .join('\n');
    })
    .join('\n');
}

/**
 * Découpe par annexe — obligatoirement avant toute recherche de rubrique.
 *
 * L'étiquetage porte lui aussi une « 1. DENOMINATION DU MEDICAMENT ». Cherché
 * sur le document entier, le filtre de cohérence retiendrait une progression
 * traversant les annexes et produirait un plan absurde.
 *
 * @returns {Map<string, string>} type de document -> texte
 */
export function decouperAnnexes(texte) {
  const lignes = String(texte ?? '').split('\n');
  const bornes = [];

  lignes.forEach((ligne, i) => {
    for (const { motif, type } of ANNEXES) {
      if (motif.test(ligne)) {
        bornes.push({ i, type });
        return;
      }
    }
    if (DEBUT_NOTICE.test(ligne)) bornes.push({ i, type: 'notice' });
    else if (DEBUT_ETIQUETAGE.test(ligne)) bornes.push({ i, type: null });
    else if (DEBUT_RCP.test(ligne) && bornes.length === 0) bornes.push({ i, type: 'rcp' });
  });

  // Aucun repère : tout le document est un RCP.
  if (bornes.length === 0) return new Map([['rcp', lignes.join('\n')]]);

  const parType = new Map();
  bornes.forEach((borne, k) => {
    if (!borne.type || borne.type === 'etiquetage-notice') return;
    const fin = bornes[k + 1]?.i ?? lignes.length;
    const bloc = lignes.slice(borne.i, fin).join('\n');
    // Un en-tête d'annexe se répète : on recolle les morceaux.
    parType.set(borne.type, `${parType.get(borne.type) ?? ''}\n${bloc}`);
  });

  // « ANNEXE III » sans suffixe regroupe étiquetage puis notice : on ne garde
  // que ce qui suit le début de la notice.
  const groupee = bornes.find((b) => b.type === 'etiquetage-notice');
  if (groupee && !parType.has('notice')) {
    const fin = bornes[bornes.indexOf(groupee) + 1]?.i ?? lignes.length;
    const bloc = lignes.slice(groupee.i, fin);
    const debut = bloc.findIndex((l) => DEBUT_NOTICE.test(l));
    if (debut !== -1) parType.set('notice', bloc.slice(debut).join('\n'));
  }

  if (!parType.has('rcp')) parType.set('rcp', lignes.join('\n'));

  return parType;
}

/**
 * Écarte les sommaires.
 *
 * Une notice s'ouvre sur « Que contient cette notice ? » suivi de ses six
 * rubriques. Ces lignes ont la forme de titres et viennent en premier : le
 * filtre de cohérence les retient, et tout le corps de la notice se retrouve
 * dans la dernière rubrique.
 *
 * Signature d'un sommaire : au moins trois titres qui se suivent sans une seule
 * ligne de texte entre eux, sans descendre d'un niveau. Une rubrique chapeau
 * (« 4 » puis « 4.1 ») est vide elle aussi, mais la suivante est plus profonde.
 */
function sansSommaire(candidats, lignes) {
  const profondeur = (n) => n.split('.').length;
  const rang = (n) => Number(n.split('.')[0]);
  // Deux titres se suivent dans un sommaire s'ils sont séparés par du vide, au
  // même niveau, et que la numérotation progresse : « 6 » puis « 1 », c'est le
  // corps qui commence, pas la suite de la liste.
  const colles = (a, b) =>
    lignes.slice(a.i + 1, b.i).every((l) => !l.trim()) &&
    profondeur(b.number) <= profondeur(a.number) &&
    rang(b.number) > rang(a.number);

  const aRetirer = new Set();
  let debut = 0;
  for (let i = 0; i < candidats.length; i += 1) {
    if (i + 1 < candidats.length && colles(candidats[i], candidats[i + 1])) continue;
    if (i - debut >= 2) for (let k = debut; k <= i; k += 1) aRetirer.add(k);
    debut = i + 1;
  }

  const restants = candidats.filter((_, i) => !aRetirer.has(i));
  return restants.length >= 3 ? restants : candidats;
}

/**
 * Reconstitue un HTML minimal — mêmes balises que les documents scrapés, pour
 * que l'application et le découpeur ignorent d'où vient le document.
 *
 * La détection des titres se fait ici, sur le texte : c'est le seul moment où
 * la mise en page est encore lisible. Une fois converti en <p>, il ne resterait
 * que la numérotation.
 */
export function versHtml(texte, type = 'doc') {
  const lignes = String(texte ?? '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l, i, tab) => l.trim() || tab[i - 1]?.trim()); // pas deux vides d'affilée

  let candidats = [];
  lignes.forEach((ligne, i) => {
    const t = ligne.trim();
    if (!t || t.length > LONGUEUR_TITRE_MAX || !NUMERO_TITRE.test(t)) return;
    const { number, label } = splitHeading(t);
    if (number) candidats.push({ i, number, label });
  });

  // Une notice suit un plan connu. Une procédure numérotée dans le corps a la
  // même forme qu'un plan : seule la tournure du libellé tranche. On ne filtre
  // que si le plan se reconnaît vraiment — sinon la source fait foi.
  if (type === 'notice') {
    const plan = candidats.filter((c) => rubriqueNotice(c.number, c.label));
    if (plan.length >= 4) candidats = plan;
  }

  const titres = new Set(coherentes(sansSommaire(candidats, lignes)).map((c) => c.i));

  const echapper = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = [];
  let paragraphe = [];
  let liste = [];
  let listeIndent = 0;
  let tableau = [];

  const retrait = (ligne) => ligne.length - ligne.trimStart().length;

  // Un PDF n'a pas de paragraphes, il a des lignes. Rendre chaque ligne en
  // <p> donne un texte aéré d'un interligne complet tous les soixante-dix
  // signes — illisible. On recolle les lignes consécutives ; ce sont les
  // lignes vides qui séparent les paragraphes.
  const viderParagraphe = () => {
    if (paragraphe.length === 0) return;
    html.push(`<p>${echapper(paragraphe.join(' '))}</p>`);
    paragraphe = [];
  };

  const viderListe = () => {
    if (liste.length === 0) return;
    const items = liste.map((item) => `<li>${echapper(item.join(' '))}</li>`).join('');
    html.push(`<ul>${items}</ul>`);
    liste = [];
  };

  const viderTableau = () => {
    if (tableau.length === 0) return;
    // Une seule ligne alignée n'est pas un tableau : c'est une phrase que la
    // mise en page a espacée. Un vrai tableau a plusieurs lignes.
    if (tableau.length === 1) paragraphe.push(tableau[0].trim());
    else {
      // Les tableaux de posologie ne se reconstruisent pas de façon fiable :
      // l'alignement en espaces est conservé tel quel. Une colonne décalée sur
      // une dose est pire qu'un texte brut.
      html.push(`<pre>${echapper(tableau.join('\n'))}</pre>`);
    }
    tableau = [];
  };

  const viderTout = () => {
    viderTableau();
    viderParagraphe();
    viderListe();
  };

  for (let i = 0; i < lignes.length; i += 1) {
    const ligne = lignes[i];
    const t = ligne.trim();

    if (titres.has(i)) {
      viderTout();
      html.push(`<h2>${echapper(t)}</h2>`);
      continue;
    }

    // La ligne vide est la seule marque de fin de paragraphe d'un PDF.
    if (!t) {
      viderTout();
      continue;
    }

    const puce = ligne.match(PUCE);
    if (puce) {
      viderTableau();
      viderParagraphe();
      liste.push([t.slice(puce[0].trimStart().length)]);
      listeIndent = puce[0].length;
      continue;
    }

    // Trois espaces ou plus au milieu d'une ligne : mise en colonnes. Testé
    // après la puce, sans quoi « •    en association avec… » passe pour un
    // tableau et sort en chasse fixe.
    if (/\S {3,}\S/.test(ligne)) {
      viderParagraphe();
      viderListe();
      tableau.push(ligne);
      continue;
    }

    viderTableau();

    // La suite d'un élément de liste est en retrait sous sa puce ; une ligne
    // revenue à la marge ouvre autre chose.
    if (liste.length > 0 && retrait(ligne) >= listeIndent - 1) {
      liste.at(-1).push(t);
      continue;
    }

    viderListe();
    paragraphe.push(t);
  }

  viderTout();
  return html.join('\n');
}

/**
 * Sépare les reprises du plan à l'intérieur d'une annexe.
 *
 * Un PDF de l'EMA décrit toutes les formes d'une spécialité : l'annexe I
 * enchaîne autant de RCP complets qu'il y a de formes — six pour Keppra. Sans
 * séparation, la numérotation repart à 1, le filtre de cohérence refuse ce
 * retour en arrière, et tout le second RCP finit dans la rubrique 10 du premier.
 *
 * @returns {string[]} un bloc par reprise, dans l'ordre du document
 */
export function separerRepetitions(texte, type) {
  const motif = REPRISE[type];
  if (!motif) return [String(texte ?? '')];

  const lignes = String(texte ?? '').split('\n');
  const debuts = [];
  lignes.forEach((l, i) => {
    if (motif.test(l)) debuts.push(i);
  });
  if (debuts.length < 2) return [lignes.join('\n')];

  return debuts.map((d, k) => lignes.slice(d, debuts[k + 1] ?? lignes.length).join('\n'));
}

const mots = (s) => deaccent(String(s ?? '')).toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Choisit la reprise qui correspond à la spécialité.
 *
 * « Keppra 250 mg, comprimé pelliculé » et « Keppra 100 mg/ml, solution
 * buvable » n'ont ni la même posologie ni les mêmes excipients : servir la
 * mauvaise au comptoir serait une faute. On compare la dénomination du CIS à
 * l'en-tête de chaque bloc — c'est la rubrique 1, donc le nom complet.
 */
export function choisirBloc(blocs, denomination) {
  if (blocs.length === 1 || !denomination) return blocs[0];

  const attendus = mots(denomination);
  let meilleur = blocs[0];
  let score = -1;

  for (const bloc of blocs) {
    const tete = mots(bloc.slice(0, 400));
    const n = attendus.filter((m) => tete.includes(m)).length;
    if (n > score) {
      score = n;
      meilleur = bloc;
    }
  }

  return meilleur;
}

/**
 * Chaîne complète : texte de `pdftotext -layout` -> documents prêts à découper.
 *
 * @param {string} texte
 * @param {{ denomination?: string }} [options] - dénomination du CIS traité
 * @returns {{ type: string, html: string }[]}
 */
export function pdfEnDocuments(texte, { denomination } = {}) {
  const propre = retirerHabillage(texte);

  return [...decouperAnnexes(propre)]
    .map(([type, bloc]) => ({
      type,
      html: versHtml(choisirBloc(separerRepetitions(bloc, type), denomination), type),
    }))
    .filter((doc) => doc.html.length > 0);
}
