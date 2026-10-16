// Apparence choisie (auto, clair, sombre), posée avant les feuilles de style :
// pas de page qui change de couleur au chargement. Chargé dans <head>, sans
// `defer`. Le bouton qui change ce choix est dans theme.js.
// Un autre onglet ouvert suit le choix fait ailleurs : le navigateur l'en
// avertit par `storage`. Même fichier que Dispomed, où une page en
// surimpression (iframe) suit ainsi la page qui l'affiche.
(function () {
  const CLE = 'apparence';
  const racine = document.documentElement;
  const poser = (valeur) => {
    if (valeur === 'light' || valeur === 'dark') racine.dataset.theme = valeur;
    else delete racine.dataset.theme;
  };
  try {
    poser(localStorage.getItem(CLE));
  } catch {
    // Stockage indisponible : le réglage du système s'applique.
  }
  window.addEventListener('storage', (evenement) => {
    if (evenement.key === CLE) poser(evenement.newValue);
  });
})();
