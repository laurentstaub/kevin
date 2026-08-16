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
 * L'initiale du produit dans l'index Meddispar.
 *
 * Les fiches ont pourtant une URL courte — /Medicaments/SABRIL-500-B-60 — mais
 * le slug tient au libellé de la boîte et ne se déduit pas de la BDPM. Le
 * deviner supposerait de sonder leur site présentation par présentation, c'est
 *-à-dire l'extraction qu'on s'interdit. L'index alphabétique, lui, répond en
 * GET et affiche le code CIP en première colonne : le lecteur arrive à un clic
 * de sa fiche, et le lien ne peut pas pourrir.
 *
 * Les 15 857 spécialités de la BDPM commencent toutes par une lettre latine une
 * fois les accents ôtés. Le garde-fou sert au cas qui n'existe pas encore.
 */
export function meddisparLettre(denomination) {
  const initiale = deaccent(String(denomination ?? '').trim()).slice(0, 1).toUpperCase();
  return /^[A-Z]$/.test(initiale) ? initiale : null;
}

/**
 * Liens sortants d'une fiche produit.
 * Aucun appel réseau côté serveur : ce sont des URL construites, donc gratuites
 * et sans latence. Tous les gabarits sont surchargeables par variable d'environnement.
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
  // Renvoyer vers son index depuis une boîte d'ibuprofène enverrait le lecteur
  // chercher une fiche qui n'y est pas : le lien ne s'affiche que là où la BDPM
  // enregistre au moins une condition de prescription ou de délivrance.
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

  return { official, scientific };
}
