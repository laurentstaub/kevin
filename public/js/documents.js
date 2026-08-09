// Sections repliables, onglets, et ouverture au bon endroit depuis le rail.
//
// Toute la fiche est fermée au chargement. Le rail reste le sommaire de la
// page entière : un lien qui mène à un contenu replié — section, onglet
// inactif, rubrique — doit ouvrir ce qu'il faut avant que le navigateur
// n'aille à l'ancre, sinon le lecteur atterrit sur du vide.
//
// Sans JavaScript la fiche reste utilisable : les blocs repliables sont des
// <details> natifs, les onglets des <button> sur des sections déjà rendues.

const documents = document.querySelector('#documents');
const onglets = documents ? [...documents.querySelectorAll('.onglet')] : [];
const panneaux = onglets.map((o) => document.getElementById(o.getAttribute('aria-controls')));

function activerOnglet(indice) {
  onglets.forEach((onglet, i) => {
    const actif = i === indice;
    onglet.setAttribute('aria-selected', actif ? 'true' : 'false');
    onglet.tabIndex = actif ? 0 : -1;
    if (panneaux[i]) panneaux[i].hidden = !actif;
  });
}

onglets.forEach((onglet, i) => {
  onglet.addEventListener('click', () => activerOnglet(i));
  onglet.addEventListener('keydown', (e) => {
    const pas = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!pas) return;
    e.preventDefault();
    const suivant = (i + pas + onglets.length) % onglets.length;
    activerOnglet(suivant);
    onglets[suivant].focus();
  });
});

/** Rend visible ce que désigne une ancre : onglet, puis blocs englobants. */
function reveler(id) {
  const cible = id && document.getElementById(id);
  if (!cible) return;

  const panneau = cible.closest('[role="tabpanel"]');
  const indice = panneaux.indexOf(panneau);
  if (indice !== -1) activerOnglet(indice);

  // La cible peut être elle-même un <details> — une rubrique, une section.
  for (let n = cible; n; n = n.parentElement) {
    if (n.tagName === 'DETAILS') n.open = true;
  }
}

document.addEventListener('click', (e) => {
  const lien = e.target.closest('a[href^="#"]');
  if (lien) reveler(decodeURIComponent(lien.hash.slice(1)));
});

window.addEventListener('hashchange', () => {
  reveler(decodeURIComponent(location.hash.slice(1)));
});

if (location.hash) reveler(decodeURIComponent(location.hash.slice(1)));

// « Tout déplier » bascule : un RCP entier se lit parfois d'un trait.
for (const bouton of document.querySelectorAll('.deplier')) {
  bouton.addEventListener('click', () => {
    const panneau = document.getElementById(bouton.dataset.cible);
    if (!panneau) return;

    const blocs = [...panneau.querySelectorAll('details.rubrique')];
    const ouvrir = blocs.some((d) => !d.open);
    for (const d of blocs) d.open = ouvrir;
    bouton.textContent = ouvrir ? 'Tout replier' : 'Tout déplier';
  });
}
