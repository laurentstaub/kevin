/**
 * Conditions de prescription et de délivrance (`dbpm.cis_cpd_bdpm`), classées
 * pour le comptoir. Meddispar (Ordre des pharmaciens) n'est pas ouvert : lien,
 * pas de copie. Un libellé qu'aucune règle ne reconnaît sort tel quel.
 */

import { sanitizeDocument } from './sanitize.js';

const MEDDISPAR = 'https://www.meddispar.fr';

/** Mentions courtes du résumé ; libellé complet en infobulle. */
const UNITES = { jour: 'j', jours: 'j', semaine: 'sem.', semaines: 'sem.', mois: 'mois' };
const abreger = (nombre, unite) => `${nombre} ${UNITES[unite.toLowerCase()] ?? unite}`;
const mention = (court, long) => ({ court, long: long ?? court });

/**
 * Portée d'une condition sur la délivrance, dans l'ordre de lecture :
 *   bloque    ne se délivre pas en officine ;
 *   verifier  se délivre après contrôle (prescripteur, support, durée…) ;
 *   info      ni l'un ni l'autre.
 */
export const PORTEES = ['bloque', 'verifier', 'info'];

/** Règles, dans l'ordre du comptoir, avec la rubrique Meddispar éventuelle. */
const REGLES = [
  // ---- Ce qui interdit la délivrance en officine --------------------------
  // « Usage hospitalier » et « usage professionnel » restent deux motifs : un
  // « usage professionnel DENTAIRE » n'est pas hospitalier.
  {
    cle: 'cadre',
    portee: 'bloque',
    motif: /usage hospitalier/i,
    resume: () => mention('Hôpital seulement', "Réservé à l'usage hospitalier"),
  },
  {
    cle: 'cadre',
    portee: 'bloque',
    motif: /usage professionnel/i,
    resume: (correspondance) => mention('Usage professionnel', correspondance.input),
  },
  {
    cle: 'cadre',
    portee: 'bloque',
    motif: /structure d.assistance m[ée]dicale mobile|rapatriement sanitaire/i,
    resume: () => mention('SMUR seulement', "Réservé aux structures d'assistance médicale mobile ou de rapatriement"),
  },
  {
    cle: 'cadre',
    portee: 'bloque',
    motif: /situation d.urgence selon l.article R5121-96/i,
    resume: () => mention("Urgence seulement", "Réservé à l'usage en situation d'urgence (art. R5121-96 CSP)"),
  },

  // ---- Ce qu'il faut vérifier avant de délivrer ---------------------------
  {
    cle: 'controle',
    portee: 'verifier',
    motif: /attestation/i,
    resume: () => mention('Attestation', "Délivrance subordonnée à la vérification d'une attestation"),
  },
  {
    cle: 'controle',
    portee: 'verifier',
    motif: /accord de soins/i,
    resume: () => mention('Accord de soins', "Recueil de l'accord de soins du patient exigé"),
  },
  {
    cle: 'controle',
    portee: 'verifier',
    motif: /carnet/i,
    resume: () => mention('Carnet patient', 'Carnet de suivi à remettre ou à mettre à jour'),
  },
  {
    cle: 'controle',
    portee: 'verifier',
    motif: /programme de pr[ée]vention de la grossesse/i,
    resume: () => mention('Prév. grossesse', 'Programme de prévention de la grossesse'),
  },
  {
    cle: 'support',
    portee: 'verifier',
    motif: /toutes lettres|ordonnance s[ée]curis/i,
    resume: () => mention('Ordo sécurisée', 'Ordonnance sécurisée'),
  },
  {
    cle: 'duree',
    portee: 'verifier',
    motif: /prescription limit[ée]e? [àa] (\d+) (semaines?|mois|jours?)/i,
    resume: (correspondance) => mention(`${abreger(correspondance[1], correspondance[2])} max`, `Prescription limitée à ${correspondance[1]} ${correspondance[2]}`),
  },
  {
    cle: 'fractionnement',
    portee: 'verifier',
    motif: /d[ée]livrance fractionn[ée]e? de (\d+) (jours?|semaines?)/i,
    resume: (correspondance) => mention(`Fractionné ${abreger(correspondance[1], correspondance[2])}`, `Délivrance fractionnée, ${correspondance[1]} ${correspondance[2]}`),
  },
  {
    cle: 'chevauchement',
    portee: 'verifier',
    motif: /chevauchement/i,
    resume: () => mention('Chevauchement encadré'),
  },

  // Prescription hospitalière : l'ordonnance vient de l'hôpital, la boîte se
  // délivre en ville.
  {
    cle: 'prescripteur',
    portee: 'verifier',
    motif: /prescription initiale hospitali[èe]re/i,
    resume: () => mention('Initiale hosp.', 'Prescription initiale hospitalière'),
    lien: {
      label: 'Prescription initiale hospitalière',
      url: `${MEDDISPAR}/Medicaments-a-prescription-restreinte/Medicaments-a-prescription-initiale-hospitaliere/Criteres`,
    },
  },
  {
    cle: 'prescripteur',
    portee: 'verifier',
    motif: /prescription hospitali[èe]re/i,
    resume: () => mention('Prescr. hosp.', 'Prescription hospitalière — délivrance en ville possible'),
    lien: {
      label: 'Prescription hospitalière',
      url: `${MEDDISPAR}/Medicaments-a-prescription-restreinte/Medicaments-a-prescription-hospitaliere/Criteres`,
    },
  },
  {
    cle: 'prescripteur',
    portee: 'verifier',
    motif: /r[ée]serv[ée]e? aux (sp[ée]cialistes|m[ée]decins)|r[ée]serv[ée]e? [àa] certains sp[ée]cialistes|prescription initiale r[ée]serv[ée]e|comp[ée]tents? en/i,
    resume: () => mention('Spécialiste', 'Prescription réservée à certains spécialistes'),
    lien: {
      label: 'Prescription réservée à certains spécialistes',
      url: `${MEDDISPAR}/Medicaments-a-prescription-restreinte/Medicaments-a-prescription-reservee-a-certains-medecins-specialistes/Criteres`,
    },
  },

  // ---- Ce qui se lit sans conditionner le geste ---------------------------
  {
    cle: 'classement',
    portee: 'info',
    motif: /^stup[ée]fiants?$/i,
    resume: () => mention('Stupéfiant'),
    lien: {
      label: 'Stupéfiants — conditions de délivrance',
      url: `${MEDDISPAR}/Substances-veneneuses/Medicaments-stupefiants-et-assimiles/Conditions-de-delivrance`,
    },
  },
  {
    cle: 'classement',
    portee: 'info',
    motif: /assimil[ée].*stup[ée]fiant|stup[ée]fiant.*assimil/i,
    resume: () => mention('Assimilé stup.', 'Assimilé stupéfiant'),
    lien: {
      label: 'Stupéfiants et assimilés — conditions de délivrance',
      url: `${MEDDISPAR}/Substances-veneneuses/Medicaments-stupefiants-et-assimiles/Conditions-de-delivrance`,
    },
  },
  { cle: 'classement', portee: 'info', motif: /^liste I$/i, resume: () => mention('Liste I') },
  { cle: 'classement', portee: 'info', motif: /^liste II$/i, resume: () => mention('Liste II') },
  {
    cle: 'suivi',
    portee: 'info',
    motif: /surveillance particuli[èe]re/i,
    lien: {
      label: 'Surveillance particulière pendant le traitement',
      url: `${MEDDISPAR}/Medicaments-a-prescription-restreinte/Medicaments-necessitant-une-surveillance-particuliere-pendant-le-traitement/Criteres`,
    },
  },
  { cle: 'renouvellement', portee: 'info', motif: /renouvellement/i },
];

/** Ordre d'affichage des groupes : ce qui empêche, puis ce qui conditionne. */
export const AXES = [
  ['cadre', 'Où elle se délivre'],
  ['prescripteur', 'Qui la prescrit'],
  ['controle', 'À vérifier avant délivrance'],
  ['support', 'Ordonnance'],
  ['duree', 'Durée'],
  ['fractionnement', 'Fractionnement'],
  ['chevauchement', 'Chevauchement'],
  ['classement', 'Classement'],
  ['suivi', 'Suivi'],
  ['renouvellement', 'Renouvellement'],
  ['autres', 'Autres conditions'],
];

/** Rang d'une portée, pour trier le résumé. */
const rang = (portee) => {
  const i = PORTEES.indexOf(portee);
  return i === -1 ? PORTEES.length : i;
};

const capitale = (texte) => (texte ? texte.charAt(0).toUpperCase() + texte.slice(1) : texte);

/** Les capitales désignent une discipline, sauf ces sigles (relevé sur les 164 libellés). */
const SIGLES = new Set(['CSAPA', 'DPD', 'ETS']);

/**
 * Locution en capitales (« MALADIES INFECTIEUSES ET TROPICALES » : une seule
 * spécialité). Premier mot de 4 lettres au moins, pour ignorer « ET », « II ».
 */
const CRIE = /[A-ZÀ-Þ][A-ZÀ-Þ'’/-]{3,}(?:[\s/-]+[A-ZÀ-Þ][A-ZÀ-Þ'’/-]*)*/g;

/**
 * Met une condition en forme sans en changer un mot : population en tête
 * (avant « : ») et discipline en capitales détachées. Le libellé brut reste
 * en infobulle.
 *
 * @returns {{population:string|null, segments:{texte:string,fort:boolean}[], brut:string}}
 */
export function presenter(condition) {
  const brut = String(condition ?? '').trim();

  // Seuls les libellés de population contiennent « : ».
  const coupe = brut.match(/^\s*(pour [^:]{3,140}?)\s*:\s*(.+)$/i);
  const population = coupe ? capitale(coupe[1].trim()) : null;
  const texte = capitale((coupe ? coupe[2] : brut).trim());

  // Discipline en capitales : remise en casse lisible et détachée.
  const segments = [];
  let depuis = 0;
  CRIE.lastIndex = 0;
  let cri;
  while ((cri = CRIE.exec(texte))) {
    if (SIGLES.has(cri[0].trim())) continue;
    if (cri.index > depuis) segments.push({ texte: texte.slice(depuis, cri.index), fort: false });
    segments.push({ texte: capitale(cri[0].toLowerCase()), fort: true });
    depuis = cri.index + cri[0].length;
  }
  if (depuis < texte.length) segments.push({ texte: texte.slice(depuis), fort: false });

  return { population, segments, brut };
}

/**
 * @param {string[]} libelles - conditions brutes de dbpm.cis_cpd_bdpm
 * @returns {{ resume: {cle,court,long}[], groupes: object[], liens: object[] }}
 */
export function classer(libelles) {
  const conditions = [...new Set((libelles ?? []).map((libelle) => String(libelle ?? '').trim()).filter(Boolean))];

  const parAxe = new Map();
  const resume = new Map();
  const liens = new Map();

  for (const condition of conditions) {
    const regle = REGLES.find((candidate) => candidate.motif.test(condition));
    const cle = regle?.cle ?? 'autres';

    if (!parAxe.has(cle)) parAxe.set(cle, []);
    parAxe.get(cle).push(presenter(condition));

    if (regle?.resume) {
      // Ordre de la règle : celui des libellés, alphabétique, est arbitraire.
      const entree = {
        cle,
        portee: regle.portee,
        ordre: REGLES.indexOf(regle),
        ...regle.resume(condition.match(regle.motif)),
      };
      if (!resume.has(entree.court)) resume.set(entree.court, entree);
    }

    if (regle?.lien) liens.set(regle.lien.url, regle.lien);
  }

  const mentions = [...resume.values()]
    .sort((a, b) => rang(a.portee) - rang(b.portee) || a.ordre - b.ordre);

  return {
    // Ce qui empêche, puis ce qui conditionne, puis ce qui informe.
    resume: mentions,
    // Permet à la vue de répondre non d'emblée.
    bloque: mentions.some((entree) => entree.portee === 'bloque'),
    groupes: AXES.filter(([cle]) => parAxe.has(cle)).map(([cle, titre]) => ({
      cle,
      titre,
      conditions: parAxe.get(cle),
    })),
    liens: [...liens.values()],
  };
}

/**
 * Taux de remboursement : « 30.00 » → « 30 % », espace insécable. Seuls 15, 30,
 * 65 et 100 existent : les décimales ne portent rien.
 */
export function pourcentage(valeur) {
  const nombre = Number(valeur);
  if (valeur === null || valeur === undefined || valeur === '' || !Number.isFinite(nombre)) return null;
  const chiffres = Number.isInteger(nombre) ? String(nombre) : nombre.toFixed(2).replace('.', ',');
  return `${chiffres}\u00A0%`;
}

/**
 * Indications ouvrant droit au remboursement (672 spécialités). Pas appelé
 * « médicament d'exception » : le champ ne le dit que deux fois. Texte
 * identique pour toutes les présentations : le premier non vide suffit.
 */
export async function getRemboursement(pool, cis) {
  const { rows } = await pool.query(
    `SELECT indications_remboursement AS texte, taux_remboursement AS taux
     FROM dbpm.cis_cip_bdpm
     WHERE code_cis = $1
       AND coalesce(indications_remboursement, '') <> ''
     -- Six spécialités portent le texte sans le taux : les présentations qui
     -- l'ont passent devant, sans quoi l'ordre des CIP déciderait à leur place.
     ORDER BY (taux_remboursement IS NULL), code_cip13
     LIMIT 1`,
    [cis],
  );

  const ligne = rows[0];
  // Rendu en HTML (listes, retours à la ligne) : assaini comme les documents.
  return ligne ? { texte: sanitizeDocument(ligne.texte), taux: pourcentage(ligne.taux) } : null;
}

/**
 * Conditions illisibles (panne de la base) : à ne jamais confondre avec une
 * spécialité sans condition, que la fiche dit « Sans ordonnance ».
 */
export function delivranceIndisponible() {
  return { resume: [], bloque: false, groupes: [], liens: [], indisponible: true };
}

/** Conditions d'une spécialité, classées. */
export async function getDelivrance(pool, cis) {
  const { rows } = await pool.query(
    `SELECT condition_prescription_delivrance AS condition
     FROM dbpm.cis_cpd_bdpm
     WHERE code_cis = $1
     ORDER BY condition_prescription_delivrance`,
    [cis],
  );

  return classer(rows.map((row) => row.condition));
}
