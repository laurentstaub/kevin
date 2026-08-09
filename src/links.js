import { config } from './config.js';

const fill = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(values[key] ?? ''));

/** Première DCI de la liste — la plus pertinente pour interroger la littérature. */
export function primarySubstance(activeIngredients) {
  const first = (activeIngredients ?? '').split(',')[0]?.trim();
  return first || '';
}

/**
 * Liens sortants d'une fiche produit.
 * Aucun appel réseau côté serveur : ce sont des URL construites, donc gratuites
 * et sans latence. Tous les gabarits sont surchargeables par variable d'environnement.
 *
 * @param {{ id: string|number, denomination_medicament: string, active_ingredients?: string }} product
 */
export function productLinks(product) {
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

  return { official, scientific };
}
