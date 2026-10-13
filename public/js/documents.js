// Sections repliables, onglets, et ouverture au bon endroit depuis une ancre.
// La fiche est repliée au chargement : un lien vers un contenu replié doit
// l'ouvrir avant que le navigateur n'aille à l'ancre.
// Sans JavaScript, les <details> natifs et les sections rendues suffisent.

const documents = document.querySelector('#documents');
const onglets = documents ? [...documents.querySelectorAll('.onglet[role="tab"]')] : [];
const panneaux = onglets.map((onglet) => document.getElementById(onglet.getAttribute('aria-controls')));

// « until-found » : caché mais trouvable par la recherche du navigateur.
// Non supporté, il vaut `hidden`.
function activerOnglet(indice) {
  onglets.forEach((onglet, i) => {
    const actif = i === indice;
    onglet.setAttribute('aria-selected', actif ? 'true' : 'false');
    onglet.tabIndex = actif ? 0 : -1;
    if (panneaux[i]) panneaux[i].hidden = actif ? false : 'until-found';
  });
}

// Le navigateur révèle seul un panneau trouvé : les onglets doivent suivre,
// sinon deux documents s'affichent à la fois.
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
 * Sous-rubriques d'une charnière (ex. 6.1 à 6.6 pour « 6. »), qui la suivent
 * comme frères, jusqu'au prochain titre de même rang.
 */
function sousRubriques(charniere) {
  const suite = [];
  for (let voisin = charniere.nextElementSibling; voisin; voisin = voisin.nextElementSibling) {
    if (voisin.classList.contains('charniere') || voisin.classList.contains('rub-n1')) break;
    if (voisin.tagName === 'DETAILS') suite.push(voisin);
  }
  return suite;
}

/** Titre visible d'une cible : il porte la marge d'ancrage. */
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

  // La cible peut être elle-même un <details>.
  for (let noeud = cible; noeud; noeud = noeud.parentElement) {
    if (noeud.tagName === 'DETAILS') noeud.open = true;
  }

  if (cible.classList.contains('charniere')) {
    for (const rubrique of sousRubriques(cible)) rubrique.open = true;
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

// « Tout déplier » / « Tout replier ».
for (const bouton of document.querySelectorAll('.deplier')) {
  bouton.addEventListener('click', () => {
    const panneau = document.getElementById(bouton.dataset.cible);
    if (!panneau) return;

    const blocs = [...panneau.querySelectorAll('details.rubrique')];
    const ouvrir = blocs.some((bloc) => !bloc.open);
    for (const bloc of blocs) bloc.open = ouvrir;
    bouton.textContent = ouvrir ? 'Tout replier' : 'Tout déplier';
  });
}

// ---------------------------------------------------------------------------
// Repère de lecture : quand le titre de la rubrique en cours est sorti par le
// haut, il s'affiche à côté du nom collé (« Lyrica 100 mg › 4.5 Interactions »).
// Rien ne s'affiche tant que tout est replié.

const repere = document.querySelector('.repere-rubrique');
const barre = document.querySelector('.barre');
const bande = document.querySelector('.signaletique');
const titreColle = document.querySelector('.titre-colle');

if (repere && barre && documents) {
  // Mis en cache : ne change qu'à l'ouverture d'une rubrique ou d'un onglet.
  let candidats = null;
  const perimer = () => { candidats = null; };

  const titres = () => {
    if (!candidats) {
      candidats = [...documents.querySelectorAll(
        // Avec ou sans onglets : un document seul n'est pas un tabpanel.
        '.document:not([hidden]) details.rubrique[open] > .rubrique-tete',
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
      return;
    }

    const num = titre.querySelector('.num');
    const lab = titre.querySelector('.lab');
    repere.textContent = [num?.textContent, lab?.textContent]
      .filter(Boolean).join(' ').trim();
    repere.hidden = false;
  };

  const situer = () => {
    // Sous la barre et, quand elle colle, sous la bande signalétique.
    const seuil = (bande ?? barre).getBoundingClientRect().bottom;
    let trouve = null;

    for (const titre of titres()) {
      const haut = titre.getBoundingClientRect().top;
      if (haut > seuil) break;
      // Titre passé sous la barre, mais rubrique peut-être déjà finie.
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

  // Changer d'onglet ne fait pas défiler, mais change la rubrique visible.
  for (const onglet of onglets) {
    onglet.addEventListener('click', () => { perimer(); auProchainRendu(); });
  }

  // Le clic remonte au titre de la rubrique.
  repere.addEventListener('click', () => {
    courant?.scrollIntoView({ block: 'start' });
  });

  situer();
}

// ---------------------------------------------------------------------------
// Tableaux du document : enveloppe de défilement horizontal, pour ne pas
// écraser une posologie sur téléphone.
// Fait ici et non dans le gabarit : le HTML des rubriques vient de la BDPM.

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

// Focalisable au clavier seulement s'il déborde, pour éviter des arrêts de
// tabulation inutiles.
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
  // Une rubrique fermée mesure zéro : mesurer à l'ouverture.
  documents?.addEventListener('toggle', bientot, true);
  for (const onglet of onglets) onglet.addEventListener('click', bientot);
  bientot();
}

// ---------------------------------------------------------------------------
// Rail : reflet de la page, jamais un second modèle.
// Il montre le plan du document affiché et surligne la rubrique en cours ;
// ses liens sont des ancres que `reveler` déplie.

const rail = document.querySelector('.rail');

if (rail && documents) {
  const jeux = [...rail.querySelectorAll('.rail-sous')];

  // Le plan suit l'onglet actif.
  const suivreOnglet = () => {
    const actif = onglets.findIndex((onglet) => onglet.getAttribute('aria-selected') === 'true');
    const type = panneaux[actif]?.dataset.type;
    for (const jeu of jeux) jeu.hidden = type ? jeu.dataset.doc !== type : false;
  };

  for (const onglet of onglets) onglet.addEventListener('click', suivreOnglet);
  for (const panneau of panneaux) panneau?.addEventListener('beforematch', suivreOnglet);
  if (jeux.length > 1) suivreOnglet();

  // --- Repère de lecture ---------------------------------------------------

  // Le rail n'existe qu'au-delà de 1200 px.
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
      // Ordre du document, pas du balisage : les rubriques sont imbriquées
      // sous « Documents » mais le suivent dans la page.
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
   * Seuil sous l'endroit où se pose un titre ancré (`scroll-margin-top:
   * barre + sp-2`), sinon le repère reste sur la rubrique précédente.
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

    // En haut de page : la première entrée.
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
   * Le clic du rail fait le défilement lui-même : le navigateur calcule la
   * position de l'ancre avant que `reveler` n'ouvre les blocs qui précèdent.
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
    // Sans empiler d'entrée d'historique.
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

// ---------------------------------------------------------------------------
// Charnières : ouvrir et refermer une rubrique entière (ex. 6.1 à 6.6) d'un geste.
// Bouton créé ici et non dans le gabarit : sans JavaScript, il serait inerte.

for (const charniere of document.querySelectorAll('.charniere')) {
  const groupe = sousRubriques(charniere);
  if (groupe.length === 0) continue;

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'charniere-bascule';
  bouton.append(...charniere.childNodes);
  charniere.append(bouton);

  const etat = () => {
    const ouvert = groupe.some((bloc) => bloc.open);
    charniere.classList.toggle('ouverte', ouvert);
    bouton.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    return ouvert;
  };

  bouton.addEventListener('click', () => {
    const fermer = etat();
    for (const bloc of groupe) bloc.open = !fermer;
    etat();
  });

  // L'état suit aussi les ouvertures manuelles des sous-rubriques.
  for (const bloc of groupe) bloc.addEventListener('toggle', etat);

  etat();
}

// ---------------------------------------------------------------------------
// Surlignage de la requête venue de « Dans les documents » (?q=…).
// Mots de 2 lettres et plus, hors mots vides ; accents et pluriels ignorés.
// Approximation du stemming de Postgres : suffixe libre de 0 à 4 lettres.

const MOTS_VIDES = new Set(['au', 'aux', 'avec', 'ce', 'dans', 'de', 'des', 'du', 'en', 'et',
  'la', 'le', 'les', 'ou', 'par', 'pas', 'pour', 'sur', 'un', 'une']);

const ACCENTS = { a: '[aàâä]', e: '[eéèêë]', i: '[iîï]', o: '[oôö]', u: '[uùûü]', c: '[cç]' };

function motifRequete(requete) {
  const racines = requete.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((mot) => mot.length >= 2 && !MOTS_VIDES.has(mot))
    // Pluriel retiré : « pointes » trouve « pointe ».
    .map((mot) => (mot.length > 3 ? mot.replace(/[sx]$/, '') : mot));
  if (racines.length === 0) return null;
  const alternatives = [...new Set(racines)]
    .map((racine) => [...racine].map((lettre) => ACCENTS[lettre] ?? lettre).join(''));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})\\p{L}{0,4}(?![\\p{L}\\p{N}])`, 'giu');
}

function surligner(racine, motif) {
  const marcheur = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
  const noeuds = [];
  while (marcheur.nextNode()) noeuds.push(marcheur.currentNode);

  for (const noeud of noeuds) {
    const texte = noeud.nodeValue;
    motif.lastIndex = 0;
    if (!motif.test(texte)) continue;
    motif.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let debut = 0;
    for (const trouve of texte.matchAll(motif)) {
      fragment.append(texte.slice(debut, trouve.index));
      const marque = document.createElement('mark');
      marque.className = 'surligne';
      marque.textContent = trouve[0];
      fragment.append(marque);
      debut = trouve.index + trouve[0].length;
    }
    fragment.append(texte.slice(debut));
    noeud.replaceWith(fragment);
  }
}

const requete = new URLSearchParams(location.search).get('q');
const motif = requete && motifRequete(requete);

if (motif && documents) {
  for (const article of documents.querySelectorAll('.document')) surligner(article, motif);
  // Premier passage surligné de la rubrique visée, au centre de l'écran.
  const cible = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  cible?.querySelector('mark.surligne')?.scrollIntoView({ block: 'center' });
}

// Dénomination collée : dès qu'elle touche la barre, elle prend fond et filet.
// Observée 1 px sous la barre : collée, ce pixel passe dessous et le ratio chute.
if (titreColle && barre && 'IntersectionObserver' in window
  && getComputedStyle(titreColle).position === 'sticky') {
  const hauteurBarre = Math.ceil(barre.getBoundingClientRect().height);
  titreColle.style.top = `${hauteurBarre - 1}px`;
  new IntersectionObserver(([entree]) => {
    titreColle.classList.toggle('colle', entree.intersectionRatio < 1);
  }, { threshold: [1], rootMargin: `-${hauteurBarre}px 0px 0px 0px` }).observe(titreColle);
}
