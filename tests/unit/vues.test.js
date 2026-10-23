import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import pug from 'pug';
import { ROOT } from '../../src/config.js';
import { COLONNES } from '../../src/recherche-texte.js';
import { productLinks } from '../../src/links.js';
import { lienAlternatives } from '../../src/excipients.js';
import { lireEtat, lien } from '../../src/etat-recherche.js';
import { dci, specialite, phrase } from '../../src/casse.js';
import { CONCEPTS_DOCUMENT_JSON } from '../../src/concepts-document.js';
import { regrouperSpecialites } from '../../src/specialites.js';
import { signaletique } from '../../src/signaletique.js';

/**
 * Rend chaque gabarit : `pug.compileFile` laisse passer mixin absent, variable indéfinie
 * ou boucle sur un non-tableau, qui ne cassent qu'au rendu.
 */
/**
 * Locales toujours fournies par les deux routes de recherche.
 * `etat` est dérivé du cas comme en production, jamais posé à la main.
 */
const rendre = (vue, locals = {}) => {
  const mode = vue === 'documents' ? 'documents' : 'nom';
  const etat = locals.etat ?? lireEtat({
    q: locals.query,
    rubrique: locals.rubrique,
    page: locals.page,
    filter: locals.filter,
  }, mode);

  return pug.renderFile(path.join(ROOT, 'views', `${vue}.pug`), {
    v: 'test', lien, dci, specialite, phrase, conceptsDocument: CONCEPTS_DOCUMENT_JSON, colonnes: COLONNES, etat, ...locals,
  });
};

const RECHERCHE_VIDE = { resultats: [], total: 0, borne: false, decalage: 0, suite: false, elargissements: [] };

// Toutes les locales de la fiche produit, la page la plus sensible à un oubli.
const produit = (extra = {}) => ({
  product: {
    id: '66297965',
    denomination_medicament: 'EDEX 20 microgrammes',
    active_ingredients: 'ALPROSTADIL',
    forme_pharmaceutique: 'poudre et solvant pour solution injectable',
    titulaires: 'UCB PHARMA',
    cip_products: [],
  },
  importation: false,
  reference: null,
  alternatives: { categories: [], groupe: null },
  deglutition: null,
  lienAlternatives,
  variantes: [],
  remboursement: null,
  resumeAtc: null,
  railActif: null,
  genericGroup: null,
  documents: [],
  hasDocuments: false,
  delivrance: { resume: [], groupes: [], liens: [] },
  signaletique: [],
  evaluation: [],
  // Via productLinks, pour suivre tout nouveau lien de la fiche.
  links: { ...productLinks({ id: '1', denomination_medicament: 'X' }), official: [], scientific: [] },
  sections: [],
  ...extra,
});

const TROUVAILLE = {
  signature: '62851',
  molecule: 'OLANZAPINE',
  sansMolecule: false,
  code_cis: '66297965',
  denomination: 'OLANZAPINE ALPHA 5 mg, comprimé',
  numero: '4.4',
  libelle: 'Mises en garde spéciales',
  ancre: 'rcp-12',
  extrait: 'allongement de l’<mark>intervalle QT</mark>',
  specialites: 66,
  rubriques: [
    { numero: '4.4', libelle: 'Mises en garde', cis: '66297965', ancre: 'rcp-12' },
    { numero: '4.8', libelle: 'Effets indésirables', cis: '66297966', ancre: 'rcp-21' },
  ],
  formes: [{ forme: 'comprimé', total: 2, noms: [{
    nom: 'OLANZAPINE ALPHA', princeps: false, importation: false, uniteCourte: 'mg',
    dosages: [
      {
        id: '66297965', etiquette: '5', denomination: 'OLANZAPINE ALPHA 5 mg', ancre: 'rcp-12',
        rubriques: [{ numero: '4.4', libelle: 'Mises en garde', type: 'rcp', exact: true, ancre: 'rcp-12' }],
      },
      {
        id: '66297966', etiquette: '10', denomination: 'OLANZAPINE ALPHA 10 mg', ancre: 'rcp-21',
        rubriques: [
          { numero: '4.8', libelle: 'Effets indésirables', type: 'rcp', exact: true, ancre: 'rcp-21' },
          { numero: '2', libelle: 'Avant de prendre', type: 'notice', exact: true, ancre: 'notice-3' },
        ],
      },
    ],
  }] }],
};

// Cas rare : la dénomination sert de titre et le lien va à la fiche.
const SANS_MOLECULE = {
  ...TROUVAILLE,
  signature: 'cis:66297967',
  molecule: 'SPECIALITE SANS COMPOSITION',
  denomination: 'SPECIALITE SANS COMPOSITION',
  sansMolecule: true,
  specialites: 1,
  code_cis: '66297967',
  formes: [],
  rubriques: [{ numero: '4.4', libelle: 'Mises en garde', cis: '66297967', ancre: 'rcp-12' }],
};

const RECHERCHE_PLEINE = {
  resultats: [TROUVAILLE, SANS_MOLECULE],
  total: 10358,
  molecules: 461,
  moleculesMax: 200,
  borne: true,
  decalage: 20,
  suite: true,
};

const REMBOURSEMENT = {
  texte: '<p>Ce médicament peut être pris en charge dans le cas suivant : dysfonction érectile.</p>',
  taux: '65 %',
};

const DELIVRANCE_PLEINE = {
  resume: [{ cle: 'liste', court: 'Liste I', long: 'Liste I', portee: 'bloque' }],
  groupes: [{
    titre: 'Qui la prescrit',
    conditions: [{
      brut: 'Prescription initiale réservée aux spécialistes en urologie',
      population: null,
      segments: [{ texte: 'Prescription initiale réservée aux ', fort: false },
        { texte: 'urologues', fort: true }],
    }],
  }],
  liens: [],
};

const PAGES = [
  ['search_page', { query: '', filter: 'all', results: null, classes: [] }],
  ['search_page', {
    query: 'aspirine',
    filter: 'all',
    results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
    documents: RECHERCHE_VIDE,
  }],
  ['documents', { query: 'QT', rubrique: null, documents: RECHERCHE_VIDE }],
  ['documents', { query: 'QT', rubrique: '4.4', documents: RECHERCHE_VIDE, panne: 'indisponible' }],
  ['documents', {
    query: 'intervalle QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 2,
  }],
  ['search_page', {
    query: 'intervalle QT',
    filter: 'all',
    results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
    documents: RECHERCHE_PLEINE,
  }],
  ['product', produit()],
  ['product', produit({ delivrance: DELIVRANCE_PLEINE, remboursement: REMBOURSEMENT })],
  ['error', { title: 'Erreur', message: 'Cette page n’existe pas.', status: 404 }],
];

describe('rendu des gabarits', () => {
  for (const [vue, locals] of PAGES) {
    it(`${vue} se rend (${Object.keys(locals).join(', ')})`, () => {
      const html = rendre(vue, locals);
      assert.ok(html.includes('<!DOCTYPE html>') || html.includes('<!doctype html>'), 'document complet');
    });
  }

  it('la page des documents dispose de la barre de situation', () => {
    const html = rendre('documents', { query: 'QT', rubrique: null, documents: RECHERCHE_VIDE });
    assert.match(html, /class="barre"/);
  });

  // Le document lu sert de titre : « RCP », pas « Documents ».
  it('les onglets de documents portent le libellé court', () => {
    const doc = (type, court, label) => ({ type, anchor: `doc-${type}`, court, label, html: '<p>x</p>' });
    const deux = rendre('product', produit({
      hasDocuments: true,
      documents: [doc('rcp', 'RCP', 'Résumé des caractéristiques du produit'), doc('notice', 'Notice', 'Notice patient')],
    }));
    assert.match(deux, /role="tab"[^>]*>RCP<\/button>/);
    assert.match(deux, /title="Notice patient"[^>]*>Notice<\/button>/);
    const un = rendre('product', produit({
      hasDocuments: true,
      documents: [doc('rcp', 'RCP', 'Résumé des caractéristiques du produit')],
    }));
    assert.match(un, /<span class="onglet"[^>]*>RCP<\/span>/);
    assert.doesNotMatch(un, /role="tab"/);
  });

  // Un filtre, dans la barre sous le champ de recherche, pour le document affiché ;
  // caché sans JavaScript (documents.js le révèle) ; aucun quand il n'y a qu'un PDF.
  it('la barre porte le filtre du document sous le champ de recherche', () => {
    const doc = (type, html) => ({ type, anchor: `doc-${type}`, court: type, label: type, html, url: 'https://x' });
    const html = rendre('product', produit({
      hasDocuments: true,
      documents: [doc('rcp', '<p>x</p>'), doc('notice', '<p>y</p>')],
    }));
    const barre = html.match(/<header class="barre">[\s\S]*?<\/header>/)[0];
    assert.match(barre, /<div class="barre-champs"><div class="search-wrapper search-compacte">[\s\S]*<form class="filtre-doc" role="search" hidden/);
    assert.match(barre, /<input class="filtre-champ" id="filtre-doc" type="search"/);
    // Les touches se lisent au survol : sans souris, rien d'autre ne les dit.
    assert.match(barre, /title="Entrée : occurrence suivante[^"]*Échap : effacer · \/ : chercher un autre médicament"/);
    assert.equal((html.match(/class="filtre-doc"/g) ?? []).length, 1);
    // Les concepts du comptoir partent avec le filtre : « sécabilité » cherche aussi « barre de cassure ».
    const concepts = JSON.parse(barre.match(/data-concepts="([^"]*)"/)[1].replaceAll('&quot;', '"'));
    assert.ok(concepts.some((concept) => concept.mots.includes('sécabilité') && concept.formes.includes('barre de cassure')));

    // Citer : documents.js lit le libellé du document et la ligne de service le dit.
    assert.match(html, /<article class="document" id="doc-rcp" data-type="rcp" data-libelle="rcp"/);
    assert.match(html, /<span class="astuce-copie">Un passage copié emporte sa source<\/span>/);

    const pdf = rendre('product', produit({ hasDocuments: true, documents: [doc('rcp_notice', null)] }));
    assert.doesNotMatch(pdf, /filtre-doc/);
    assert.doesNotMatch(pdf, /barre-champs/);
  });

  // Une ligne de valeurs, dans l'ordre ; libellé et détail en infobulle, l'aplat marque ce qui bloque.
  it('la bande signalétique rend ses cases dans l\'ordre, valeurs seules, picto et aplat', () => {
    const html = rendre('product', produit({
      signaletique: [
        { cle: 'ordonnance', picto: 'cadenas', libelle: 'Ordonnance', valeur: 'Stupéfiant', detail: 'Stupéfiant', portee: 'bloque' },
        { cle: 'prix', picto: 'euro', libelle: 'Prise en charge', valeur: '65 % · 2,10 €' },
        { cle: 'generique', picto: 'generique', libelle: 'Générique', valeur: 'Générique · 12 options', lien: '#alternatives' },
      ],
    }));
    assert.match(html, /<section class="signaletique"/);
    // La dénomination colle sous la barre : hors de l'en-tête, dans son propre bloc.
    assert.match(html, /<div class="titre-colle"><div class="identite-inner"><h1 class="produit-titre">Edex 20 microgrammes<\/h1>/);
    assert.doesNotMatch(html, /barre-titre/);
    assert.doesNotMatch(html, /repere/);
    assert.match(html, /class="signal signal-bloque" title="Ordonnance — Stupéfiant" data-cle="ordonnance"><svg class="picto"/);
    assert.match(html, /title="Prise en charge" data-cle="prix">.*?<span class="signal-valeur">65 % · 2,10 €<\/span>/);
    assert.match(html, /<a class="signal-valeur" href="#alternatives">Générique · 12 options<\/a>/);
    assert.doesNotMatch(html, /signal-libelle/);
    assert.ok(html.indexOf('data-cle="ordonnance"') < html.indexOf('data-cle="prix"'));
    assert.doesNotMatch(rendre('product', produit()), /signaletique/);
  });

  // Avis HAS : le plus récent visible, les autres repliés ; libellé mot pour mot.
  it('le bloc Évaluation HAS montre le dernier avis et replie les autres', () => {
    const avis = (date, motif, smr, asmr) => ({
      dossier: 'CT-1', date: new Date(date), motif, lien: 'https://www.has-sante.fr/jcms/p_1',
      smr: [{ valeur: smr, lignes: { intro: 'Le service médical rendu est important.', items: ['dans a', 'dans b'] } }],
      asmr: asmr ? [{ valeur: asmr, lignes: { intro: 'Pas d’amélioration.', items: [] } }] : [],
    });
    const html = rendre('product', produit({
      evaluation: [avis('2026-03-04', 'Renouvellement d’inscription (CT)', 'Important', 'V'),
        avis('2019-01-10', 'Inscription (CT)', 'Modéré', 'Commentaires sans chiffrage de l’ASMR')],
    }));
    assert.match(html, /<details class="bloc" id="evaluation">/);
    assert.match(html, /<span class="bloc-compte">2 avis<\/span>/);
    assert.match(html, /<strong class="avis-valeur">SMR important<\/strong> — Le service médical rendu est important\./);
    assert.match(html, /<strong class="avis-valeur">ASMR V<\/strong>/);
    assert.match(html, /<ul class="avis-items"><li>dans a<\/li><li>dans b<\/li><\/ul>/);
    assert.match(html, /<strong class="avis-valeur">Commentaires sans chiffrage de l’ASMR<\/strong>/);
    assert.match(html, /1 avis antérieur<\/summary>/);
    assert.match(html, /href="https:\/\/www\.has-sante\.fr\/jcms\/p_1"/);
    assert.doesNotMatch(rendre('product', produit()), /id="evaluation"/);
  });

  // Le dosage affiché est dans le titre : la liste ne porte que les autres.
  it('les autres dosages omettent le dosage affiché', () => {
    const forme = 'poudre et solvant pour solution injectable';
    const html = rendre('product', produit({
      variantes: [
        { id: '1', variante: '10 microgrammes', forme_pharmaceutique: forme, courante: false },
        { id: '2', variante: '20 microgrammes', forme_pharmaceutique: forme, courante: true },
      ],
    }));
    assert.match(html, /href="\/product\/1">10 microgrammes/);
    assert.doesNotMatch(html, /forme-choix[^>]*>20 microgrammes/);
  });

  // Seul dosage : pas de liste.
  it('un seul dosage, pas de liste d’autres dosages', () => {
    const html = rendre('product', produit({
      variantes: [{ id: '2', variante: '20 microgrammes', forme_pharmaceutique: 'x', courante: true }],
    }));
    assert.doesNotMatch(html, /Autres dosages et formes/);
  });

  // Autre table que les conditions : sinon la mention de l'en-tête annoncerait un bloc vide.
  it('la prise en charge restreinte s’affiche sans condition de délivrance', () => {
    const html = rendre('product', produit({ remboursement: REMBOURSEMENT }));
    assert.match(html, /Indications remboursées/);
    assert.match(html, /dysfonction érectile/);
    assert.match(html, /meddispar\.fr\/Medicaments-d-exception\/Criteres/);
    assert.doesNotMatch(html, /aucune condition de prescription/);
  });

  // Le champ de l'Assurance Maladie rapporte une restriction, pas ce statut.
  it('la fiche ne qualifie pas le produit de médicament d’exception', () => {
    const html = rendre('product', produit({ remboursement: REMBOURSEMENT }));
    const hors = html.replace(/<a[^>]*>[\s\S]*?<\/a>/g, '');
    assert.doesNotMatch(hors, /médicament d.exception/i);
  });

  it('la page des documents sait avancer et reculer', () => {
    const html = rendre('documents', {
      query: 'intervalle QT', rubrique: '4.4', documents: RECHERCHE_PLEINE, page: 2,
    });
    assert.match(html, /Précédents/);
    assert.match(html, /Suivants/);
    assert.match(html, /page=3/);
    assert.match(html, /rubrique=4\.4/);
    assert.match(html, /Résultats 21 à 22/);
  });

  // Sinon deux URL pour une même page, et le lien « actif » se dédouble.
  it('revient à la première page sans paramètre de page', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: { ...RECHERCHE_PLEINE, decalage: 20 }, page: 2,
    });
    assert.doesNotMatch(html, /page=1/);
  });

  it('la page de recherche annonce la recherche plein texte', () => {
    const html = rendre('search_page', {
      query: 'intervalle QT',
      filter: 'all',
      results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
      documents: RECHERCHE_PLEINE,
    });
    assert.match(html, /Dans les documents/);
    // URLSearchParams encode l'espace en « + ».
    assert.match(html, /href="\/documents\?q=intervalle\+QT"/);
  });

  // Un résultat par nom : chaque dosage est un lien vers sa spécialité.
  it('un résultat par nom liste ses dosages cliquables', () => {
    const produit = {
      libelle: 'DROLEPTAN', titulaires: 'PANPHARMA', princeps: true,
      active_ingredients: 'DROPÉRIDOL',
      formes: [{ forme: 'solution injectable', total: 1, noms: [{
        nom: 'DROLEPTAN', uniteCourte: 'mg/ml',
        dosages: [{ id: '61234567', etiquette: '2,5', denomination: 'DROLEPTAN 2,5 mg/ml' }],
      }] }],
    };
    const html = rendre('search_page', {
      query: 'droleptan', filter: 'all', classes: [],
      results: { brandMatches: [produit], activeIngredientMatches: [], total: 1 },
    });
    assert.match(html, /href="\/product\/61234567"/);
    assert.match(html, /solution injectable/);
    assert.doesNotMatch(html, /dosages et formes/);
  });

  // Le point de la molécule mène au RCP d'une spécialité, nommée dans l'infobulle.
  it('chaque rubrique porte sa propre ancre, et nomme sa spécialité', () => {
    const html = rendre('documents', {
      query: 'intervalle QT', rubrique: null, page: 1,
      documents: { ...RECHERCHE_PLEINE, resultats: [{ ...TROUVAILLE, rubriques: [
        { numero: '4.4', libelle: 'Mises en garde', cis: '66297965', ancre: 'rcp-12', denomination: 'ZYPREXA 5 mg' },
        { numero: '4.8', libelle: 'Effets indésirables', cis: '66297966', ancre: 'rcp-21' },
      ] }] },
    });
    assert.match(html, /class="point" href="\/product\/66297965\?q=intervalle%20QT#rcp-12" title="4\.4 Mises en garde — Zyprexa 5 mg"/);
    assert.match(html, /class="point" href="\/product\/66297966\?q=intervalle%20QT#rcp-21"/);
    assert.match(html, /66 spécialités/);
  });

  // Déplié, l'accordéon de la vue large donne une ligne de points par dosage,
  // chacun vers son propre RCP ; la forme fait l'intertitre.
  it('déplié, chaque dosage a ses points', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /class="ligne-dosages ligne-forme"><td colspan="10">comprimé</);
    assert.match(html, /class="point point-dosage" href="\/product\/66297965\?q=QT#rcp-12"/);
    assert.match(html, /class="point point-dosage" href="\/product\/66297966\?q=QT#rcp-21"/);
    assert.match(html, /class="autre" href="\/product\/66297966\?q=QT#notice-3"[^>]*>N2</);
    assert.match(html, /Olanzapine Alpha 5 mg/);
  });

  // Ciblée : la phrase dit de quelle spécialité elle vient, quand il y en a plusieurs.
  it('la phrase nomme la spécialité dont elle vient', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, page: 1, ciblee: true,
      documents: { ...RECHERCHE_PLEINE, resultats: [{ ...TROUVAILLE, rubriques: [
        { numero: '4.4', libelle: 'Mises en garde', cis: '1', ancre: 'rcp-12', extrait: 'x', denomination: 'ZYPREXA 5 mg, comprimé' },
      ] }] },
    });
    assert.match(html, /class="phrase-source">— Zyprexa 5 mg, comprimé/);
  });

  // Chaque dosage mène au passage trouvé de sa spécialité, requête transmise.
  it('la molécule déplie ses dosages ; seule, elle mène à son passage', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /<details class="trouvaille-details">/);
    assert.match(html, /class="ligne-dosages ligne-specialite"/);
    assert.match(html, /class="dosage-lien" href="\/product\/66297966\?q=QT#rcp-21"/);
    assert.match(html, /class="trouvaille-molecule" href="\/product\/66297967\?q=QT#rcp-12"/);
    // Sans composition : la dénomination est le titre, pas de parenthèse en double.
    assert.doesNotMatch(html, /trouvaille-specialite/);
  });

  // Une seule spécialité : nommée entre parenthèses, nom et dosage, forme en infobulle.
  it('une molécule à spécialité unique nomme sa spécialité', () => {
    const unique = {
      ...TROUVAILLE, signature: 'toremifene', molecule: 'CITRATE DE TORÉMIFÈNE', specialites: 1, formes: [],
      code_cis: '60000001', ancre: 'rcp-8', denomination: 'FARESTON 60 mg, comprimé',
    };
    const html = rendre('documents', { query: 'QT', rubrique: null, page: 1, documents: { ...RECHERCHE_PLEINE, resultats: [unique] } });
    assert.match(html, /class="trouvaille-specialite" title="Fareston 60 mg, comprimé">\(Fareston 60 mg\)</);
  });

  // Sans filtre, la phrase se lit au survol du point.
  it('une ligne par molécule, sans extrait sous chaque ligne', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.doesNotMatch(html, /trouvaille-extrait/);
    assert.match(html, /66 spé\./);
  });

  // L'onglet plein texte n'apparaît qu'après une recherche : la page de garde doit l'annoncer.
  it('la page de garde montre qu’on peut chercher une expression', () => {
    const html = rendre('search_page', { query: '', filter: 'all', results: null, classes: [] });
    assert.match(html, /Dénomination, principe actif ou expression/);
    assert.match(html, /href="\/documents\?q=allongement\+QT"/);
  });

  // Mode d'emploi replié : le résumé nomme les cas, la liste donne un exemple de chacun ;
  // la question seulement avec l'IA.
  it('le mode d’emploi de l’accueil décline nom, textes, interactions, excipients, boîte et question', () => {
    const sans = rendre('search_page', { query: '', filter: 'all', results: null, classes: [] });
    assert.match(sans, /<details class="notice-site"><summary><span class="notice-titre">Comment utiliser la barre de recherche\u202f\?<\/span><span class="notice-genres"> · un nom, un passage des RCP, une interaction, une alternative, une boîte<\/span>/);
    assert.match(sans, /<dt>Un nom, une molécule<\/dt><dd><a class="notice-essai" href="\/search\?q=amoxicilline">/);
    assert.match(sans, /<dt>Une interaction<\/dt><dd><a class="notice-essai" href="\/interactions\?m=kardegic&amp;m=previscan">/);
    assert.match(sans, /<dt>Une alternative<\/dt><dd><a class="notice-essai" href="\/product\/60234100\?sans=lactose#alternatives">/);
    assert.match(sans, /<dt>Un passage des RCP<\/dt><dd><a class="notice-essai" href="\/documents\?q=allongement\+QT">/);
    assert.match(sans, /<dt>Une boîte<\/dt><dd><a class="notice-essai" href="\/search\?q=3400935955838">/);
    assert.doesNotMatch(sans, /Lévothyrox|une question/);
    const avec = rendre('search_page', { query: '', filter: 'all', results: null, classes: [], ia: true });
    assert.match(avec, /, une boîte, une question<\/span>/);
    assert.match(avec, /<dt>Une question à Kevin<\/dt><dd><a class="notice-essai" href="\/search\?q=couper\+le\+L%C3%A9vothyrox\+%3F">couper le Lévothyrox \?<\/a>/);
  });

  // Référencement : description et canonique, ou hors index.
  it('l’en-tête porte description, adresse canonique ou noindex', () => {
    const page = rendre('search_page', {
      query: '', filter: 'all', results: null, classes: [],
      description: 'Les médicaments', canonique: 'https://kevin.test/',
    });
    assert.match(page, /<meta name="description" content="Les médicaments">/);
    assert.match(page, /<link rel="canonical" href="https:\/\/kevin.test\/">/);
    assert.doesNotMatch(page, /noindex/);
    const resultats = rendre('search_page', {
      query: '', filter: 'all', results: null, classes: [], noindex: true, canonique: 'https://kevin.test/search',
    });
    assert.match(resultats, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(resultats, /rel="canonical"/);
  });

  // Documents d'un médicament, rien trouvé : ses fiches, ou la recherche sans le filtre.
  it('sans résultat pour un médicament, la page mène à ses spécialités', () => {
    const html = rendre('documents', {
      query: 'divisé', rubrique: null, documents: RECHERCHE_VIDE,
      etat: lireEtat({ q: 'divisé', molecule: 'doliprane 1000', question: 'Sécabilité du doliprane 1000 ?', ia: '1' }, 'documents'),
    });
    assert.match(html, /Aucune rubrique ne contient « divisé » pour « doliprane 1000 »\./);
    assert.match(html, /<a href="\/search\?q=doliprane\+1000">Voir ses spécialités<\/a>/);
    assert.match(html, /<a href="\/documents\?q=divis%C3%A9&amp;question=[^"]*&amp;ia=1">Chercher dans tous les médicaments<\/a>/);
  });

  // Interactions : le thésaurus au-dessus des deux colonnes, son silence dit aussi.
  it('la page d’interactions cite le thésaurus de l’ANSM, ou dit qu’il se tait', () => {
    const sensVide = { de: 'A', sur: 'B', rcp: 0, citant: 0, passages: [], autres: 0, horsRcp: false };
    const paire = (ansm) => ({
      a: { libelle: 'Atorvastatine' }, b: { libelle: 'Pamplemousse (jus et fruit)' }, ansm,
      niveau: ansm.length ? 'apec' : null, libelleNiveau: ansm.length ? 'À prendre en compte' : null,
      niveauSource: ansm.length ? 'ansm' : null, communes: [], memeClasse: [], cite: false,
      sens: [sensVide, { ...sensVide, horsRcp: true }],
    });
    const couple = {
      de: 'ATORVASTATINE', avec: 'PAMPLEMOUSSE (JUS ET FRUIT)', niveaux: ['apec'], libelleNiveau: 'À prendre en compte',
      mecanisme: 'Augmentation des concentrations plasmatiques de l’hypolipémiant.', conduite: '',
    };
    const resultat = (ansm) => ({ medicaments: [], inconnus: [], paires: [paire(ansm)] });
    const avec = rendre('interactions', { saisie: 'atorvastatine pamplemousse', resultat: resultat([couple]) });
    assert.match(avec, /<span class="niveau-part">selon le thésaurus de l'ANSM<\/span>/);
    assert.match(avec, /<blockquote class="citation citation-ansm">.*Atorvastatine \+ Pamplemousse \(jus et fruit\).*Augmentation des concentrations/s);
    assert.match(avec, /Pas de RCP : ce n'est pas un médicament\./);
    const sans = rendre('interactions', { saisie: 'x', resultat: resultat([]) });
    assert.match(sans, /Thésaurus de l'ANSM \(septembre 2023\) : aucune entrée pour ce couple\./);
  });

  // Accueil : les molécules les plus fournies, sous les classes.
  it('l’accueil liste les molécules les plus fournies', () => {
    const html = rendre('search_page', {
      query: '', filter: 'all', results: null, sansRail: true,
      classes: [{ code: 'N', label: 'Système nerveux', specialites: 1988 }],
      molecules: [{ code: 'N02BF02', label: 'PREGABALINE', specialites: 92 }],
    });
    assert.match(html, /Top 20 des molécules avec le plus de spécialités/);
    assert.match(html, /href="\/classe\/N02BF02"/);
  });

  // Apparence : choix mémorisé posé avant les styles, bouton caché sans JavaScript.
  it('chaque page porte le bouton d’apparence et l’applique avant les styles', () => {
    const accueil = rendre('search_page', { query: '', filter: 'all', results: null, classes: [] });
    // Fichier externe, avant les styles : la CSP (script-src 'self') refuse un script en ligne.
    assert.match(accueil, /<script src="\/js\/apparence\.js\?v=test"><\/script>[\s\S]*<link rel="stylesheet"/);
    assert.doesNotMatch(accueil, /<script>/);
    assert.match(accueil, /<button class="theme" type="button" hidden="hidden"/);
    assert.match(accueil, /src="\/js\/theme\.js\?v=test"/);
    const docs = rendre('documents', { query: 'QT', rubrique: null, documents: RECHERCHE_VIDE });
    assert.match(docs, /class="barre-inner">[\s\S]*<button class="theme"/);
  });

  // Accueil et résultats : sans rail, la recherche prend toute la largeur.
  it('le rail n’apparaît que si la page le demande', () => {
    const recherche = rendre('search_page', {
      query: 'aspirine', filter: 'all', classes: [], sansRail: true,
      results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
    });
    assert.doesNotMatch(recherche, /class="rail"/);
    const classe = rendre('search_page', { query: '', filter: 'all', results: null, classes: [] });
    assert.match(classe, /class="rail"/);
  });

  it('la notice disparaît une fois la recherche faite', () => {
    const html = rendre('search_page', {
      query: 'aspirine',
      filter: 'all',
      results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
      documents: RECHERCHE_VIDE,
    });
    assert.doesNotMatch(html, /notice-site/);
  });

  // Pas de barre de situation sur cette page : le titre du bandeau est le seul retour.
  it('la page de résultats ramène à l’accueil', () => {
    const html = rendre('search_page', {
      query: 'valsartan',
      filter: 'all',
      results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
      documents: RECHERCHE_VIDE,
    });
    assert.match(html, /<a class="titre-lien" href="\/">Médipile<\/a>/);
  });

  it('mais la page de garde ne se lie pas à elle-même', () => {
    const html = rendre('search_page', { query: '', filter: 'all', results: null, classes: [] });
    assert.doesNotMatch(html, /titre-lien/);
  });

  // Colonnes fixes pour être apprises ; dans « Autres », la notice se distingue du RCP de même numéro.
  it('range les rubriques en colonnes fixes, et nomme les autres', () => {
    const html = rendre('documents', {
      query: 'QT',
      rubrique: null,
      page: 1,
      documents: {
        ...RECHERCHE_PLEINE,
        resultats: [{
          ...TROUVAILLE,
          rubriques: [
            { numero: '4.8', libelle: 'Effets', cis: '1', ancre: 'rcp-2', type: 'rcp', exact: true },
            { numero: '2', libelle: 'Composition', cis: '1', ancre: 'rcp-9', type: 'rcp', exact: true },
            { numero: '2', libelle: 'Avant de prendre', cis: '1', ancre: 'notice-3', type: 'notice', exact: true },
          ],
        }],
      },
    });
    assert.equal((html.match(/col-rubrique/g) || []).length, COLONNES.length);
    assert.match(html, /class="autre"[^>]*>2</);
    assert.match(html, /class="autre"[^>]*>N2</);
    assert.match(html, /aria-label="Notice · 2 Avant de prendre"/);
    // La 4.4, absente de ce résultat, laisse sa cellule vide sans décaler les autres.
    assert.match(html, /<td class="cellule-rubrique"><\/td>/);
  });

  // Point plein : expression exacte ; creux : mots dispersés. Seulement pour plusieurs mots.
  it('distingue l’expression exacte des mots dispersés', () => {
    const resultats = [{
      ...TROUVAILLE,
      rubriques: [
        { numero: '4.3', libelle: 'Contre-indications', cis: '1', ancre: 'rcp-3', type: 'rcp', exact: true },
        { numero: '4.2', libelle: 'Posologie', cis: '1', ancre: 'rcp-2', type: 'rcp', exact: false },
      ],
    }];
    const avec = rendre('documents', {
      query: 'insuffisance hépatique', rubrique: null, page: 1,
      documents: { ...RECHERCHE_PLEINE, exacte: true, resultats },
    });
    assert.match(avec, /class="legende"/);
    assert.match(avec, /class="point point-epars"[^>]*aria-label="4\.2 Posologie — mots séparés"/);
    assert.match(avec, /class="point"[^>]*aria-label="4\.3 Contre-indications"/);

    const sans = rendre('documents', {
      query: 'QT', rubrique: null, page: 1,
      documents: { ...RECHERCHE_PLEINE, exacte: false, resultats },
    });
    assert.doesNotMatch(sans, /class="legende"/);
    assert.doesNotMatch(sans, /point-epars/);
  });

  // `title` nomme le point sans script ; le script le retire pour ne pas masquer la phrase.
  it('nomme chaque point, pour le lecteur d’écran comme sans script', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /title="4\.4 Mises en garde"/);
    assert.match(html, /aria-label="4\.4 Mises en garde"/);
  });

  // Les onglets répéteraient les rubriques de l'en-tête du tableau.
  it('filtre depuis l’en-tête, sans rangée d’onglets', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.doesNotMatch(html, /class="filtres"/);
    assert.match(html, /class="th-lien" href="\/documents\?q=QT&amp;rubrique=4\.5"/);
  });

  // Filtrée, la phrase devient la réponse.
  it('replie les colonnes quand une rubrique est choisie', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: '4.5', documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.doesNotMatch(html, /col-rubrique/);
    assert.doesNotMatch(html, /cellule-autres/);
    assert.match(html, /class="jeton"[^>]*>rubrique 4\.5/);
    assert.match(html, /class="jeton" href="\/documents\?q=QT"/);
  });

  // Recherche ciblée : la phrase de chaque rubrique se lit sur place, la rubrique mène au RCP.
  it('affiche la phrase de chaque rubrique quand elle est fournie', () => {
    const ciblee = {
      ...RECHERCHE_PLEINE,
      resultats: [{
        ...TROUVAILLE,
        rubriques: [
          { numero: '4.4', libelle: 'Mises en garde', cis: '66297965', ancre: 'rcp-12', extrait: 'allongement de l’<mark>intervalle QT</mark>' },
          { numero: '4.8', libelle: 'Effets indésirables', cis: '66297966', ancre: 'rcp-21', extrait: '<mark>QT</mark> prolongé' },
        ],
      }],
    };
    const html = rendre('documents', { query: 'QT', rubrique: null, documents: ciblee, page: 1 });
    assert.match(html, /class="ligne-phrases"/);
    assert.match(html, /class="phrase-rubrique" href="\/product\/66297965\?q=QT#rcp-12"[^>]*>4\.4</);
    assert.match(html, /intervalle QT<\/mark>/);
    assert.match(html, /<mark>QT<\/mark> prolongé/);
  });

  // Ciblée : les phrases remplacent les colonnes, le tableau se réduit à la molécule.
  it('la recherche ciblée n’a ni colonnes ni en-tête', () => {
    const large = rendre('documents', { query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1 });
    assert.match(large, /col-rubrique/);
    assert.match(large, /class="th-molecule"/);
    assert.match(large, /class="cellule-autres"/);
    const ciblee = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1, ciblee: true,
    });
    assert.match(ciblee, /class="trouvailles trouvailles-ciblees"/);
    assert.doesNotMatch(ciblee, /col-rubrique|th-molecule|cellule-autres|cellule-rubrique|legende/);
    assert.match(ciblee, /class="ligne-dosages"/);
  });

  // L'aperçu au survol est demandé au serveur par clé primaire.
  it('chaque numéro porte de quoi demander son extrait', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /data-cis="66297966" data-type="rcp" data-position="21"/);
  });

  // Alternatives : une section par action, la classe regroupée par molécule, les écartés repliés.
  it('range les substituts par action au comptoir', () => {
    const html = rendre('product', produit({
      genericGroup: 'CICLOPIROX 1 % - MYCOSTER 1 %, crème',
      optionsAlternatives: 4,
      sousClasseAtc: { code: 'D01AE', label: 'AUTRES ANTIFONGIQUES A USAGE TOPIQUE', level: 4 },
      alternatives: { groupe: 'CICLOPIROX', categories: [
        { cle: 'SUBSTITUABLE', action: 'Génériques du groupe', detail: 'De droit', lignes: [
          { id: '1', denomination: 'MYCOSTER 1 %, crème', role: 'Princeps' },
          { id: '2', denomination: 'CICLOPIROX TEVA 1 %, crème', role: 'Générique' },
        ] },
        { cle: 'ALTERNATIVE_CLASSE', action: 'Même sous-classe ATC', detail: 'Même sous-classe', total: 2, molecules: [
          { nom: 'ÉCONAZOLE', atc5: 'D01AC03', specialites: [
            { id: '3', denomination: 'PEVARYL 1 %, crème' }, { id: '4', denomination: 'ECONAZOLE BIOGARAN 1 %, crème' }] },
        ] },
        { cle: 'BLOQUE', action: 'Non substituables', detail: '', lignes: [
          { id: '5', denomination: 'MYCOSTER 8 %, vernis', motif: 'Voie différente (cutanee contre autre)' }] },
      ] },
    }));
    assert.match(html, /<span class="bloc-compte">4 options<\/span>/);
    assert.match(html, /<h3 class="subst-action">Génériques du groupe<\/h3>/);
    assert.match(html, /<h3 class="subst-action">Même sous-classe ATC<\/h3>/);
    assert.match(html, /<a href="\/classe\/D01AE">Autres antifongiques à usage topique<\/a>/);
    assert.match(html, /<span class="subst-molecule">éconazole<\/span><span class="subst-atc">D01AC03<\/span>/);
    assert.match(html, /<details class="subst-ecartes"><summary class="formes-plus">1 écarté, avec la raison<\/summary>/);
    assert.match(html, /Voie différente/);
    assert.match(html, /ansm\.sante\.fr\/documents\/reference\/repertoire-des-medicaments-generiques/);
  });

  it('filtre « sans … » : puces, masqués comptés, étiquettes, et le vide dit', () => {
    const filtre = (categories, masques) => ({
      optionsAlternatives: 3,
      alternatives: { groupe: null, categories },
      parExcipient: {
        sans: ['lactose'], masques, categories,
        filtres: [
          { id: 'lactose', court: 'lactose', actif: true, dansProduit: true },
          { id: 'gelatine', court: 'gélatine', actif: false, dansProduit: false },
        ],
      },
    });
    const html = rendre('product', produit(filtre([
      { cle: 'SUBSTITUABLE', action: 'Génériques du groupe', detail: 'De droit', lignes: [
        { id: '2', denomination: 'X 1 mg, comprimé', role: 'Générique', excipients: { lu: true, courts: ['gélatine'] } },
        { id: '3', denomination: 'Y 1 mg, comprimé', role: 'Générique', excipients: { lu: false, courts: [] } },
      ] },
    ], 1)));
    assert.match(html, /<details class="bloc" id="alternatives" open/);
    assert.match(html, /3 options · 1 masquée/);
    assert.match(html, /class="filtre-excipient actif"[^>]*>lactose<span class="filtre-ici"> \(ce produit\)/);
    // Ôter le seul filtre actif ramène à la fiche sans paramètre ; en ajouter un les cumule.
    assert.match(html, /class="filtre-excipient actif" href="\?#alternatives"/);
    assert.match(html, /href="\?sans=lactose,gelatine#alternatives"/);
    assert.match(html, /1 spécialité masquée : son RCP en indique/);
    assert.match(html, /<span class="excipients-item">gélatine<\/span>/);
    assert.match(html, /<span class="excipients-item non-lu">non lu<\/span>/);
    assert.doesNotMatch(html, /Aucune alternative sans/);

    // Tout masqué sauf les écartés : le bloc reste, le vide est dit, le filtre s'ôte.
    const vide = rendre('product', produit(filtre([
      { cle: 'BLOQUE', action: 'Non substituables', detail: '', lignes: [{ id: '5', denomination: 'Z', motif: 'Voie différente' }] },
    ], 2)));
    assert.match(vide, /Aucune alternative sans lactose\./);
    assert.match(vide, /class="filtre-excipient actif"/);
  });

  it('sans candidat, pas de bloc Alternatives', () => {
    assert.doesNotMatch(rendre('product', produit()), /id="alternatives"/);
  });

  // Filtrer fait passer sous le plafond : le décompte doit rester.
  it('compte les rubriques exactement, et dit les molécules non détaillées', () => {
    const filtre = rendre('documents', {
      query: 'QT',
      rubrique: '4.5',
      page: 1,
      documents: { ...RECHERCHE_PLEINE, total: 312, borne: false },
    });
    assert.match(filtre, /312 rubriques/);
    assert.doesNotMatch(filtre, /premières détaillées/);

    const large = rendre('documents', {
      query: 'QT', rubrique: null, page: 1, documents: RECHERCHE_PLEINE,
    });
    assert.match(large, /10[\s\u202f]358 rubriques · 461 molécules, les 200 premières détaillées/);
    assert.doesNotMatch(large, /plus de/);

    // Dernière page : l'invitation à affiner remplace « Suivants ».
    const fin = rendre('documents', {
      query: 'QT', rubrique: null, page: 4, documents: { ...RECHERCHE_PLEINE, suite: false, decalage: 150 },
    });
    assert.match(fin, /Les 200 molécules les mieux classées sont détaillées, sur 461\./);
  });

  // Préremplie pour affiner ; une saisie repart par nom comme partout : « paracetamol »
  // tapé ici donne les spécialités, pas le mot cherché dans tous les documents.
  it('la barre porte la requête et resoumet à la recherche par nom', () => {
    const html = rendre('documents', {
      query: 'intervalle QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /action="\/search"/);
    assert.doesNotMatch(html, /action="\/documents"/);
    assert.match(html, /value="intervalle QT"/);
  });

  // Sinon un résultat sans le mot tapé passe pour une erreur ; une requête citée n'est pas élargie.
  it('dit ce que le thésaurus a cherché en plus, et comment le refuser', () => {
    const html = rendre('documents', {
      query: 'QT',
      rubrique: null,
      page: 1,
      documents: {
        ...RECHERCHE_PLEINE,
        elargissements: [{ terme: 'QT', vers: ['intervalle QT', 'torsade de pointes'] }],
      },
    });
    assert.match(html, /« QT » cherché aussi comme/);
    assert.match(html, /« intervalle QT », « torsade de pointes »<\/span>\./);
    assert.match(html, /Recherche de l’expression exacte\s*<a class="elargi-exact" href="\/documents\?q=%22QT%22"[^>]*>« QT »<\/a>\./);
  });

  it('se tait quand rien n’a été élargi', () => {
    const html = rendre('documents', {
      query: 'paracétamol', rubrique: null, page: 1, documents: RECHERCHE_PLEINE,
    });
    assert.doesNotMatch(html, /cherché aussi comme/);
  });
});

describe('page de classe', () => {
  const CLASSE = {
    code: 'M01A', label: 'ANTIINFLAMMATOIRES NON STEROIDIENS', level: 3, specialites: 600,
    chaine: [{ code: 'M', label: 'Muscle', level: 1 }, { code: 'M01A', label: 'AINS', level: 3 }],
    enfants: [],
  };
  const page = (extra) => rendre('classe', {
    classe: CLASSE, commercialisees: [], retirees: [], feuille: false, molecules: [],
    portrait: [], chapeau: null, ...extra,
  });

  // Unité unique : la spécialité commercialisée.
  it('compte en spécialités, et montre le portrait', () => {
    const html = page({ portrait: [{ valeur: '41\u00A0%', libelle: 'génériques' }] });
    assert.match(html, /class="portrait-valeur">41/);
    assert.match(html, /600 spécialités commercialisées/);
    assert.doesNotMatch(html, /produit/i);
  });

  // Les spécialités retirées sont repliées.
  it('range les spécialités par forme et par nom, un lien par dosage', () => {
    const sp = (id, denomination, forme, extra = {}) => ({
      id, denomination, forme_pharmaceutique: forme, titulaires: 'LABO', ...extra,
    });
    const html = page({
      feuille: true,
      commercialisees: regrouperSpecialites([
        sp('1', 'DUROGESIC 12 microgrammes/heure, dispositif transdermique', 'dispositif transdermique', { princeps: true }),
        sp('2', 'DUROGESIC 100 microgrammes/heure, dispositif transdermique', 'dispositif transdermique', { princeps: true }),
        sp('3', 'ABSTRAL 100 microgrammes, comprimé sublingual', 'comprimé sublingual'),
      ]),
      retirees: regrouperSpecialites([sp('4', 'FENTANYL X 25 microgrammes/heure, dispositif transdermique', 'dispositif transdermique')]),
    });
    assert.match(html, /Spécialités commercialisées<span class="compte">3</);
    assert.match(html, /Dispositif transdermique<span class="compte">2</);
    assert.match(html, /href="\/product\/1"[^>]*>12<\/a>.*href="\/product\/2"[^>]*>100<\/a> µg\/h/s);
    assert.match(html, /<span class="marque">Princeps/);
    // Une seule spécialité : un lien aussi ; le nom n'est jamais un lien.
    // Nom propre : capitale initiale, le reste en bas de casse (casse.js).
    assert.match(html, /<span class="specialite-nom">Abstral/);
    assert.match(html, /href="\/product\/3"[^>]*>100<\/a> µg/);
    assert.match(html, /1 spécialité non commercialisée/);
  });

  it('dit la substitution des biosimilaires quand le groupe l’autorise', () => {
    const html = page({ substitution: { arrete_le: '2026-04-10', url_arrete: 'https://a', url_conditions: 'https://b' } });
    assert.match(html, /Substituable en officine/);
    assert.match(html, /arrêté du 10 avril 2026/);
    assert.doesNotMatch(page({}), /Substituable en officine/);
    // Lien écarté par lienWeb : l'arrêté reste nommé, sans lien.
    const sansLien = page({ substitution: { arrete_le: '2026-04-10', url_arrete: null, url_conditions: null } });
    assert.match(sansLien, /arrêté du 10 avril 2026/);
    assert.doesNotMatch(sansLien, /<a[^>]*>arrêté du|ameli/);
  });

  it('se rend sans portrait ni chapeau', () => {
    const html = page({});
    assert.doesNotMatch(html, /class="portrait"/);
    assert.doesNotMatch(html, /class="chapeau"/);
  });

  it('montre le chapeau signé, et le dit brouillon tant qu’il n’est pas relu', () => {
    const chapeau = { slug: 'm01a', meta: { auteur: 'Dr L. Staub' }, blocs: [{ type: 'html', html: '<p>Texte.</p>' }] };
    const html = page({ chapeau });
    assert.match(html, /<p>Texte\.<\/p>/);
    assert.match(html, /Dr L\. Staub/);
    assert.match(html, /Brouillon/);
    assert.doesNotMatch(page({ chapeau: { ...chapeau, meta: { auteur: 'A', relu: '2026-09-28' } } }), /Brouillon/);
  });
});

describe('fiche produit — conditions de délivrance illisibles', () => {
  const indisponible = { resume: [], bloque: false, groupes: [], liens: [], indisponible: true };
  const bdpm = { key: 'bdpm', label: 'Fiche officielle BDPM', url: 'https://bdpm.example/66297965' };

  it('le dit et renvoie à la BDPM, sans affirmer « aucune liste »', () => {
    const html = rendre('product', produit({
      delivrance: indisponible,
      links: { ...productLinks({ id: '1', denomination_medicament: 'X' }), official: [bdpm], scientific: [] },
    }));
    assert.match(html, /Conditions indisponibles/);
    assert.match(html, /n'ont pas pu être lues/);
    assert.match(html, /href="https:\/\/bdpm\.example\/66297965"/);
    assert.doesNotMatch(html, /Aucune condition enregistrée/);
    assert.doesNotMatch(html, /aucune liste de substances vénéneuses/);
  });

  it('sans panne, l’absence de condition reste dite comme avant', () => {
    const html = rendre('product', produit());
    assert.match(html, /Aucune condition enregistrée/);
    assert.doesNotMatch(html, /n'ont pas pu être lues/);
  });
});

describe('fiche produit — pannes visibles bloc fermé', () => {
  const entete = (html) => html.match(/<summary class="bloc-tete"><h2 class="section-titre">Délivrance[\s\S]*?<\/summary>/)[0];
  const bdpm = { key: 'bdpm', label: 'Fiche officielle BDPM', url: 'https://bdpm.example/66297965' };
  const liens = { ...productLinks({ id: '1', denomination_medicament: 'X' }), official: [bdpm], scientific: [] };

  it('la panne des conditions se lit dans l’en-tête, même avec des indications remboursées', () => {
    const html = rendre('product', produit({
      delivrance: { resume: [], bloque: null, groupes: [], liens: [], indisponible: true },
      remboursement: REMBOURSEMENT,
      links: liens,
    }));
    assert.match(entete(html), /Conditions indisponibles/);
    assert.match(entete(html), /Indications remboursées/);
  });

  it('la panne du remboursement se dit « à vérifier », jamais « non remboursé »', () => {
    const html = rendre('product', produit({
      remboursement: { texte: null, taux: null, indisponible: true },
      links: liens,
    }));
    assert.match(entete(html), /Prise en charge à vérifier/);
    assert.doesNotMatch(entete(html), /Indications remboursées/);
    assert.match(html, /indications ouvrant droit au remboursement n'ont pas pu être lues/);
    assert.match(html, /href="https:\/\/bdpm\.example\/66297965"/);
    assert.doesNotMatch(html, /class="remboursement-texte"/);
  });
});

describe('fiche produit — condition complétée', () => {
  it('dit dans le bloc que la condition ne vient pas de la BDPM', () => {
    const delivrance = {
      resume: [{ cle: 'classement', portee: 'info', ordre: 0, court: 'Liste I', long: 'Liste I' }],
      bloque: false,
      groupes: [{ cle: 'classement', titre: 'Classement', conditions: [{ population: null, segments: [{ texte: 'Liste I', fort: false }], brut: 'liste I' }] }],
      liens: [],
      complement: { motif: 'Ses équivalentes sont en liste I.', confirme_le: '2026-10-13' },
    };
    const html = rendre('product', produit({ delivrance }));
    assert.match(html, /Condition absente de la BDPM, complétée le 13\/10\/2026 : Ses équivalentes sont en liste I\./);
    // L'en-tête du bloc ne répète plus les conditions : la bande les porte, origine comprise.
    const bande = signaletique({ id: '1', denomination_medicament: 'X' }, delivrance, null, null);
    assert.match(bande.find((signal) => signal.cle === 'ordonnance').detail, /complété, absent de la BDPM : Ses équivalentes/);
  });
});

describe('fiche produit — degrés de la bande', () => {
  it('le stupéfiant en gras, l’aplat pour ce qui ne se délivre pas en officine', () => {
    const html = rendre('product', produit({ signaletique: [
      { cle: 'ordonnance', picto: 'cadenas', libelle: 'Ordonnance', valeur: 'Stupéfiant', fort: true },
      { cle: 'cadre', picto: 'hopital', libelle: 'Prescription', valeur: 'Hors officine', portee: 'bloque' },
    ] }));
    assert.match(html, /<li class="signal signal-fort"[^>]*data-cle="ordonnance"/);
    assert.match(html, /<li class="signal signal-bloque"[^>]*data-cle="cadre"/);
  });
});
