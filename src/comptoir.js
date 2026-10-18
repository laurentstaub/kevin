/**
 * Les questions du comptoir lues au RCP : grossesse et allaitement (4.3),
 * conduite (4.7), repas (4.2), durée après ouverture (6.3). Comme la
 * sécabilité : un mot dans la bande, la phrase citée en infobulle, un lien
 * vers la rubrique. Seul ce qui contraint s'affiche : un « effet
 * négligeable » ou « avec ou sans nourriture » ne prend pas de place. Le RCP
 * muet, ambigu ou contradictoire, rien.
 */
import { deaccent } from './text.js';

const plier = (texte) => deaccent(String(texte ?? '')).toLowerCase().replaceAll('’', "'").replace(/\s+/g, ' ');

/** Phrases d'un texte, sans couper sur les décimales. */
const phrases = (texte) => texte.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=\S)/).map((phrase) => phrase.trim()).filter(Boolean);

/** Segments d'une liste de contre-indications : phrases, puis puces et points-virgules. */
const segments = (texte) => texte.split(/\n+|\s*[;·•]\s*|(?<=[.!?])\s+(?=\S)/).map((segment) => segment.replace(/\s+/g, ' ').trim()).filter(Boolean);

// ------------------------------------------------------------ grossesse

const GROSSESSE = /\bgrossesses?\b|\benceintes?\b/;
const ALLAITEMENT = /\ballait(?:ement|ante?s?|er|e)\b|\bqui allaite/;
/** Ce que la rubrique 4.3 nomme sans l'interdire. */
const PAS_CI = /deconseill|n'est pas indique|pas de contre-indication|n'est pas contre-indique|se reporter|incompatible avec une grossesse/;

/** Période : « 2e et 3e trimestres », « à partir du 6e mois (24 SA) », « 3e trimestre ». */
function periode(plie) {
  if (/24 semaines|6 ?(?:e|eme|ieme) mois|sixieme mois/.test(plie)) return 'dès 24 SA';
  if (/(?:2|deux)i?(?: ?e|eme|ieme)? et (?:3|trois)i?(?: ?e|eme|ieme)? trimestres?|(?:deuxieme|2 ?(?:e|eme)) et (?:troisieme|3 ?(?:e|eme)) trimestres?/.test(plie)) return '2e et 3e trimestres';
  if (/(?:troisieme|3 ?(?:e|eme)|dernier) trimestre/.test(plie)) return '3e trimestre';
  return null;
}

/**
 * Contre-indications de la rubrique 4.3 : grossesse (avec sa période) et
 * allaitement. Null si la rubrique n'en dit rien.
 * @returns {{ grossesse: { periode: string|null, phrase: string }|null, allaitement: { phrase: string }|null }|null}
 */
export function lireGrossesse(texte) {
  if (!texte) return null;
  let grossesse = null;
  let allaitement = null;
  for (const segment of segments(texte)) {
    if (segment.length > 400) continue;
    const plie = plier(segment);
    if (PAS_CI.test(plie)) continue;
    if (!grossesse && GROSSESSE.test(plie)) grossesse = { periode: periode(plie), phrase: segment };
    if (!allaitement && ALLAITEMENT.test(plie)) allaitement = { phrase: segment };
  }
  return grossesse || allaitement ? { grossesse, allaitement } : null;
}

// ------------------------------------------------------------ conduite

/**
 * Niveaux de la formule européenne (rubrique 4.7) : « n'a aucun effet ou un
 * effet négligeable », « a une influence mineure / modérée / importante ».
 */
const NIVEAUX = [
  ['importante', /\binfluence (?:importante|majeure)\b|\beffet (?:important|majeur)\b/],
  ['moderee', /\binfluence moderee\b|\beffet modere\b/],
  ['mineure', /\binfluence mineure\b|\beffet mineur\b/],
  ['negligeable', /\beffet negligeable\b|\binfluence negligeable\b|\bn'a aucun effet\b/],
];
/** « n'a pas d'influence importante » ne dit pas qu'elle est importante. */
const NIEE = /\b(?:pas d'|aucune )(?:influence|effet)/;

/** Le niveau le plus fort que la rubrique 4.7 énonce, avec sa phrase ; null sans la formule. */
export function lireConduite(texte) {
  if (!texte) return null;
  const toutes = phrases(texte).filter((phrase) => phrase.length <= 500).map((phrase) => [phrase, plier(phrase)]);
  for (const [niveau, motif] of NIVEAUX) {
    const trouvee = toutes.find(([, plie]) => motif.test(plie) && !(niveau !== 'negligeable' && NIEE.test(plie)));
    if (trouvee) return { niveau, phrase: trouvee[0] };
  }
  return null;
}

// ------------------------------------------------------------ repas

/** Indifférent : rien à dire au comptoir. */
const INDIFFERENT = /avec ou sans (?:nourriture|aliments?|repas)|(?:pendant|au cours|au moment|avec) ou en dehors (?:des|d'un|du) repas|independamment (?:des|du) repas|(?:pendant|au cours) (?:des |du |d'un )?(?:repas )?ou a distance|que ce soit (?:pendant|au cours)|avant ou apres (?:les|le|un) repas|pas d'indication concernant/;
const A_JEUN = /\ba jeun\b|\ben dehors des repas\b|\bestomac vide\b|\ba distance des repas\b|\bsans nourriture\b/;
const AVANT = /\bavant (?:les |le |chaque |un )?repas\b/;
const AU_REPAS = /\bau cours (?:des|d'un|du) repas\b|\bpendant (?:les|le|un) repas\b|\bavec (?:de la )?nourriture\b|\bavec (?:un|des|les|le) (?:repas|aliments)\b|\bau moment des repas\b|\b(?:juste |immediatement )?apres (?:les|le|un) repas\b|\ben mangeant\b/;
/** La phrase dit comment prendre le médicament (pas une « glycémie à jeun »). */
const PRISE = /\b(?:pris|prise|prises|prendre|administr[a-z]*|aval[a-z]*|absorb[a-z]*)\b/;
const NEGATION = /\bne (?:doi[a-z]*|peu[a-z]*|faut|pas)\b|\bjamais\b|\bsans tenir\b/;
/** Une permission (« peuvent être pris avec les repas ») n'est pas une contrainte. */
const PERMISSION = /\bpeu(?:t|vent) (?:aussi |egalement )?etre (?:pris|prises?|administr|aval)/;

/** Contrainte de prise par rapport aux repas, rubrique 4.2 ; null si indifférente, absente ou contradictoire. */
export function lireRepas(texte) {
  if (!texte) return null;
  const trouvees = new Map();
  for (const phrase of phrases(texte)) {
    if (phrase.length > 500) continue;
    const plie = plier(phrase);
    if (INDIFFERENT.test(plie)) return null;
    if (!PRISE.test(plie) || NEGATION.test(plie) || PERMISSION.test(plie)) continue;
    // Une phrase, une contrainte : « sans nourriture, une heure avant ou deux heures après un repas » est à jeun.
    const cle = [['a-jeun', A_JEUN], ['avant-repas', AVANT], ['au-repas', AU_REPAS]].find(([, motif]) => motif.test(plie))?.[0];
    if (cle && !trouvees.has(cle)) trouvees.set(cle, phrase);
  }
  // « à jeun » et « au cours du repas » dans un même RCP : plusieurs dosages ou indications.
  if (trouvees.has('au-repas') && (trouvees.has('a-jeun') || trouvees.has('avant-repas'))) return null;
  const [cle, phrase] = [...trouvees][0] ?? [];
  return cle ? { cle, phrase } : null;
}

// ------------------------------------------------------------ après ouverture

const NOMBRES = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, douze: 12, quinze: 15, trente: 30, 'vingt-huit': 28 };
const APRES = /\b(?:apres (?:la )?(?:premiere )?(?:ouverture|reconstitution)|une fois (?:ouvert|reconstitue)e?s?|(?:suspension|solution|sirop)s? reconstituees? ?:)/;
const DUREE = new RegExp(`\\b(\\d+(?:[,.]\\d+)?|${Object.keys(NOMBRES).join('|')}) (heures?|jours?|semaines?|mois|ans?)\\b`);

/**
 * Durée d'utilisation après ouverture ou reconstitution, rubrique 6.3 : la
 * première durée qui suit « Après ouverture » de près. Null sans durée
 * (« à utiliser immédiatement » relève de l'hôpital).
 */
export function lireOuverture(texte) {
  if (!texte) return null;
  for (const phrase of phrases(texte)) {
    if (phrase.length > 500) continue;
    const plie = plier(phrase);
    const apres = plie.match(APRES);
    if (!apres) continue;
    const suite = plie.slice(apres.index + apres[0].length, apres.index + apres[0].length + 80);
    const duree = suite.match(DUREE);
    if (!duree) continue;
    const nombre = NOMBRES[duree[1]] ?? duree[1].replace('.', ',');
    const reconstitution = apres[0].includes('reconstitu');
    const froid = /refrigerateur|2 ?° ?c? et (?:\+ ?)?8 ?° ?c/.test(plie);
    return { duree: `${nombre} ${duree[2]}`, apres: reconstitution ? 'reconstitution' : 'ouverture', froid, phrase };
  }
  return null;
}

// ------------------------------------------------------------ lecture

/** Formes dont la durée après ouverture ne concerne pas l'officine. */
const HOSPITALIERE = /injectable|perfusion|dialyse|irrigation|inhalation par vapeur/;

/**
 * Les mentions du comptoir d'après les rubriques déjà découpées, chacune avec
 * sa rubrique et son ancre dans la fiche.
 * @param {Map<string, { texte: string, ancre: string }>} rubriques  par numéro
 * @param {string} forme  forme pharmaceutique BDPM
 */
export function lireComptoir(rubriques, forme = '') {
  const source = (numero) => rubriques.get(numero) ?? null;
  const de = (numero, lu) => (lu ? { ...lu, rubrique: numero, ancre: source(numero)?.ancre ?? null } : null);
  return {
    grossesse: de('4.3', lireGrossesse(source('4.3')?.texte)),
    conduite: de('4.7', lireConduite(source('4.7')?.texte)),
    repas: de('4.2', lireRepas(source('4.2')?.texte)),
    ouverture: HOSPITALIERE.test(plier(forme)) ? null : de('6.3', lireOuverture(source('6.3')?.texte)),
  };
}

/** Rubriques 4.2, 4.3, 4.7 et 6.3 d'une spécialité, le RCP HTML de préférence au PDF converti. */
export async function getComptoir(pool, cis, forme) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (numero) numero, texte, document_type, position
     FROM docs.rcp_sections
     WHERE code_cis = $1 AND numero IN ('4.2', '4.3', '4.7', '6.3') AND document_type <> 'notice'
     ORDER BY numero, (document_type = 'rcp') DESC, position`,
    [cis],
  );
  return lireComptoir(new Map(rows.map((row) => [row.numero, { texte: row.texte, ancre: `${row.document_type}-${row.position}` }])), forme);
}
