/**
 * Classification des alternatives, en règles explicites. Repris de dispomed
 * (library/substitution_rules.js), où il a été mis au point face aux ruptures.
 *
 * Remplace le score continu de substitution.equivalences_therapeutiques, qui
 * projetait sur une seule dimension une décision qui est catégorielle : à
 * l'officine il n'existe pas de « substituable à 0,72 ». Soit la substitution
 * est de droit, soit elle suppose une adaptation, soit elle demande le
 * prescripteur, soit elle est impossible — et dans ce dernier cas, dire POURQUOI
 * vaut mieux que de taire le candidat.
 *
 * Ce module ne fait aucun accès base : entrées simples, sorties simples, donc
 * testable sans fixture. La disponibilité est ajoutée en amont par l'appelant.
 */

/** Catégories, dans l'ordre d'utilité au comptoir. L'ACTION est l'en-tête. */
export const CATEGORIES = {
  SUBSTITUABLE: {
    rang: 1,
    action: 'Génériques du groupe',
    detail: 'Substitution de droit, sauf mention « non substituable »',
  },
  AUTRE_PRESENTATION: {
    rang: 2,
    action: 'Même molécule, autre présentation',
    detail: 'Dosage ou forme différents : à apprécier selon la prescription',
  },
  ALTERNATIVE_CLASSE: {
    rang: 3,
    action: 'Même sous-classe ATC',
    detail: 'Autre molécule, avec l’accord du prescripteur : alternative si disponible',
  },
  BLOQUE: {
    rang: 4,
    action: 'Non substituables',
    detail: 'Raison indiquée pour chaque ligne',
  },
};

/**
 * Molécules à marge thérapeutique étroite : une variation d'exposition modifie
 * l'effet ou la toxicité. On ne propose JAMAIS de changer de présentation, même
 * à molécule identique. Liste amendable — c'est un choix clinique, pas technique.
 */
export const MARGE_ETROITE = [
  'levothyroxine', 'liothyronine',
  'ciclosporine', 'tacrolimus', 'sirolimus', 'everolimus', 'mycophenolate',
  'warfarine', 'fluindione', 'acenocoumarol',
  'digoxine', 'lithium', 'theophylline',
];

/**
 * Classes ATC entièrement couvertes par la règle de marge étroite. Plus sûr et
 * plus simple à tenir qu'une liste de molécules : N03 couvre tous les
 * antiépileptiques, y compris zonisamide, lacosamide ou cénobamate que la liste
 * nominative oubliait.
 */
export const MARGE_ETROITE_ATC = ['N03'];


const sansAccent = (texte) => (texte || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Libération prolongée ? LP et libération immédiate ne se substituent jamais. */
export function estLP(texte) {
  const brut = sansAccent(texte);
  return /\b(lp|l\.p|liberation prolongee|liberation modifiee|retard|chrono|longue duree)\b/.test(brut)
    || /\bprolonge/.test(brut);
}

/** Voie d'administration ramenée à une famille comparable. */
export function voie(texte) {
  const brut = sansAccent(texte);
  if (/intraveineu|intramuscul|sous.?cutan|perfusion|injectable|parenteral/.test(brut)) return 'parenterale';
  if (/orale|buvable|sublingual|orodispers|comprime|gelule|capsule|sirop|granule/.test(brut)) return 'orale';
  if (/cutan|transdermi|topique/.test(brut)) return 'cutanee';
  if (/ophtalmi|oculaire|collyre|pommade ophtalmique/.test(brut)) return 'ophtalmique';
  if (/nasal|inhal|pulmonaire/.test(brut)) return 'respiratoire';
  if (/auriculaire|otique/.test(brut)) return 'auriculaire';
  if (/rectal|suppositoire/.test(brut)) return 'rectale';
  if (/vaginal/.test(brut)) return 'vaginale';
  return 'autre';
}

/**
 * Dosage en valeur + unité. « 1,00 mg » -> { valeur: 1, unite: 'mg' }.
 * Les concentrations (« 50 mg/mL ») gardent le numérateur : comparer 50 mg/mL à
 * 100 mg/mL a un sens, comparer 50 mg à 50 mg/mL n'en a pas — d'où le drapeau.
 */
export function dosage(texte) {
  const brut = sansAccent(texte).replace(',', '.');
  const trouve = brut.match(/(\d+(?:\.\d+)?)\s*(mg|g|µg|mcg|ug|ui|%|ml)\b/);
  if (!trouve) return null;
  let valeur = parseFloat(trouve[1]);
  let unite = trouve[2] === 'mcg' || trouve[2] === 'ug' ? 'µg' : trouve[2];
  if (unite === 'g') { valeur *= 1000; unite = 'mg'; }          // normalisation en mg
  const concentration = /\/\s*\d*\s*(ml|l)\b/.test(brut);
  return { valeur, unite, concentration };
}

/** Comprimé sécable ? Seule mention de la BDPM qui autorise à évoquer une fraction. */
export function estSecable(texte) {
  return /s[ée]cable/i.test(texte || '');
}

/**
 * Classe un candidat par rapport au produit en rupture.
 *
 * @param {{atc5:string, substances:string[], forme:string, voies:string, dosage:string}} ref
 * @param {{atc5:string, substances:string[], forme:string, voies:string, dosage:string,
 *          code_cis:string, denomination:string, meme_groupe_generique:boolean,
 *          statut:string}} cand
 * @returns {{categorie:string, action:string, detail:string, motif:string, tri:number}}
 */
export function classer(ref, cand) {
  const memeMolecule = (cand.atc5 && ref.atc5 && cand.atc5 === ref.atc5)
    || memeSubstances(ref.substances, cand.substances);

  // 1. Substitution de droit — le fait réglementaire prime sur toute règle calculée.
  if (cand.meme_groupe_generique) {
    return { categorie: 'SUBSTITUABLE', ...CATEGORIES.SUBSTITUABLE, motif: 'Même groupe générique', tri: 0 };
  }

  const vRef = voie(`${ref.voies} ${ref.forme}`);
  const vCand = voie(`${cand.voies} ${cand.forme}`);

  // 2. Blocages — énoncés AVANT les propositions : un candidat écarté doit dire
  //    pourquoi, c'est ce qui fait gagner du temps au comptoir.
  if (memeMolecule && estLP(`${ref.forme} ${ref.denomination || ''}`) !== estLP(`${cand.forme} ${cand.denomination || ''}`)) {
    return bloque('Libération prolongée contre libération immédiate');
  }
  // La marge thérapeutique étroite interdit de changer de PRÉSENTATION d'une même
  // molécule — pas d'envisager une autre molécule, qui relève du prescripteur.
  // Appliquée aux candidats d'une autre molécule, elle masquait 27 lamotrigines
  // qu'un prescripteur aurait pu retenir face à un zonisamide en rupture.
  const mte = MARGE_ETROITE.find((mol) => (ref.substances || []).some((sub) => sansAccent(sub).includes(mol)))
    || (MARGE_ETROITE_ATC.some((prefixe) => (ref.atc5 || '').startsWith(prefixe)) ? `classe ${(ref.atc5 || '').slice(0, 3)}` : null);
  if (memeMolecule && mte && !cand.meme_groupe_generique) {
    return bloque(`Marge thérapeutique étroite (${mte}) — changement de présentation exclu`);
  }
  if (vRef !== vCand && vRef !== 'autre' && vCand !== 'autre') {
    return bloque(`Voie différente (${vRef} contre ${vCand})`);
  }

  // 3. Même molécule, autre présentation. Aucun calcul d'équivalence : 850 mg
  //    n'est pas « à vérifier » contre 500 mg, c'est un autre dosage, et le
  //    pharmacien en décide. Seul le même dosage est dit.
  if (memeMolecule) {
    const [dRef, dCand] = [dosage(ref.dosage), dosage(cand.dosage)];
    const memeDosage = Boolean(dRef && dCand && dRef.unite === dCand.unite
      && dRef.concentration === dCand.concentration && dRef.valeur === dCand.valeur);
    return {
      categorie: 'AUTRE_PRESENTATION',
      ...CATEGORIES.AUTRE_PRESENTATION,
      motif: memeDosage ? 'Même dosage' : '',
      tri: (memeDosage ? 0 : 1) + (cand.forme === ref.forme ? 0 : 0.5) + (dCand ? dCand.valeur / 1e6 : 0),
    };
  }

  // 4. Même classe, autre molécule : décision médicale, pas pharmaceutique.
  // Aucune exception par classe : même pour les dermocorticoïdes, où l'ATC4 code
  // l'activité et où l'échange est courant en pratique, changer de molécule reste
  // une décision du prescripteur. Une règle unique est plus sûre qu'un catalogue
  // d'exceptions que personne ne tiendra à jour.
  const atc4 = (code) => (code || '').slice(0, 5);
  if (atc4(ref.atc5) && atc4(ref.atc5) === atc4(cand.atc5)) {
    return { categorie: 'ALTERNATIVE_CLASSE', ...CATEGORIES.ALTERNATIVE_CLASSE,
      motif: `Même sous-classe ATC (${atc4(ref.atc5)})`, tri: 0 };
  }
  return null;   // hors périmètre : on ne propose rien
}

function bloque(motif) {
  return { categorie: 'BLOQUE', ...CATEGORIES.BLOQUE, motif, tri: 0 };
}

/**
 * Mot d'une substance ramené à son sel de base : « hémifumarate », « ditartrate »,
 * « hydrogénofumarate » → « fumarate », « tartrate » ; « hydratée » → « hydrate ».
 */
const motDeSel = (mot) => mot.replace(/^(?:hemi|di|hydrogeno)(?=[a-z]+ate$)/, '').replace(/(hydrat)ee?$/, '$1e');

/** Mots d'une substance, sans accent, parenthèse ni article : « AMLODIPINE (BÉSILATE D') » → {amlodipine}. */
const motsDe = (substance) => new Set(sansAccent(substance).replace(/\(.*?\)/g, ' ')
  .split(/[^a-z0-9]+/).filter((mot) => mot.length > 2).map(motDeSel));

/**
 * Même substance au sel près : tous les mots de l'une sont des mots entiers de
 * l'autre (« metformine » et « chlorhydrate de metformine »). Une sous-chaîne ne
 * suffit pas : oméprazole et ésoméprazole, aciclovir et valaciclovir, ofloxacine
 * et ciprofloxacine sont d'autres molécules de la même sous-classe.
 */
function memeSubstance(une, autre) {
  const [petit, grand] = [motsDe(une), motsDe(autre)].sort((gauche, droite) => gauche.size - droite.size);
  return petit.size > 0 && [...petit].every((mot) => grand.has(mot));
}

/** Mêmes substances, chacune appariée dans l'autre liste (l'ordre alphabétique varie avec le sel). */
function memeSubstances(premieres = [], secondes = []) {
  if (!premieres.length || premieres.length !== secondes.length) return false;
  return premieres.every((une) => secondes.some((autre) => memeSubstance(une, autre)))
    && secondes.every((autre) => premieres.some((une) => memeSubstance(une, autre)));
}

/**
 * Candidats classés et regroupés pour la fiche, une entrée par catégorie dans
 * l'ordre du comptoir. Les alternatives de classe sont regroupées par molécule
 * (le pharmacien cherche une alternative disponible), la même forme d'abord.
 *
 * @param {object} ref - le produit consulté (même forme que `classer`)
 * @param {object[]} candidats - id, denomination, forme, voies, atc5, substances,
 *   dosage, meme_groupe_generique, role
 * @returns {Array<{ cle, action, detail, lignes?: object[], molecules?: object[] }>}
 */
export function regrouperAlternatives(ref, candidats) {
  const parCategorie = new Map(Object.keys(CATEGORIES).map((cle) => [cle, []]));
  for (const cand of candidats) {
    const verdict = classer(ref, cand);
    if (verdict) parCategorie.get(verdict.categorie).push({ ...cand, ...verdict });
  }

  const memeForme = (cand) => (sansAccent(cand.forme) === sansAccent(ref.forme) ? 0 : 1);
  const parNom = (a, b) => String(a.denomination).localeCompare(String(b.denomination), 'fr');
  // Le princeps ouvre son groupe : c'est la référence, pas un générique de plus
  // (« Monuril » se rangeait après douze « Fosfomycine »).
  const princepsDabord = (cand) => (cand.role === 'Princeps' ? 0 : 1);

  return Object.entries(CATEGORIES)
    .map(([cle, { action, detail }]) => {
      const lignes = parCategorie.get(cle)
        .sort((a, b) => a.tri - b.tri || princepsDabord(a) - princepsDabord(b)
          || memeForme(a) - memeForme(b) || parNom(a, b));
      if (lignes.length === 0) return null;
      if (cle === 'SUBSTITUABLE') return { cle, action, detail, ...factoriser(lignes) };
      if (cle !== 'ALTERNATIVE_CLASSE') return { cle, action, detail, lignes };

      // Une molécule par ligne, ses spécialités à la suite.
      const molecules = new Map();
      for (const ligne of lignes) {
        const nom = (ligne.substances ?? []).join(' + ') || ligne.denomination;
        if (!molecules.has(nom)) molecules.set(nom, { nom, atc5: ligne.atc5, specialites: [] });
        molecules.get(nom).specialites.push(ligne);
      }
      const liste = [...molecules.values()].sort((a, b) =>
        Math.min(...a.specialites.map(memeForme)) - Math.min(...b.specialites.map(memeForme))
        || a.nom.localeCompare(b.nom, 'fr'));
      return { cle, action, detail, molecules: liste, total: lignes.length };
    })
    .filter(Boolean);
}

/** Spécialités proposables : toutes les catégories sauf les écartées. */
export function compterOptions(categories) {
  return (categories ?? [])
    .filter((categorie) => categorie.cle !== 'BLOQUE')
    .reduce((total, categorie) => total + (categorie.total ?? categorie.lignes?.length ?? 0), 0);
}

/** Dosage dans un nom de spécialité : « 3 g », « 500 mg/5 ml », « 2,4 pour cent ». */
const DOSAGE_NOM = /\d+(?:[.,]\d+)?\s?(?:mg|g|µg|mcg|ml|ui|%|pour cent|microgrammes?|milligrammes?)(?:\s?\/\s?\d*(?:[.,]\d+)?\s?(?:mg|g|ml|dose|h))?/i;

/**
 * Ce que toutes les lignes partagent (dosage, forme) dit une fois : un groupe
 * générique a, par définition, même dosage et même forme. « FOSFOMYCINE ARROW
 * 3 g, granulés pour solution buvable en sachet » devient « FOSFOMYCINE ARROW »
 * sous « 3 g, granulés pour solution buvable en sachet ». Nom complet gardé.
 *
 * @returns {{ commun: string|null, lignes: object[] }} lignes avec `court`
 */
export function factoriser(lignes) {
  if (lignes.length < 2) return { commun: null, lignes };
  const parts = lignes.map((ligne) => {
    const denomination = String(ligne.denomination ?? '');
    const virgule = denomination.indexOf(', ');
    const nom = virgule === -1 ? denomination : denomination.slice(0, virgule);
    return {
      nom,
      forme: virgule === -1 ? '' : denomination.slice(virgule + 2).trim(),
      dose: nom.match(DOSAGE_NOM)?.[0] ?? '',
    };
  });
  const partage = (cle) => parts[0][cle] !== ''
    && parts.every((part) => part[cle].toLowerCase() === parts[0][cle].toLowerCase());
  const forme = partage('forme') ? parts[0].forme : null;
  const dose = partage('dose') ? parts[0].dose : null;
  if (!forme && !dose) return { commun: null, lignes };

  return {
    commun: [dose, forme].filter(Boolean).join(', '),
    lignes: lignes.map((ligne, i) => {
      let court = forme ? parts[i].nom : String(ligne.denomination);
      if (dose) court = court.replace(parts[i].dose, '').replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
      return { ...ligne, court };
    }),
  };
}
