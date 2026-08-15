/**
 * Conditions de prescription et de délivrance.
 *
 * La fiche répond à la question du RCP : « que fait ce médicament ». Reste
 * celle du comptoir : « puis-je le délivrer, et sous quelles conditions ». La
 * réponse est déjà dans la base publique — `dbpm.cis_cpd_bdpm` porte 26 800
 * lignes sur 12 350 spécialités, et pas des étiquettes vagues : la liste, la
 * durée maximale, le fractionnement, le support d'ordonnance, le chevauchement.
 *
 * Meddispar, édité par l'Ordre, ajoute la conduite à tenir rédigée — mentions
 * obligatoires, registre, traçabilité. Ce contenu n'est pas ouvert : on y
 * renvoie par un lien vers la rubrique concernée, on ne le recopie pas.
 *
 * `classer` est pure. Les libellés qu'aucune règle ne reconnaît ne sont pas
 * perdus : ils sortent tels quels. Sur une donnée réglementaire, escamoter ce
 * qu'on n'a pas su ranger serait pire que de l'afficher brut.
 */

const MEDDISPAR = 'https://www.meddispar.fr';

/**
 * Le résumé se lit d'un coup d'œil, en mentions courtes. Chacune garde son
 * libellé complet en infobulle, et la BDPM reste affichée mot pour mot dans le
 * corps du bloc : on abrège l'accès, jamais la donnée.
 */
const UNITES = { jour: 'j', jours: 'j', semaine: 'sem.', semaines: 'sem.', mois: 'mois' };
const abreger = (n, unite) => `${n} ${UNITES[unite.toLowerCase()] ?? unite}`;
const mention = (court, long) => ({ court, long: long ?? court });

/**
 * Portée d'une condition — ce qu'elle fait à la délivrance, et non ce qu'elle
 * décrit. C'est l'ordre dans lequel la question se pose la boîte à la main :
 *
 *   bloque    la spécialité ne se délivre pas en officine. Rien d'autre à
 *             lire : la réponse est non.
 *   verifier  elle se délivre, mais quelque chose est à contrôler avant —
 *             le prescripteur, le support, la durée, une attestation.
 *   info      ni l'un ni l'autre : le classement, le suivi, le renouvellement.
 *
 * Cette hiérarchie impose une lecture à un texte réglementaire qui n'en porte
 * aucune : la BDPM aligne ses conditions sans les ordonner. C'est assumé — la
 * donnée brute reste affichée mot pour mot dans le corps du bloc, et une
 * condition qu'aucune règle ne reconnaît sort telle quelle.
 */
export const PORTEES = ['bloque', 'verifier', 'info'];

/**
 * Axes de lecture, dans l'ordre où la question se pose au comptoir. Chaque
 * règle porte éventuellement la rubrique Meddispar qui la détaille.
 */
const REGLES = [
  // ---- Ce qui interdit la délivrance en officine --------------------------
  //
  // « Réservé à l'usage hospitalier » et « réservé à l'usage professionnel »
  // sont deux choses distinctes, et la règle précédente les confondait : son
  // motif « réservé à l'usage » attrapait « réservé à l'usage professionnel
  // DENTAIRE » et l'affichait « Usage hospitalier ». Faux, et faux sur la
  // mention la plus lourde de conséquence de tout le bloc.
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
    resume: (m) => mention('Usage professionnel', m.input),
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
    resume: (m) => mention(`${abreger(m[1], m[2])} max`, `Prescription limitée à ${m[1]} ${m[2]}`),
  },
  {
    cle: 'fractionnement',
    portee: 'verifier',
    motif: /d[ée]livrance fractionn[ée]e? de (\d+) (jours?|semaines?)/i,
    resume: (m) => mention(`Fractionné ${abreger(m[1], m[2])}`, `Délivrance fractionnée, ${m[1]} ${m[2]}`),
  },
  {
    cle: 'chevauchement',
    portee: 'verifier',
    motif: /chevauchement/i,
    resume: () => mention('Chevauchement encadré'),
  },

  // Le prescripteur. « Prescription hospitalière » ne veut pas dire « délivrance
  // hospitalière » : l'ordonnance doit venir d'un prescripteur hospitalier, la
  // boîte se délivre en ville. Confondre les deux, c'est refuser à tort.
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

/**
 * Met une condition en forme sans en changer un mot.
 *
 * La BDPM écrit ses 164 libellés d'un seul tenant, en bas de casse, la
 * discipline en capitales et la population en tête suivie d'un deux-points :
 *
 *   « pour adolescents de sexe masculin et hommes susceptibles de procréer :
 *     prescription initiale réservée à certains spécialistes »
 *   « prescription réservée aux spécialistes et services NEUROLOGIE »
 *
 * La structure est donc déjà là, portée par la ponctuation et la casse. Quatre
 * lignes composées à l'identique se lisent comme un bloc gris ; séparées selon
 * leur propre grammaire, elles se parcourent.
 *
 * On ne déplace, n'ajoute ni ne retire aucun mot : on coupe où la source coupe
 * et l'on rend la casse lisible. Le libellé d'origine reste accessible en
 * entier — la vue le garde en infobulle.
 *
 * @returns {{population:string|null, texte:string, accent:string|null, brut:string}}
 */
const capitale = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/**
 * Les capitales de la source désignent une discipline — sauf trois sigles.
 *
 * Relevé sur les 164 libellés : soixante-dix-huit mots en capitales, tous des
 * spécialités médicales, à l'exception de CSAPA, DPD et ETS. Un sigle mis en
 * bas de casse cesse d'être un sigle : la liste est courte, elle est close.
 */
const SIGLES = new Set(['CSAPA', 'DPD', 'ETS']);

/**
 * Une locution en capitales, et non un mot.
 *
 * « CHIRURGIE THORACIQUE », « MALADIES INFECTIEUSES ET TROPICALES »,
 * « ENDOCRINOLOGIE - DIABETOLOGIE - NUTRITION » désignent chacune une seule
 * spécialité. Traitées mot à mot, elles ressortaient en « Maladies
 * Infectieuses ET Tropicales » — trois emphases pour une notion, et un « ET »
 * resté en capitales parce qu'il est trop court pour être vu.
 *
 * Le premier mot fait quatre lettres au moins — « ET », « DU », « II » ne sont
 * pas des mots criés ; la suite prend tous les mots capitalisés qui
 * l'enchaînent, quelle que soit leur longueur.
 */
const CRIE = /[A-ZÀ-Þ][A-ZÀ-Þ'’/-]{3,}(?:[\s/-]+[A-ZÀ-Þ][A-ZÀ-Þ'’/-]*)*/g;

/**
 * Met une condition en forme sans en changer un mot.
 *
 * La BDPM écrit ses libellés d'un seul tenant, en bas de casse, la discipline
 * en capitales et la population en tête suivie d'un deux-points :
 *
 *   « pour adolescents de sexe masculin et hommes susceptibles de procréer :
 *     prescription initiale réservée à certains spécialistes »
 *   « prescription réservée aux spécialistes et services NEUROLOGIE »
 *
 * La structure est donc déjà là, portée par la ponctuation et par la casse.
 * Quatre lignes composées à l'identique se lisent comme un bloc gris ;
 * séparées selon leur propre grammaire, elles se parcourent.
 *
 * On ne déplace, n'ajoute ni ne retire aucun mot : on coupe où la source coupe,
 * et l'on rend lisible une casse qui ne portait pas d'emphase mais un
 * repérage. Le libellé d'origine reste entier — la vue le garde en infobulle.
 *
 * @returns {{population:string|null, segments:{texte:string,fort:boolean}[], brut:string}}
 */
export function presenter(condition) {
  const brut = String(condition ?? '').trim();

  // « population : condition ». Aucun autre libellé de la base ne porte de
  // deux-points, la coupe ne peut donc pas se tromper de rôle.
  const coupe = brut.match(/^\s*(pour [^:]{3,140}?)\s*:\s*(.+)$/i);
  const population = coupe ? capitale(coupe[1].trim()) : null;
  const texte = capitale((coupe ? coupe[2] : brut).trim());

  // Chaque mot crié devient un mot lu — et se détache, parce que c'est lui qui
  // décide si l'ordonnance est recevable.
  const segments = [];
  let depuis = 0;
  CRIE.lastIndex = 0;
  let m;
  while ((m = CRIE.exec(texte))) {
    if (SIGLES.has(m[0].trim())) continue;
    if (m.index > depuis) segments.push({ texte: texte.slice(depuis, m.index), fort: false });
    segments.push({ texte: capitale(m[0].toLowerCase()), fort: true });
    depuis = m.index + m[0].length;
  }
  if (depuis < texte.length) segments.push({ texte: texte.slice(depuis), fort: false });

  return { population, segments, brut };
}

/**
 * @param {string[]} libelles - conditions brutes de dbpm.cis_cpd_bdpm
 * @returns {{ resume: {cle,court,long}[], groupes: object[], liens: object[] }}
 */
export function classer(libelles) {
  const conditions = [...new Set((libelles ?? []).map((l) => String(l ?? '').trim()).filter(Boolean))];

  const parAxe = new Map();
  const resume = new Map();
  const liens = new Map();

  for (const condition of conditions) {
    const regle = REGLES.find((r) => r.motif.test(condition));
    const cle = regle?.cle ?? 'autres';

    if (!parAxe.has(cle)) parAxe.set(cle, []);
    parAxe.get(cle).push(presenter(condition));

    if (regle?.resume) {
      // L'ordre de la règle, et non celui d'arrivée : la requête trie par
      // libellé, donc l'ordre des conditions est arbitraire. Sans ce rang, deux
      // spécialités portant les mêmes mentions les afficheraient dans deux
      // ordres différents selon l'alphabet de leurs libellés.
      const m = {
        cle,
        portee: regle.portee,
        ordre: REGLES.indexOf(regle),
        ...regle.resume(condition.match(regle.motif)),
      };
      if (!resume.has(m.court)) resume.set(m.court, m);
    }

    if (regle?.lien) liens.set(regle.lien.url, regle.lien);
  }

  const mentions = [...resume.values()]
    .sort((a, b) => rang(a.portee) - rang(b.portee) || a.ordre - b.ordre);

  return {
    // Ce qui empêche d'abord, ce qui conditionne ensuite, ce qui informe en
    // dernier. On lit la réponse avant d'en lire les modalités.
    resume: mentions,
    // Une seule question compte avant toutes les autres : est-ce que ça sort
    // de la pharmacie ? La vue s'en sert pour dire non d'emblée.
    bloque: mentions.some((m) => m.portee === 'bloque'),
    groupes: AXES.filter(([cle]) => parAxe.has(cle)).map(([cle, titre]) => ({
      cle,
      titre,
      conditions: parAxe.get(cle),
    })),
    liens: [...liens.values()],
  };
}

/**
 * Prise en charge limitée à certaines indications.
 *
 * `cis_cip_bdpm.indications_remboursement` porte, pour 672 spécialités, le
 * texte des seules indications ouvrant droit au remboursement. C'est le
 * mécanisme qui, en pratique, va souvent de pair avec l'ordonnance de
 * médicament d'exception.
 *
 * **On ne l'appelle pourtant pas ainsi.** Relevé sur les 800 présentations
 * concernées : le champ ne contient le mot « exception » que deux fois, et
 * toutes les restrictions de prise en charge ne relèvent pas de cette
 * catégorie réglementaire. Nommer d'après la donnée, pas d'après ce qu'on en
 * déduit — c'est la même règle qui a fait distinguer « usage hospitalier » et
 * « usage professionnel ».
 *
 * Le texte est le même pour toutes les présentations d'une spécialité : on
 * prend le premier non vide.
 */
/**
 * Le taux, en toutes lettres.
 *
 * La colonne est un `numeric(5,2)` et sort de la base en « 30.00 » : un nombre
 * nu, sans unité, posé à côté du titre. Trente quoi ? La BDPM n'écrit que
 * quatre valeurs — 15, 30, 65 et 100 %, relevées sur les 800 présentations
 * concernées — donc les décimales ne portent rien et le signe manquait seul.
 * L'espace avant le signe est insécable : le taux ne se coupe pas en fin de
 * ligne.
 */
export function pourcentage(valeur) {
  const n = Number(valeur);
  if (valeur === null || valeur === undefined || valeur === '' || !Number.isFinite(n)) return null;
  const chiffres = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return `${chiffres}\u00A0%`;
}

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
  return ligne ? { texte: ligne.texte, taux: pourcentage(ligne.taux) } : null;
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

  return classer(rows.map((r) => r.condition));
}
