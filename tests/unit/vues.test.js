import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import pug from 'pug';
import { ROOT } from '../../src/config.js';
import { COLONNES } from '../../src/recherche-texte.js';
import { productLinks } from '../../src/links.js';
import { lireEtat, lien } from '../../src/etat-recherche.js';
import { dci, specialite, phrase } from '../../src/casse.js';
import { regrouperSpecialites } from '../../src/specialites.js';

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
    v: 'test', lien, dci, specialite, phrase, colonnes: COLONNES, etat, ...locals,
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
  substitutions: [],
  variantes: [],
  remboursement: null,
  resumeAtc: null,
  railActif: null,
  genericGroup: null,
  documents: [],
  hasDocuments: false,
  delivrance: { resume: [], groupes: [], liens: [] },
  signaletique: [],
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
  total: 3000,
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

  // Une ligne de valeurs, dans l'ordre ; libellé et détail en infobulle, l'aplat marque ce qui bloque.
  it('la bande signalétique rend ses cases dans l\'ordre, valeurs seules, picto et aplat', () => {
    const html = rendre('product', produit({
      signaletique: [
        { cle: 'ordonnance', picto: 'cadenas', libelle: 'Ordonnance', valeur: 'Stupéfiant', detail: 'Stupéfiant', portee: 'bloque' },
        { cle: 'prix', picto: 'euro', libelle: 'Prise en charge', valeur: '65 % · 2,10 €' },
        { cle: 'atc', picto: 'arbre', libelle: 'ATC', valeur: 'N02AA01', detail: 'morphine', lien: '/classe/N02AA01' },
      ],
    }));
    assert.match(html, /<section class="signaletique"/);
    assert.match(html, /class="signal signal-bloque" title="Ordonnance — Stupéfiant" data-cle="ordonnance"><svg class="picto"/);
    assert.match(html, /title="Prise en charge" data-cle="prix">.*?<span class="signal-valeur">65 % · 2,10 €<\/span>/);
    assert.match(html, /<a class="signal-valeur" href="\/classe\/N02AA01">N02AA01<\/a>/);
    assert.doesNotMatch(html, /signal-libelle/);
    assert.ok(html.indexOf('data-cle="ordonnance"') < html.indexOf('data-cle="prix"'));
    assert.doesNotMatch(rendre('product', produit()), /signaletique/);
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
    assert.match(accueil, /localStorage\.getItem\('apparence'\)[\s\S]*<link rel="stylesheet"/);
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

  it('l’exemple disparaît une fois la recherche faite', () => {
    const html = rendre('search_page', {
      query: 'aspirine',
      filter: 'all',
      results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
      documents: RECHERCHE_VIDE,
    });
    assert.doesNotMatch(html, /accueil-exemple/);
  });

  // Pas de barre de situation sur cette page : le titre du bandeau est le seul retour.
  it('la page de résultats ramène à l’accueil', () => {
    const html = rendre('search_page', {
      query: 'valsartan',
      filter: 'all',
      results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
      documents: RECHERCHE_VIDE,
    });
    assert.match(html, /<a class="titre-lien" href="\/">Dr Kevin<\/a>/);
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

  // Le Répertoire ANSM fonde la substitution ; le rapprochement par principe actif, non.
  it('dit d’où viennent les substituts, et ce qui n’en est pas', () => {
    const html = rendre('product', produit({
      substitutions: [
        { id: '1', denomination_medicament: 'MYCOSTER', role: 'Princeps' },
        { id: '2', denomination_medicament: 'CICLOPIROX TEVA', role: 'Générique' },
        { id: '3', denomination_medicament: 'MYCOSTER shampooing', role: 'Même DCI' },
      ],
    }));
    assert.match(html, /Répertoire des groupes génériques de l’ANSM|Répertoire des groupes génériques de l'ANSM/);
    assert.match(html, /ansm\.sante\.fr\/documents\/reference\/repertoire-des-medicaments-generiques/);
    assert.match(html, /sans substitution de droit/);
  });

  // Un avertissement sans objet apprend à ne plus lire les avertissements.
  it('se tait sur « Même DCI » quand il n’y en a pas', () => {
    const html = rendre('product', produit({
      substitutions: [{ id: '1', denomination_medicament: 'MYCOSTER', role: 'Princeps' }],
    }));
    assert.match(html, /Répertoire des groupes génériques/);
    assert.doesNotMatch(html, /sans substitution de droit/);
  });

  // Filtrer fait passer sous le plafond : le décompte doit rester.
  it('compte les résultats, plafonnés ou non', () => {
    const filtre = rendre('documents', {
      query: 'QT',
      rubrique: '4.5',
      page: 1,
      documents: { ...RECHERCHE_PLEINE, total: 312, borne: false },
    });
    assert.match(filtre, /312 rubriques/);
    assert.doesNotMatch(filtre, /plus de/);

    const plafonne = rendre('documents', {
      query: 'QT', rubrique: null, page: 1, documents: RECHERCHE_PLEINE,
    });
    assert.match(plafonne, /plus de 3 000 rubriques|plus de 3\u202f000 rubriques/);
  });

  // Préremplie pour affiner, et dans le mode courant pour ne pas changer de question.
  it('la barre porte la requête et resoumet au bon endroit', () => {
    const html = rendre('documents', {
      query: 'intervalle QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /action="\/documents"/);
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
