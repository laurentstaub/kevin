/**
 * Calendrier vaccinal : de `data/calendrier-vaccinal.json` (transcription des
 * tableaux synoptiques du ministère) à la frise de la page /vaccins.
 *
 * Aucun calcul dans la vue : ce module donne, pour chaque marque, sa position et
 * sa largeur en pourcentage de la piste. La page est du HTML positionné en CSS,
 * sans bibliothèque ni script.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const FICHIER = path.join(ROOT, 'data', 'calendrier-vaccinal.json');

/** Âge maximal de l'axe, en mois : 85 ans. Au-delà, « et plus ». */
export const AGE_MAX = 1020;

/**
 * Échelle par paliers [mois, % de la piste] : tout se joue avant 2 ans, il
 * reçoit un tiers de la largeur ; 18 à 25 ans est dilaté pour que les deux âges
 * restent lisibles ; de 25 à 85 ans, 36 %.
 */
export const PALIERS = [[0, 0], [24, 33], [216, 58], [300, 64], [AGE_MAX, 100]];

/** Deux rangs de libellés en alternance : des âges voisins ne se chevauchent pas. */
export const GRADUATIONS = [
  { mois: 0, texte: 'Naissance', rang: 1 },
  { mois: 6, texte: '6 mois', rang: 2 },
  { mois: 12, texte: '12 mois', rang: 1 },
  { mois: 18, texte: '18 mois', rang: 2 },
  { mois: 24, texte: '2 ans', rang: 1, palier: true },
  { mois: 72, texte: '6 ans', rang: 2 },
  { mois: 132, texte: '11 ans', rang: 1 },
  { mois: 180, texte: '15 ans', rang: 2 },
  { mois: 216, texte: '18 ans', rang: 1, palier: true },
  { mois: 300, texte: '25 ans', rang: 2 },
  { mois: 540, texte: '45 ans', rang: 1 },
  { mois: 780, texte: '65 ans', rang: 2 },
  { mois: 900, texte: '75 ans', rang: 2 },
  { mois: AGE_MAX, texte: '85 ans', rang: 1 },
];

const OBLIGATION = { obligatoire: 'Obligatoire', recommande: 'Recommandé', propose: 'Proposé' };

/** Position d'un âge (mois) sur la piste, en pourcentage, interpolée entre paliers. */
export function position(mois) {
  const age = Math.min(Math.max(mois, 0), AGE_MAX);
  for (let i = 1; i < PALIERS.length; i++) {
    const [m0, x0] = PALIERS[i - 1];
    const [m1, x1] = PALIERS[i];
    if (age <= m1) return x0 + ((age - m0) / (m1 - m0)) * (x1 - x0);
  }
  return 100;
}

const arrondi = (nombre) => Math.round(nombre * 100) / 100;

/** Un âge en mois, dit comme au comptoir : « 2 mois », « 6 ans ». */
export function ageEnClair(mois) {
  if (mois === 0) return 'Naissance';
  if (mois < 24) return `${mois} mois`;
  return `${Math.floor(mois / 12)} ans`;
}

/** Âge ou plage d'un événement : « 2 mois », « 16 à 18 mois », « 11 à 14 ans », « 65 ans et plus ». */
export function periodeEnClair({ de_mois: de, a_mois: a }) {
  if (a === de) return ageEnClair(de);
  if (a === null) return `${ageEnClair(de)} et plus`;
  if (a <= 24) return `${de} à ${a} mois`;
  if (de >= 24) return `${Math.floor(de / 12)} à ${Math.floor(a / 12)} ans`;
  return `${ageEnClair(de)} à ${ageEnClair(a)}`;
}

/** Statut en un mot ou deux, pour le détail. */
export function statutEnClair({ nature, obligation }) {
  const mot = OBLIGATION[obligation];
  return nature === 'rattrapage' ? `Rattrapage ${mot.toLowerCase()}` : mot;
}

/** Détail des recommandations d'un vaccin, dans l'ordre des âges. */
export function detail(evenements) {
  return [...evenements]
    .sort((a, b) => a.de_mois - b.de_mois || (a.nature === 'rattrapage') - (b.nature === 'rattrapage'))
    .map((e) => ({
      age: periodeEnClair(e),
      statut: statutEnClair(e),
      obligatoire: e.obligation === 'obligatoire',
      texte: e.texte ?? e.precision,
      condition: e.condition,
      precision: e.texte ? e.precision : null,
      rythme: e.rythme,
      pages: `page${e.pages.length > 1 ? 's' : ''} ${e.pages.join(', ')}`,
    }));
}

/** Infobulle : ce que dit le tableau, à qui, avec quel statut, et où le vérifier. */
export function titre(evenement) {
  const statut = `${evenement.nature === 'rattrapage' ? 'Rattrapage · ' : ''}${OBLIGATION[evenement.obligation]}`;
  return [
    statut,
    evenement.texte ?? evenement.precision,
    evenement.condition,
    evenement.texte && evenement.precision,
    evenement.rythme && `Rythme : ${evenement.rythme}`,
    `Calendrier, page${evenement.pages.length > 1 ? 's' : ''} ${evenement.pages.join(', ')}`,
  ].filter(Boolean).join('\n');
}

/** Géométrie d'un événement : un point pour une dose à âge fixe, une barre sinon. */
export function marque(evenement) {
  const debut = position(evenement.de_mois);
  const ouvert = evenement.a_mois === null;
  const point = evenement.type === 'dose' && evenement.de_mois === evenement.a_mois;
  const fin = point ? debut : position(ouvert ? AGE_MAX : evenement.a_mois + 1);
  return {
    point,
    ouvert,
    gauche: arrondi(debut),
    largeur: arrondi(fin - debut),
    classes: [
      point ? 'jalon-point' : 'jalon-barre',
      `jalon-${evenement.obligation}`,
      `jalon-${evenement.nature}`,
      ouvert && 'jalon-ouverte',
    ].filter(Boolean).join(' '),
    titre: titre(evenement),
  };
}

/**
 * Range les marques d'une ligne en voies. Points et barres partagent la même
 * hauteur : une barre passe sous un point qu'elle croise. Seules deux barres
 * qui se recouvrent (ROR de l'adulte) obligent à ouvrir une voie de plus.
 * Dans chaque voie, les barres précèdent les points : le point reste dessus.
 */
// Un mois de recouvrement (« jusqu'à 24 mois » puis « dès 2 ans ») ne justifie pas une voie.
const TOLERANCE = 0.3;

export function ranger(marques) {
  const voies = [];
  const barres = marques.filter((item) => !item.point).sort((a, b) => a.gauche - b.gauche);
  for (const barre of barres) {
    const voie = voies.find((existante) => existante.fin <= barre.gauche + TOLERANCE);
    if (voie) {
      voie.marques.push(barre);
      voie.fin = barre.gauche + barre.largeur;
    } else {
      voies.push({ fin: barre.gauche + barre.largeur, marques: [barre] });
    }
  }
  const points = marques.filter((item) => item.point);
  if (points.length > 0) {
    if (voies.length === 0) voies.push({ marques: [] });
    voies[0].marques.push(...points);
  }
  return voies.map((voie) => voie.marques);
}

/** Une ligne par maladie ; plusieurs voies seulement si des barres se recouvrent. */
export function frise(donnees, { population = 'generale' } = {}) {
  const lignes = donnees.vaccins.map((vaccin) => {
    const evenements = vaccin.evenements.filter((e) => e.population === population);
    return {
      id: vaccin.id, nom: vaccin.nom, voies: ranger(evenements.map(marque)), detail: detail(evenements),
    };
  }).filter((ligne) => ligne.voies.length > 0);

  return {
    source: donnees.source,
    lignes,
    graduations: GRADUATIONS.map((grad) => ({ ...grad, x: arrondi(position(grad.mois)) })),
  };
}

let cache;
/** Données lues une fois : le fichier ne change qu'avec une nouvelle version du calendrier. */
export function lireCalendrier() {
  cache ??= JSON.parse(readFileSync(FICHIER, 'utf8'));
  return cache;
}

// ------------------------------------------------------------ spécialités

const CORRESPONDANCE = path.join(ROOT, 'data', 'correspondance-vaccins.json');

/** Minuscules sans accents : la BDPM écrit « HÉPATITE », « HEPATITE » ou « hépatite ». */
export const aplatir = (texte) => String(texte ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

let regles;
/** Règles de rattachement, compilées une fois : { id de ligne → expression }. */
export function lireCorrespondance() {
  regles ??= Object.fromEntries(
    Object.entries(JSON.parse(readFileSync(CORRESPONDANCE, 'utf8')).substances)
      .map(([id, motif]) => [id, new RegExp(motif)]),
  );
  return regles;
}

/** Lignes du calendrier couvertes par une spécialité, d'après ses substances actives. */
export function rattacher(substances, correspondance = lireCorrespondance()) {
  const plates = substances.map(aplatir);
  return Object.entries(correspondance)
    .filter(([, motif]) => plates.some((substance) => motif.test(substance)))
    .map(([id]) => id);
}

/** Nom affiché : la dénomination jusqu'à la forme pharmaceutique (« ENGERIX B 10 microgrammes/0,5 mL »). */
export function nomAffiche(denomination) {
  return denomination.split(/,\s|\s(?:suspension|poudre|solution)\b/i)[0].trim();
}

/** Marque seule, sans dosage : « ENGERIX B », « BEYFORTUS », « PREVENAR 20 ». */
export function nomCourt(denomination) {
  return nomAffiche(denomination).replace(/\s+\d+(?:[.,]\d+)?\s*(?:microgrammes?|mg|u)\b.*$/i, '').trim();
}

/** Clé de comparaison : sans accents, espaces, tirets ; « Prevenar20 » = « PREVENAR 20 ». */
const compacte = (texte) => aplatir(texte).replace(/[\s\-’']/g, '');

/** Clés d'une spécialité : la marque, et la marque avec son dosage (« engerixb10 »). */
export function cles(denomination) {
  return {
    marque: compacte(nomCourt(denomination)),
    dosee: compacte(nomAffiche(denomination).replace(/\s*(?:microgrammes?|mg|u)\b.*$/i, '')),
  };
}

// Une phrase qui écarte le produit (« Engerix B10 µg n'est pas adapté », « mère
// n'ayant pas reçu Abrysvo ») n'est pas une citation.
const NEGATION = /n'est pas|n'a pas|ne doit pas|ne pas |pas adapte|contre-indiqu/;

/**
 * Événements du calendrier qui recommandent la spécialité, phrase par phrase,
 * dans le texte, la condition et la précision ; une phrase négative ne compte
 * pas (« la mère n'a pas reçu Abrysvo »). Le dosage départage deux
 * spécialités de même marque : une phrase qui nomme « Engerix B20 » ne cite pas
 * Engerix B 10 ; une phrase qui ne nomme que « Beyfortus » cite les deux dosages.
 */
export function citations(denomination, evenements, dosagesVoisins = []) {
  const { marque, dosee } = cles(denomination);
  const cite = (phrase) => {
    const texte = compacte(phrase);
    if (NEGATION.test(aplatir(phrase).replace(/’/g, "'"))) return false;
    if (texte.includes(dosee)) return true;
    return texte.includes(marque) && !dosagesVoisins.some((voisin) => texte.includes(voisin));
  };
  return evenements.filter((e) => [e.texte, e.condition, e.precision].filter(Boolean)
    .flatMap((bloc) => bloc.split(/(?<=[.;])\s+/))
    .some(cite));
}

/**
 * Citations regroupées par statut : « 2 mois, 4 mois et 11 mois (obligatoire) ·
 * 65 ans et plus (recommandé) ». Chaîne vide si le calendrier ne cite pas.
 */
export function citeeEnClair(evenements) {
  const parStatut = new Map();
  for (const e of evenements) {
    const statut = statutEnClair(e).toLowerCase();
    parStatut.set(statut, [...(parStatut.get(statut) ?? []), periodeEnClair(e)]);
  }
  const liste = (ages) => (ages.length > 1 ? `${ages.slice(0, -1).join(', ')} et ${ages.at(-1)}` : ages[0]);
  return [...parStatut].map(([statut, ages]) => `${liste(ages)} (${statut})`).join(' · ');
}

/**
 * Vaccins et anticorps (J07, J06BD) commercialisés, avec leurs substances actives.
 * Une quarantaine de lignes : lue à chaque fiche, sans cache.
 */
export async function getSpecialitesVaccins(pool) {
  const { rows } = await pool.query(
    `SELECT m.code_cis AS id, m.denomination_medicament AS denomination,
            min(a.atc_code) AS atc,
            coalesce(array_agg(DISTINCT c.denomination_substance)
                     FILTER (WHERE c.denomination_substance IS NOT NULL), '{}') AS substances
     FROM ref.cis_atc_mapping a
     JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
     LEFT JOIN dbpm.cis_compo_bdpm c ON c.code_cis = m.code_cis AND c.nature_composant = 'SA'
     WHERE (a.atc_code LIKE 'J07%' OR a.atc_code LIKE 'J06BD%')
       AND m.etat_commercialisation = 'Commercialisée'
     GROUP BY 1, 2
     ORDER BY 2`,
  );
  return rows;
}

/**
 * Fiche d'un vaccin : sa ligne de frise, ses recommandations, et les spécialités
 * qui protègent contre cette maladie — citées par le calendrier d'abord, puis
 * les autres ; pour un vaccin combiné, ce qu'il couvre en plus.
 */
export function ficheVaccin(donnees, id, specialites, correspondance = lireCorrespondance()) {
  const vaccin = donnees.vaccins.find((vaccin) => vaccin.id === id);
  if (!vaccin) return null;
  const evenements = vaccin.evenements.filter((e) => e.population === 'generale');
  const noms = Object.fromEntries(donnees.vaccins.map((vaccin) => [vaccin.id, vaccin.nom]));

  const retenues = specialites
    .map((sp) => ({ ...sp, couvre: rattacher(sp.substances, correspondance), cles: cles(sp.denomination) }))
    .filter((sp) => sp.couvre.includes(id));

  const liste = retenues
    .map((sp) => {
      // Dosages des autres spécialités de même marque (Engerix B 10 et 20).
      const voisins = retenues
        .filter((autre) => autre.id !== sp.id && autre.cles.marque === sp.cles.marque && autre.cles.dosee !== sp.cles.marque)
        .map((autre) => autre.cles.dosee);
      return {
        id: sp.id,
        nom: nomAffiche(sp.denomination),
        denomination: sp.denomination,
        atc: sp.atc,
        aussi: sp.couvre.filter((autre) => autre !== id).map((autre) => noms[autre]),
        citee: citeeEnClair(citations(sp.denomination, evenements, voisins)),
      };
    })
    .sort((a, b) => (b.citee.length > 0) - (a.citee.length > 0) || a.nom.localeCompare(b.nom, 'fr'));

  const { lignes, graduations } = frise({ ...donnees, vaccins: [vaccin] });
  return { source: donnees.source, ligne: lignes[0], graduations, specialites: liste };
}

/**
 * Lignes du calendrier où figure une spécialité, pour sa fiche produit.
 * Groupées par citation : un vaccin hexavalent cité aux mêmes âges pour ses
 * trois lignes ne répète pas trois fois « 2 mois, 4 mois et 11 mois ».
 * Tableau vide si la spécialité n'est pas un vaccin commercialisé.
 */
export function calendrierDe(donnees, cis, specialites, correspondance = lireCorrespondance()) {
  const sp = specialites.find((candidate) => String(candidate.id) === String(cis));
  if (!sp) return [];
  const groupes = [];
  for (const id of rattacher(sp.substances, correspondance)) {
    const fiche = ficheVaccin(donnees, id, specialites, correspondance);
    if (!fiche) continue;
    const citee = fiche.specialites.find((candidate) => String(candidate.id) === String(cis))?.citee ?? '';
    const dernier = groupes.at(-1);
    if (dernier && dernier.citee === citee) dernier.lignes.push({ id, nom: fiche.ligne.nom });
    else groupes.push({ citee, lignes: [{ id, nom: fiche.ligne.nom }] });
  }
  return groupes;
}

// Fin de la première phrase : un point, un appel de note éventuel, puis
// une espace et une majuscule ou une balise (le texte est celui de nos fiches).
const PREMIERE_PHRASE = /^(.*?[.!?](?:<sup class="appel">.*?<\/sup>)?)\s+(?=[A-ZÀ-Ý<])/s;
const premierePhrase = (html) => html.match(PREMIERE_PHRASE)?.[1] ?? html;

/**
 * Résumé d'une fiche de vaccin pour la page du calendrier : le paragraphe
 * « La maladie. » sans son intitulé ; pour « Les maladies. » suivi d'une liste,
 * la première phrase de chaque maladie. Les appels de note pointent vers la
 * fiche, où sont les références. Chaîne vide sans fiche.
 */
export function resumeTopo(topo, adresse) {
  const blocs = (topo?.blocs ?? []).filter((bloc) => bloc.type === 'html').map((bloc) => bloc.html);
  if (blocs.length === 0) return '';
  let html;
  if (/^<p><strong>Les maladies\.<\/strong>\s*<\/p>$/.test(blocs[0]) && blocs[1]?.startsWith('<ul>')) {
    html = blocs[1].replace(/<li>(<strong>.*?<\/strong>)\s*(.*?)<\/li>/gs,
      (tout, intitule, texte) => `<li>${intitule} ${premierePhrase(texte)}</li>`);
  } else {
    html = blocs[0].replace(/^<p><strong>La maladie\.<\/strong>\s*/, '<p>');
  }
  return html.replace(/href="#ref-/g, `href="${adresse}#ref-`);
}
