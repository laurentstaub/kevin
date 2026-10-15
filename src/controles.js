/**
 * Contrôles de fraîcheur des données, pour détecter une collecte arrêtée.
 * Sans base ni requête : reçoit des cohortes déjà comptées, rend un verdict.
 */

/** Part d'une cohorte qui a ce qu'elle devrait avoir. */
export const couverture = (cohorte) => {
  const total = cohorte.avec + cohorte.sans;
  return total === 0 ? null : cohorte.avec / total;
};

export function mediane(nombres) {
  const tri = [...nombres].filter((nombre) => Number.isFinite(nombre)).sort((a, b) => a - b);
  if (tri.length === 0) return null;
  const milieu = Math.floor(tri.length / 2);
  return tri.length % 2 ? tri[milieu] : (tri[milieu - 1] + tri[milieu]) / 2;
}

/**
 * Détecte une falaise : des cohortes récentes très en dessous de la norme (médiane
 * des anciennes). Un seuil absolu ne voit pas un arrêt noyé dans la moyenne.
 * Les périodes récentes sont exclues de la norme pour ne pas l'abaisser ; les
 * cohortes trop petites sont ignorées.
 *
 * @param {{periode:number, avec:number, sans:number}[]} cohortes
 * @returns {{reference:number|null, etat:string, ruptures:object[], alertes:object[],
 *            derniereSaine:number|null}}
 */
export function falaise(cohortes, {
  volumeMin = 20,
  seuilRupture = 0.5,
  seuilAlerte = 0.8,
  recentes = 3,
} = {}) {
  const series = (cohortes ?? [])
    .filter((cohorte) => Number.isFinite(cohorte.periode) && cohorte.avec + cohorte.sans >= volumeMin)
    .map((cohorte) => ({ ...cohorte, couverture: couverture(cohorte) }))
    .sort((a, b) => b.periode - a.periode);

  const anciennes = series.slice(recentes);
  const reference = mediane(anciennes.map((ancienne) => ancienne.couverture));

  // Sans norme, verdict « indéterminable » plutôt qu'un faux vert.
  if (reference === null) {
    return { reference: null, etat: 'indeterminable', ruptures: [], alertes: [], derniereSaine: null };
  }
  if (reference < 0.5) {
    return { reference, etat: 'norme trop basse', ruptures: [], alertes: [], derniereSaine: null };
  }

  const ruptures = series.filter((serie) => serie.couverture < reference * seuilRupture);
  const alertes = series.filter(
    (serie) => serie.couverture >= reference * seuilRupture && serie.couverture < reference * seuilAlerte,
  );
  const derniereSaine = series.find((serie) => serie.couverture >= reference * seuilAlerte)?.periode ?? null;

  return {
    reference,
    etat: ruptures.length > 0 ? 'rupture' : alertes.length > 0 ? 'alerte' : 'ok',
    ruptures,
    alertes,
    derniereSaine,
  };
}

/**
 * Plancher simple pour une mesure sans cohortes. Seulement sur une population
 * homogène ; sinon utiliser `falaise`.
 */
export function plancher(mesure, { minimum, libelle }) {
  const part = mesure.total === 0 ? null : mesure.ok / mesure.total;
  return {
    libelle,
    part,
    minimum,
    etat: part === null ? 'indeterminable' : part >= minimum ? 'ok' : 'rupture',
  };
}

/** Âge d'une donnée, en jours ; `null` si la date manque (défaut en soi). */
export function age(date, maintenant) {
  if (!date) return null;
  const jours = (maintenant.getTime() - new Date(date).getTime()) / 86400000;
  return Math.floor(jours);
}
