/**
 * Regroupe les spécialités d'une molécule par forme, puis par nom avec les
 * dosages à la suite (« ABSTRAL 100 · 200 · 300 µg »), chaque dosage restant un lien.
 * Tout se déduit de la dénomination BDPM « NOM DOSAGE, forme ».
 * L'ordre d'entrée est conservé ; les dosages se trient par valeur. Module pur.
 */

import { statutBiologique } from './biosimilaires.js';

const nombre = (texte) => Number(String(texte).replace(/\s/g, '').replace(',', '.'));

/** « DUROGESIC 100 microgrammes/heure, dispositif transdermique » → parties. */
export function decomposer(denomination) {
  const texte = String(denomination ?? '').trim();
  // Virgule suivie d'une espace : la virgule seule est décimale (« 0,33 mg/ml »).
  const virgule = texte.indexOf(', ');
  const tete = (virgule >= 0 ? texte.slice(0, virgule) : texte).trim();
  const parties = /^(.*?)\s+(\d.*)$/.exec(tete);
  return parties ? { nom: parties[1].trim(), dosage: parties[2].trim() } : { nom: tete, dosage: '' };
}

/**
 * « 100 microgrammes/heure » → { valeur: 100, chiffre: '100', unite: 'microgrammes/heure' }.
 * Dosage composé (« 4 000 UI (40 mg)/0,4 mL ») : tête lue, dosage complet en `detail`.
 * Null si rien ne se lit.
 */
const NOMBRE = String.raw`(\d{1,3}(?:[\s\u00a0\u202f]\d{3})+|\d+)(?:[.,](\d+))?`;
function lireDosage(dosage) {
  const entier = new RegExp(`^${NOMBRE}\\s*([^\\d\\s][^\\d]*)$`).exec(dosage);
  const tete = entier ?? new RegExp(`^${NOMBRE}\\s*([A-Za-zµμ%]+(?:/[A-Za-zµμ]+)?)(?=[\\s(]|$)`).exec(dosage);
  if (!tete) return null;
  const chiffre = tete[2] ? `${tete[1]},${tete[2]}` : tete[1];
  return {
    valeur: nombre(chiffre),
    // Espace des milliers insécable.
    chiffre: chiffre.replace(/[\s\u00a0]/g, '\u202f'),
    unite: tete[3].trim(),
    detail: entier ? null : dosage,
  };
}

/** Unités abrégées : « 12 µg/h » plutôt que « 12 microgrammes/heure ». */
export const abregerUnite = (texte) => String(texte ?? '')
  .replace(/microgrammes?/gi, 'µg')
  .replace(/milligrammes?/gi, 'mg')
  .replace(/\s*\/\s*heure\b/gi, '/h');

const minuscule = (texte) => String(texte ?? '').trim().toLowerCase();

/**
 * @param {Array<{id, denomination, forme_pharmaceutique, titulaires,
 *   princeps, importation}>} lignes - dans l'ordre voulu
 * @returns {Array<{ forme: string, total: number, noms: Array<{ nom, titulaires,
 *   princeps, importation, unite: string|null,
 *   dosages: Array<{ id, libelle }> }> }>}
 */
export function regrouperSpecialites(lignes) {
  const formes = new Map();

  for (const ligne of lignes) {
    const forme = minuscule(ligne.forme_pharmaceutique) || 'forme non précisée';
    if (!formes.has(forme)) formes.set(forme, { forme, total: 0, noms: new Map() });
    const groupeForme = formes.get(forme);
    groupeForme.total += 1;

    const { nom, dosage } = decomposer(ligne.denomination);
    const cle = `${nom}|${ligne.titulaires ?? ''}|${Boolean(ligne.importation)}`;
    if (!groupeForme.noms.has(cle)) {
      groupeForme.noms.set(cle, {
        nom, titulaires: ligne.titulaires, princeps: false, importation: Boolean(ligne.importation),
        biologique: statutBiologique(ligne.denomination), brut: [],
      });
    }
    const groupeNom = groupeForme.noms.get(cle);
    groupeNom.princeps ||= Boolean(ligne.princeps);
    groupeNom.brut.push({ id: ligne.id, dosage, denomination: ligne.denomination });
  }

  return [...formes.values()]
    // Forme la plus fournie d'abord (presque toujours la plus délivrée).
    .sort((a, b) => b.total - a.total)
    .map((groupeForme) => ({
      forme: groupeForme.forme,
      total: groupeForme.total,
      // Princeps ou biologique de référence d'abord ; tri stable pour le reste.
      noms: [...groupeForme.noms.values()]
        .sort((a, b) => Number(b.princeps || b.biologique === 'reference')
          - Number(a.princeps || a.biologique === 'reference'))
        .map(({ brut, ...groupeNom }) => {
        const lus = brut.map((entree) => ({ ...entree, lu: lireDosage(entree.dosage) }));
        const unites = new Set(lus.map((entree) => entree.lu?.unite));
        const chiffres = new Set(lus.map((entree) => entree.lu?.valeur));
        // Unité écrite une fois si elle est commune et que les chiffres distinguent chaque spécialité.
        const commune = lus.every((entree) => entree.lu) && unites.size === 1 && chiffres.size === lus.length
          ? [...unites][0] : null;
        const ordonnes = commune ? [...lus].sort((a, b) => a.lu.valeur - b.lu.valeur) : lus;
        return {
          ...groupeNom,
          unite: commune,
          // Unité commune, abrégée, écrite une fois après les liens.
          uniteCourte: commune ? abregerUnite(commune) : null,
          dosages: ordonnes.map((entree) => ({
            id: entree.id,
            // Complément du dosage, en infobulle.
            detail: commune ? entree.lu.detail : null,
            // Sans dosage lisible : dénomination entière, seule à distinguer les spécialités.
            libelle: commune ? entree.lu.chiffre : (entree.dosage || entree.denomination),
            // Texte du lien : le chiffre si l'unité est commune, sinon le dosage entier ;
            // « Fiche » s'il n'y a pas de dosage.
            etiquette: commune
              ? entree.lu.chiffre
              : (entree.dosage ? abregerUnite(entree.dosage) : 'Fiche'),
            denomination: entree.denomination,
          })),
        };
      }),
    }));
}
