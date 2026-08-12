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

/**
 * Ce qu'il faut ouvrir pour qu'une charnière ait quelque chose à montrer.
 *
 * « 6. Données pharmaceutiques » n'a pas de contenu propre : son contenu, ce
 * sont 6.1 à 6.6, qui la suivent comme frères. Cliquer dessus dans un sommaire
 * veut dire « montre-moi la rubrique 6 » — sans quoi le clic ne fait rien de
 * visible et l'on croit le lien mort. On s'arrête au premier titre de même
 * rang, qui appartient déjà à la rubrique suivante.
 */
function sousRubriques(charniere) {
  const suite = [];
  for (let n = charniere.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.classList.contains('charniere') || n.classList.contains('rub-n1')) break;
    if (n.tagName === 'DETAILS') suite.push(n);
  }
  return suite;
}

/** Le titre visible d'une cible : c'est lui qui porte la marge d'ancrage. */
function titreDe(cible) {
  return cible.tagName === 'DETAILS' ? cible.querySelector(':scope > summary') ?? cible : cible;
}

/** Rend visible ce que désigne une ancre : onglet, puis blocs englobants. */
function reveler(id) {
  const cible = id && document.getElementById(id);
  if (!cible) return null;

  const panneau = cible.closest('[role="tabpanel"]');
  const indice = panneaux.indexOf(panneau);
  if (indice !== -1) activerOnglet(indice);

  // La cible peut être elle-même un <details> — une rubrique, une section.
  for (let n = cible; n; n = n.parentElement) {
    if (n.tagName === 'DETAILS') n.open = true;
  }

  if (cible.classList.contains('charniere')) {
    for (const d of sousRubriques(cible)) d.open = true;
  }

  return cible;
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

// ---------------------------------------------------------------------------
// Tableaux du document : enveloppe de défilement.
//
// Un tableau de posologie a quatre colonnes ; sur un téléphone il ne rentre
// pas. Écrasé, il rend une dose illisible — ce qui est pire qu'une dose qu'il
// faut aller chercher en faisant glisser. On l'enveloppe donc dans un
// conteneur qui défile, la première colonne restant collée à gauche pour
// qu'on sache toujours à quel poids se rapporte le « 3000 mg » qu'on lit.
//
// Fait ici et non dans le gabarit : le HTML des rubriques vient de la BDPM,
// on ne le réécrit pas au découpage pour un besoin d'affichage.

const enveloppes = [];

for (const table of document.querySelectorAll(
  '.rubrique-corps table, .document-corps table',
)) {
  if (table.parentElement?.classList.contains('table-defilante')) continue;
  const enveloppe = document.createElement('div');
  enveloppe.className = 'table-defilante';
  table.replaceWith(enveloppe);
  enveloppe.append(table);
  enveloppes.push(enveloppe);
}

// Un conteneur qui défile doit pouvoir être atteint au clavier, sinon son
// contenu est hors de portée de qui ne se sert pas d'une souris. Mais on ne
// pose l'arrêt de tabulation que s'il y a vraiment quelque chose à faire
// défiler : sur un large écran, les onze tableaux d'un RCP ajouteraient onze
// arrêts qui ne mènent nulle part.
function reglerDefilement() {
  for (const e of enveloppes) {
    const deborde = e.scrollWidth > e.clientWidth + 1;
    if (deborde === (e.tabIndex === 0)) continue;
    if (deborde) {
      e.tabIndex = 0;
      e.setAttribute('role', 'region');
      e.setAttribute('aria-label', 'Tableau, défilement horizontal');
    } else {
      e.removeAttribute('tabindex');
      e.removeAttribute('role');
      e.removeAttribute('aria-label');
    }
  }
}

if (enveloppes.length > 0) {
  let enAttente = false;
  const bientot = () => {
    if (enAttente) return;
    enAttente = true;
    requestAnimationFrame(() => { enAttente = false; reglerDefilement(); });
  };

  addEventListener('resize', bientot, { passive: true });
  // Une rubrique fermée mesure zéro : c'est à son ouverture qu'on peut savoir
  // si son tableau déborde.
  documents?.addEventListener('toggle', bientot, true);
  for (const onglet of onglets) onglet.addEventListener('click', bientot);
  bientot();
}

// ---------------------------------------------------------------------------
// Rail : reflet de la page, jamais un second modèle.
//
// Deux liens seulement entre le rail et l'accordéon, et ils vont dans le même
// sens : le rail montre le plan du document affiché, et surligne la rubrique
// en cours de lecture. Il ne décide de rien — ses liens sont des ancres, que
// `reveler` sait déjà déplier avant d'y conduire.

const rail = document.querySelector('.rail');

if (rail && documents) {
  const jeux = [...rail.querySelectorAll('.rail-sous')];

  // Le plan suit l'onglet. Sans ça, le rail nommerait les rubriques d'un
  // document caché — le pire défaut possible pour un sommaire.
  const suivreOnglet = () => {
    const actif = onglets.findIndex((o) => o.getAttribute('aria-selected') === 'true');
    const type = panneaux[actif]?.dataset.type;
    for (const jeu of jeux) jeu.hidden = type ? jeu.dataset.doc !== type : false;
  };

  for (const onglet of onglets) onglet.addEventListener('click', suivreOnglet);
  for (const panneau of panneaux) panneau?.addEventListener('beforematch', suivreOnglet);
  if (jeux.length > 1) suivreOnglet();

  // --- Repère de lecture ---------------------------------------------------

  // Le rail n'existe qu'au-delà de 1200 px : inutile de mesurer quoi que ce
  // soit sur un téléphone, où la barre collante fait déjà ce travail.
  const large = matchMedia('(min-width: 75rem)');
  let cibles = null;
  const perimerCibles = () => { cibles = null; };

  const paires = () => {
    if (!cibles) {
      cibles = [];
      for (const lien of rail.querySelectorAll('.rail-plan .rail-lien[href^="#"]')) {
        if (lien.closest('[hidden]')) continue;
        const cible = document.getElementById(decodeURIComponent(lien.hash.slice(1)));
        if (cible) cibles.push({ lien, cible });
      }
      // Ordre du document, et non celui du balisage : les rubriques sont
      // imbriquées sous « Documents » alors qu'elles le suivent dans la page.
      cibles.sort((a, b) => (
        a.cible.compareDocumentPosition(b.cible) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      ));
    }
    return cibles;
  };

  let marque = null;

  const marquer = (lien) => {
    if (lien === marque) return;
    marque?.classList.remove('rail-ici');
    lien?.classList.add('rail-ici');
    marque = lien;
  };

  /**
   * Le seuil doit tomber *sous* l'endroit où un titre ancré vient se poser.
   *
   * Les titres portent `scroll-margin-top: barre + sp-2`, soit une vingtaine de
   * pixels de plus que le bas de la barre. Un seuil calé sur la barre plaçait
   * donc le titre qu'on venait d'atteindre juste en dessous, et le repère
   * restait sur le précédent : on cliquait sur 7, le rail marquait 5.
   */
  const seuilDeLecture = () => (barre?.getBoundingClientRect().bottom ?? 0) + 24;

  const peindre = () => {
    if (!large.matches) return;
    const seuil = seuilDeLecture();

    const liste = paires();
    let trouve = null;
    for (const { lien, cible } of liste) {
      if (cible.getBoundingClientRect().top > seuil) break;
      trouve = lien;
    }

    // Tout est encore sous le seuil — on est en haut de page : c'est la
    // première entrée qui vaut, pas aucune.
    marquer(trouve ?? liste[0]?.lien ?? null);
  };

  let differe = false;
  const bientot = () => {
    if (differe) return;
    differe = true;
    requestAnimationFrame(() => { differe = false; peindre(); });
  };

  const rafraichir = () => { perimerCibles(); bientot(); };

  /**
   * Le clic du rail fait le déplacement lui-même.
   *
   * Laissé au navigateur, il calculait la position de l'ancre *avant* que
   * `reveler` n'ouvre les blocs qui la précèdent : la page s'arrêtait là où la
   * cible était au moment du clic, pas là où elle a fini. On ouvre d'abord, on
   * se déplace ensuite, et le repère se pose sans attendre le défilement —
   * cliquer sur une entrée doit la marquer, pas marquer la précédente.
   */
  rail.addEventListener('click', (e) => {
    const lien = e.target.closest('.rail-plan .rail-lien[href^="#"]');
    if (!lien) return;

    const id = decodeURIComponent(lien.hash.slice(1));
    const cible = reveler(id);
    if (!cible) return;

    e.preventDefault();
    marquer(lien);
    titreDe(cible).scrollIntoView({ block: 'start' });
    // L'adresse suit, sans empiler une entrée d'historique par rubrique lue.
    history.replaceState(null, '', `#${id}`);
    perimerCibles();
  });

  addEventListener('scroll', bientot, { passive: true });
  addEventListener('resize', rafraichir, { passive: true });
  large.addEventListener('change', rafraichir);
  documents.addEventListener('toggle', rafraichir, true);
  for (const onglet of onglets) onglet.addEventListener('click', rafraichir);

  peindre();
}
