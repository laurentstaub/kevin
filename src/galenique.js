/**
 * Sécabilité d'un comprimé, lue au RCP : rubrique 3 (forme pharmaceutique),
 * puis les consignes des rubriques 4.2 et 4.4 (« ne doit pas être divisé »).
 * La phrase source est rendue telle quelle : la bande n'en affiche qu'un mot,
 * l'infobulle cite. Rien n'est déduit d'une simple « barre de cassure », qui
 * peut ne servir qu'à faciliter la prise.
 */
import { deaccent } from './text.js';

/** « doses égales », « demi-doses égales », « deux-demi doses égales ». */
const EGALES = '(?:deux[ -])?(?:demi[ -]?)?doses egales';
/** Barre de cassure qui ne divise pas en doses égales : à vérifier avant tout « sécable ». */
const PRISE_SEULE = [
  new RegExp(`ne (?:le |la |les )?divise(?:nt)? pas en ${EGALES}`),
  new RegExp(`(?:et )?non (?:pas )?(?:pour |de )?(?:le |la )?diviser en ${EGALES}`),
  /n'est pas destinee a (?:briser|casser|diviser|couper)/,
  /(?:seulement|uniquement) (?:a |de |pour )?faciliter la (?:prise|deglutition)/,
];
const QUADRI = /quadrisecable/;
/** Le mot, sauf nié : « non sécable », « ne sont pas sécables ». */
const SECABLE_MOT = /(?<!non[ -])(?<!pas )\bsecables?\b/;
// « peut être divisé en doses égales », « peuvent être divisés en deux parties égales », « peut-être » (sic).
const DIVISIBLE = /peu[a-z]*[ -]etre (?:divise|coupe|casse)e?s? en (?:deux |quatre )?(?:(?:demi-?)?doses|quarts|parties egales|moities)/;
const PAS_SECABLE = /\b(?:n'est|ne sont) pas secables?\b/;
const NON_SECABLE = new RegExp(`\\bnon[ -]secables?\\b|${PAS_SECABLE.source}`);
/**
 * Consigne de ne pas couper : « ne doit pas être divisé », « ni mâchés, ni
 * divisés », « Ne pas tenter de diviser le comprimé ». Pas une dose « divisée
 * par deux » ni « divisée en deux prises ».
 */
const NE_PAS_COUPER = /(?:\bne (?:doi[a-z]*|peu[a-z]*|faut|pas)\b|\bni\b|\bsans (?:etre|les?|la)\b)[^.;:]{0,60}?\b(?:divis|coup|cass|bris)(?:e|es|ee|ees|er)\b(?! par| en (?:deux|2|trois|3|plusieurs) (?:prises|doses|administrations))/;
/** Sujet d'une consigne qui porte sur la posologie, pas sur le comprimé. */
const POSOLOGIE = /\b(?:posologies?|doses? (?:quotidienne|journaliere|totale|d'entretien|initiale)s?)\b/;

/** Phrases d'un texte, sans couper sur les décimales. */
const phrases = (texte) => texte.split(/(?<=[.!?])\s+(?=\S)/).map((phrase) => phrase.trim()).filter(Boolean);
const plier = (phrase) => deaccent(phrase).toLowerCase().replaceAll('’', "'");

/**
 * @param {string|null} texte  texte de la rubrique 3
 * @param {{ [numero: string]: string|null }} consignes  rubriques 4.2 et 4.4
 * @returns {{ valeur: 'secable'|'quadrisecable'|'prise-seule'|'non-secable'|'ne-pas-couper', phrase: string, rubrique: string }|null}
 *   null quand le RCP ne dit rien, ou se contredit (plusieurs dosages dans un même RCP)
 */
export function lireSecabilite(texte, consignes = {}) {
  const sources = [['3', texte], ...Object.entries(consignes)].filter(([, contenu]) => contenu);
  const trouve = (motif, numeros, garde = () => true) => {
    for (const [rubrique, contenu] of sources) {
      if (!numeros.includes(rubrique)) continue;
      const phrase = phrases(contenu.replace(/\s+/g, ' ')).find((candidate) => {
        const plie = plier(candidate);
        return candidate.length <= 500 && motif.test(plie) && garde(plie);
      });
      if (phrase) return { phrase, rubrique };
    }
    return null;
  };
  const tout = sources.map(([rubrique]) => rubrique);
  const avec = (valeur, lu) => ({ valeur, ...lu });

  const priseSeule = PRISE_SEULE.map((motif) => trouve(motif, tout)).find(Boolean);
  if (priseSeule) return avec('prise-seule', priseSeule);

  const quadri = trouve(QUADRI, ['3']);
  const secable = trouve(SECABLE_MOT, ['3']) ?? trouve(DIVISIBLE, ['3']);
  const non = trouve(NON_SECABLE, ['3']);
  const consignes4 = tout.filter((rubrique) => rubrique !== '3');
  const consigne = trouve(NE_PAS_COUPER, consignes4, (plie) => !POSOLOGIE.test(plie)) ?? trouve(PAS_SECABLE, consignes4);
  // « 50 mg : non sécables … 100 mg : sécables » : la bande ne tranche pas.
  if ((quadri || secable) && (non || consigne)) return null;
  if (quadri) return avec('quadrisecable', quadri);
  if (secable) return avec('secable', secable);
  // La consigne dit plus que la description : « ne pas couper » plutôt que « non sécable ».
  if (consigne) return avec('ne-pas-couper', consigne);
  if (non) return avec('non-secable', non);
  // Rubrique 3 muette : une permission écrite en 4.2. Pas le mot seul, qui y
  // nomme souvent une autre spécialité (« un comprimé sécable à 100 mg est disponible »).
  const permis = trouve(DIVISIBLE, consignes4, (plie) => !POSOLOGIE.test(plie));
  return permis ? avec('secable', permis) : null;
}

/**
 * Sécabilité écrite dans la forme BDPM (« comprimé pelliculé sécable »), quand
 * le RCP se tait ou manque. La bande abrège la forme et en retire ce mot.
 */
export function secabiliteDeForme(forme) {
  const plie = plier(String(forme ?? ''));
  if (/quadrisecable/.test(plie)) return { valeur: 'quadrisecable', phrase: forme, rubrique: null };
  if (/(?<!non[ -])\bsecables?\b/.test(plie)) return { valeur: 'secable', phrase: forme, rubrique: null };
  return null;
}

/** Libellés courts de la bande. */
export const SECABILITE = {
  secable: 'sécable',
  quadrisecable: 'quadrisécable',
  'prise-seule': 'barre de prise seule',
  'non-secable': 'non sécable',
  'ne-pas-couper': 'ne pas couper',
};

/** Sécabilité d'une spécialité d'après ses rubriques 3, 4.2 et 4.4 déjà découpées ; null si muettes. */
export async function getSecabilite(pool, cis) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (numero) numero, texte, document_type, position
     FROM docs.rcp_sections
     WHERE code_cis = $1 AND numero IN ('3', '4.2', '4.4') AND document_type <> 'notice'
     ORDER BY numero, (document_type = 'rcp') DESC, position`,
    [cis],
  );
  const rubrique = (numero) => rows.find((row) => row.numero === numero);
  const texte = (numero) => rubrique(numero)?.texte ?? null;
  const lu = lireSecabilite(texte('3'), { '4.2': texte('4.2'), '4.4': texte('4.4') });
  if (!lu) return null;
  // Ancre de la rubrique citée dans la fiche : la bande y mène.
  const source = rubrique(lu.rubrique);
  return { ...lu, ancre: source ? `${source.document_type}-${source.position}` : null };
}

// ------------------------------------------------------------ l'administration

/**
 * Comment avaler, écraser, ouvrir ou passer par une sonde, lu dans les
 * rubriques 4.2 et 6.6 du RCP. Chaque mention garde la phrase qui la porte :
 * la bande en affiche le mot, l'infobulle la cite. Rien n'est déduit de la
 * forme (« à libération prolongée ») : c'est au RCP de dire qu'on n'écrase pas.
 * Le RCP muet, rien ne s'affiche.
 */

/** Mentions dans l'ordre d'affichage : ce qui interdit avant ce qui permet. */
export const ADMINISTRATION = {
  'ne-pas-ecraser': 'ne pas écraser',
  'ne-pas-ouvrir': 'ne pas ouvrir',
  'avaler-entier': 'avaler entier',
  ecrasable: 'écrasable',
  ouvrable: 'gélule ouvrable',
  dispersible: 'dispersible',
  sonde: 'sonde possible',
};

// Verbes d'altération, sur texte plié (sans accents, minuscules).
const ECRASER = '(?:ecras|croqu|mach|broy)';
const OUVRIR = '(?:ouvr|ouvert)';
/** Négations : « ne doivent pas être écrasés », « ni ouvertes, ni mâchées », « sans croquer ». */
const negation = (verbe) => new RegExp(`ne (?:doi[a-z]* |peu[a-z]* |faut )?(?:pas|jamais) (?:etre |les? |la )?${verbe}`
  + `|\\bni (?:etre )?${verbe}|sans (?:etre |les? |la |l')?${verbe}`);
const INTERDIT_ECRASER = negation(ECRASER);
const INTERDIT_OUVRIR = negation(OUVRIR);
/** « Ne pas ouvrir » ne vaut que pour une gélule : pas pour un flacon ni une plaquette. */
const GELULE = /\b(?:gelules?|capsules?)\b/;
/** Permission, dont le sujet est le médicament : « les comprimés peuvent être écrasés », « le contenu des gélules peut être dispersé ». */
const SUJET = '\\b(?:comprimes?|gelules?|capsules?|contenu|granul[a-z]*|microgranul[a-z]*|poudre|sachets?|ils?|elles?)\\b';
const permis = (verbe) => new RegExp(`${SUJET}[^.;]{0,60}?peu[a-z]* (?:aussi |egalement |etre aussi )?(?:etre )?${verbe}`);
const PERMIS_ECRASER = permis('ecras');
const PERMIS_OUVRIR = new RegExp(`${permis('ouvert').source}|\\bouvrir la gelule|\\bcontenu (?:de la |des )gelules? (?:peu|doi|est|sont)`);
/** « leur contenu peut être administré dans une purée » : la gélule s'ouvre, si la phrase parle d'une gélule. */
const CONTENU_ADMINISTRE = /\bcontenu [^.;]{0,30}?peu[a-z]* (?:aussi |egalement )?etre (?:administr|verse|vide|melang|saupoudr|dispers|ajout)/;
// « peuvent être écrasés et mis en suspension » : le verbe peut suivre d'un ou deux mots.
const PERMIS_DISPERSER = new RegExp(`${SUJET}[^.;]{0,60}?peu[a-z]* (?:aussi |egalement )?etre [^.;]{0,40}?(?:dispers|dissou|melang|saupoudr|delay|suspension)`);
/** Entier, quand c'est une consigne : « doit être avalé entier », « à avaler en entier », « Avaler le comprimé entier ». */
const TEL = '(?:en )?(?:entiere?s?|tels? quels?|telles? quelles?)';
const ENTIER = new RegExp(`doi[a-z]* (?:[a-z]+ ){0,2}etre avale[a-z]* ${TEL}|\\ba avaler ${TEL}|^avaler\\b[^.]{0,40} ${TEL}`);
/**
 * Sonde digestive : l'administration par elle, pas une consigne de rinçage, ni
 * une sonde endotrachéale, ni un renvoi vers l'intraveineuse, ni une mise en garde.
 */
const SONDE = /(?:administr[a-z]*|donne[a-z]*) (?:par|au moyen d'une|via une?|a l'aide d'une) sonde|\bpar sonde\b|administration par sonde|\bdans (?:la |une |des )?sondes? (?:naso|gastr|de gastr|d'alim)/;
const SONDE_DIGESTIVE = /gastr|nasogastr|naso-gastr|d'alimentation|enterale|jejun|duoden/;
const NIE = /n'est pas recommand|deconseill|ne doi[a-z]* pas|intraveineuse/;

const plierAdm = (texte) => deaccent(String(texte ?? '')).toLowerCase().replace(/’/g, "'");

/**
 * @param {string[]} textes  rubriques 4.2 et 6.6
 * @returns {Array<{ cle: string, libelle: string, phrase: string }>} dans l'ordre d'ADMINISTRATION
 */
export function lireAdministration(textes) {
  const trouvees = new Map();
  const noter = (cle, phrase) => { if (!trouvees.has(cle)) trouvees.set(cle, phrase); };
  for (const texte of textes.filter(Boolean)) {
    for (const phrase of phrases(texte.replace(/\s+/g, ' '))) {
      if (phrase.length > 500) continue;
      const plie = plierAdm(phrase);
      // « ne pas mâcher la gomme trop vigoureusement » règle la façon, ne l'interdit pas.
      if (INTERDIT_ECRASER.test(plie) && !/(?:ecras|croqu|mach)[a-z]* [a-z' ]{0,30}\btrop\b/.test(plie)) noter('ne-pas-ecraser', phrase);
      if (INTERDIT_OUVRIR.test(plie) && GELULE.test(plie)) noter('ne-pas-ouvrir', phrase);
      if (ENTIER.test(plie)) noter('avaler-entier', phrase);
      // Une permission niée (« ne peuvent pas être écrasés ») n'en est pas une.
      if (PERMIS_ECRASER.test(plie) && !INTERDIT_ECRASER.test(plie)) noter('ecrasable', phrase);
      if ((PERMIS_OUVRIR.test(plie) || (CONTENU_ADMINISTRE.test(plie) && GELULE.test(plie))) && !INTERDIT_OUVRIR.test(plie)) noter('ouvrable', phrase);
      if (PERMIS_DISPERSER.test(plie)) noter('dispersible', phrase);
      if (SONDE.test(plie) && SONDE_DIGESTIVE.test(plie) && !NIE.test(plie)) noter('sonde', phrase);
    }
  }
  return Object.keys(ADMINISTRATION)
    .filter((cle) => trouvees.has(cle))
    .map((cle) => ({ cle, libelle: ADMINISTRATION[cle], phrase: trouvees.get(cle) }));
}

/** Rubriques 4.2 et 6.6 d'une spécialité, le RCP HTML de préférence au PDF converti. */
export async function getAdministration(pool, cis) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (numero) numero, texte
     FROM docs.rcp_sections
     WHERE code_cis = $1 AND numero IN ('4.2', '6.6') AND document_type <> 'notice'
     ORDER BY numero, (document_type = 'rcp') DESC, position`,
    [cis],
  );
  return lireAdministration(rows.map((row) => row.texte));
}

// ------------------------------------------------- déglutition difficile

/** Mentions du RCP qui permettent de prendre le médicament sans l'avaler entier. */
const PERMET = new Set(['ecrasable', 'ouvrable', 'dispersible', 'sonde']);

/**
 * Formes BDPM qui ne s'avalent pas entières : buvables, fondantes, à disperser,
 * avec le mot affiché. Une gélule (« microgranules en gélule ») n'en est pas une :
 * c'est à son RCP de dire qu'elle s'ouvre.
 */
const FORMES_AISEES = [
  [/buvable|solution orale|suspension orale/, 'buvable'], [/sirop/, 'sirop'], [/gouttes/, 'gouttes'],
  [/orodispersible/, 'orodispersible'], [/effervescent/, 'effervescent'], [/dispersible/, 'dispersible'],
  [/lyophilisat/, 'lyophilisat oral'], [/granul/, 'granulés'], [/poudre/, 'poudre'], [/sachet/, 'sachet'],
  [/a sucer/, 'à sucer'], [/sublingu/, 'sublingual'], [/gingiva/, 'gingival'],
];

/**
 * Pourquoi un médicament convient à qui avale mal : sa forme (BDPM), sinon ce
 * que son RCP permet. Null : rien de tel n'est dit.
 * @param {string} forme  forme pharmaceutique BDPM
 * @param {{ cle: string, libelle: string }[]} mentions  sortie de lireAdministration
 * @returns {string|null}
 */
export function raisonDeglutition(forme, mentions = []) {
  const plie = plierAdm(forme);
  const aisee = /gelule/.test(plie) ? null : FORMES_AISEES.find(([motif]) => motif.test(plie));
  if (aisee) return aisee[1];
  const permise = mentions.find((mention) => PERMET.has(mention.cle));
  return permise ? `${permise.libelle} (RCP)` : null;
}

/**
 * Mentions d'administration de plusieurs spécialités. La base ne rend que les
 * rubriques qui en parlent (filtre large), le tri fin se fait ici : une fiche peut
 * proposer quatre cents alternatives, on ne rapatrie pas tous leurs textes.
 * @returns {Promise<Map<string, object[]>>}
 */
export async function administrationDe(pool, cisListe) {
  if (cisListe.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT code_cis, array_agg(texte) AS textes
     FROM docs.rcp_sections
     WHERE code_cis = ANY($1::text[]) AND numero IN ('4.2', '6.6') AND document_type <> 'notice'
       AND public.f_unaccent(lower(texte)) ~ '(ecras|ouv|dispers|dissou|melang|saupoudr|delay|sonde|contenu)'
     GROUP BY code_cis`,
    [cisListe],
  );
  return new Map(rows.map((row) => [row.code_cis, lireAdministration(row.textes)]));
}

/**
 * Filtre « déglutition difficile » des alternatives : chaque candidat porte sa
 * raison (forme ou RCP) ; actif, ceux qui n'en ont pas sont masqués et comptés.
 * Proposé seulement s'il sépare les candidats.
 * @returns {{ categories: object[], propose: boolean, actif: boolean, masques: number }}
 */
export function filtrerDeglutition(categories, mentionsParCis, actif) {
  const raison = (item) => raisonDeglutition(item.forme ?? item.denomination ?? '', mentionsParCis.get(String(item.id)) ?? []);
  const items = (categories ?? []).filter((categorie) => categorie.cle !== 'BLOQUE')
    .flatMap((categorie) => [...(categorie.lignes ?? []), ...(categorie.molecules ?? []).flatMap((molecule) => molecule.specialites)]);
  const avec = items.filter((item) => raison(item)).length;
  const propose = actif || (avec > 0 && avec < items.length);

  let masques = 0;
  const garder = (liste) => liste
    .map((item) => ({ ...item, deglutition: raison(item) }))
    .filter((item) => {
      if (!actif || item.deglutition) return true;
      masques += 1;
      return false;
    });
  const filtrees = (categories ?? []).map((categorie) => {
    if (categorie.cle === 'BLOQUE') return categorie;
    if (categorie.molecules) {
      const molecules = categorie.molecules
        .map((molecule) => ({ ...molecule, specialites: garder(molecule.specialites) }))
        .filter((molecule) => molecule.specialites.length > 0);
      const total = molecules.reduce((somme, molecule) => somme + molecule.specialites.length, 0);
      return total > 0 ? { ...categorie, molecules, total } : null;
    }
    const lignes = garder(categorie.lignes ?? []);
    return lignes.length > 0 ? { ...categorie, lignes } : null;
  }).filter(Boolean);
  return { categories: filtrees, propose, actif, masques };
}
