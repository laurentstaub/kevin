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

import { statutBiologique } from './biosimilaires.js';

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
 * « 100 microgrammes/heure » → { valeur: 100, chiffre: '100', unite: 'microgrammes/heure' }.
 *
 * Quand le dosage porte plus qu'un nombre et une unité — l'énoxaparine,
 * « 4 000 UI (40 mg)/0,4 mL » —, on en lit la tête, « 4 000 UI », et on garde
 * le reste en `detail` : la ligne affiche la tête, l'infobulle et la fiche le
 * détail. Sept dosages d'énoxaparine écrits en entier faisaient trois lignes
 * illisibles par laboratoire.
 *
 * Null quand rien ne se lit, et `regrouperSpecialites` décide ensuite si la
 * tête suffit à distinguer les spécialités d'une ligne.
 */
const NOMBRE = String.raw`(\d{1,3}(?:[\s  ]\d{3})+|\d+)(?:[.,](\d+))?`;
function lireDosage(dosage) {
  const entier = new RegExp(`^${NOMBRE}\\s*([^\\d\\s][^\\d]*)$`).exec(dosage);
  const tete = entier ?? new RegExp(`^${NOMBRE}\\s*([A-Za-zµμ%]+(?:/[A-Za-zµμ]+)?)(?=[\\s(]|$)`).exec(dosage);
  if (!tete) return null;
  const chiffre = tete[2] ? `${tete[1]},${tete[2]}` : tete[1];
  return {
    valeur: nombre(chiffre),
    // L'espace des milliers devient insécable : « 4 000 » ne se coupe plus.
    chiffre: chiffre.replace(/[\s ]/g, ' '),
    unite: tete[3].trim(),
    detail: entier ? null : dosage,
  };
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
        nom, titulaires: l.titulaires, princeps: false, importation: Boolean(l.importation),
        biologique: statutBiologique(l.denomination), brut: [],
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
      // La référence d'abord — princeps du Répertoire ou médicament biologique
      // de référence : LOVENOX avant INHIXA, que l'alphabet mettait devant.
      // Le tri est stable, l'ordre de la requête vaut pour le reste.
      noms: [...f.noms.values()]
        .sort((a, b) => Number(b.princeps || b.biologique === 'reference')
          - Number(a.princeps || a.biologique === 'reference'))
        .map(({ brut, ...n }) => {
        const lus = brut.map((b) => ({ ...b, lu: lireDosage(b.dosage) }));
        const unites = new Set(lus.map((b) => b.lu?.unite));
        const chiffres = new Set(lus.map((b) => b.lu?.valeur));
        // Une seule unité, et des chiffres qui suffisent à distinguer chaque
        // spécialité : on écrit l'unité une fois, à la fin. Deux « 0,33 mg »
        // qui ne diffèrent que par « SANS SUCRE » s'écrivent en entier.
        const commune = lus.every((b) => b.lu) && unites.size === 1 && chiffres.size === lus.length
          ? [...unites][0] : null;
        const ordonnes = commune ? [...lus].sort((a, b) => a.lu.valeur - b.lu.valeur) : lus;
        return {
          ...n,
          unite: commune,
          dosages: ordonnes.map((b) => ({
            id: b.id,
            // Ce que la tête tait — « (40 mg)/0,4 mL » — reste en infobulle.
            detail: commune ? b.lu.detail : null,
            // Sans dosage, le lien porte la dénomination entière : c'est la
            // seule chose qui distingue deux spécialités du même nom.
            libelle: commune ? b.lu.chiffre : (b.dosage || b.denomination),
          })),
        };
      }),
    }));
}
