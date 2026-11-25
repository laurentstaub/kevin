// Filtre par statut de /vaccins. Le filtrage est en CSS ; ce script reporte
// seulement le choix dans l'adresse, pour qu'un lien ou un rechargement garde
// le filtre. « Tous » est la page sans paramètre.
(() => {
  const filtres = document.querySelector('.frise-filtres');
  if (!filtres) return;
  filtres.addEventListener('change', (evenement) => {
    const adresse = new URL(location.href);
    if (evenement.target.value === 'tous') adresse.searchParams.delete('statut');
    else adresse.searchParams.set('statut', evenement.target.value);
    history.replaceState(null, '', adresse);
  });
})();
