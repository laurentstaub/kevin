/**
 * Interactions entre médicaments nommés dans une même saisie, lues dans la
 * rubrique 4.5 des RCP, dans les deux sens : ce que le RCP de A dit de B, et
 * ce que celui de B dit de A. Les deux se lisent séparément parce qu'ils
 * divergent souvent : l'un nomme la substance, l'autre parle de sa classe.
 *
 * Première étape : on cherche le nom de la substance (et ses noms courants),
 * pas encore ses classes (« AINS », « anticoagulants oraux »). Un silence ne
 * vaut donc jamais absence d'interaction, et la page le dit.
 *
 * Le niveau est celui du thésaurus de l'ANSM, lu dans l'intitulé sous lequel
 * tombe le passage ; à défaut, dans le passage lui-même. Le passage est cité
 * tel quel, jamais reformulé.
 */
import { deaccent } from './text.js';
import { phrases } from './citations.js';
import { correspondances } from './synonymes.js';
import { dci, specialite } from './casse.js';

/** Du plus grave au moins grave ; `null` : le RCP ne classe pas le passage. */
export const NIVEAUX = {
  ci: 'Contre-indiquée',
  deconseillee: 'Déconseillée',
  pe: 'Précaution d’emploi',
  apec: 'À prendre en compte',
};
const RANG = { ci: 0, deconseillee: 1, pe: 2, apec: 3 };
const rang = (niveau) => RANG[niveau] ?? 4;

/** Médicaments comparés au plus : au-delà, les paires se comptent par dizaines. */
export const MEDICAMENTS_MAX = 5;
/** Passages distincts montrés par sens ; le reste est compté. */
export const PASSAGES_MAX = 4;
/** Au-delà, un passage est réduit à ses phrases qui nomment la substance. */
const BLOC_MAX = 500;

/**
 * Minuscules sans accents, apostrophe droite, **même longueur** que l'entrée :
 * les positions trouvées dans le texte plié valent dans le texte d'origine.
 */
export function plier(texte) {
  return String(texte ?? '').split('')
    .map((car) => (car === '’' ? "'" : deaccent(car).toLowerCase()[0] ?? car))
    .join('');
}

// -------------------------------------------------------- les termes cherchés

/** Mots d'un nom de substance qui ne la désignent pas : sels, hydrates, articles. */
const ACCESSOIRES = new Set([
  'acide', 'de', 'd', 'du', 'des', 'la', 'le', 'l', 'dl', 'en', 'sous', 'forme', 'base', 'sel',
  'sodique', 'potassique', 'calcique', 'magnesique', 'disodique', 'lysine',
  'sodium', 'potassium', 'magnesium',
  'chlorhydrate', 'bromhydrate', 'dichlorhydrate', 'monochlorhydrate',
  'anhydre', 'monohydrate', 'dihydrate', 'trihydrate', 'hemihydrate', 'sesquihydrate', 'hydrate',
  'maleate', 'hydrogenomaleate', 'tartrate', 'hydrogenotartrate', 'mesilate', 'mesylate',
  'besilate', 'fumarate', 'hemifumarate', 'succinate', 'sulfate', 'phosphate', 'acetate',
  'citrate', 'oxalate', 'lactate', 'gluconate', 'tosilate', 'embonate', 'pivalate',
]);

/**
 * Racine d'un mot de substance : « acétylsalicylique » et « acétylsalicylate »
 * donnent « acetylsalicyl », que nomment aussi bien le RCP de la warfarine que
 * celui de Kardégic. Une racine trop courte reste le mot entier.
 */
export function racine(mot) {
  const court = mot.replace(/(?:ique|ate)$/, '');
  return court !== mot && court.length >= 6 ? court : mot;
}

/** Mots qui désignent une substance, sans sel ni article. Jamais vide : à défaut, le mot le plus long. */
export function motsUtiles(nom) {
  const mots = plier(nom).split(/[^a-z0-9]+/).filter(Boolean);
  const utiles = mots.filter((mot) => mot.length >= 4 && !ACCESSOIRES.has(mot));
  if (utiles.length) return utiles;
  const long = mots.reduce((a, b) => (b.length > a.length ? b : a), '');
  return long ? [long] : [];
}

/**
 * Termes à chercher dans un texte pour désigner ces substances : racines, plus
 * les noms courants qui leur correspondent (« aspirine »).
 */
export function termes(substances) {
  const racines = new Set(substances.flatMap(motsUtiles).map(racine));
  for (const [courant, substance] of correspondances()) {
    if (motsUtiles(substance).map(racine).some((rac) => racines.has(rac))) racines.add(plier(courant));
  }
  return [...racines].filter(Boolean).sort();
}

/**
 * Motif commun à Postgres (ARE) et à JavaScript : un terme en début de mot,
 * sur texte plié. Les termes sont faits de lettres, chiffres et espaces.
 */
export function motif(liste) {
  const alternatives = liste.map((terme) => terme.replace(/[^a-z0-9 ]/g, '').replace(/ +/g, ' '))
    .filter(Boolean);
  return `(^|[^a-z0-9])(${alternatives.join('|')})`;
}

// --------------------------------------------------- les passages de la 4.5

/** Intitulés des quatre niveaux, avec leurs variantes de rédaction relevées dans la base. */
// « … précautions d'emploi ou à prendre en compte » : un seul intitulé, le niveau le plus fort.
const INTITULE = /associations? (contre-indiquees?|deconseillees?|(?:faisant l'objet|necessitant)(?: d'une| de| des| une)? precautions? d'emploi(?: ou a prendre en compte)?|a prendre en compte)/g;

const niveauIntitule = (texte) => {
  if (texte.startsWith('contre')) return 'ci';
  if (texte.startsWith('deconseill')) return 'deconseillee';
  if (texte.includes('precaution')) return 'pe';
  return 'apec';
};

/** Niveau dit par le passage lui-même, quand aucun intitulé ne le précède. */
function niveauDuPassage(plie) {
  if (/contre-indiqu/.test(plie)) return 'ci';
  if (/deconseill/.test(plie)) return 'deconseillee';
  return null;
}

/**
 * Découpe une 4.5 en passages : par intitulé de niveau, puis par substance
 * annoncée (« + Acide acétylsalicylique », « · Anticoagulants oraux : »).
 * @returns {{ niveau: string|null, texte: string }[]}
 */
export function passages(texte) {
  const source = String(texte ?? '').replace(/\s+/g, ' ').trim();
  const plie = plier(source);

  const coupes = [{ debut: 0, niveau: null }];
  for (const trouve of plie.matchAll(INTITULE)) {
    coupes.push({ debut: trouve.index, corps: trouve.index + trouve[0].length, niveau: niveauIntitule(trouve[1]) });
  }

  const resultat = [];
  coupes.forEach((coupe, i) => {
    const fin = coupes[i + 1]?.debut ?? source.length;
    const segment = source.slice(coupe.corps ?? coupe.debut, fin);
    // Une substance annoncée ouvre un passage : « + Substance », ou, dans les RCP
    // qui n'emploient pas le « + », une puce ou un point médian. Sous un « + »,
    // les puces détaillent la même substance (doses) et restent dans son passage.
    const parPlus = segment.split(/(?:^|\s)\+(?=\s*[A-Za-zÀ-ÿ(])/);
    const blocs = parPlus.length > 1 ? parPlus : segment.split(/(?:^|\s)[•▪·](?=\s*[A-Za-zÀ-ÿ(])/);
    for (const bloc of blocs) {
      const propre = bloc.trim();
      if (propre) resultat.push({ niveau: coupe.niveau, texte: propre });
    }
  });
  return resultat;
}

/**
 * Passages d'une 4.5 qui nomment l'un des termes.
 * @param {string} texte
 * @param {RegExp} regex  motif() compilé
 * @returns {{ niveau: string|null, extrait: string }[]}
 */
export function extraire(texte, regex) {
  const trouves = [];
  for (const passage of passages(texte)) {
    if (!regex.test(plier(passage.texte))) continue;
    let extrait = passage.texte;
    if (extrait.length > BLOC_MAX) {
      // Passage long, souvent de la prose : les phrases qui nomment la substance.
      const decoupe = phrases(extrait.replace(/\s·\s/g, ' • '));
      const utiles = decoupe.filter((phrase) => regex.test(plier(phrase)));
      extrait = (utiles.length ? utiles : decoupe).slice(0, 2).join(' […] ');
    }
    trouves.push({ niveau: passage.niveau ?? niveauDuPassage(plier(extrait)), extrait });
  }
  return trouves;
}

/**
 * Regroupe les passages identiques de plusieurs RCP (génériques d'un même
 * princeps) : un passage, le nombre de RCP qui le portent, un RCP pour le lien.
 */
export function regrouper(lignes, regex) {
  const groupes = new Map();
  for (const ligne of lignes) {
    if (!ligne.texte) continue;
    for (const { niveau, extrait } of extraire(ligne.texte, regex)) {
      const cle = plier(extrait).replace(/[^a-z0-9]+/g, ' ').trim();
      const groupe = groupes.get(cle);
      if (groupe) {
        groupe.cis.add(ligne.code_cis);
      } else {
        groupes.set(cle, {
          niveau, extrait, cis: new Set([ligne.code_cis]),
          exemple: { cis: ligne.code_cis, denomination: ligne.denomination_medicament, ancre: `rcp-${ligne.position}` },
        });
      }
    }
  }
  return [...groupes.values()]
    .map(({ cis, ...groupe }) => ({ ...groupe, nb: cis.size, libelleNiveau: NIVEAUX[groupe.niveau] ?? null }))
    .sort((a, b) => rang(a.niveau) - rang(b.niveau) || b.nb - a.nb);
}

// ------------------------------------------------------------------ la base

const motsSql = (expr) => `' ' || regexp_replace(public.f_unaccent(lower(${expr})), '[^a-z0-9]+', ' ', 'g') || ' '`;

/**
 * Un médicament de la saisie (« kardegic », « acide acetylsalicylique ») :
 * ses substances et les spécialités dont on lit le RCP. Une substance garde
 * ses spécialités à substance unique quand il y en a : le RCP d'une association
 * parle aussi de l'autre substance.
 * @returns {Promise<object|null>} null si la base ne le connaît pas
 */
export async function resoudre(pool, element) {
  const { rows } = await pool.query(
    `WITH par_substance AS (
       SELECT DISTINCT c.code_cis FROM dbpm.cis_compo_bdpm c
       WHERE c.nature_composant = 'SA'
         AND public.f_unaccent(lower(c.denomination_substance)) LIKE '%' || $1 || '%'
         AND ${motsSql('c.denomination_substance')} LIKE '% ' || $1 || ' %'
     ),
     par_marque AS (
       SELECT m.code_cis FROM dbpm.cis_bdpm m
       WHERE NOT EXISTS (SELECT 1 FROM par_substance)
         AND public.f_unaccent(lower(m.denomination_medicament)) LIKE $1 || '%'
         AND ${motsSql('m.denomination_medicament')} LIKE ' ' || $1 || ' %'
     )
     SELECT m.code_cis, m.denomination_medicament,
            (m.etat_commercialisation = 'Commercialisée') AS commercialise,
            EXISTS (SELECT 1 FROM par_substance) AS par_substance,
            ARRAY(SELECT DISTINCT c.denomination_substance FROM dbpm.cis_compo_bdpm c
                  WHERE c.code_cis = m.code_cis AND c.nature_composant = 'SA') AS substances
     FROM dbpm.cis_bdpm m
     WHERE m.code_cis IN (SELECT code_cis FROM par_substance UNION SELECT code_cis FROM par_marque)`,
    [element],
  );
  return choisir(element, rows);
}

/** Mots de la saisie dans la graphie de la base, accents compris : « acetylsalicylique » → « ACÉTYLSALICYLIQUE ». */
function graphie(element, substances) {
  const mots = substances.flatMap((substance) => substance.split(/[^\p{L}\p{N}-]+/u));
  return element.split(' ')
    .map((mot) => mots.find((original) => plier(original) === mot) ?? mot)
    .join(' ');
}

/** Partie pure de `resoudre` : substances retenues, spécialités lues, libellé. */
export function choisir(element, rows) {
  if (rows.length === 0) return null;
  const parSubstance = rows[0].par_substance;
  const mots = element.split(' ');
  const nomme = (substance) => mots.every((mot) => ` ${plier(substance).replace(/[^a-z0-9]+/g, ' ')} `.includes(` ${mot} `));

  let retenues = rows;
  if (parSubstance) {
    const seules = rows.filter((row) => row.substances.length === 1);
    if (seules.length) retenues = seules;
  } else {
    // « Dafalgan » : DAFALGAN 500 mg, pas DAFALGAN CODEINE, une autre association.
    const marque = rows.filter((row) => /^\s*(?:[0-9,]|$)/.test(plier(row.denomination_medicament).slice(element.length)));
    if (marque.length) retenues = marque;
  }
  const commercialisees = retenues.filter((row) => row.commercialise);
  if (commercialisees.length) retenues = commercialisees;

  // Une substance par racine : la BDPM écrit « ACÉTYLSALICYLATE DE DL-LYSINE »
  // et « DL-LYSINE (ACÉTYLSALICYLATE DE) » pour la même.
  const parRacine = new Map();
  for (const substance of retenues.flatMap((row) => row.substances)) {
    if (parSubstance && !nomme(substance)) continue;
    const cle = motsUtiles(substance).map(racine).sort().join(' ');
    if (!parRacine.has(cle)) parRacine.set(cle, substance);
  }
  const substances = [...parRacine.values()].sort();
  const libelle = parSubstance
    ? dci(graphie(element, substances))
    : specialite(retenues[0].denomination_medicament.slice(0, element.length));

  return {
    element,
    libelle,
    type: parSubstance ? 'substance' : 'marque',
    substances,
    termes: termes(substances),
    cis: retenues.map((row) => row.code_cis),
  };
}

/**
 * Ce que les 4.5 des RCP de `a` disent des substances de `b`. Les termes que
 * `a` partage avec `b` sont écartés : le RCP du paracétamol parle du
 * paracétamol à chaque phrase, ce n'est pas une interaction.
 */
export async function sens(pool, a, b) {
  const propres = new Set(a.termes);
  const cherches = b.termes.filter((terme) => !propres.has(terme));
  const base = { de: a.libelle, sur: b.libelle, cherche: b.type === 'substance' ? b.libelle : b.substances.map(dci).join(', ') || b.libelle };
  if (cherches.length === 0) return { ...base, rcp: 0, citant: 0, passages: [], autres: 0, niveau: null, sansObjet: true };
  const source = motif(cherches);
  const { rows } = await pool.query(
    `SELECT s.code_cis, m.denomination_medicament, s.position,
            CASE WHEN public.f_unaccent(lower(s.texte)) ~ $2 THEN s.texte END AS texte
     FROM docs.rcp_sections s
     JOIN dbpm.cis_bdpm m ON m.code_cis = s.code_cis
     WHERE s.code_cis = ANY($1::text[]) AND s.numero = '4.5' AND s.document_type = 'rcp'
     ORDER BY length(m.denomination_medicament), s.code_cis, s.position`,
    [a.cis, source],
  );
  const regex = new RegExp(source);
  const groupes = regrouper(rows, regex);
  const lus = new Set(rows.map((row) => row.code_cis));
  const citant = new Set(rows.filter((row) => row.texte).map((row) => row.code_cis));
  return {
    ...base,
    rcp: lus.size,
    citant: citant.size,
    passages: groupes.slice(0, PASSAGES_MAX),
    autres: Math.max(0, groupes.length - PASSAGES_MAX),
    niveau: groupes[0]?.niveau ?? null,
  };
}

/** Substances communes : deux noms pour une même molécule, risque de surdosage. */
export function communes(a, b) {
  const racines = new Set(a.substances.flatMap(motsUtiles).map(racine));
  return b.substances.filter((substance) => motsUtiles(substance).map(racine).some((rac) => racines.has(rac)));
}

/**
 * Toutes les paires d'une liste de médicaments, la plus grave d'abord.
 * @param {string[]} elements  sortie de reconnaitreMedicaments
 */
export async function chercherInteractions(pool, elements) {
  const resolus = await Promise.all(elements.slice(0, MEDICAMENTS_MAX).map((element) => resoudre(pool, element)));
  const medicaments = resolus.filter(Boolean);
  const inconnus = elements.slice(0, MEDICAMENTS_MAX).filter((_, i) => !resolus[i]);

  const paires = [];
  for (let i = 0; i < medicaments.length; i += 1) {
    for (let j = i + 1; j < medicaments.length; j += 1) {
      const [a, b] = [medicaments[i], medicaments[j]];
      const [ab, ba] = await Promise.all([sens(pool, a, b), sens(pool, b, a)]);
      const niveau = rang(ab.niveau) <= rang(ba.niveau) ? ab.niveau : ba.niveau;
      paires.push({
        a, b, sens: [ab, ba], niveau, libelleNiveau: NIVEAUX[niveau] ?? null,
        communes: communes(a, b).map(dci),
        cite: ab.citant + ba.citant > 0,
      });
    }
  }
  paires.sort((p1, p2) => rang(p1.niveau) - rang(p2.niveau) || Number(p2.cite) - Number(p1.cite));
  return { medicaments, inconnus, paires };
}

/**
 * Une saisie qui nomme les substances d'une association commercialisée
 * (« paracetamol codeine ») désigne ce produit, pas une interaction.
 */
export async function estAssociation(pool, elements) {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM dbpm.cis_bdpm m
       WHERE (SELECT bool_and(
                ${motsSql('m.denomination_medicament')} LIKE '% ' || e || ' %'
                OR EXISTS (SELECT 1 FROM dbpm.cis_compo_bdpm c
                           WHERE c.code_cis = m.code_cis AND c.nature_composant = 'SA'
                             AND ${motsSql('c.denomination_substance')} LIKE '% ' || e || ' %'))
              FROM unnest($1::text[]) AS e)
         AND m.code_cis IN (
           SELECT code_cis FROM dbpm.cis_compo_bdpm
           WHERE public.f_unaccent(lower(denomination_substance)) LIKE '%' || $1[1] || '%'
           UNION
           SELECT code_cis FROM dbpm.cis_bdpm
           WHERE public.f_unaccent(lower(denomination_medicament)) LIKE '%' || $1[1] || '%')
     ) AS oui`,
    [elements],
  );
  return Boolean(rows[0]?.oui);
}
