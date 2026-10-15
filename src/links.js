import { config } from './config.js';
import { deaccent } from './text.js';

const fill = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(values[key] ?? ''));

/** Première DCI de la liste — la plus pertinente pour interroger la littérature. */
export function primarySubstance(activeIngredients) {
  const first = (activeIngredients ?? '').split(',')[0]?.trim();
  return first || '';
}

/**
 * Initiale du produit dans l'index Meddispar. Le slug des fiches ne se déduit
 * pas de la BDPM et le sonder serait de l'extraction : l'index alphabétique
 * mène à un clic de la fiche et reste stable.
 */
export function meddisparLettre(denomination) {
  const initiale = deaccent(String(denomination ?? '').trim()).slice(0, 1).toUpperCase();
  return /^[A-Z]$/.test(initiale) ? initiale : null;
}

/**
 * Liens sortants d'une fiche produit : URL construites, sans appel réseau ;
 * gabarits surchargeables par variable d'environnement.
 *
 * @param {{ id: string|number, denomination_medicament: string, active_ingredients?: string }} product
 * @param {{ dispensationParticuliere?: boolean }} [contexte]
 */
export function productLinks(product, contexte = {}) {
  const cis = String(product.id);
  const substance = primarySubstance(product.active_ingredients);
  const name = product.denomination_medicament ?? '';

  const official = [
    {
      key: 'bdpm',
      label: 'Fiche officielle BDPM',
      hint: 'Source ANSM de référence',
      url: fill(config.links.bdpm, { cis, q: name }),
    },
    {
      key: 'availability',
      label: 'Disponibilité et ruptures',
      hint: 'Suivi des tensions d’approvisionnement',
      url: fill(config.links.availability, { q: name, cis }),
    },
  ];

  // Meddispar ne recense que les spécialités à dispensation particulière.
  const lettre = contexte.dispensationParticuliere ? meddisparLettre(name) : null;
  if (lettre) {
    official.push({
      key: 'meddispar',
      label: 'Conduite à tenir — Meddispar',
      hint: `Ordre national des pharmaciens · index ${lettre}`,
      url: fill(config.links.meddispar, { lettre }),
    });
  }

  const scientific = substance
    ? [
        {
          key: 'pubmed',
          label: 'Publications — PubMed',
          hint: substance,
          url: fill(config.links.pubmed, { q: substance }),
        },
        {
          key: 'trials',
          label: 'Essais cliniques — ClinicalTrials.gov',
          hint: substance,
          url: fill(config.links.trials, { q: substance }),
        },
        {
          key: 'ema',
          label: 'Évaluation européenne — EMA',
          hint: substance,
          url: fill(config.links.ema, { q: substance }),
        },
      ]
    : [];

  // Répertoire des génériques : lien fixe, sans paramètre.
  return { official, scientific, repertoire: config.links.repertoire };
}
