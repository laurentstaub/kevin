/**
 * Bande signalétique de la fiche : les caractéristiques d'une spécialité en
 * cases fixes, toujours dans le même ordre, pour que l'œil apprenne où regarder.
 * L'ordre est celui des questions du comptoir : délivrer, payer, substituer,
 * ranger. Chaque case : un picto, un libellé (état détaillé) et une
 * valeur (état condensé). `portee` 'bloque' marque ce qui empêche la
 * délivrance en officine.
 */
const GENERIQUE = { 0: 'Princeps', 1: 'Générique', 2: 'Assimilé', 4: 'Assimilé' };

/** Picto de la forme pharmaceutique, d'après son libellé BDPM. */
export function pictoForme(forme) {
  const texte = String(forme ?? '').toLowerCase();
  if (/comprim|pastille|lyophilisat oral/.test(texte)) return 'comprime';
  if (/g[ée]lule|capsule/.test(texte)) return 'gelule';
  if (/inject|perfusion|seringue|stylo/.test(texte)) return 'injection';
  if (/collyre|goutte|auriculaire|nasal/.test(texte)) return 'goutte';
  if (/cr[èe]me|pommade|gel|[ée]mulsion|p[âa]te/.test(texte)) return 'tube';
  if (/sachet|poudre|granul/.test(texte)) return 'sachet';
  if (/suppositoire|ovule/.test(texte)) return 'suppositoire';
  if (/pulv[ée]risation|a[ée]rosol|inhal|spray/.test(texte)) return 'spray';
  if (/dispositif transdermique|patch|emplâtre/.test(texte)) return 'patch';
  if (/buvable|sirop|solution|suspension|sol\./.test(texte)) return 'flacon';
  return 'boite';
}

/**
 * Forme abrégée pour la bande : la tête du libellé BDPM, sans ses qualificatifs
 * galéniques, avec LP / LM / GR en sigle. « gélule à libération prolongée » →
 * « gélule LP » ; « poudre pour solution buvable en sachet » → « solution buvable ».
 */
export function abregerForme(forme) {
  let texte = String(forme ?? '').toLowerCase().trim();
  if (!texte) return '';
  const sigle = /lib[ée]ration prolong[ée]e/.test(texte) ? 'LP'
    : /lib[ée]ration modifi[ée]e/.test(texte) ? 'LM'
      : /gastro-r[ée]sistant/.test(texte) ? 'GR' : null;
  // « poudre pour solution injectable » : ce qui compte est ce qu'on administre.
  const pour = texte.match(/\bpour\s+(.+)$/);
  if (pour) texte = pour[1];
  texte = texte.split(/\s+(?:à|en|de|du|des|avec|sans)\s+|,/)[0];
  texte = texte.replace(/(^|\s)(pellicul[ée]e?s?|s[ée]cables?|quadris[ée]cables?|enrob[ée]e?s?|drag[ée]ifi[ée]e?s?|gastro-r[ée]sistante?s?)(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ').trim();
  return sigle ? `${texte} ${sigle}` : texte;
}

/** « 42.11 » → « 42,11 € » ; « 2.1 » → « 2,10 € ». Espace fine insécable avant le symbole. */
/** « 1 234,56 », « 19.5 » → nombre ; null si illisible. */
const montant = (valeur) => {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const nombre = Number(String(valeur).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  return Number.isFinite(nombre) && nombre > 0 ? nombre : null;
};

const euros = (valeur) => {
  const nombre = montant(valeur);
  if (nombre === null) return null;
  return `${nombre.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u202f€`;
};

/** « 65.00 » → « 65 % ». */
const taux = (valeur) => {
  const nombre = Number(String(valeur).replace(',', '.').replace('%', ''));
  return Number.isFinite(nombre) ? `${nombre}\u202f%` : null;
};

/**
 * @param {object} product        sortie de getProduct (cip_products, forme, commercialise, type_generique)
 * @param {{ resume: Array<{cle, court, long, portee}> }} delivrance
 * @param {object|null} resumeAtc  feuille { code, label }
 * @param {string|null} groupe     libellé du groupe générique
 * @param {boolean} importation
 * @param {{ valeur, detail, avis }|null} evaluation  résumé HAS (has.js)
 * @param {number} options         alternatives proposables (substitution.js)
 * @returns {Array<{ cle, picto, libelle, valeur, detail?, portee?, lien? }>}
 *   `libelle` et `detail` vont en infobulle : la bande n'affiche que les valeurs.
 */
export function signaletique(product, delivrance, resumeAtc, groupe, importation, evaluation = null, options = 0) {
  const cases = [];
  const mentions = delivrance?.resume ?? [];
  const par = (cle) => mentions.filter((mention) => mention.cle === cle);
  const bloquantes = mentions.filter((mention) => mention.portee === 'bloque');

  // Délivrance : classement (Liste I, Stupéfiant…), puis ce qui bloque ou se vérifie.
  const classement = par('classement');
  if (delivrance?.indisponible) {
    // Panne : ni « Sans ordonnance » ni « bloque », qui dirait « pas en officine ».
    cases.push({
      cle: 'ordonnance', picto: 'ordonnance', libelle: 'Ordonnance', valeur: 'Conditions indisponibles',
      detail: 'Conditions de prescription et de délivrance momentanément illisibles : vérifier sur la fiche officielle BDPM',
      lien: '#delivrance',
    });
  } else if (classement.length > 0) {
    const stup = classement.some((mention) => /stup/i.test(mention.court));
    cases.push({
      cle: 'ordonnance', picto: stup ? 'cadenas' : 'ordonnance', libelle: 'Ordonnance',
      valeur: classement.map((mention) => mention.court).join(' · '),
      detail: classement.map((mention) => mention.long).join(' ; '),
      portee: stup ? 'bloque' : null,
    });
  } else if (mentions.length === 0) {
    cases.push({ cle: 'ordonnance', picto: 'ordonnance', libelle: 'Ordonnance', valeur: 'Sans ordonnance' });
  }
  const duree = [...par('duree'), ...par('fractionnement'), ...par('renouvellement')];
  if (duree.length > 0) {
    cases.push({
      cle: 'duree', picto: 'calendrier', libelle: 'Durée',
      valeur: duree.map((mention) => mention.court).join(' · '),
      detail: duree.map((mention) => mention.long).join(' ; '),
    });
  }
  // Le classement est déjà dans la case Ordonnance : ne pas le répéter.
  const cadre = [...bloquantes, ...par('prescripteur'), ...par('support'), ...par('controle'), ...par('suivi')]
    .filter((mention, i, liste) => mention.cle !== 'classement' && liste.indexOf(mention) === i);
  if (cadre.length > 0) {
    cases.push({
      cle: 'cadre', picto: 'hopital', libelle: 'Prescription',
      valeur: cadre.map((mention) => mention.court).join(' · '),
      detail: cadre.map((mention) => mention.long).join(' ; '),
      portee: cadre.some((mention) => mention.portee === 'bloque') ? 'bloque' : null,
    });
  }

  // Prise en charge : taux et prix de la plus petite présentation commercialisée.
  // Deux prix BDPM : le plus bas est hors honoraire de dispensation, le plus
  // haut honoraire compris — ordre déduit des valeurs, pas des colonnes.
  const presentations = (product.cip_products ?? []).filter((pres) => pres.commercialise !== false);
  const prixDe = (pres) => {
    const valeurs = [montant(pres.prix), montant(pres.prix_2)].filter((valeur) => valeur !== null);
    if (valeurs.length === 0) return null;
    return { hors: Math.min(...valeurs), compris: Math.max(...valeurs) };
  };
  const ecrire = ({ hors, compris }) => (hors === compris
    ? euros(compris) : `${euros(compris)} · ${euros(hors)} hors hon.`);
  const avecPrix = presentations.filter((pres) => prixDe(pres));
  const tauxValeurs = [...new Set(presentations.map((pres) => taux(pres.taux)).filter(Boolean))];
  if (avecPrix.length > 0 || tauxValeurs.length > 0) {
    // La première présentation seule : les autres sont en infobulle.
    const premier = avecPrix.length > 0 ? ecrire(prixDe(avecPrix[0])) : null;
    const valeur = [tauxValeurs.join(' / '), premier].filter(Boolean).join(' · ');
    cases.push({
      cle: 'prix', picto: 'euro', libelle: 'Prise en charge', valeur,
      detail: avecPrix.map((pres) => `${pres.libelle_presentation} : ${ecrire(prixDe(pres))}`).join(' ; ') || null,
    });
  } else {
    cases.push({ cle: 'prix', picto: 'euro', libelle: 'Prise en charge', valeur: 'Non remboursé' });
  }

  // Évaluation HAS, toujours affichée : une case qui apparaît et disparaît ne se lit pas.
  if (evaluation) {
    cases.push({
      cle: 'has', picto: 'balance', libelle: 'Évaluation HAS', valeur: evaluation.valeur,
      detail: evaluation.detail, lien: evaluation.avis > 0 ? '#evaluation' : null,
    });
  }

  // Place dans le groupe générique, et porte d'entrée des alternatives : la
  // bande reste visible partout, le bloc est loin sous le titre.
  const type = product.type_generique === null || product.type_generique === undefined
    ? null : GENERIQUE[Number(product.type_generique)];
  const compte = options > 0 ? `${options}\u00a0option${options > 1 ? 's' : ''}` : null;
  const lien = compte ? '#alternatives' : null;
  if (type) {
    cases.push({
      cle: 'generique', picto: 'generique', libelle: 'Groupe',
      valeur: compte ? `${type} · ${compte}` : type, detail: groupe, lien,
    });
  } else if (compte) {
    cases.push({
      cle: 'generique', picto: 'generique', libelle: 'Alternatives',
      valeur: `Alternatives · ${options}`, detail: 'Hors groupe générique', lien,
    });
  }
  if (importation) {
    cases.push({ cle: 'importation', picto: 'importation', libelle: 'Origine', valeur: 'Importation parallèle' });
  }

  // Forme abrégée ; le dosage est dans le titre, le libellé complet en infobulle.
  const forme = product.forme_pharmaceutique ?? '';
  cases.push({ cle: 'forme', picto: pictoForme(forme), libelle: 'Forme', valeur: abregerForme(forme), detail: forme || null });

  if (product.commercialise === false) {
    cases.push({ cle: 'etat', picto: 'barre', libelle: 'État', valeur: 'Non commercialisé', portee: 'bloque' });
  }

  if (resumeAtc?.feuille?.code) {
    cases.push({
      cle: 'atc', picto: 'arbre', libelle: 'ATC',
      valeur: resumeAtc.feuille.code, detail: resumeAtc.feuille.label, lien: `/classe/${resumeAtc.feuille.code}`,
    });
  }

  return cases;
}
