// Sections repliables, onglets, et ouverture au bon endroit depuis une ancre.
//
// Toute la fiche est fermée au chargement. Le document replié est le sommaire de la
// page entière : un lien qui mène à un contenu replié — section, onglet
// inactif, rubrique — doit ouvrir ce qu'il faut avant que le navigateur
// n'aille à l'ancre, sinon le lecteur atterrit sur du vide.
//
// Sans JavaScript la fiche reste utilisable : les blocs repliables sont des
// <details> natifs, les onglets des <button> sur des sections déjà rendues.

const documents = document.querySelector('#documents');
const onglets = documents ? [...documents.querySelectorAll('.onglet')] : [];
const panneaux = onglets.map((o) => document.getElementById(o.getAttribute('aria-controls')));

// Un panneau replié reste « until-found » : caché, mais fouillé par la
// recherche du navigateur, qui l'ouvrira si le mot cherché s'y trouve. Là où
// la valeur n'est pas comprise, une chaîne non vide vaut `hidden` — le
// comportement d'avant, sans rien casser.
function activerOnglet(indice) {
  onglets.forEach((onglet, i) => {
    const actif = i === indice;
    onglet.setAttribute('aria-selected', actif ? 'true' : 'false');
    onglet.tabIndex = actif ? 0 : -1;
    if (panneaux[i]) panneaux[i].hidden = actif ? false : 'until-found';
  });
}

// Quand le navigateur révèle un panneau parce qu'il y a trouvé le mot cherché,
// il retire l'attribut lui-même. Sans ce relais, le panneau s'afficherait avec
// l'onglet d'à côté marqué actif, et deux documents seraient visibles à la
// fois : l'état du groupe d'onglets doit suivre ce que le navigateur a fait.
panneaux.forEach((panneau, i) => {
  if (panneau) panneau.addEventListener('beforematch', () => activerOnglet(i));
});

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

// ---------------------------------------------------------------------------
// Repère de lecture dans la barre collante.
//
// Une rubrique de RCP fait couramment quatre écrans. Passé le premier, son
// titre est sorti par le haut et le plan avec lui : c'est le seul moment de la
// page où l'on ne sait plus où l'on est. Le titre de la rubrique prend alors la
// place du nom du produit — qui, lui, n'a pas changé depuis le chargement — et
// la rend au défilement inverse. Une fente, une information, toujours la plus
// locale.
//
// Tant que tout est replié, rien ne s'affiche : la liste fermée tient sur un
// écran et se suffit.

const repere = document.querySelector('.barre-repere');
const barreTitre = document.querySelector('.barre-titre');
const barre = document.querySelector('.barre');

if (repere && barre && documents) {
  // La liste des titres candidats ne change qu'à l'ouverture d'une rubrique ou
  // au changement d'onglet. La recalculer à chaque image de défilement serait
  // une requête DOM par frame pour un résultat presque toujours identique.
  let candidats = null;
  const perimer = () => { candidats = null; };

  const titres = () => {
    if (!candidats) {
      candidats = [...documents.querySelectorAll(
        '[role="tabpanel"]:not([hidden]) details.rubrique[open] > .rubrique-tete',
      )];
    }
    return candidats;
  };

  documents.addEventListener('toggle', perimer, true);

  let courant = null;

  const montrer = (titre) => {
    if (titre === courant) return;
    courant = titre;

    if (!titre) {
      repere.hidden = true;
      if (barreTitre) barreTitre.hidden = false;
      return;
    }

    const num = titre.querySelector('.num');
    const lab = titre.querySelector('.lab');
    repere.textContent = [num?.textContent, lab?.textContent]
      .filter(Boolean).join(' ').trim();
    repere.hidden = false;
    if (barreTitre) barreTitre.hidden = true;
  };

  const situer = () => {
    const seuil = barre.getBoundingClientRect().bottom;
    let trouve = null;

    for (const titre of titres()) {
      const haut = titre.getBoundingClientRect().top;
      if (haut > seuil) break;
      // Le titre est passé sous la barre, mais sa rubrique peut être finie :
      // dans ce cas on ne lit plus dedans, et le repère mentirait.
      if (titre.parentElement.getBoundingClientRect().bottom > seuil) trouve = titre;
    }

    montrer(trouve);
  };

  let attend = false;
  const auProchainRendu = () => {
    if (attend) return;
    attend = true;
    requestAnimationFrame(() => { attend = false; situer(); });
  };

  addEventListener('scroll', auProchainRendu, { passive: true });
  addEventListener('resize', auProchainRendu, { passive: true });
  documents.addEventListener('toggle', auProchainRendu, true);

  // Changer d'onglet ne fait pas défiler la page, mais change ce qu'elle
  // montre : le repère doit suivre, sous peine de nommer une rubrique cachée.
  for (const onglet of onglets) {
    onglet.addEventListener('click', () => { perimer(); auProchainRendu(); });
  }

  // Un repère qui dit où l'on est sans permettre d'en sortir est une
  // décoration : le clic remonte au titre, donc au plan, sans quitter la page.
  repere.addEventListener('click', () => {
    courant?.scrollIntoView({ block: 'start' });
  });

  situer();
}
