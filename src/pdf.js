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
// ---------------------------------------------------------------- tableaux

/** Légende d'un tableau (« Tableau 3 :    Interactions… ») : alignée, mais pas une rangée. */
const LEGENDE = /^\s*Tableau\s+\d/i;

/**
 * Morceaux d'une ligne de `pdftotext -layout` : les mots séparés par une ou deux
 * espaces restent ensemble, trois espaces ou plus changent de colonne.
 */
export function morceaux(ligne) {
  const sortie = [];
  const motif = /\S+(?: {1,2}\S+)*/g;
  let trouve;
  while ((trouve = motif.exec(ligne))) {
    sortie.push({ debut: trouve.index, texte: trouve[0] });
  }
  return sortie;
}

/**
 * Débuts de colonnes : positions de départ des morceaux, groupées à trois
 * caractères près (un en-tête centré tombe un peu à droite de ses données).
 * Une position vue une seule fois n'est pas une colonne.
 */
function colonnesDe(debuts) {
  const groupes = [];
  for (const debut of [...debuts].sort((a, b) => a - b)) {
    const dernier = groupes.at(-1);
    if (dernier && debut - dernier.fin <= 3) {
      dernier.fin = debut;
      dernier.n += 1;
    } else {
      groupes.push({ debut, fin: debut, n: 1 });
    }
  }
  return groupes.filter((groupe) => groupe.n >= 2).map((groupe) => groupe.debut);
}

/**
 * Colonnes d'un tableau, chacune avec son étendue. Leur nombre est le plus grand
 * nombre de morceaux que deux lignes au moins partagent ; leur étendue se lit
 * sur ces lignes complètes. Les en-têtes et les cellules centrés (Eliquis)
 * commencent n'importe où : seul l'ordre des morceaux compte sur une ligne
 * complète.
 *
 * @returns {{ debut: number, fin: number }[]}
 */
function colonnesDuTableau(zone) {
  const lignes = zone.map(morceaux).filter((parts) => parts.length >= 2);
  const effectifs = new Map();
  for (const parts of lignes) effectifs.set(parts.length, (effectifs.get(parts.length) ?? 0) + 1);
  const partages = [...effectifs].filter(([, vues]) => vues >= 2).map(([nombre]) => nombre);
  if (partages.length === 0) return [];
  // La première ligne, l'en-tête le plus souvent, remplit toutes les colonnes,
  // même quand aucune rangée de données ne le fait (Ferriprox).
  const nombre = Math.max(...partages, Math.min(lignes[0].length, Math.max(...partages) + 2));
  const completes = lignes.filter((parts) => parts.length === nombre);
  const colonnes = Array.from({ length: nombre }, (_, i) => ({
    debut: Math.min(...completes.map((parts) => parts[i].debut)),
    fin: Math.max(...completes.map((parts) => parts[i].debut + parts[i].texte.length)),
  }));
  // Une colonne va jusqu'où commence la suivante : ni recouvrement, où un mot
  // hésiterait entre deux, ni vide entre elles.
  colonnes.forEach((colonne, i) => {
    if (colonnes[i + 1]) colonne.fin = colonnes[i + 1].debut - 1;
  });
  return colonnes;
}

/**
 * Colonne d'une position : la dernière qui commence avant elle. Un mot à deux
 * caractères du début d'une colonne en est : une cellule voisine séparée par une
 * seule espace (« 12,6 % des patients 2,1 % ») ne déborde pas jusque-là.
 */
function colonneDe(position, colonnes) {
  let indice = 0;
  colonnes.forEach((colonne, i) => {
    if (colonne.debut <= position + 2) indice = i;
  });
  return indice;
}

/**
 * Morceaux coupés entre deux colonnes : des mots séparés par une ou deux espaces
 * que leur position envoie dans deux colonnes. Rare dans un tableau net, fréquent
 * quand `pdftotext` a mal aligné : un indice de confiance.
 */
function morceauxCoupes(zone, colonnes) {
  let coupes = 0;
  for (const ligne of zone) {
    const parts = morceaux(ligne);
    if (parts.length === colonnes.length) continue;
    for (const part of parts) {
      const motif = /\S+/g;
      const vues = new Set();
      let mot;
      while ((mot = motif.exec(part.texte))) vues.add(colonneDe(part.debut + mot.index, colonnes));
      if (vues.size > 1) coupes += 1;
    }
  }
  return coupes;
}

/**
 * Cellules d'une ligne. Une ligne complète se range dans l'ordre ; les autres
 * mot par mot, chacun dans la colonne où il tombe (`pdftotext` ne laisse
 * parfois qu'une espace entre deux cellules).
 *
 * @returns {Map<number, string[]>}
 */
function cellulesDe(ligne, colonnes) {
  const parts = morceaux(ligne);
  const cellules = new Map();
  const ajouter = (colonne, texte) => cellules.set(colonne, [...(cellules.get(colonne) ?? []), texte]);
  if (parts.length === colonnes.length) {
    parts.forEach((part, i) => ajouter(i, part.texte));
    return cellules;
  }
  for (const part of parts) {
    let courante = null;
    let mots = [];
    const motif = /\S+/g;
    let mot;
    while ((mot = motif.exec(part.texte))) {
      const colonne = colonneDe(part.debut + mot.index, colonnes);
      if (courante !== null && colonne !== courante) {
        ajouter(courante, mots.join(' '));
        mots = [];
      }
      courante = colonne;
      mots.push(mot[0]);
    }
    if (courante !== null) ajouter(courante, mots.join(' '));
  }
  return cellules;
}

/** Lignes d'une cellule recollées ; « contre- » + « indiquée » → « contre-indiquée ». */
function recoller(lignes) {
  return lignes.reduce((texte, ligne) => {
    if (!texte) return ligne;
    if (/[\p{L}\d]-$/u.test(texte) && /^\p{Ll}/u.test(ligne)) return texte + ligne;
    return `${texte} ${ligne}`;
  }, '');
}

/** Fin de phrase : une cellule qui s'arrête là est complète. */
const FIN_DE_PHRASE = /[.:;!?)»]$/;

/** Texte d'une ligne, espaces d'alignement réduits : sert à reconnaître un en-tête répété. */
const empreinte = (ligne) => morceaux(ligne).map((morceau) => morceau.texte).join(' ');

/**
 * Rangées d'un tableau, chacune avec ses cellules (lignes de texte par colonne)
 * et les lignes du texte d'où elle vient. Une ligne vide sépare deux rangées ;
 * sans ligne vide, une rangée commence quand du texte apparaît dans une colonne
 * restée vide à la ligne précédente (un nouveau médicament, une nouvelle classe),
 * ou quand une ligne en plusieurs colonnes n'a aucune cellule qui commence en
 * minuscule : la suite d'une cellule (« récepteurs », « système ») en commence une.
 */
function rangees(zone, colonnes, sauter = new Set()) {
  const rangs = [];
  let rangee = null;
  let avant = new Set();
  for (const [rang, ligne] of zone.entries()) {
    // En-tête répété à un saut de page : traité comme une ligne vide.
    if (!ligne.trim() || sauter.has(rang)) {
      rangee = null;
      avant = new Set();
      continue;
    }
    // Intitulé de groupe sur toute la largeur, en majuscule initiale : sa propre rangée.
    const seul = morceaux(ligne);
    if (seul.length === 1 && colonnes.length > 1 && seul[0].debut <= colonnes[0].debut + 3
      && seul[0].debut + seul[0].texte.length > colonnes[1].debut && /^\p{Lu}/u.test(seul[0].texte)) {
      rangs.push({ cellules: colonnes.map(() => []), lignes: [empreinte(ligne)], pleine: seul[0].texte });
      rangee = null;
      avant = new Set();
      continue;
    }
    const cellules = cellulesDe(ligne, colonnes);
    // Seule dans la première colonne, en majuscule, après une ligne en colonnes
    // ou assez longue pour ne pas être un mot d'en-tête (« MedDRA ») : un intitulé
    // de groupe court (« Affections du système nerveux »).
    const seuleEnTete = cellules.size === 1 && cellules.has(0) && /^\p{Lu}/u.test(cellules.get(0)[0]);
    const intitule = seuleEnTete && (avant.size >= 2 || cellules.get(0).join(' ').length >= 15);
    // Commentaire du dessus fini, nouveau nom plus à gauche : nouvelle rangée.
    // (« ↑Fentanyl / ↑Oxycodone » sous un commentaire qui continue : même cellule.)
    const derniere = colonnes.length - 1;
    const phraseFinie = Boolean(rangee && FIN_DE_PHRASE.test(rangee.cellules[derniere].at(-1) ?? ''))
      && avant.has(derniere);
    const nouveauNom = [...cellules].some(([colonne, textes]) => colonne < derniere && !/^\p{Ll}/u.test(textes[0]));
    const nouvelle = intitule || (phraseFinie && nouveauNom) || [...cellules.keys()].some((colonne) => !avant.has(colonne))
      || (cellules.size >= 2 && [...cellules.values()].every((textes) => !/^\p{Ll}/u.test(textes[0])));
    if (!rangee || nouvelle) {
      rangee = { cellules: colonnes.map(() => []), lignes: [], groupe: intitule };
      rangs.push(rangee);
    }
    for (const [colonne, textes] of cellules) rangee.cellules[colonne].push(textes.join(' '));
    rangee.lignes.push(empreinte(ligne));
    avant = new Set(cellules.keys());
  }

  // Rattachements, dans cet ordre :
  // 1. une rangée qui commence en minuscule est une suite (saut de page, ligne
  //    vide dans une cellule) : elle rejoint la rangée d'avant ;
  // 2. une cellule centrée commence une ligne plus haut que ses voisines : un
  //    début de phrase seul dans la dernière colonne rejoint la rangée d'après ;
  // 3. le reste de la dernière colonne seule complète la rangée d'avant : une
  //    nouvelle rangée a toujours une autre colonne remplie.
  const derniere = colonnes.length - 1;
  const fusionnees = [];
  for (let i = 0; i < rangs.length; i += 1) {
    const rang = rangs[i];
    const suivante = rangs[i + 1];
    const precedente = fusionnees.at(-1)?.pleine ? null : fusionnees.at(-1);
    if (rang.pleine) {
      fusionnees.push(rang);
      continue;
    }
    if (precedente && rang.cellules.every((cellule) => !cellule.length || /^\p{Ll}/u.test(cellule[0]))) {
      fondre(precedente, rang);
      continue;
    }
    if (seuleDerniere(rang) && suivante && !suivante.pleine && !FIN_DE_PHRASE.test(rang.cellules[derniere].at(-1))) {
      suivante.cellules[derniere] = [...rang.cellules[derniere], ...suivante.cellules[derniere]];
      suivante.lignes = [...rang.lignes, ...suivante.lignes];
      continue;
    }
    if (precedente && seuleDerniere(rang)) {
      fondre(precedente, rang);
      continue;
    }
    fusionnees.push(rang);
  }
  // Intitulé de groupe resté seul dans sa première colonne : sur toute la largeur.
  for (const rang of fusionnees) {
    if (rang.groupe && rang.cellules.every((cellule, col) => (col === 0) === (cellule.length > 0))) {
      rang.pleine = recoller(rang.cellules[0]);
    }
  }
  return fusionnees;
}

/** Rangée qui n'a de texte que dans sa dernière colonne. */
function seuleDerniere(rangee) {
  const derniere = rangee.cellules.length - 1;
  return rangee.cellules.every((cellule, col) => (col === derniere) === (cellule.length > 0));
}

/**
 * Lignes d'un en-tête répété : un bloc qui reproduit toutes les lignes de
 * l'en-tête, dans l'ordre (lignes vides permises entre elles). Une ligne de
 * données qui ressemble à une ligne d'en-tête reste.
 *
 * @returns {Set<number>} indices dans `zone`, à partir de `depuis`
 */
function repetitionsEntete(zone, entete, depuis = 0) {
  const sauter = new Set();
  if (entete.length === 0) return sauter;
  for (let pos = depuis; pos < zone.length; pos += 1) {
    if (empreinte(zone[pos]) !== entete[0]) continue;
    const bloc = [];
    let j = pos;
    for (const attendue of entete) {
      while (j < zone.length && !zone[j].trim()) j += 1;
      if (j >= zone.length || empreinte(zone[j]) !== attendue) break;
      bloc.push(j);
      j += 1;
    }
    if (bloc.length === entete.length) {
      for (const indice of bloc) sauter.add(indice);
      pos = j - 1;
    }
  }
  return sauter;
}

/** Fond une rangée dans une autre, cellule par cellule. */
function fondre(dans, rangee) {
  rangee.cellules.forEach((cellule, col) => dans.cellules[col].push(...cellule));
  dans.lignes.push(...rangee.lignes);
}

/**
 * En-tête : la première rangée, plus les suivantes tant qu'il manque une
 * colonne et qu'elles sont courtes (un en-tête sur trois lignes, centré, se
 * découpe en rangées). Rend le nombre de rangées fondues dans l'en-tête.
 */
function fondreEntete(rangs) {
  if (rangs.length === 0) return;
  const tete = rangs[0];
  const utilisees = new Set();
  for (const rangee of rangs) rangee.cellules.forEach((cellule, col) => { if (cellule.length) utilisees.add(col); });
  const couvertes = () => tete.cellules.filter((cellule) => cellule.length).length;
  let fondues = 0;
  if (tete.pleine) return;
  // Une rangée à valeurs chiffrées est une donnée, jamais l'en-tête.
  const chiffree = (rangee) => rangee.cellules.filter((cellule) => /^[\d\s.,%<>≤≥±*()[\];–-]+$/u.test(recoller(cellule))).length >= 2;
  while (rangs.length > 1 && fondues < 3 && couvertes() < utilisees.size && !rangs[1].pleine && !chiffree(rangs[1])
    && rangs[1].cellules.every((cellule) => recoller(cellule).length <= 40)) {
    fondre(tete, rangs.splice(1, 1)[0]);
    fondues += 1;
  }
  // Fin d'en-tête sous ses colonnes, première colonne vide (« (FANV) », « 18 ans »).
  const fin = rangs[1];
  if (fin && !fin.pleine && !fin.cellules[0].length
    && fin.cellules.every((cellule) => recoller(cellule).length <= 20)) {
    fondre(tete, rangs.splice(1, 1)[0]);
  }
}

/**
 * Repère les zones en colonnes. Une zone commence à une ligne en colonnes et se
 * poursuit tant que les lignes se rangent dans ses colonnes : en colonnes, en
 * retrait sous une colonne, ou courtes dans la première colonne entre deux
 * lignes du tableau. Il en faut au moins deux en colonnes, alignées.
 */
function zonesEnColonnes(lignes, titres) {
  const zones = [];
  const enColonnes = (i) => {
    const ligne = lignes[i];
    return morceaux(ligne).length >= 2 && !LEGENDE.test(ligne) && !PUCE.test(ligne);
  };

  const tableEnVue = (j) => {
    let vues = 0;
    for (let pos = j + 1; pos < lignes.length && vues < 3; pos += 1) {
      if (titres.has(pos) || LEGENDE.test(lignes[pos])) return false;
      if (!lignes[pos].trim()) continue;
      if (enColonnes(pos)) return true;
      vues += 1;
    }
    return false;
  };

  for (let i = 0; i < lignes.length; i += 1) {
    if (titres.has(i) || !enColonnes(i)) continue;

    const debuts = morceaux(lignes[i]).map((morceau) => morceau.debut);
    let fin = i;
    let multiples = 1;
    for (let j = i + 1; j < lignes.length; j += 1) {
      const ligne = lignes[j];
      if (titres.has(j) || LEGENDE.test(ligne)) break;
      if (!ligne.trim()) continue;
      const cols = colonnesDe(debuts);
      const seconde = cols[1] ?? debuts.filter((pos) => pos > Math.min(...debuts) + 3).sort((a, b) => a - b)[0] ?? Infinity;
      const parts = morceaux(ligne);
      const retrait = parts[0].debut;
      const prochaine = lignes.slice(j + 1).findIndex((autre) => autre.trim());
      const suite = prochaine === -1 ? null : j + 1 + prochaine;
      const suiteEnTableau = suite !== null && !titres.has(suite)
        && (enColonnes(suite) || morceaux(lignes[suite])[0].debut >= seconde - 3);

      let dedans = false;
      if (parts.length >= 2) dedans = true;
      else if (retrait >= seconde - 3) dedans = true;
      else if (retrait + parts[0].texte.length <= seconde && lignes[j - 1].trim() && suiteEnTableau) dedans = true;
      // Ligne seule sur toute la largeur, le tableau reprenant dans les trois
      // lignes : intitulé de groupe (« Affections vasculaires ») ou suite d'une
      // cellule de la première colonne.
      else if (retrait <= Math.min(...debuts) + 3 && tableEnVue(j)) dedans = true;
      if (!dedans) break;

      if (parts.length >= 2) {
        multiples += 1;
        debuts.push(...parts.map((part) => part.debut));
      }
      fin = j;
    }

    if (multiples < 2 || colonnesDe(debuts).length < 2) continue;
    const colonnes = colonnesDuTableau(lignes.slice(i, fin + 1));
    if (colonnes.length < 2) continue;

    // En-tête au-dessus de la première ligne en colonnes, en retrait sous une
    // colonne (« Médicament de la classe ») : il appartient au tableau.
    let debut = i;
    while (debut > 0 && lignes[debut - 1].trim() && !titres.has(debut - 1) && !LEGENDE.test(lignes[debut - 1])
      && morceaux(lignes[debut - 1]).length === 1 && morceaux(lignes[debut - 1])[0].debut >= colonnes[1].debut - 3) {
      debut -= 1;
    }
    zones.push({ debut, fin, colonnes });
    i = fin;
  }
  return zones;
}

/**
 * Tableaux en HTML, par ligne de début. Un tableau coupé par un saut de page
 * reprend avec son en-tête répété, à d'autres positions : la suite est recollée
 * au tableau, sans l'en-tête, et le bout de cellule coupé rejoint sa rangée.
 *
 * @returns {Map<number, { fin: number, html: string }>}
 */
/** Pages d'une zone : séparées par deux lignes vides ou plus (un saut de page). */
function pagesDeZone(texte) {
  const pages = [];
  let debut = 0;
  let vides = 0;
  texte.forEach((ligne, i) => {
    if (!ligne.trim()) {
      vides += 1;
      return;
    }
    if (vides >= 2 && i > debut) {
      pages.push(texte.slice(debut, i));
      debut = i;
    }
    vides = 0;
  });
  pages.push(texte.slice(debut));
  return pages.filter((page) => page.some((ligne) => ligne.trim()));
}

/** Après un saut de page, le bout de cellule coupé rejoint sa rangée. */
function raccorder(rangs, suite) {
  const premiere = suite[0];
  const avant = rangs.at(-1);
  if (!premiere || !avant || avant.pleine) return;
  const coupee = !premiere.pleine && premiere.cellules.every((cellule) => !cellule.length || /^\p{Ll}/u.test(cellule[0]));
  if (coupee || seuleDerniere(premiere)) fondre(avant, suite.shift());
}

/**
 * Rangées d'une zone, page par page : le PDF décale les colonnes d'une page à
 * l'autre, chaque page a donc les siennes ; l'en-tête répété est sauté.
 *
 * @returns {{ rangs: object[], coupes: number }}
 */
function lireZone(texte, colonnes, entete = null) {
  let rangs = [];
  let coupes = 0;
  let tete = entete;
  for (const page of pagesDeZone(texte)) {
    const propres = colonnesDuTableau(page);
    const cols = propres.length === colonnes.length ? propres : colonnes;
    coupes += morceauxCoupes(page, cols);
    if (!tete) {
      let suite = rangees(page, cols);
      fondreEntete(suite);
      tete = suite[0]?.lignes ?? [];
      // En-tête répété plus bas sur la même page : ses lignes sautées.
      let apres = 0;
      for (let vues = 0; apres < page.length && vues < tete.length; apres += 1) if (page[apres].trim()) vues += 1;
      const sauter = repetitionsEntete(page, tete, apres);
      if (sauter.size > 0) {
        suite = rangees(page, cols, sauter);
        fondreEntete(suite);
      }
      rangs = suite;
      continue;
    }
    const suite = rangees(page, cols, repetitionsEntete(page, tete));
    raccorder(rangs, suite);
    rangs.push(...suite);
  }
  return { rangs, coupes };
}

/**
 * Tableaux en HTML, par ligne de début. Un tableau coupé par un saut de page
 * reprend avec son en-tête répété, à d'autres positions : la suite est recollée
 * au tableau, sans l'en-tête, et le bout de cellule coupé rejoint sa rangée.
 * Trop de mots à répartir entre deux colonnes : la répartition n'est pas sûre,
 * et une valeur dans la mauvaise colonne tromperait ; la zone garde alors son
 * alignement, d'un seul bloc.
 *
 * @returns {Map<number, { fin: number, html: string }>}
 */
function tableaux(lignes, titres, echapper) {
  const tables = [];
  const sure = (texte, coupes) => coupes <= texte.filter((ligne) => ligne.trim()).length / 10;
  for (const zone of zonesEnColonnes(lignes, titres)) {
    const texte = lignes.slice(zone.debut, zone.fin + 1);
    const precedente = tables.at(-1)?.alignee ? null : tables.at(-1);
    const contigue = precedente && lignes.slice(precedente.fin + 1, zone.debut).every((ligne) => !ligne.trim());
    if (contigue && precedente.colonnes.length === zone.colonnes.length) {
      const entete = precedente.rangs[0].lignes;
      // La suite commence par l'en-tête répété : c'est le même tableau.
      if (repetitionsEntete(texte, entete).has(texte.findIndex((ligne) => ligne.trim()))) {
        const { rangs: suite, coupes } = lireZone(texte, zone.colonnes, entete);
        if (sure(texte, coupes)) {
          raccorder(precedente.rangs, suite);
          precedente.rangs.push(...suite);
          precedente.fin = zone.fin;
          continue;
        }
      }
    }
    const { rangs, coupes } = lireZone(texte, zone.colonnes);
    tables.push(sure(texte, coupes) ? { ...zone, rangs } : { ...zone, alignee: texte });
  }

  const html = new Map();
  for (const table of tables) {
    if (table.alignee) {
      // Retrait commun retiré, lignes vides du bord aussi.
      const pleines = table.alignee.filter((ligne) => ligne.trim());
      const retrait = Math.min(...pleines.map((ligne) => ligne.search(/\S/)));
      html.set(table.debut, { fin: table.fin, html: `<pre>${echapper(table.alignee.map((ligne) => ligne.slice(retrait)).join('\n').trim())}</pre>` });
      continue;
    }
    const lignesHtml = table.rangs.map((rangee) => rangee.cellules.map(recoller));
    // Liste à puces alignée (« −   Gardez cette notice », « o   Chaque volume ») :
    // la première colonne ne porte que des puces.
    // Un intitulé sur toute la largeur y devient un paragraphe, entre deux listes.
    const puces = lignesHtml.filter((_, rang) => !table.rangs[rang].pleine);
    if (puces.length > 0 && puces.every((rangee) => !rangee[0] || /^[^\p{L}\p{N}]{1,3}$|^o$/u.test(rangee[0]))
      && puces.some((rangee) => rangee[0])) {
      const blocs = [];
      lignesHtml.forEach((rangee, rang) => {
        if (table.rangs[rang].pleine) {
          blocs.push({ paragraphe: table.rangs[rang].pleine });
          return;
        }
        const texte = rangee.slice(1).filter(Boolean).join(' ');
        const liste = blocs.at(-1)?.items;
        if (rangee[0] || !liste) {
          if (liste) liste.push(texte);
          else blocs.push({ items: [texte] });
        } else {
          liste[liste.length - 1] += ` ${texte}`;
        }
      });
      html.set(table.debut, {
        fin: table.fin,
        html: blocs.map((bloc) => (bloc.paragraphe
          ? `<p>${echapper(bloc.paragraphe)}</p>`
          : `<ul>${bloc.items.map((item) => `<li>${echapper(item)}</li>`).join('')}</ul>`)).join('\n'),
      });
      continue;
    }
    // Liste numérotée alignée (sommaire de la notice : « 1.   Qu’est-ce que… ») :
    // des paragraphes, pas un tableau.
    if (lignesHtml.length > 1 && lignesHtml.every((rangee) => rangee.length === 2 && /^\d{1,2}\.?$/.test(rangee[0]))) {
      html.set(table.debut, { fin: table.fin, html: lignesHtml.map(([numero, texte]) => `<p>${echapper(`${numero} ${texte}`)}</p>`).join('\n') });
      continue;
    }
    // Colonnes restées vides : retirées.
    const utiles = table.colonnes.map((_, col) => lignesHtml.some((rangee) => rangee[col]));
    const largeur = utiles.filter(Boolean).length;
    const propres = lignesHtml.map((rangee, indice) => (table.rangs[indice].pleine
      ? { pleine: table.rangs[indice].pleine }
      : rangee.filter((_, col) => utiles[col])));
    const ligneHtml = (rangee, balise) => (rangee.pleine
      ? `<tr><th colspan="${largeur}" scope="colgroup">${echapper(rangee.pleine)}</th></tr>`
      : `<tr>${rangee.map((cellule) => `<${balise}>${echapper(cellule)}</${balise}>`).join('')}</tr>`);
    const [tete, ...corps] = propres;
    html.set(table.debut, {
      fin: table.fin,
      html: `<table><thead>${ligneHtml(tete, 'th')}</thead><tbody>${corps.map((rangee) => ligneHtml(rangee, 'td')).join('')}</tbody></table>`,
    });
  }
  return html;
}

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

  const titres = new Set(coherentes(sansSommaire(candidats, lignes), { type }).map((candidat) => candidat.i));

  const echapper = (brut) =>
    brut.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const zones = tableaux(lignes, titres, echapper);

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

    // Tableau reconnu : rendu d'un bloc, en vrai tableau.
    const zone = zones.get(i);
    if (zone) {
      viderTout();
      html.push(zone.html);
      i = zone.fin;
      continue;
    }

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
