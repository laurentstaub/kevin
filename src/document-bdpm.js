/**
 * Extraction du document dans une page de la BDPM.
 *
 * `affichageDoc.php` rend le RCP ou la notice enveloppés dans l'habillage du
 * site : navigation, fil d'Ariane, pied de page. Stocker la page entière
 * reviendrait à donner ces morceaux à manger au découpeur, qui en tirerait de
 * fausses rubriques.
 *
 * On ne se fie donc pas à un conteneur nommé — le site vient de migrer, et un
 * sélecteur appris aujourd'hui mourra à la prochaine refonte, exactement comme
 * l'ancien collecteur. On se fie à la **signature du document lui-même** : un
 * RCP commence par « 1. DÉNOMINATION DU MÉDICAMENT » et se termine après sa
 * dernière rubrique numérotée. Cette numérotation est imposée par le modèle
 * QRD européen ; elle survivra à toutes les refontes du site.
 *
 * Le module est pur : on lui passe du HTML, il rend une tranche. Aucun réseau,
 * aucune base.
 */

/** Ce qui n'est jamais du document, et qu'on retire avant toute mesure. */
const HABILLAGE = /<(script|style|noscript|head|nav|header|footer|form|select)\b[\s\S]*?<\/\1>/gi;
const COMMENTAIRES = /<!--[\s\S]*?-->/g;

/** Première rubrique d'un RCP, et d'une notice. Les deux plans sont distincts. */
const DEBUT = {
  rcp: /1\s*\.?\s*D[ÉE]NOMINATION\s+DU\s+M[ÉE]DICAMENT/i,
  notice: /(?:^|>)\s*NOTICE\s*:|1\s*\.?\s*QU[’'`]?EST[- ]CE\s+QU/i,
};

/**
 * Où s'arrête un document.
 *
 * Depuis la refonte du site, `affichageDoc.php` redirige vers
 * `/medicament/<CIS>/extrait`, **une seule page qui porte le RCP puis la
 * notice**. Sans cette borne, le RCP extrait emportait la notice avec lui —
 * trente-huit mille signes au lieu de vingt mille, et le lecteur aurait trouvé
 * la notice patient à la suite de la rubrique 12.
 *
 * La notice, elle, va jusqu'au bout : rien ne la suit.
 */
const FIN = { rcp: DEBUT.notice };

/** Un titre de rubrique numéroté : « 4.2 Posologie », « 10. DATE DE MISE À JOUR ». */
const RUBRIQUE = /(?:^|>)\s*(\d{1,2}(?:\.\d{1,2})*)\s*\.?\s+[A-ZÀ-Þ«"(]/gm;

const sansHabillage = (html) =>
  String(html ?? '').replace(COMMENTAIRES, '').replace(HABILLAGE, ' ');

/** Balises sans contenu : elles n'ouvrent rien, donc rien à refermer. */
const VIDES = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'source']);
const BALISE = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;

/**
 * Rééquilibre un fragment découpé au milieu d'un arbre.
 *
 * Couper au premier titre laisse derrière soi les fermetures des conteneurs
 * ouverts plus haut — un `</div>` sans son `<div>`. Le navigateur répare alors
 * à sa façon, et l'on a déjà vu aujourd'hui ce que ça donne : un élément cloné
 * qui s'intercale et emporte la mise en page. On préfère réparer nous-mêmes,
 * de façon déterministe : les fermantes orphelines sautent, les ouvrantes
 * restées béantes sont refermées à la fin.
 */
export function equilibrer(html) {
  const pile = [];
  const aRetirer = [];

  BALISE.lastIndex = 0;
  let m;
  while ((m = BALISE.exec(html))) {
    const nom = m[2].toLowerCase();
    if (m[3] === '/' || VIDES.has(nom)) continue;

    if (m[1] === '/') {
      const ouverte = pile.lastIndexOf(nom);
      if (ouverte === -1) aRetirer.push([m.index, m.index + m[0].length]);
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

/** Combien de titres numérotés distincts — la signature d'un document QRD. */
export function rubriquesVues(html) {
  const vues = new Set();
  for (const m of String(html ?? '').matchAll(RUBRIQUE)) vues.add(m[1]);
  return vues.size;
}

/**
 * La BDPM ne renvoie pas d'erreur pour un CIS sans document : elle sert une
 * page qui l'explique en toutes lettres. Sans ce contrôle, on stockerait le
 * message comme s'il était le RCP.
 */
const ABSENT = [
  // Le CIS n'existe pas, ou sort du périmètre publié.
  /n['’]existe pas ou n['’]entre pas dans le p[ée]rim[èe]tre|aucun document|pas de document/i,

  // Les homéopathiques à nom commun n'ont **jamais** de RCP ni de notice : la
  // loi ne leur en impose pas. La BDPM sert alors une phrase d'explication à
  // la place du document. Sans cette ligne, ces fiches ressortaient en « page
  // non reconnue », c'est-à-dire mêlées aux vraies pannes de lecture — et une
  // absence normale déguisée en anomalie finit par masquer les anomalies.
  /hom[ée]opathiques?\s+[àa]\s+nom\s+commun/i,
];

export const pageSansDocument = (html) => {
  const texte = texteNu(sansHabillage(html));
  return ABSENT.some((motif) => motif.test(texte));
};

/**
 * Lien vers le PDF européen, quand la fiche n'a pas de texte en HTML.
 *
 * Les spécialités centralisées n'ont pas de RCP sur la BDPM : elle renvoie au
 * PDF de l'EMA. On ne le télécharge pas ici — build-pdf-sections sait déjà le
 * faire — on note seulement l'adresse pour qu'il la trouve.
 */
export function lienPdf(html) {
  const trouve = String(html ?? '').match(/https?:\/\/[^\s"'<>]+?\.pdf/i);
  return trouve ? trouve[0] : null;
}

/**
 * La tranche de page qui porte le document.
 *
 * On coupe au premier titre du plan, et non à un conteneur : l'habillage se
 * trouve avant, le pied de page après le dernier titre reconnu. Ce qui subsiste
 * entre les deux est le document, éventuellement suivi de quelques lignes de
 * site que `sansSommaire` et la vérification de cohérence du découpeur savent
 * déjà écarter.
 *
 * @returns {{html:string, rubriques:number, signes:number}|null}
 */
export function extraireDocument(page, type = 'rcp') {
  const corps = sansHabillage(page);
  const motif = DEBUT[type] ?? DEBUT.rcp;

  const depart = corps.search(motif);
  if (depart === -1) return null;

  // La borne se cherche après le début, sinon une mention de la notice dans
  // l'en-tête du RCP couperait le document à sa première ligne.
  const borne = FIN[type];
  const apres = borne ? corps.slice(depart + 1).search(borne) : -1;
  const arret = apres === -1 ? corps.length : depart + 1 + apres;

  // Reculer jusqu'à l'ouverture de la balise qui porte ce titre : couper au
  // milieu d'un élément laisserait une balise fermante orpheline, et le
  // navigateur recollerait les morceaux à sa façon.
  const ouverture = corps.lastIndexOf('<', depart);
  const html = equilibrer(corps.slice(ouverture === -1 ? depart : ouverture, arret).trim());

  const rubriques = rubriquesVues(html);
  const signes = texteNu(html).length;

  // Un RCP fait quinze à quarante mille signes et porte au moins ses six
  // premières rubriques. En dessous, ce n'est pas un document : c'est une page
  // qui contient par hasard les mots qu'on cherchait.
  if (rubriques < 4 || signes < 800) return null;

  return { html, rubriques, signes };
}
