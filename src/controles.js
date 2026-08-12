/**
 * Contrôles de fraîcheur des données.
 *
 * Une base dérivée vieillit en silence. La collecte des documents s'est arrêtée
 * à la charnière 2023-2024 et personne ne l'a su pendant deux ans ; le
 * constructeur de correspondances ATC énumérait les millésimes de 2014 à 2024
 * en dur, et a cessé de lire les nouveaux le 1er janvier 2025. Même maladie
 * chaque fois : rien ne mesurait la fraîcheur, donc rien ne pouvait s'allumer.
 *
 * Ce module ne connaît ni base ni requête. On lui passe des cohortes déjà
 * comptées, il rend un verdict. C'est ce qui le rend testable, et c'est ce qui
 * permet de le brancher sur autre chose que les documents.
 */

/** Part d'une cohorte qui a ce qu'elle devrait avoir. */
export const couverture = (c) => {
  const total = c.avec + c.sans;
  return total === 0 ? null : c.avec / total;
};

export function mediane(nombres) {
  const tri = [...nombres].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (tri.length === 0) return null;
  const milieu = Math.floor(tri.length / 2);
  return tri.length % 2 ? tri[milieu] : (tri[milieu - 1] + tri[milieu]) / 2;
}

/**
 * Détecte une falaise : une population récente très en dessous de la norme
 * établie par les anciennes.
 *
 * Un seuil absolu — « au moins 90 % de couverture » — ne voit rien : il restait
 * vrai pendant que l'année 2025 était à zéro, parce que les vingt années
 * précédentes portaient la moyenne. C'est la comparaison entre cohortes qui
 * révèle l'arrêt, et elle a l'avantage de ne pas avoir à savoir quand la
 * collecte aurait dû tourner.
 *
 * La norme se calcule en écartant les périodes récentes — celles qu'on juge —
 * sans quoi une collecte arrêtée abaisserait la référence qui doit la
 * condamner. Et les cohortes trop petites sont ignorées : trois AMM dont aucune
 * n'a de document ne prouvent rien.
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
    .filter((c) => Number.isFinite(c.periode) && c.avec + c.sans >= volumeMin)
    .map((c) => ({ ...c, couverture: couverture(c) }))
    .sort((a, b) => b.periode - a.periode);

  const anciennes = series.slice(recentes);
  const reference = mediane(anciennes.map((c) => c.couverture));

  // Sans norme établie, on ne peut rien condamner. Le dire vaut mieux que
  // rendre un verdict vert sur une base qu'on n'a pas su juger.
  if (reference === null) {
    return { reference: null, etat: 'indeterminable', ruptures: [], alertes: [], derniereSaine: null };
  }
  if (reference < 0.5) {
    return { reference, etat: 'norme trop basse', ruptures: [], alertes: [], derniereSaine: null };
  }

  const ruptures = series.filter((c) => c.couverture < reference * seuilRupture);
  const alertes = series.filter(
    (c) => c.couverture >= reference * seuilRupture && c.couverture < reference * seuilAlerte,
  );
  const derniereSaine = series.find((c) => c.couverture >= reference * seuilAlerte)?.periode ?? null;

  return {
    reference,
    etat: ruptures.length > 0 ? 'rupture' : alertes.length > 0 ? 'alerte' : 'ok',
    ruptures,
    alertes,
    derniereSaine,
  };
}

/**
 * Un plancher simple, pour ce qui n'a pas de cohortes — la part de documents
 * effectivement découpés, par exemple. À n'employer que là où la population est
 * homogène : sur une population qui se renouvelle, c'est la falaise qu'il faut.
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

/**
 * Âge d'une donnée, en jours. `null` si la date manque — ce qui est un défaut
 * en soi : une source sans date ne peut pas être jugée périmée.
 */
export function age(date, maintenant) {
  if (!date) return null;
  const jours = (maintenant.getTime() - new Date(date).getTime()) / 86400000;
  return Math.floor(jours);
}
