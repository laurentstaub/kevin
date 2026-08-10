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
 * Axes de lecture, dans l'ordre où la question se pose au comptoir. Chaque
 * règle porte éventuellement la rubrique Meddispar qui la détaille.
 */
const REGLES = [
  {
    cle: 'classement',
    motif: /^stup[ée]fiants?$/i,
    resume: () => mention('Stupéfiant'),
    lien: {
      label: 'Stupéfiants — conditions de délivrance',
      url: `${MEDDISPAR}/Substances-veneneuses/Medicaments-stupefiants-et-assimiles/Conditions-de-delivrance`,
    },
  },
  {
    cle: 'classement',
    motif: /assimil[ée].*stup[ée]fiant|stup[ée]fiant.*assimil/i,
    resume: () => mention('Assimilé stup.', 'Assimilé stupéfiant'),
    lien: {
      label: 'Stupéfiants et assimilés — conditions de délivrance',
      url: `${MEDDISPAR}/Substances-veneneuses/Medicaments-stupefiants-et-assimiles/Conditions-de-delivrance`,
    },
  },
  { cle: 'classement', motif: /^liste I$/i, resume: () => mention('Liste I') },
  { cle: 'classement', motif: /^liste II$/i, resume: () => mention('Liste II') },

  {
    cle: 'support',
    motif: /toutes lettres|ordonnance s[ée]curis/i,
    resume: () => mention('Ordo sécurisée', 'Ordonnance sécurisée'),
  },
  {
    cle: 'duree',
    motif: /prescription limit[ée]e? [àa] (\d+) (semaines?|mois|jours?)/i,
    resume: (m) => mention(`${abreger(m[1], m[2])} max`, `Prescription limitée à ${m[1]} ${m[2]}`),
  },
  {
    cle: 'fractionnement',
    motif: /d[ée]livrance fractionn[ée]e? de (\d+) (jours?|semaines?)/i,
    resume: (m) => mention(`Fractionné ${abreger(m[1], m[2])}`, `Délivrance fractionnée, ${m[1]} ${m[2]}`),
  },
  { cle: 'chevauchement', motif: /chevauchement/i, resume: () => mention('Chevauchement encadré') },

  {
    cle: 'prescripteur',
    motif: /prescription initiale hospitali[èe]re/i,
    lien: {
      label: 'Prescription initiale hospitalière',
      url: `${MEDDISPAR}/Medicaments-a-prescription-restreinte/Medicaments-a-prescription-initiale-hospitaliere/Criteres`,
    },
  },
  {
    cle: 'prescripteur',
    motif: /prescription hospitali[èe]re/i,
    lien: {
      label: 'Prescription hospitalière',
      url: `${MEDDISPAR}/Medicaments-a-prescription-restreinte/Medicaments-a-prescription-hospitaliere/Criteres`,
    },
  },
  {
    cle: 'prescripteur',
    motif: /r[ée]serv[ée]e? aux (sp[ée]cialistes|m[ée]decins)|prescription initiale r[ée]serv[ée]e/i,
    lien: {
      label: 'Prescription réservée à certains spécialistes',
      url: `${MEDDISPAR}/Medicaments-a-prescription-restreinte/Medicaments-a-prescription-reservee-a-certains-medecins-specialistes/Criteres`,
    },
  },
  { cle: 'cadre', motif: /usage hospitalier|r[ée]serv[ée] [àa] l.usage/i, resume: () => mention('Usage hospitalier') },
  {
    cle: 'suivi',
    motif: /surveillance particuli[èe]re/i,
    lien: {
      label: 'Surveillance particulière pendant le traitement',
      url: `${MEDDISPAR}/Medicaments-a-prescription-restreinte/Medicaments-necessitant-une-surveillance-particuliere-pendant-le-traitement/Criteres`,
    },
  },
  { cle: 'suivi', motif: /carnet/i },
  { cle: 'renouvellement', motif: /renouvellement/i },
];

/** Ordre d'affichage des groupes. */
export const AXES = [
  ['classement', 'Classement'],
  ['support', 'Ordonnance'],
  ['duree', 'Durée'],
  ['fractionnement', 'Délivrance'],
  ['chevauchement', 'Chevauchement'],
  ['prescripteur', 'Prescripteur'],
  ['cadre', 'Cadre'],
  ['suivi', 'Suivi'],
  ['renouvellement', 'Renouvellement'],
  ['autres', 'Autres conditions'],
];

/** Ce qui se lit sans ouvrir le bloc : la réponse tient en quatre mentions. */
const AU_RESUME = ['classement', 'support', 'duree', 'fractionnement'];

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
    parAxe.get(cle).push(condition);

    if (regle?.resume && AU_RESUME.includes(cle)) {
      const m = { cle, ...regle.resume(condition.match(regle.motif)) };
      if (!resume.has(cle)) resume.set(cle, []);
      if (!resume.get(cle).some((x) => x.court === m.court)) resume.get(cle).push(m);
    }

    if (regle?.lien) liens.set(regle.lien.url, regle.lien);
  }

  return {
    resume: AU_RESUME.flatMap((cle) => resume.get(cle) ?? []),
    groupes: AXES.filter(([cle]) => parAxe.has(cle)).map(([cle, titre]) => ({
      cle,
      titre,
      conditions: parAxe.get(cle),
    })),
    liens: [...liens.values()],
  };
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
