/**
 * Aperçu de la phrase d'une rubrique au survol de son numéro.
 * Chargé à la demande puis mis en cache : `ts_headline` est trop coûteux
 * pour être rendu avec la page. Le `title` est retiré pour ne pas recouvrir
 * l'aperçu. Au toucher : premier appui = aperçu, second = lien.
 */
(function () {
  const table = document.querySelector('.trouvailles');
  if (!table || !window.fetch) return;

  const requete = new URLSearchParams(window.location.search).get('q');
  if (!requete) return;

  const CIBLE = '[data-cis]';
  table.querySelectorAll(CIBLE).forEach((el) => { el.removeAttribute('title'); });

  const cache = new Map();
  let toucher = false;
  let bulle = null;
  let attente = null;
  let courant = null;

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
    const bulleCourante = boite();
    const rect = cible.getBoundingClientRect();
    bulleCourante.style.visibility = 'hidden';
    bulleCourante.hidden = false;
    const hauteur = bulleCourante.getBoundingClientRect().height;
    // Au-dessus si la place y est, sinon dessous.
    const dessus = rect.top > hauteur + 16;
    bulleCourante.style.top = (window.scrollY + (dessus ? rect.top - hauteur - 8 : rect.bottom + 8)) + 'px';
    const largeur = bulleCourante.getBoundingClientRect().width;
    const gauche = rect.left + rect.width / 2 - largeur / 2;
    bulleCourante.style.left = Math.max(8, Math.min(gauche, window.innerWidth - largeur - 8)) + 'px';
    bulleCourante.style.visibility = '';
  }

  function montrer(cible, donnee) {
    if (courant !== cible) return;
    const bulleCourante = boite();
    bulleCourante.innerHTML = '';
    const tete = document.createElement('p');
    tete.className = 'apercu-tete';
    tete.textContent = (donnee.type === 'notice' ? 'Notice · ' : '') + donnee.numero + ' ' + donnee.libelle;
    const corps = document.createElement('p');
    corps.className = 'apercu-texte';
    // Échappé côté serveur (`marquer`) : seuls les <mark> sont du HTML.
    corps.innerHTML = donnee.extrait;
    const source = document.createElement('p');
    source.className = 'apercu-source';
    source.textContent = donnee.denomination;
    bulleCourante.appendChild(tete);
    bulleCourante.appendChild(corps);
    bulleCourante.appendChild(source);
    placer(cible);
  }

  function cacher() {
    clearTimeout(attente);
    courant = null;
    if (bulle) bulle.hidden = true;
  }

  function demander(cible) {
    courant = cible;
    const cle = cible.dataset.cis + '|' + cible.dataset.type + '|' + cible.dataset.position;
    if (cache.has(cle)) return montrer(cible, cache.get(cle));

    const url = '/extrait?q=' + encodeURIComponent(requete)
      + '&cis=' + encodeURIComponent(cible.dataset.cis)
      + '&type=' + encodeURIComponent(cible.dataset.type)
      + '&position=' + encodeURIComponent(cible.dataset.position);

    return fetch(url)
      .then((reponse) => { return reponse.ok ? reponse.json() : null; })
      .then((donnee) => { if (donnee) { cache.set(cle, donnee); montrer(cible, donnee); } })
      .catch(() => { /* un aperçu absent ne casse rien */ });
  }

  function viser(e) {
    if (toucher) return;
    const cible = e.target.closest(CIBLE);
    if (!cible) return;
    clearTimeout(attente);
    // Délai : évite une requête par point traversé.
    attente = setTimeout(() => { demander(cible); }, 120);
  }

  table.addEventListener('mouseover', viser);
  table.addEventListener('mouseout', (e) => {
    if (!toucher && e.target.closest(CIBLE)) cacher();
  });

  table.addEventListener('pointerdown', (e) => { toucher = e.pointerType === 'touch'; });
  table.addEventListener('click', (e) => {
    const cible = e.target.closest(CIBLE);
    if (!cible || !toucher) return;
    if (courant === cible && bulle && !bulle.hidden) return; // second appui : le lien
    e.preventDefault();
    demander(cible);
  });
  table.addEventListener('focusin', viser);
  table.addEventListener('focusout', () => { if (!toucher) cacher(); });
  window.addEventListener('scroll', cacher, { passive: true });
  document.addEventListener('click', (e) => { if (!e.target.closest(CIBLE)) cacher(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cacher(); });
}());
