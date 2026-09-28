import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Node >= 20.12 : chargement natif du .env, aucune dépendance requise.
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const int = (value, fallback) => {
  const nombre = Number.parseInt(value ?? '', 10);
  return Number.isFinite(nombre) ? nombre : fallback;
};

const list = (value) =>
  (value ?? '')
    .split(',')
    .map((origine) => origine.trim())
    .filter(Boolean);

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3000),

  db: {
    connectionString: process.env.DATABASE_URL,
    // Repli explicite pour le développement local si DATABASE_URL est absent.
    user: process.env.PGUSER,
    host: process.env.PGHOST ?? 'localhost',
    database: process.env.PGDATABASE ?? 'incidents_json',
    port: int(process.env.PGPORT, 5432),
    password: process.env.PGPASSWORD,
    max: int(process.env.PG_POOL_MAX, 10),
    statementTimeoutMs: int(process.env.PG_STATEMENT_TIMEOUT_MS, 5000),
  },

  search: {
    minLength: int(process.env.SEARCH_MIN_LENGTH, 3),
    maxTerms: int(process.env.SEARCH_MAX_TERMS, 5),
    // Quota par famille (dénomination, principe actif), pas au total : sinon
    // l'une affame l'autre.
    limit: int(process.env.SEARCH_LIMIT, 60),
    suggestLimit: int(process.env.SUGGEST_LIMIT, 8),
    relatedLimit: int(process.env.RELATED_LIMIT, 40),
  },

  // Origines autorisées pour le CORS. Vide = même origine uniquement.
  corsOrigins: list(process.env.CORS_ORIGINS),

  // Base des file_path relatifs de la BDPM (« /documents/<CIS>/rcp_notice.pdf »).
  documentBaseUrl:
    process.env.DOCUMENT_BASE_URL ?? 'https://base-donnees-publique.medicaments.gouv.fr',

  // Domaines autorisés pour les redirections vers les documents officiels.
  documentHosts: list(
    process.env.DOCUMENT_HOSTS ??
      'ansm.sante.fr,base-donnees-publique.medicaments.gouv.fr,bdpmt.ansm.sante.fr,ema.europa.eu',
  ),

  // Liens externes. {q} = terme encodé, {cis} = code CIS.
  links: {
    bdpm:
      process.env.LINK_BDPM ??
      'https://base-donnees-publique.medicaments.gouv.fr/extrait.php?specid={cis}',
    pubmed: process.env.LINK_PUBMED ?? 'https://pubmed.ncbi.nlm.nih.gov/?term={q}',
    trials: process.env.LINK_TRIALS ?? 'https://clinicaltrials.gov/search?intr={q}',
    ema:
      process.env.LINK_EMA ?? 'https://www.ema.europa.eu/en/search?search_api_fulltext={q}',
    // Répertoire qui fait foi pour la substitution, publié par l'ANSM (décret 2016-183).
    repertoire:
      process.env.LINK_REPERTOIRE
      ?? 'https://ansm.sante.fr/documents/reference/repertoire-des-medicaments-generiques',
    // Index alphabétique de Meddispar (Ordre des pharmaciens) : lien seulement, rien n'est recopié.
    meddispar:
      process.env.LINK_MEDDISPAR ?? 'https://www.meddispar.fr/content/search/?letter={lettre}',
    // Pont vers le projet ruptures d'approvisionnement.
    availability: process.env.LINK_AVAILABILITY ?? 'https://app.antheosdata.com/?q={q}',
  },
};
