/**
 * Concepts du filtre de document : le mot du comptoir (« sécabilité ») cherche
 * aussi les expressions que les RCP emploient (« barre de cassure », « doses
 * égales », « ne doit pas être divisé »). La table data/concepts-document.json
 * part dans la page ; documents.js l'applique à la saisie entière.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const { concepts } = JSON.parse(readFileSync(path.join(ROOT, 'data', 'concepts-document.json'), 'utf8'));

export const CONCEPTS_DOCUMENT = concepts.map(({ mots, formes }) => ({ mots, formes }));

/** La table telle que la page la lit (attribut data-concepts du filtre). */
export const CONCEPTS_DOCUMENT_JSON = JSON.stringify(CONCEPTS_DOCUMENT);
