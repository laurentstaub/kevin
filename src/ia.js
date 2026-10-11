/**
 * Interprétation d'une question en langage courant (option A) : l'IA traduit
 * la question en critères de recherche, la base répond avec le texte officiel.
 * L'IA ne rédige jamais de réponse ; sa sortie est validée avant tout usage.
 * Sans clé ni modèle configurés, le module est inerte.
 */

import { config } from './config.js';
import { normaliserRubrique } from './recherche-texte.js';

/** Rubriques du RCP proposées au modèle, et seules acceptées en retour. */
export const RUBRIQUES_IA = {
  '4.1': 'Indications thérapeutiques',
  '4.2': 'Posologie et mode d\'administration',
  '4.3': 'Contre-indications',
  '4.4': 'Mises en garde spéciales et précautions d\'emploi',
  '4.5': 'Interactions avec d\'autres médicaments',
  '4.6': 'Fertilité, grossesse et allaitement',
  '4.7': 'Effets sur l\'aptitude à conduire',
  '4.8': 'Effets indésirables',
  '4.9': 'Surdosage',
  '5.1': 'Propriétés pharmacodynamiques',
  '5.2': 'Propriétés pharmacocinétiques',
  '6.1': 'Liste des excipients',
  '6.3': 'Durée de conservation',
  '6.4': 'Précautions particulières de conservation',
};

/** Clé du fournisseur choisi (Mistral par défaut : hébergement européen). */
const cleDe = (fournisseur) => (fournisseur === 'anthropic' ? config.ia.cleAnthropic : config.ia.cleMistral);

export const iaActive = () => Boolean(config.ia.modele && cleDe(config.ia.fournisseur));

/**
 * Une question plutôt qu'une recherche : point d'interrogation, ou trois mots
 * et plus. À appeler après la reconnaissance par la base, qui écarte les noms
 * avec dosage (« doliprane 1000 mg »).
 */
export function estQuestion(texte) {
  const propre = String(texte ?? '').trim();
  if (!propre || /^".*"$/.test(propre)) return false;
  return /\?\s*$/.test(propre) || propre.split(/\s+/).length >= 3;
}

const SYSTEME = `Tu traduis la question d'un pharmacien d'officine en critères de recherche
dans les résumés des caractéristiques du produit (RCP) français. Tu ne réponds jamais
à la question elle-même.
- molecule : la DCI ou le nom de spécialité cité, sans dosage ni forme ; null si aucun.
- rubrique : le numéro de la rubrique du RCP la plus pertinente, parmi :
${Object.entries(RUBRIQUES_IA).map(([numero, libelle]) => `  ${numero} ${libelle}`).join('\n')}
  null si aucune ne s'impose.
- mots : une seule expression de 1 à 4 mots, celle qui figure textuellement dans un RCP
  (vocabulaire médical français), sans la molécule. Jamais de liste ni de virgule :
  tous les mots doivent être présents dans la même rubrique pour qu'elle soit trouvée.
  Exemples : « allaitement », « insuffisance rénale », « allongement QT ».`;

const OUTIL = {
  name: 'criteres_recherche',
  description: 'Critères de recherche dans les RCP.',
  input_schema: {
    type: 'object',
    properties: {
      molecule: { type: ['string', 'null'] },
      rubrique: { type: ['string', 'null'], enum: [...Object.keys(RUBRIQUES_IA), null] },
      mots: { type: 'string' },
    },
    required: ['molecule', 'rubrique', 'mots'],
  },
};

/** Ce que le modèle écrit quand il n'a rien à mettre, en toutes lettres. */
const RIEN = new Set(['', 'null', 'none', 'aucun', 'aucune', 'n/a']);

/** Sortie du modèle → critères sûrs, ou null : on retombe alors sur la recherche normale. */
export function validerInterpretation(entree) {
  if (!entree || typeof entree !== 'object') return null;
  // Une liste malgré la consigne (« a, b, c ») : la première expression seule,
  // car la recherche exige tous les mots dans la même rubrique.
  const mots = String(entree.mots ?? '').replace(/[?"]/g, '').split(/[,;]/)[0]
    .trim().split(/\s+/).slice(0, 5).join(' ');
  if (!mots || mots.length > 120) return null;

  const brute = String(entree.molecule ?? '').trim();
  const molecule = !RIEN.has(brute.toLowerCase())
    && /^[\p{L}\d][\p{L}\d\s'’-]{1,79}$/u.test(brute) ? brute : null;

  const numero = normaliserRubrique(entree.rubrique);
  const rubrique = numero && RUBRIQUES_IA[numero] ? numero : null;

  return { molecule, rubrique, mots };
}

/**
 * Mistral, sortie en schéma JSON strict : chaînes vides plutôt que null (le
 * mode strict accepte mal les types multiples) ; la validation les ramène à null.
 */
const SCHEMA_MISTRAL = {
  type: 'object',
  properties: {
    molecule: { type: 'string' },
    rubrique: { type: 'string', enum: [...Object.keys(RUBRIQUES_IA), ''] },
    mots: { type: 'string' },
  },
  required: ['molecule', 'rubrique', 'mots'],
  additionalProperties: false,
};

/** Réponse de l'API Mistral → objet, ou null si le contenu n'est pas du JSON. */
export function lireMistral(corps) {
  const contenu = corps?.choices?.[0]?.message?.content;
  if (typeof contenu !== 'string') return null;
  try {
    return JSON.parse(contenu);
  } catch {
    return null;
  }
}

async function appelerMistral(question, { modele, cle }) {
  const reponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cle}` },
    body: JSON.stringify({
      model: modele,
      temperature: 0,
      max_tokens: 200,
      messages: [{ role: 'system', content: SYSTEME }, { role: 'user', content: question }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: OUTIL.name, schema: SCHEMA_MISTRAL, strict: true },
      },
    }),
    signal: AbortSignal.timeout(config.ia.delaiMs),
  });
  if (!reponse.ok) throw new Error(`Mistral ${reponse.status}`);
  return lireMistral(await reponse.json());
}

/** Anthropic : outil imposé, sortie structurée, délai borné. */
async function appelerAnthropic(question, { modele, cle }) {
  const reponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cle,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modele,
      // Outil imposé : réponse directe, sans réflexion préalable ; marge pour l'appel d'outil.
      max_tokens: 400,
      system: SYSTEME,
      tools: [OUTIL],
      tool_choice: { type: 'tool', name: OUTIL.name },
      messages: [{ role: 'user', content: question }],
    }),
    signal: AbortSignal.timeout(config.ia.delaiMs),
  });
  if (!reponse.ok) throw new Error(`Anthropic ${reponse.status}`);
  const corps = await reponse.json();
  return corps.content?.find((bloc) => bloc.type === 'tool_use')?.input ?? null;
}

/**
 * Un appel brut au modèle, sans cache ni validation (sert aussi au comparatif).
 * @param {string} question
 * @param {{ fournisseur?: 'mistral'|'anthropic', modele?: string, cle?: string }} [choix]
 */
export function appelerModele(question, choix = {}) {
  const fournisseur = choix.fournisseur ?? config.ia.fournisseur;
  const options = { modele: choix.modele ?? config.ia.modele, cle: choix.cle ?? cleDe(fournisseur) };
  return fournisseur === 'anthropic' ? appelerAnthropic(question, options) : appelerMistral(question, options);
}

// Une même question ne coûte qu'un appel (cache borné, perdu au redémarrage).
const cache = new Map();
const CACHE_MAX = 500;

/**
 * @param {string} question
 * @param {{ appeler?: (question: string) => Promise<object|null> }} [options] - injectable (tests)
 * @returns {Promise<{ molecule: string|null, rubrique: string|null, mots: string }|null>}
 */
export async function interpreterQuestion(question, { appeler = appelerModele } = {}) {
  const cle = String(question ?? '').trim().toLowerCase();
  if (!cle) return null;
  if (cache.has(cle)) return cache.get(cle);

  const interpretation = validerInterpretation(await appeler(cle));
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(cle, interpretation);
  return interpretation;
}

/** Vide le cache (tests). */
export function oublierInterpretations() {
  cache.clear();
}
