// Sommaire actif : surligne dans le rail la rubrique en cours de lecture.
// Sur une fiche dont le RCP fait quarante mille signes, savoir où l'on se
// trouve vaut autant que pouvoir sauter ailleurs.

const rail = document.querySelector('.rail');
if (rail) {
  const liens = [...rail.querySelectorAll('.rail-lien[href^="#"]')];
  const parCible = new Map();

  for (const lien of liens) {
    const cible = document.getElementById(decodeURIComponent(lien.hash.slice(1)));
    if (cible) parCible.set(cible, lien);
  }

  if (parCible.size > 0) {
    const visibles = new Set();

    const peindre = () => {
      // La cible active est la plus haute parmi celles visibles ; à défaut,
      // la dernière franchie vers le haut de la fenêtre.
      let active = null;
      let meilleur = Infinity;

      for (const cible of visibles) {
        const y = cible.getBoundingClientRect().top;
        if (y < meilleur) {
          meilleur = y;
          active = cible;
        }
      }

      if (!active) {
        for (const cible of parCible.keys()) {
          if (cible.getBoundingClientRect().top <= 80) active = cible;
        }
      }

      for (const [cible, lien] of parCible) {
        lien.classList.toggle('actif', cible === active);
      }

      const lienActif = active && parCible.get(active);
      if (lienActif && rail.scrollHeight > rail.clientHeight) {
        const r = lienActif.getBoundingClientRect();
        const cadre = rail.getBoundingClientRect();
        if (r.top < cadre.top || r.bottom > cadre.bottom) {
          lienActif.scrollIntoView({ block: 'nearest' });
        }
      }
    };

    const observateur = new IntersectionObserver(
      (entrees) => {
        for (const entree of entrees) {
          if (entree.isIntersecting) visibles.add(entree.target);
          else visibles.delete(entree.target);
        }
        peindre();
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );

    for (const cible of parCible.keys()) observateur.observe(cible);

    document.addEventListener('scroll', peindre, { passive: true });
    peindre();
  }
}
