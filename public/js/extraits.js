/**
 * Aperçu d'une rubrique au survol de son numéro.
 *
 * Le tableau dit qu'une molécule mentionne l'expression en 4.4, en 4.5 et en
 * 4.8 ; il n'en montrait qu'un extrait, celui de la meilleure occurrence, si
 * bien qu'on ne savait pas à quelle rubrique il se rattachait sans lire la
 * ligne de provenance. Survoler un numéro montre maintenant sa phrase.
 *
 * L'extrait n'est pas rendu avec la page : `ts_headline` coûte 21 ms pour
 * cinquante extraits et 168 ms pour deux cent cinquante, et presque aucun
 * aperçu n'est survolé. Il est donc demandé au serveur, une fois, puis gardé.
 *
 * Sans JavaScript il ne se passe rien de fâcheux : le numéro reste un lien
 * vers sa rubrique, et le bloc « Extrait » de la ligne reste dépliable.
 */
(function () {
  var table = document.querySelector('.trouvailles');
  if (!table || !window.fetch) return;

  var requete = new URLSearchParams(window.location.search).get('q');
  if (!requete) return;

  var cache = new Map();
  var bulle = null;
  var attente = null;
  var courant = null;

  function boite() {
    if (!bulle) {
      bulle = document.createElement('div');
      bulle.className = 'apercu';
      bulle.setAttribute('role', 'tooltip');
      document.body.appendChild(bulle);
    }
    return bulle;
  }

  function placer(cible) {
    var b = boite();
    var r = cible.getBoundingClientRect();
    b.style.visibility = 'hidden';
    b.hidden = false;
    var h = b.getBoundingClientRect().height;
    // Au-dessus si la place y est, sinon dessous : un aperçu qui sort de
    // l'écran par le haut ne se lit pas davantage qu'un aperçu absent.
    var dessus = r.top > h + 16;
    b.style.top = (window.scrollY + (dessus ? r.top - h - 8 : r.bottom + 8)) + 'px';
    var largeur = b.getBoundingClientRect().width;
    var gauche = r.left + r.width / 2 - largeur / 2;
    b.style.left = Math.max(8, Math.min(gauche, window.innerWidth - largeur - 8)) + 'px';
    b.style.visibility = '';
  }

  function montrer(cible, donnee) {
    if (courant !== cible) return;
    var b = boite();
    b.innerHTML = '';
    var tete = document.createElement('p');
    tete.className = 'apercu-tete';
    tete.textContent = donnee.numero + ' ' + donnee.libelle;
    var corps = document.createElement('p');
    corps.className = 'apercu-texte';
    // `extrait` vient de ts_headline : seuls <mark> et l'échappement de
    // Postgres s'y trouvent, le reste est le texte du document.
    corps.innerHTML = donnee.extrait;
    var source = document.createElement('p');
    source.className = 'apercu-source';
    source.textContent = donnee.denomination;
    b.appendChild(tete);
    b.appendChild(corps);
    b.appendChild(source);
    placer(cible);
  }

  function cacher() {
    clearTimeout(attente);
    courant = null;
    if (bulle) bulle.hidden = true;
  }

  function demander(cible) {
    courant = cible;
    var cle = cible.dataset.cis + '|' + cible.dataset.type + '|' + cible.dataset.position;
    if (cache.has(cle)) return montrer(cible, cache.get(cle));

    var url = '/extrait?q=' + encodeURIComponent(requete)
      + '&cis=' + encodeURIComponent(cible.dataset.cis)
      + '&type=' + encodeURIComponent(cible.dataset.type)
      + '&position=' + encodeURIComponent(cible.dataset.position);

    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { cache.set(cle, d); montrer(cible, d); } })
      .catch(function () { /* un aperçu absent ne casse rien */ });
  }

  function viser(e) {
    var cible = e.target.closest('.puce[data-cis]');
    if (!cible) return;
    clearTimeout(attente);
    // Un délai court : sans lui, traverser la ligne déclencherait huit requêtes.
    attente = setTimeout(function () { demander(cible); }, 120);
  }

  table.addEventListener('mouseover', viser);
  table.addEventListener('mouseout', function (e) {
    if (e.target.closest('.puce[data-cis]')) cacher();
  });
  table.addEventListener('focusin', viser);
  table.addEventListener('focusout', cacher);
  window.addEventListener('scroll', cacher, { passive: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cacher(); });
}());
