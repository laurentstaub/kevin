/**
 * Apparence : automatique (réglage du système), claire ou sombre.
 * Un bouton par page, qui passe d'un état au suivant. Le choix est mémorisé
 * dans le navigateur ; en automatique, rien n'est écrit. Le gabarit applique
 * le choix mémorisé avant les feuilles de style, pour ne pas voir la page
 * changer au chargement.
 */
(function () {
  const ETATS = ['auto', 'light', 'dark'];
  const LIBELLES = { auto: 'Auto', light: 'Clair', dark: 'Sombre' };
  const CLE = 'apparence';
  const racine = document.documentElement;
  const boutons = document.querySelectorAll('.theme');
  if (boutons.length === 0) return;

  const lire = () => {
    try {
      const valeur = localStorage.getItem(CLE);
      return ETATS.includes(valeur) ? valeur : 'auto';
    } catch {
      return 'auto';
    }
  };

  const ecrire = (etat) => {
    try {
      if (etat === 'auto') localStorage.removeItem(CLE);
      else localStorage.setItem(CLE, etat);
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour la page.
    }
  };

  const appliquer = (etat) => {
    if (etat === 'auto') delete racine.dataset.theme;
    else racine.dataset.theme = etat;
    boutons.forEach((bouton) => {
      bouton.textContent = LIBELLES[etat];
      bouton.setAttribute('aria-label', `Apparence : ${LIBELLES[etat].toLowerCase()}`);
    });
  };

  appliquer(lire());
  boutons.forEach((bouton) => {
    bouton.hidden = false;
    bouton.addEventListener('click', () => {
      const suivant = ETATS[(ETATS.indexOf(lire()) + 1) % ETATS.length];
      ecrire(suivant);
      appliquer(suivant);
    });
  });
})();
