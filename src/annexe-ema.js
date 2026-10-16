/**
 * Annexe de la ligne directrice européenne sur les excipients à effet notoire
 * (EMA/CHMP/302620/2017 Rev. 1, SANTE-2017-11668), reprise telle quelle : nom
 * de l'excipient, numéros E, exemples cités, et une ligne par voie
 * d'administration avec son seuil. C'est elle qui dit qu'un excipient est « à
 * effet notoire », et à partir de quel seuil. Module pur : il lit le texte de
 * `pdftotext -layout` du tableau.
 *
 * Colonnes du tableau, en caractères : nom, date de mise à jour, voie, seuil,
 * puis texte de notice et commentaires (non repris ici).
 */

const COLONNES = { nom: [0, 37], maj: [37, 57], voie: [57, 82], seuil: [82, 103] };

const colonne = (ligne, [debut, fin]) => ligne.slice(debut, fin).trim();

/** Début d'un seuil : « Zero », « Less than 1 mmol », « 5g », « 15 mg/kg per dose », « 30 mmol/l ». */
const SEUIL = /\b(Zero|Less than|\d[\d.,]*\s?(mg|g|mmol)\b)/;

/** Forme lisible d'un seuil, au début de sa cellule. */
const SEUIL_LISIBLE = /^(Zero|Less than \d+ mmol|\d[\d.,]*\s?(?:mg|g|mmol)(?:\s?B)?(?:\/kg)?(?:\/day| per dose|\/l)?)/;

/** En-têtes et pieds répétés à chaque page. */
const HABILLAGE = /^\s*(Name\b|Administration\b|Annex to the European|EMA\/CHMP\/|Excipients and information for the package leaflet)/;

/** « E 951 », « E 1520 » : les numéros cités dans une cellule de nom, coupure de ligne comprise. */
const numerosE = (texte) => [...texte.replace(/\(E\s*\n?\s*/g, '(E ').matchAll(/\bE\s?(\d{3,4})\b/g)].map((trouve) => `E ${trouve[1]}`);

/**
 * @param {string} texte  sortie de `pdftotext -layout` de l'annexe
 * @returns {{ nom: string, numeros: string[], exemples: string[], lignes: { voie: string, seuil: string, maj: string|null }[] }[]}
 *   un excipient par nom, ses lignes dans l'ordre de l'annexe
 */
export function lireAnnexe(texte) {
  const lignes = String(texte ?? '').split('\n');
  // Le tableau commence à son premier en-tête et s'arrête à l'appendice des parfums.
  const debut = lignes.findIndex((ligne) => /^Name\s+Updated on/.test(ligne));
  const fin = lignes.findIndex((ligne) => /^Appendix:/.test(ligne.trim()));
  const blocs = [];
  let bloc = null;

  for (const ligne of lignes.slice(debut, fin < 0 ? undefined : fin)) {
    if (HABILLAGE.test(ligne) || /^\s*$/.test(ligne)) {
      if (/^\s*$/.test(ligne) && bloc) bloc.vide = true;
      continue;
    }
    // Une date qui déborde dans la cellule de nom n'en fait pas partie.
    const nom = colonne(ligne, COLONNES.nom).replace(/\s*\d{2}\/\d{2}\/\d{4}\s*$/, '');
    // La voie peut déborder sur la colonne du seuil (« Topical, parenteral Zero ») : on les lit ensemble.
    const voieEtSeuil = ligne.slice(COLONNES.voie[0], COLONNES.seuil[1]).trim();
    const coupe = SEUIL.exec(voieEtSeuil);
    const voie = coupe ? voieEtSeuil.slice(0, coupe.index).trim() : voieEtSeuil;
    const seuil = coupe ? voieEtSeuil.slice(coupe.index).trim() : '';
    // Une ligne du tableau s'ouvre là où un nom est écrit en face d'un seuil.
    const ouvre = Boolean(seuil) && Boolean(nom);
    if (ouvre) {
      bloc = { noms: [nom], voies: [voie], seuils: [seuil], maj: colonne(ligne, COLONNES.maj) || null, vide: false };
      blocs.push(bloc);
      continue;
    }
    if (!bloc) continue;
    if (bloc.vide && nom && !seuil) {
      // Après un blanc, la cellule de nom continue : « e.g.: », exemples.
      bloc.noms.push(nom);
      continue;
    }
    if (nom) bloc.noms.push(nom);
    if (voie) bloc.voies.push(voie);
    if (seuil && !bloc.vide) bloc.seuils.push(seuil);
  }

  const parNom = new Map();
  for (const { noms, voies, seuils, maj } of blocs) {
    const cellule = noms.join('\n');
    const [tete, ...suite] = cellule.split(/\ne\.g\.:\n?/);
    const nom = tete.replace(/\s*\n\s*/g, ' ').replace(/\s+\d{2}\/\d{2}\/\d{4}$/, '').trim();
    const exemples = suite.join('\n').split('\n')
      .reduce((liste, morceau) => {
        // Un exemple coupé en fin de ligne (« Azorubine, carmoisine (E » / « 122) ») se recolle.
        if (liste.length && (/[(-]$/.test(liste.at(-1)) || /^[a-z0-9)(]/.test(morceau))) liste[liste.length - 1] = `${liste.at(-1)}${/-$/.test(liste.at(-1)) ? '' : ' '}${morceau}`.replace(/\s+/g, ' ');
        else liste.push(morceau);
        return liste;
      }, [])
      .map((exemple) => exemple.trim()).filter(Boolean);
    const entree = parNom.get(nom) ?? { nom, numeros: [], exemples: [], lignes: [] };
    entree.numeros = [...new Set([...entree.numeros, ...numerosE(cellule)])];
    entree.exemples = [...new Set([...entree.exemples, ...exemples])];
    // Seuil : sa forme lisible seulement (« Zero », « 5 mg/kg/day ») ; sur plusieurs lignes, le
    // texte se mêle à la colonne voisine et ne serait plus celui de l'annexe.
    const seuil = SEUIL_LISIBLE.exec(seuils.join(' ').replace(/\s+/g, ' ').trim())?.[0] ?? null;
    entree.lignes.push({ voie: voies.join(' ').replace(/\s+/g, ' ').trim(), seuil, maj });
    parNom.set(nom, entree);
  }
  return [...parNom.values()];
}
