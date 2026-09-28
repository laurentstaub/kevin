import { splitHeading, coherentes } from './outline.js';
import { deaccent } from './text.js';
import { rubriqueNotice } from './rcp-plan.js';

/**
 * Conversion d'un PDF de la BDPM (procédure centralisée, sans RCP HTML) en
 * documents au même format HTML que les documents scrapés.
 * Part du texte de `pdftotext -layout`. Fonctions pures : ni réseau, ni base, ni fichier.
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
 * Numéro de rubrique ponctué (« 1. », « 4.2 »). Un nombre nu (« 12 ans… » en
 * début de ligne) ne compte pas : il avalerait le reste du document.
 */
const NUMERO_TITRE = /^\d{1,2}(?:\.\d{1,2})*\.\s|^\d{1,2}(?:\.\d{1,2})+\s/;

/** Début d'un élément de liste ; l'alignement en espaces qui suit n'est pas un tableau. */
const PUCE = /^\s*([\u2022\u25AA\u25CF\u00B7\u25E6\u2023\-\u2013\u2014]|\(?[a-z]\)|\d{1,2}\))\s+/;

/** Reprises du plan à l'intérieur d'une même annexe. */
const REPRISE = {
  rcp: /^\s*1\s*\.\s+D[E\u00c9]NOMINATION\b/i,
  notice: /^\s*NOTICE\s*:/i,
};

/** `pdftotext` sépare les pages par un saut de page. */
export const pages = (texte) => String(texte ?? '').split('\f');

/**
 * Retire en-têtes, pieds de page répétés et numéros de page.
 * Seules les lignes de bord comptent : la dénomination, répétée en en-tête,
 * est aussi le contenu de la rubrique 1.
 */
export function retirerHabillage(texte) {
  const feuillets = pages(texte);
  if (feuillets.length < 3) return feuillets.join('\n');

  const BORD = 3; // lignes examinées en haut et en bas de page

  const bords = (lignes) => {
    const set = new Set();
    for (let i = 0; i < Math.min(BORD, lignes.length); i += 1) set.add(i);
    for (let i = Math.max(0, lignes.length - BORD); i < lignes.length; i += 1) set.add(i);
    return set;
  };

  const frequence = new Map();
  for (const feuillet of feuillets) {
    const lignes = feuillet.split('\n');
    const auBord = bords(lignes);
    const vues = new Set(
      lignes
        .map((ligne, i) => (auBord.has(i) ? ligne.trim() : ''))
        .filter((ligne) => ligne && ligne.length <= 90),
    );
    for (const vue of vues) frequence.set(vue, (frequence.get(vue) ?? 0) + 1);
  }

  const seuil = Math.max(3, Math.ceil(feuillets.length / 3));
  const habillage = new Set([...frequence].filter(([, nombre]) => nombre >= seuil).map(([ligne]) => ligne));

  return feuillets
    .map((feuillet) => {
      const lignes = feuillet.split('\n');
      const auBord = bords(lignes);
      return lignes
        .filter((ligne, i) => {
          const propre = ligne.trim();
          if (!propre) return true;
          if (!auBord.has(i)) return true;
          if (habillage.has(propre)) return false;
          return !/^\d{1,4}(\s*\/\s*\d{1,4})?$/.test(propre); // numéro de page
        })
        .join('\n');
    })
    .join('\n');
}

/**
 * Découpe par annexe, avant toute recherche de rubrique : l'étiquetage a aussi
 * une rubrique « 1. DENOMINATION », qui brouillerait le plan.
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
  bornes.forEach((borne, rang) => {
    if (!borne.type || borne.type === 'etiquetage-notice') return;
    const fin = bornes[rang + 1]?.i ?? lignes.length;
    const bloc = lignes.slice(borne.i, fin).join('\n');
    // Un en-tête d'annexe peut se répéter : recoller les morceaux.
    parType.set(borne.type, `${parType.get(borne.type) ?? ''}\n${bloc}`);
  });

  // « ANNEXE III » seule regroupe étiquetage puis notice : garder la notice.
  const groupee = bornes.find((borne) => borne.type === 'etiquetage-notice');
  if (groupee && !parType.has('notice')) {
    const fin = bornes[bornes.indexOf(groupee) + 1]?.i ?? lignes.length;
    const bloc = lignes.slice(groupee.i, fin);
    const debut = bloc.findIndex((ligne) => DEBUT_NOTICE.test(ligne));
    if (debut !== -1) parType.set('notice', bloc.slice(debut).join('\n'));
  }

  if (!parType.has('rcp')) parType.set('rcp', lignes.join('\n'));

  return parType;
}

/**
 * Écarte les sommaires (« Que contient cette notice ? »), que le filtre de
 * cohérence prendrait pour le plan.
 * Sommaire : au moins trois titres consécutifs sans texte entre eux, sans
 * descendre d'un niveau (ce qui distingue une rubrique chapeau).
 */
function sansSommaire(candidats, lignes) {
  const profondeur = (numero) => numero.split('.').length;
  const rang = (numero) => Number(numero.split('.')[0]);
  // « 6 » puis « 1 » : c'est le corps qui commence, pas la suite du sommaire.
  const colles = (a, b) =>
    lignes.slice(a.i + 1, b.i).every((ligne) => !ligne.trim()) &&
    profondeur(b.number) <= profondeur(a.number) &&
    rang(b.number) > rang(a.number);

  const aRetirer = new Set();
  let debut = 0;
  for (let i = 0; i < candidats.length; i += 1) {
    if (i + 1 < candidats.length && colles(candidats[i], candidats[i + 1])) continue;
    if (i - debut >= 2) for (let indice = debut; indice <= i; indice += 1) aRetirer.add(indice);
    debut = i + 1;
  }

  const restants = candidats.filter((_, i) => !aRetirer.has(i));
  return restants.length >= 3 ? restants : candidats;
}

/**
 * Reconstitue un HTML minimal, aux mêmes balises que les documents scrapés.
 * Les titres se détectent ici, tant que la mise en page est encore lisible.
 */
export function versHtml(texte, type = 'doc') {
  const lignes = String(texte ?? '')
    .split('\n')
    .map((ligne) => ligne.replace(/\s+$/, ''))
    .filter((ligne, i, tab) => ligne.trim() || tab[i - 1]?.trim()); // pas deux vides d'affilée

  let candidats = [];
  lignes.forEach((ligne, i) => {
    const propre = ligne.trim();
    if (!propre || propre.length > LONGUEUR_TITRE_MAX || !NUMERO_TITRE.test(propre)) return;
    const { number, label } = splitHeading(propre);
    if (number) candidats.push({ i, number, label });
  });

  // Notice : garder les titres du plan connu (écarte les procédures numérotées),
  // seulement si ce plan se reconnaît.
  if (type === 'notice') {
    const plan = candidats.filter((candidat) => rubriqueNotice(candidat.number, candidat.label));
    if (plan.length >= 4) candidats = plan;
  }

  const titres = new Set(coherentes(sansSommaire(candidats, lignes)).map((candidat) => candidat.i));

  const echapper = (brut) =>
    brut.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = [];
  let paragraphe = [];
  let liste = [];
  let listeIndent = 0;
  let tableau = [];

  const retrait = (ligne) => ligne.length - ligne.trimStart().length;

  // Recolle les lignes consécutives ; seules les lignes vides séparent les paragraphes.
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
    // Une seule ligne alignée est une phrase espacée, pas un tableau.
    if (tableau.length === 1) paragraphe.push(tableau[0].trim());
    else {
      // Alignement conservé tel quel : une colonne décalée sur une dose est pire qu'un texte brut.
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
    const propre = ligne.trim();

    if (titres.has(i)) {
      viderTout();
      html.push(`<h2>${echapper(propre)}</h2>`);
      continue;
    }

    if (!propre) {
      viderTout();
      continue;
    }

    const puce = ligne.match(PUCE);
    if (puce) {
      viderTableau();
      viderParagraphe();
      liste.push([propre.slice(puce[0].trimStart().length)]);
      listeIndent = puce[0].length;
      continue;
    }

    // Mise en colonnes. Testé après la puce, sinon « •    texte » passe pour un tableau.
    if (/\S {3,}\S/.test(ligne)) {
      viderParagraphe();
      viderListe();
      tableau.push(ligne);
      continue;
    }

    viderTableau();

    // Suite d'un élément de liste : en retrait sous sa puce.
    if (liste.length > 0 && retrait(ligne) >= listeIndent - 1) {
      liste.at(-1).push(propre);
      continue;
    }

    viderListe();
    paragraphe.push(propre);
  }

  viderTout();
  return html.join('\n');
}

/**
 * Sépare les reprises du plan dans une annexe : un PDF de l'EMA enchaîne un RCP
 * complet par forme (six pour Keppra), que le filtre de cohérence fusionnerait.
 *
 * @returns {string[]} un bloc par reprise, dans l'ordre du document
 */
export function separerRepetitions(texte, type) {
  const motif = REPRISE[type];
  if (!motif) return [String(texte ?? '')];

  const lignes = String(texte ?? '').split('\n');
  const debuts = [];
  lignes.forEach((ligne, i) => {
    if (motif.test(ligne)) debuts.push(i);
  });
  if (debuts.length < 2) return [lignes.join('\n')];

  return debuts.map((debut, rang) => lignes.slice(debut, debuts[rang + 1] ?? lignes.length).join('\n'));
}

const mots = (texte) => deaccent(String(texte ?? '')).toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Choisit la reprise de la spécialité (posologie et excipients diffèrent selon
 * la forme), en comparant la dénomination du CIS à la rubrique 1 de chaque bloc.
 */
export function choisirBloc(blocs, denomination) {
  if (blocs.length === 1 || !denomination) return blocs[0];

  const attendus = mots(denomination);
  let meilleur = blocs[0];
  let score = -1;

  for (const bloc of blocs) {
    const tete = mots(bloc.slice(0, 400));
    const nombre = attendus.filter((attendu) => tete.includes(attendu)).length;
    if (nombre > score) {
      score = nombre;
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
