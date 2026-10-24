// Sections repliables, onglets, et ouverture au bon endroit depuis une ancre.
// La fiche est repliée au chargement : un lien vers un contenu replié doit
// l'ouvrir avant que le navigateur n'aille à l'ancre.
// Sans JavaScript, les <details> natifs et les sections rendues suffisent.

/**
 * Identifiant visé par une ancre (« #rcp-12 »). Une ancre mal encodée (« #a% »)
 * ferait lever decodeURIComponent et arrêterait tout le script : elle est lue telle quelle.
 */
function idDeAncre(hash) {
  const brut = String(hash ?? '').replace(/^#/, '');
  try {
    return decodeURIComponent(brut);
  } catch {
    return brut;
  }
}

const documents = document.querySelector('#documents');
const onglets = [...document.querySelectorAll('.fiche-nav .onglet[role="tab"]')];
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
  if (lien) reveler(idDeAncre(lien.hash));
});

window.addEventListener('hashchange', () => {
  reveler(idDeAncre(location.hash));
});

if (location.hash) reveler(idDeAncre(location.hash));

// Bascules de la barre de la fiche : chaque bouton ouvre ou ferme son bloc.
// L'état suit le bloc, qu'il soit ouvert d'ici, par la bande, le rail ou une ancre.
for (const bouton of document.querySelectorAll('.bascule')) {
  const bloc = document.getElementById(bouton.getAttribute('aria-controls'));
  if (!bloc) continue;
  bouton.addEventListener('click', () => { bloc.open = !bloc.open; });
  bloc.addEventListener('toggle', () => bouton.setAttribute('aria-expanded', String(bloc.open)));
}

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
// Éléments collants : la barre, la dénomination et la bande. Le titre de la
// rubrique en cours colle sous eux par le seul CSS (product.css).

const barre = document.querySelector('.barre');
const titreColle = document.querySelector('.titre-colle');

// Filtre du document, dans la barre sous le champ de recherche : révélé avant
// toute mesure, puisqu'il donne une seconde ligne à la barre.
const filtre = documents ? barre?.querySelector('.filtre-doc') : null;
if (filtre) filtre.hidden = false;

// Hauteur réelle de la barre (sa ligne, sans son filet, que les éléments
// collés dessous recouvrent) : titres collants et ancres s'en écartent
// d'autant (--barre-h). Les fonctions de `suiviBarre` suivent ses changements.
const ligneBarre = barre?.querySelector('.barre-inner');
const suiviBarre = [];
let hauteurBarre = 0;
if (ligneBarre) {
  const mesurerBarre = () => {
    const hauteur = Math.ceil(ligneBarre.getBoundingClientRect().height);
    if (!hauteur || hauteur === hauteurBarre) return;
    hauteurBarre = hauteur;
    document.documentElement.style.setProperty('--barre-h', `${hauteur}px`);
    for (const suivre of suiviBarre) suivre(hauteur);
  };
  mesurerBarre();
  if ('ResizeObserver' in window) new ResizeObserver(mesurerBarre).observe(ligneBarre);
}

// Bande repliée sur plusieurs lignes : sa hauteur réelle remplace celle d'une
// ligne dans --signal-h, dont dépendent les titres collants et les ancres.
const bande = document.querySelector('.signaletique-inner');
if (bande) {
  const mesurer = () => {
    const hauteur = bande.getBoundingClientRect().height;
    if (hauteur > 0) document.documentElement.style.setProperty('--signal-h', `${hauteur}px`);
  };
  mesurer();
  if ('ResizeObserver' in window) new ResizeObserver(mesurer).observe(bande);
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
        const cible = document.getElementById(idDeAncre(lien.hash));
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

    const id = idDeAncre(lien.hash);
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

/** Enveloppe chaque occurrence du motif dans un <mark> de la classe donnée. */
function surligner(racine, motif, classe = 'surligne') {
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
      marque.className = classe;
      marque.textContent = trouve[0];
      fragment.append(marque);
      debut = trouve.index + trouve[0].length;
    }
    fragment.append(texte.slice(debut));
    noeud.replaceWith(fragment);
  }
}

/**
 * Ajoute au motif les formes exactes retenues par Postgres (data-mots) :
 * racines, synonymes et élargissements que la saisie ne contient pas.
 */
function motifComplet(requete, mots) {
  const base = requete && motifRequete(requete);
  const echapper = (mot) => mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const formes = (mots ?? []).filter((mot) => mot.length >= 2).map(echapper);
  if (formes.length === 0) return base;
  const exactes = `(?<![\\p{L}\\p{N}])(?:${formes.join('|')})(?![\\p{L}\\p{N}])`;
  return new RegExp(base ? `${base.source}|${exactes}` : exactes, 'giu');
}

const motsTrouves = (() => {
  try { return JSON.parse(documents?.dataset.mots ?? '[]'); } catch { return []; }
})();

/**
 * Le passage où la recherche a trouvé le plus de termes différents (le premier
 * à égalité) : « insuffisance hépatique sévère » réunis, plutôt qu'un
 * « sévère » isolé plus haut. Termes comparés sans accents ni pluriel.
 */
function meilleurPassage(racine) {
  const forme = (texte) => texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[sx]$/, '');
  let meilleur = null;
  let score = 0;
  for (const bloc of racine.querySelectorAll('p, li, td, h5, h6')) {
    const marques = bloc.querySelectorAll('mark.surligne');
    if (marques.length === 0) continue;
    const distincts = new Set([...marques].map((marque) => forme(marque.textContent))).size;
    if (distincts > score) {
      score = distincts;
      meilleur = marques[0];
    }
  }
  return meilleur ?? racine.querySelector('mark.surligne');
}

const requete = new URLSearchParams(location.search).get('q');
const motif = (requete || motsTrouves.length > 0) && motifComplet(requete, motsTrouves);

if (motif && documents) {
  for (const article of documents.querySelectorAll('.document')) surligner(article, motif);
  // Premier passage surligné de la rubrique visée, au centre de l'écran.
  // Après le chargement : le navigateur saute lui-même à l'ancre une fois la
  // page chargée, ce qui annulait un défilement fait plus tôt (on restait en
  // tête de rubrique, loin du terme trouvé).
  const cible = location.hash && document.getElementById(idDeAncre(location.hash));
  const premier = cible && meilleurPassage(cible);
  if (premier) {
    const centrer = () => requestAnimationFrame(() => premier.scrollIntoView({ block: 'center' }));
    if (document.readyState === 'complete') centrer();
    else addEventListener('load', centrer, { once: true });
  }
}

// Dénomination collée : dès qu'elle touche la barre, elle prend fond et filet.
// Observée 1 px sous la barre : collée, ce pixel passe dessous et le ratio chute.
if (titreColle && hauteurBarre && 'IntersectionObserver' in window
  && getComputedStyle(titreColle).position === 'sticky') {
  let observateur = null;
  const suivre = (hauteur) => {
    titreColle.style.top = `${hauteur}px`;
    observateur?.disconnect();
    observateur = new IntersectionObserver(([entree]) => {
      titreColle.classList.toggle('colle', entree.intersectionRatio < 1);
    }, { threshold: [1], rootMargin: `-${hauteur + 1}px 0px 0px 0px` });
    observateur.observe(titreColle);
  };
  suivre(hauteurBarre);
  suiviBarre.push(suivre);
}

// Titre de rubrique collé puis replié : la rubrique se referme au-dessus de
// l'écran ; sans correction, la page reste dans le texte qui suit. On ramène
// le titre replié là où on l'a cliqué, sous la bande.
documents?.addEventListener('click', (evenement) => {
  const tete = evenement.target.closest('summary.rubrique-tete');
  const bloc = tete?.parentElement;
  if (!bloc?.open || getComputedStyle(tete).position !== 'sticky') return;
  const pose = parseFloat(getComputedStyle(tete).top);
  const haut = tete.getBoundingClientRect().top;
  const colle = Math.abs(haut - pose) < 2 && bloc.getBoundingClientRect().top < haut - 1;
  if (!colle) return;
  bloc.addEventListener('toggle', () => {
    if (!bloc.open) scrollBy(0, tete.getBoundingClientRect().top - haut);
  }, { once: true });
});

// ---------------------------------------------------------------------------
// Filtre du document, en direct : le champ sous la recherche, dans la barre,
// surligne ce qu'on tape dans le document affiché (onglet actif), déplie les
// rubriques qui le contiennent, replie les autres et compte les occurrences.
// Ce que ⌘F ne fait pas dans un document replié. Changer d'onglet le reporte
// sur le document affiché.

/** Saisie pliée : sans accents, en minuscules, un seul blanc. */
const plierSaisie = (saisie) => saisie.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');

/** Source de motif d'un texte plié : accents ignorés, un blanc vaut plusieurs. */
function sourceLitterale(plie) {
  return [...plie].map((lettre) => {
    if (/\s/.test(lettre)) return '\\s+';
    return ACCENTS[lettre] ?? lettre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('').replace(/(\\s\+)+/g, '\\s+');
}

/**
 * Motif littéral de la saisie, telle quelle : accents ignorés, un blanc vaut
 * plusieurs. Pas de racine ni de pluriel, contrairement à `motifRequete` :
 * on cherche ce qu'on tape. Null sous deux caractères.
 */
function motifLitteral(saisie) {
  const propre = plierSaisie(saisie);
  if (propre.length < 2) return null;
  return new RegExp(sourceLitterale(propre), 'giu');
}

/**
 * Expressions du document pour un mot du comptoir pris en entier
 * (« sécabilité » → « barre de cassure », « doses égales »…) ; vide sinon.
 */
function formesDuConcept(saisie, concepts) {
  const propre = plierSaisie(saisie);
  const concept = concepts.find((candidat) => candidat.mots.some((mot) => plierSaisie(mot) === propre));
  return concept?.formes ?? [];
}

/** Ce qu'on tape, plus les expressions du concept, en mots entiers. */
function motifFiltre(saisie, concepts) {
  const base = motifLitteral(saisie);
  const formes = formesDuConcept(saisie, concepts);
  if (!base || formes.length === 0) return base;
  // Les plus longues d'abord : « être divisés » avant « être divisé ».
  const alternatives = [...new Set(formes.map(plierSaisie))]
    .sort((a, b) => b.length - a.length)
    .map(sourceLitterale);
  return new RegExp(`${base.source}|(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/** Retire les marques du filtre et recolle les textes qu'elles avaient coupés. */
function retirerMarques(racine) {
  for (const marque of racine.querySelectorAll('mark.filtre')) marque.replaceWith(marque.textContent);
  racine.normalize();
}

if (filtre) {
  const champ = filtre.querySelector('.filtre-champ');
  const compte = filtre.querySelector('.filtre-compte');
  const boutons = [...filtre.querySelectorAll('.filtre-pas')];
  const concepts = (() => {
    try { return JSON.parse(filtre.dataset.concepts ?? '[]'); } catch { return []; }
  })();

  // Le document affiché : l'onglet actif, ou le seul document.
  const corpsAffiche = () => {
    const article = panneaux.find((panneau) => panneau && !panneau.hidden)
      ?? documents.querySelector('.document');
    return article?.querySelector('.rubriques, .document-corps') ?? null;
  };

  // Document filtré, ses marques, l'occurrence visée, et l'ouverture de ses
  // rubriques avant le filtre, pour la rendre quand il est levé. La bande
  // signalétique est filtrée avec lui : « sécable » s'y lit avant le RCP.
  let corps = null;
  let marques = [];
  let courant = -1;
  let avant = null;

  const rubriques = () => [...corps.querySelectorAll('details.rubrique')];

  const compter = () => {
    for (const bouton of boutons) bouton.disabled = marques.length === 0;
    if (marques.length === 0) {
      compte.textContent = motifLitteral(champ.value) ? 'Aucune occurrence' : '';
      return;
    }
    // Concept élargi : l'infobulle dit ce qui est cherché en plus du mot tapé.
    const formes = formesDuConcept(champ.value, concepts);
    compte.title = formes.length > 0 ? `Cherche aussi : ${formes.join(', ')}` : '';
    const nb = marques.length;
    const enBande = Boolean(bande?.contains(marques[0]));
    const dans = new Set(marques.map((marque) => marque.closest('details.rubrique')).filter(Boolean)).size;
    // « 1 / 71 », puis le détail, que le téléphone masque pour laisser le champ.
    const detail = document.createElement('span');
    detail.className = 'filtre-detail';
    detail.textContent = ` occurrence${nb > 1 ? 's' : ''}${dans > 1 ? ` · ${dans} rubriques` : ''}${enBande ? ' · bande' : ''}`;
    compte.replaceChildren(`${courant >= 0 ? `${courant + 1} / ` : ''}${nb}`, detail);
  };

  // Occurrence visée, cernée et centrée ; les bornes se rejoignent.
  const aller = (indice, doux) => {
    if (marques.length === 0) return;
    marques[courant]?.classList.remove('filtre-actif');
    courant = (indice + marques.length) % marques.length;
    const marque = marques[courant];
    marque.classList.add('filtre-actif');
    // La bande, collante, est souvent déjà à l'écran : on ne quitte pas la lecture.
    const cadre = marque.getBoundingClientRect();
    if (bande?.contains(marque) && cadre.top >= 0 && cadre.bottom <= window.innerHeight) {
      compter();
      return;
    }
    marque.scrollIntoView({ block: 'center', behavior: doux ? 'smooth' : 'auto' });
    compter();
  };

  // Retire le filtre du document filtré : marques, décomptes, ouvertures.
  const lever = () => {
    if (bande) retirerMarques(bande);
    if (corps) {
      retirerMarques(corps);
      for (const badge of corps.querySelectorAll('.filtre-nb')) badge.remove();
    }
    if (avant) {
      for (const [bloc, ouvert] of avant) bloc.open = ouvert;
      avant = null;
    }
    marques = [];
    courant = -1;
  };

  const appliquer = () => {
    lever();
    corps = corpsAffiche();
    const motif = motifFiltre(champ.value, concepts);
    if (!motif || !corps) {
      compter();
      return;
    }

    avant = new Map(rubriques().map((bloc) => [bloc, bloc.open]));
    if (bande) surligner(bande, motif, 'filtre');
    surligner(corps, motif, 'filtre');
    marques = [...(bande?.querySelectorAll('mark.filtre') ?? []), ...corps.querySelectorAll('mark.filtre')];

    // Ouvertes si elles contiennent le mot, repliées sinon : la lecture se
    // concentre ; le nombre se lit dans le titre, même rubrique repliée.
    for (const bloc of rubriques()) {
      const nb = bloc.querySelectorAll('mark.filtre').length;
      bloc.open = nb > 0;
      if (nb === 0) continue;
      const badge = document.createElement('span');
      badge.className = 'filtre-nb';
      badge.textContent = String(nb);
      bloc.querySelector(':scope > summary .lab')?.append(badge);
    }

    compter();
    if (marques.length > 0) aller(0, false);
  };

  let attente = null;
  champ.addEventListener('input', () => {
    clearTimeout(attente);
    attente = setTimeout(appliquer, 120);
  });

  // Entrée : occurrence suivante ; Maj + Entrée : précédente ; Échap : filtre
  // levé, puis, champ vide, on quitte le champ (le clavier revient à la page).
  filtre.addEventListener('submit', (evenement) => evenement.preventDefault());
  champ.addEventListener('keydown', (evenement) => {
    if (evenement.key === 'Enter') {
      evenement.preventDefault();
      aller(courant + (evenement.shiftKey ? -1 : 1), true);
    } else if (evenement.key === 'Escape' && champ.value) {
      evenement.preventDefault();
      champ.value = '';
      appliquer();
    } else if (evenement.key === 'Escape') {
      champ.blur();
    }
  });

  // Sans souris : le curseur attend dans le filtre dès l'arrivée. Sur ordinateur
  // seulement : sur téléphone, le clavier couvrirait la moitié de l'écran. Sans
  // défilement : une ancre (#rcp-8) ou un passage trouvé restent à l'écran.
  // Arrivée sur une ancre : le navigateur y saute et rend le focus à la page,
  // parfois après le chargement ; on le reprend dans la seconde qui suit, tant
  // que personne n'a pris le clavier.
  const ordinateur = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const libre = () => !document.activeElement?.matches('input, textarea, select, [contenteditable]');
  const viser = () => {
    if (libre()) champ.focus({ preventScroll: true });
  };
  if (ordinateur) {
    viser();
    if (location.hash) {
      const apres = () => {
        requestAnimationFrame(viser);
        setTimeout(viser, 300);
        setTimeout(viser, 1000);
      };
      if (document.readyState === 'complete') apres();
      else addEventListener('load', apres, { once: true });
    }
  }
  for (const bouton of boutons) {
    bouton.addEventListener('click', () => aller(courant + Number(bouton.dataset.pas), true));
  }

  // Autre onglet : le filtre passe au document affiché.
  for (const onglet of onglets) {
    onglet.addEventListener('click', () => {
      if (champ.value) appliquer();
    });
  }
}

// ---------------------------------------------------------------------------
// Citer : un passage copié dans un document emporte sa source (spécialité,
// document, rubrique, date, lien vers la rubrique), pour le transmettre au
// prescripteur tel quel. Hors d'un document, la copie reste celle du navigateur.

document.addEventListener('copy', (evenement) => {
  const selection = document.getSelection();
  const texte = selection?.toString().replace(/\s+/g, ' ').trim();
  if (!texte) return;
  const element = (noeud) => (noeud?.nodeType === Node.ELEMENT_NODE ? noeud : noeud?.parentElement);
  const article = element(selection.anchorNode)?.closest('article.document');
  if (!article || element(selection.focusNode)?.closest('article.document') !== article) return;

  const rubrique = element(selection.anchorNode).closest('details.rubrique');
  const tete = rubrique?.querySelector(':scope > summary');
  const intitule = tete
    ? `rubrique ${tete.querySelector('.num')?.textContent.trim() ?? ''} ${tete.querySelector('.lab')?.textContent.trim() ?? ''}`.replace(/\s+/g, ' ').trim()
    : null;
  const date = [...article.querySelectorAll('.document-meta span')].find((span) => /^Mis à jour/.test(span.textContent))?.textContent.trim();
  const source = [
    document.querySelector('.produit-titre')?.textContent.trim(),
    article.dataset.libelle,
    intitule,
    date && date.charAt(0).toLowerCase() + date.slice(1),
  ].filter(Boolean).join(', ');
  const lien = `${location.origin}${location.pathname}#${rubrique?.id ?? article.id}`;

  evenement.clipboardData.setData('text/plain', `« ${texte} »\n— ${source}. ${lien}`);
  evenement.preventDefault();
});
