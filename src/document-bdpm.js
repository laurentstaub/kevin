/**
 * Extrait le RCP ou la notice d'une page de la BDPM, sans l'habillage du site
 * (qui produirait de fausses rubriques).
 * Repère la numérotation QRD du document plutôt qu'un conteneur HTML, fragile
 * aux refontes du site. Module pur : ni réseau, ni base.
 */

/** Jamais du document : retiré avant toute mesure. */
const HABILLAGE = /<(script|style|noscript|head|nav|header|footer|form|select)\b[\s\S]*?<\/\1>/gi;
const COMMENTAIRES = /<!--[\s\S]*?-->/g;

/** Première rubrique d'un RCP et d'une notice. */
const DEBUT = {
  rcp: /1\s*\.?\s*D[ÉE]NOMINATION\s+DU\s+M[ÉE]DICAMENT/i,
  notice: /(?:^|>)\s*NOTICE\s*:|1\s*\.?\s*QU[’'`]?EST[- ]CE\s+QU/i,
};

/**
 * Fin d'un document : `/medicament/<CIS>/extrait` porte le RCP puis la notice
 * sur la même page. La notice va jusqu'au bout.
 */
const FIN = { rcp: DEBUT.notice };

/** Un titre de rubrique numéroté : « 4.2 Posologie », « 10. DATE DE MISE À JOUR ». */
const RUBRIQUE = /(?:^|>)\s*(\d{1,2}(?:\.\d{1,2})*)\s*\.?\s+[A-ZÀ-Þ«"(]/gm;

const sansHabillage = (html) =>
  String(html ?? '').replace(COMMENTAIRES, '').replace(HABILLAGE, ' ');

/** Balises vides : rien à refermer. */
const VIDES = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'source']);
const BALISE = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;

/**
 * Rééquilibre un fragment coupé au milieu de l'arbre, plutôt que laisser le
 * navigateur réparer : fermantes orphelines retirées, ouvrantes refermées à la fin.
 */
export function equilibrer(html) {
  const pile = [];
  const aRetirer = [];

  BALISE.lastIndex = 0;
  let balise;
  while ((balise = BALISE.exec(html))) {
    const nom = balise[2].toLowerCase();
    if (balise[3] === '/' || VIDES.has(nom)) continue;

    if (balise[1] === '/') {
      const ouverte = pile.lastIndexOf(nom);
      if (ouverte === -1) aRetirer.push([balise.index, balise.index + balise[0].length]);
      else pile.length = ouverte;
    } else {
      pile.push(nom);
    }
  }

  let sortie = html;
  for (const [debut, fin] of aRetirer.reverse()) {
    sortie = sortie.slice(0, debut) + sortie.slice(fin);
  }
  return sortie + pile.reverse().map((nom) => `</${nom}>`).join('');
}

const texteNu = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Nombre de titres numérotés distincts (signature d'un document QRD). */
export function rubriquesVues(html) {
  const vues = new Set();
  for (const correspondance of String(html ?? '').matchAll(RUBRIQUE)) vues.add(correspondance[1]);
  return vues.size;
}

/** Pages d'explication servies sans erreur HTTP pour un CIS sans document. */
const ABSENT = [
  // CIS inexistant ou hors périmètre publié.
  /n['’]existe pas ou n['’]entre pas dans le p[ée]rim[èe]tre|aucun document|pas de document/i,

  // Homéopathiques à nom commun : jamais de RCP ni de notice (absence normale, pas une panne).
  /hom[ée]opathiques?\s+[àa]\s+nom\s+commun/i,

  // Pages d'erreur servies en 200, stockées comme notices en mai 2025 (4 CIS).
  /le m[ée]dicament demand[ée] n['’]existe pas dans la base/i,
  /erreur\s*:\s*le fichier\s+\S+\s+n['’]existe pas/i,
];

export const pageSansDocument = (html) => {
  const texte = texteNu(sansHabillage(html));
  return ABSENT.some((motif) => motif.test(texte));
};

/**
 * Page d'erreur stockée à la place d'un document : courte, et reconnue comme
 * telle. Ni affichée ni découpée. La longueur protège un vrai document qui
 * citerait l'une de ces phrases.
 */
export const pageErreurStockee = (html) => texteNu(sansHabillage(html)).length < 1500 && pageSansDocument(html);

/**
 * Lien vers le PDF de l'EMA d'une spécialité centralisée (sans RCP HTML).
 * Le téléchargement revient à build-pdf-sections.
 */
export function lienPdf(html) {
  const trouve = String(html ?? '').match(/https?:\/\/[^\s"'<>]+?\.pdf/i);
  return trouve ? trouve[0] : null;
}

/** Bloc qui peut porter un titre : on remonte jusqu'à lui, pas au premier « < ». */
const BLOC_OUVRANT = /<(?:p|div|h[1-6]|li|td)\b[^>]*>/gi;

/**
 * Début du titre trouvé à `depart` : la balise de bloc qui l'ouvre, parmi les
 * balises qui le précèdent sans texte. Reculer au premier « < » coupait le <p>
 * du nouveau site (« <p><span>1. DENOMINATION… ») : le document commençait par
 * un titre hors bloc, que le découpeur ne voyait pas (679 RCP, 11 notices).
 */
export function ouvertureDuTitre(corps, depart) {
  const avant = corps.slice(0, depart);
  const balises = /(?:<[^>]+>\s*)*$/.exec(avant);
  // Après la dernière fermante de la série : ce qui s'ouvre pour ce titre.
  const fermante = balises[0].lastIndexOf('</');
  const apresFermante = fermante === -1 ? 0 : balises[0].indexOf('>', fermante) + 1;
  // Le plus proche du titre : son <p>, pas le conteneur qui l'englobe.
  const bloc = [...balises[0].slice(apresFermante).matchAll(BLOC_OUVRANT)].at(-1);
  if (bloc) return balises.index + apresFermante + bloc.index;
  const ouverture = corps.lastIndexOf('<', depart);
  return ouverture === -1 ? depart : ouverture;
}

/**
 * Tranche de page qui porte le document, coupée au premier titre du plan.
 * Les quelques lignes de site restantes sont écartées plus tard par le découpeur.
 *
 * @returns {{html:string, rubriques:number, signes:number}|null}
 */
export function extraireDocument(page, type = 'rcp') {
  const corps = sansHabillage(page);
  const motif = DEBUT[type] ?? DEBUT.rcp;

  const depart = corps.search(motif);
  if (depart === -1) return null;

  // Après le début : une mention de la notice en en-tête du RCP le couperait.
  const borne = FIN[type];
  const apres = borne ? corps.slice(depart + 1).search(borne) : -1;
  const arret = apres === -1 ? corps.length : depart + 1 + apres;

  // Reculer jusqu'au bloc qui ouvre le titre.
  const html = equilibrer(corps.slice(ouvertureDuTitre(corps, depart), arret).trim());

  const rubriques = rubriquesVues(html);
  const signes = texteNu(html).length;

  // En dessous : une page qui contient les mots par hasard, pas un document.
  if (rubriques < 4 || signes < 800) return null;

  return { html, rubriques, signes };
}
