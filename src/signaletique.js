/**
 * Bande signalétique de la fiche : les caractéristiques d'une spécialité en
 * cases fixes, toujours dans le même ordre, pour que l'œil apprenne où regarder.
 * L'ordre est celui des questions du comptoir : délivrer, payer, substituer,
 * ranger, scanner. Chaque case : un picto, un libellé (état détaillé) et une
 * valeur (état condensé). `portee` 'bloque' marque ce qui empêche la
 * délivrance en officine.
 */
import { decomposer, abregerUnite } from './specialites.js';

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

/** « 42.11 » → « 42,11 € » ; « 2.1 » → « 2,10 € ». Espace fine insécable avant le symbole. */
const euros = (valeur) => {
  const nombre = Number(String(valeur).replace(',', '.'));
  if (!Number.isFinite(nombre)) return null;
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
 * @returns {Array<{ cle, picto, libelle, valeur, court?, detail?, portee?, lien? }>}
 *   `court` remplace `valeur` dans la bande condensée quand la valeur est longue.
 */
export function signaletique(product, delivrance, resumeAtc, groupe, importation) {
  const cases = [];
  const mentions = delivrance?.resume ?? [];
  const par = (cle) => mentions.filter((mention) => mention.cle === cle);
  const bloquantes = mentions.filter((mention) => mention.portee === 'bloque');

  // Délivrance : classement (Liste I, Stupéfiant…), puis ce qui bloque ou se vérifie.
  const classement = par('classement');
  if (classement.length > 0) {
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
  const presentations = (product.cip_products ?? []).filter((pres) => pres.commercialise !== false);
  const avecPrix = presentations.filter((pres) => pres.prix);
  const tauxValeurs = [...new Set(presentations.map((pres) => taux(pres.taux)).filter(Boolean))];
  if (avecPrix.length > 0 || tauxValeurs.length > 0) {
    const prix = avecPrix.map((pres) => euros(pres.prix)).filter(Boolean);
    const [bas, haut] = [prix[0], prix[prix.length - 1]];
    const valeur = [
      tauxValeurs.join(' / '),
      prix.length === 0 ? null : (bas === haut ? bas : `${bas} à ${haut}`),
    ].filter(Boolean).join(' · ');
    const court = [tauxValeurs.join(' / '), bas].filter(Boolean).join(' · ');
    cases.push({
      cle: 'prix', picto: 'euro', libelle: 'Prise en charge', valeur,
      court: court === valeur ? undefined : court,
      detail: avecPrix.map((pres) => `${pres.libelle_presentation} : ${euros(pres.prix)}`).join(' ; ') || null,
    });
  } else {
    cases.push({ cle: 'prix', picto: 'euro', libelle: 'Prise en charge', valeur: 'Non remboursé' });
  }

  // Place dans le groupe générique.
  const type = product.type_generique === null || product.type_generique === undefined
    ? null : GENERIQUE[Number(product.type_generique)];
  if (type) {
    cases.push({ cle: 'generique', picto: 'generique', libelle: 'Groupe', valeur: type, detail: groupe });
  }
  if (importation) {
    cases.push({ cle: 'importation', picto: 'importation', libelle: 'Origine', valeur: 'Importation parallèle' });
  }

  // Forme et dosage.
  const { dosage } = decomposer(product.denomination_medicament ?? '');
  const forme = product.forme_pharmaceutique ?? '';
  const dosageCourt = dosage ? abregerUnite(dosage) : null;
  cases.push({
    cle: 'forme', picto: pictoForme(forme), libelle: 'Forme',
    valeur: [dosageCourt, forme].filter(Boolean).join(' · '),
    court: dosageCourt && forme ? dosageCourt : undefined,
    detail: forme || null,
  });

  if (product.commercialise === false) {
    cases.push({ cle: 'etat', picto: 'barre', libelle: 'État', valeur: 'Non commercialisé', portee: 'bloque' });
  }

  if (resumeAtc?.feuille?.code) {
    cases.push({
      cle: 'atc', picto: 'arbre', libelle: 'ATC',
      valeur: resumeAtc.feuille.code, detail: resumeAtc.feuille.label, lien: `/classe/${resumeAtc.feuille.code}`,
    });
  }

  const cips = presentations.map((pres) => pres.code_cip13).filter(Boolean);
  if (cips.length > 0) {
    cases.push({
      cle: 'cip', picto: 'codebarre', libelle: 'CIP',
      valeur: cips.length === 1 ? cips[0] : `${cips[0]} +${cips.length - 1}`,
      detail: presentations.map((pres) => `${pres.code_cip13} ${pres.libelle_presentation}`).join(' ; '),
    });
  }

  return cases;
}
