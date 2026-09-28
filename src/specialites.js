/**
 * Les spécialités d'une molécule, rangées pour se lire d'un coup d'œil.
 *
 * Quatre-vingt-six lignes de fentanyl, une par code CIS, sont exactes et
 * illisibles : six ABSTRAL d'affilée qui ne diffèrent que par le dosage, des
 * patchs mêlés aux comprimés sublinguaux. Deux regroupements, et rien d'autre :
 *
 * - **par forme** — le patch et le comprimé sublingual ne répondent pas à la
 *   même question au comptoir (traitement de fond, accès paroxystique) ;
 * - **par nom, les dosages à la suite** — « ABSTRAL 100 · 200 · 300 µg » sur
 *   une ligne. Chaque dosage reste un lien vers sa spécialité : l'unité est
 *   toujours la spécialité, seule la mise en page les rassemble.
 *
 * Tout se déduit de la dénomination BDPM, « NOM DOSAGE, forme » : le nom est
 * ce qui précède le premier nombre isolé, le dosage ce qui le suit jusqu'à
 * la virgule. Une dénomination sans chiffre (« DRILL TOUX SECHE, sirop ») n'a
 * pas de dosage ; elle garde sa ligne.
 *
 * L'ordre d'entrée est respecté — princeps, noms de fantaisie, puis DCI, tel
 * que la requête l'a posé — et les dosages se rangent par valeur, 12 avant
 * 100, ce que l'ordre alphabétique ne fait pas.
 *
 * Pure, pour être testée sans base.
 */

const nombre = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.'));

/** « DUROGESIC 100 microgrammes/heure, dispositif transdermique » → parties. */
export function decomposer(denomination) {
  const texte = String(denomination ?? '').trim();
  // La forme suit « , » — virgule *et* espace : la virgule seule est celle
  // des décimales, « 0,33 mg/ml ».
  const virgule = texte.indexOf(', ');
  const tete = (virgule >= 0 ? texte.slice(0, virgule) : texte).trim();
  const m = /^(.*?)\s+(\d.*)$/.exec(tete);
  return m ? { nom: m[1].trim(), dosage: m[2].trim() } : { nom: tete, dosage: '' };
}

/**
 * « 100 microgrammes/heure » → { valeur: 100, unite: 'microgrammes/heure' }.
 * Null quand le dosage n'est pas « nombre unité » : une association
 * (« 500 mg/30 mg »), un dosage suivi d'une mention (« 0,33 mg/ml SANS
 * SUCRE ») se montrent alors en entier.
 */
function lireDosage(dosage) {
  const m = /^(\d[\d\s]*(?:[.,]\d+)?)\s*([^\d\s][^\d]*)$/.exec(dosage);
  return m ? { valeur: nombre(m[1]), chiffre: m[1].trim(), unite: m[2].trim() } : null;
}

const minuscule = (s) => String(s ?? '').trim().toLowerCase();

/**
 * @param {Array<{id, denomination, forme_pharmaceutique, titulaires,
 *   princeps, importation}>} lignes - dans l'ordre voulu
 * @returns {Array<{ forme: string, total: number, noms: Array<{ nom, titulaires,
 *   princeps, importation, unite: string|null,
 *   dosages: Array<{ id, libelle }> }> }>}
 */
export function regrouperSpecialites(lignes) {
  const formes = new Map();

  for (const l of lignes) {
    const forme = minuscule(l.forme_pharmaceutique) || 'forme non précisée';
    if (!formes.has(forme)) formes.set(forme, { forme, total: 0, noms: new Map() });
    const f = formes.get(forme);
    f.total += 1;

    const { nom, dosage } = decomposer(l.denomination);
    const cle = `${nom}|${l.titulaires ?? ''}|${Boolean(l.importation)}`;
    if (!f.noms.has(cle)) {
      f.noms.set(cle, {
        nom, titulaires: l.titulaires, princeps: false, importation: Boolean(l.importation), brut: [],
      });
    }
    const n = f.noms.get(cle);
    n.princeps ||= Boolean(l.princeps);
    n.brut.push({ id: l.id, dosage, denomination: l.denomination });
  }

  return [...formes.values()]
    // La forme la plus fournie d'abord : c'est, presque toujours, la plus
    // délivrée — le patch de fentanyl, le comprimé de paracétamol.
    .sort((a, b) => b.total - a.total)
    .map((f) => ({
      forme: f.forme,
      total: f.total,
      noms: [...f.noms.values()].map(({ brut, ...n }) => {
        const lus = brut.map((b) => ({ ...b, lu: lireDosage(b.dosage) }));
        const unites = new Set(lus.map((b) => b.lu?.unite));
        // Une seule unité pour tous les dosages : on l'écrit une fois, à la fin.
        const commune = lus.every((b) => b.lu) && unites.size === 1 ? [...unites][0] : null;
        const ordonnes = commune ? [...lus].sort((a, b) => a.lu.valeur - b.lu.valeur) : lus;
        return {
          ...n,
          unite: commune,
          dosages: ordonnes.map((b) => ({
            id: b.id,
            // Sans dosage, le lien porte la dénomination entière : c'est la
            // seule chose qui distingue deux spécialités du même nom.
            libelle: commune ? b.lu.chiffre : (b.dosage || b.denomination),
          })),
        };
      }),
    }));
}
