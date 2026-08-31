import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import pug from 'pug';
import { ROOT } from '../../src/config.js';
import { COLONNES } from '../../src/recherche-texte.js';
import { productLinks } from '../../src/links.js';

/**
 * Les gabarits se rendent, et pas seulement se compilent.
 *
 * `pug.compileFile` ne vérifie rien de ce qui se résout à l'exécution : un
 * mixin absent compile sans une plainte et casse à la première visite. C'est
 * arrivé sur la page des documents — elle appelait `barreSituation` sans
 * inclure `_barre.pug`, et trois vérifications « pug ok » de suite l'ont
 * laissée passer.
 *
 * Rendre chaque page avec des données minimales coûte quelques millisecondes
 * et attrape toute la famille : mixin manquant, variable indéfinie, boucle sur
 * ce qui n'est pas un tableau.
 */
const rendre = (vue, locals) => pug.renderFile(
  path.join(ROOT, 'views', `${vue}.pug`),
  // `colonnes` est fourni par les deux routes qui rendent des trouvailles :
  // l'omettre ici ferait échouer le rendu pour une raison qui n'existe pas.
  { v: 'test', colonnes: COLONNES, ...locals },
);

const RECHERCHE_VIDE = { resultats: [], total: 0, borne: false, decalage: 0, suite: false };

// La fiche produit prend une quinzaine de variables. Les fournir toutes est le
// prix du test : c'est précisément la page où une locale oubliée casse tout.
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
  // Les liens viennent de productLinks : les recopier à la main ici, c'est
  // rater le jour où la fiche en cite un nouveau — ce qui vient d'arriver.
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
};

// Deux spécialités sur treize mille six cents : la dénomination tient lieu de
// titre, et le lien va à la fiche, pas à une recherche par principe actif.
const SANS_MOLECULE = {
  ...TROUVAILLE,
  signature: 'cis:66297967',
  molecule: 'SPECIALITE SANS COMPOSITION',
  denomination: 'SPECIALITE SANS COMPOSITION',
  sansMolecule: true,
  specialites: 1,
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

  // Le cas qui a cassé : une page qui appelle un mixin d'un fichier qu'elle
  // n'inclut pas. Le rendu est le seul moment où ça se voit.
  it('la page des documents dispose de la barre de situation', () => {
    const html = rendre('documents', { query: 'QT', rubrique: null, documents: RECHERCHE_VIDE });
    assert.match(html, /class="barre"/);
  });

  // La prise en charge restreinte vient d'une autre table que les conditions
  // de délivrance : elle doit s'afficher même pour une spécialité sans aucune
  // condition enregistrée, sinon la mention de l'en-tête annonce un bloc vide.
  it('la prise en charge restreinte s’affiche sans condition de délivrance', () => {
    const html = rendre('product', produit({ remboursement: REMBOURSEMENT }));
    assert.match(html, /Indications remboursées/);
    assert.match(html, /dysfonction érectile/);
    assert.match(html, /meddispar\.fr\/Medicaments-d-exception\/Criteres/);
    assert.doesNotMatch(html, /aucune condition de prescription/);
  });

  // On rapporte la restriction, on ne qualifie pas la spécialité : le champ de
  // l'Assurance Maladie ne dit pas « médicament d'exception », et deux
  // présentations sur huit cents seulement emploient le mot.
  it('la fiche ne qualifie pas le produit de médicament d’exception', () => {
    const html = rendre('product', produit({ remboursement: REMBOURSEMENT }));
    const hors = html.replace(/<a[^>]*>[\s\S]*?<\/a>/g, '');
    assert.doesNotMatch(hors, /médicament d.exception/i);
  });

  // Le décompte annonçait des milliers de rubriques et la page en montrait
  // vingt, sans dire où étaient les autres.
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

  // Retour à la première page : elle s'écrit sans paramètre, sinon deux URL
  // rendent la même page et le lien « actif » se dédouble.
  it('revient à la première page sans paramètre de page', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: { ...RECHERCHE_PLEINE, decalage: 20 }, page: 2,
    });
    assert.doesNotMatch(html, /page=1/);
  });

  // La recherche plein texte ne s'annonçait nulle part : elle n'apparaissait
  // qu'en bas de page, une fois la recherche par nom déjà faite.
  it('la page de recherche annonce la recherche plein texte', () => {
    const html = rendre('search_page', {
      query: 'intervalle QT',
      filter: 'all',
      results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
      documents: RECHERCHE_PLEINE,
    });
    assert.match(html, /Dans les documents/);
    assert.match(html, /href="\/documents\?q=intervalle%20QT"/);
  });

  // Le regroupement par molécule ne sert à rien si le numéro de rubrique ne
  // mène nulle part de précis : chaque puce porte l'ancre de sa meilleure
  // occurrence, qui n'est pas forcément la spécialité de l'extrait.
  it('chaque rubrique porte sa propre ancre', () => {
    const html = rendre('documents', {
      query: 'intervalle QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /href="\/product\/66297965#rcp-12"/);
    assert.match(html, /href="\/product\/66297966#rcp-21"/);
    assert.match(html, /66 spécialités/);
  });

  // La molécule mène à toutes ses spécialités ; celle qui n'en a pas mène à sa
  // fiche, sinon le lien conduirait à une recherche vide.
  it('la molécule mène à ses spécialités, sauf quand il n’y en a pas', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /href="\/search\?q=OLANZAPINE&amp;filter=active"/);
    assert.match(html, /href="\/product\/66297967#rcp-12"/);
  });

  // L'extrait est replié mais présent : sans lui la liste dit où le mot
  // figure, jamais ce que le document en dit.
  it('l’extrait reste accessible, et nomme la spécialité dont il vient', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /<details class="preuve">/);
    assert.match(html, /intervalle QT<\/mark>/);
    assert.match(html, /OLANZAPINE ALPHA 5 mg, comprimé/);
  });

  // Sur la page de garde, le champ énumérait « Dénomination ou principe
  // actif » : il ne laissait pas ignorer la recherche plein texte, il la
  // niait. L'onglet, lui, ne paraît qu'une fois la recherche lancée.
  it('la page de garde montre qu’on peut chercher une expression', () => {
    const html = rendre('search_page', { query: '', filter: 'all', results: null, classes: [] });
    assert.match(html, /Dénomination, principe actif ou expression/);
    assert.match(html, /href="\/documents\?q=allongement\+QT"/);
  });

  // L'exemple s'efface dès qu'on a cherché : il enseigne, il n'encombre pas.
  it('l’exemple disparaît une fois la recherche faite', () => {
    const html = rendre('search_page', {
      query: 'aspirine',
      filter: 'all',
      results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
      documents: RECHERCHE_VIDE,
    });
    assert.doesNotMatch(html, /accueil-exemple/);
  });

  // La page de résultats n'a pas la barre de situation : son bandeau lui tient
  // lieu d'en-tête, et le titre n'était pas cliquable. Une fois la recherche
  // lancée, il ne restait que le bouton du navigateur.
  it('la page de résultats ramène à l’accueil', () => {
    const html = rendre('search_page', {
      query: 'valsartan',
      filter: 'all',
      results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
      documents: RECHERCHE_VIDE,
    });
    assert.match(html, /<a class="titre-lien" href="\/">Demander à Kevin<\/a>/);
  });

  it('mais la page de garde ne se lie pas à elle-même', () => {
    const html = rendre('search_page', { query: '', filter: 'all', results: null, classes: [] });
    assert.doesNotMatch(html, /titre-lien/);
  });

  // Les colonnes sont fixes, et non l'union de ce que la recherche a trouvé :
  // des colonnes qui changent de place d'une requête à l'autre ne s'apprennent
  // jamais. Ce qui tombe hors des huit se nomme dans « Autres ».
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
            { numero: '4.8', libelle: 'Effets', cis: '1', ancre: 'rcp-2' },
            { numero: '2', libelle: 'Composition', cis: '1', ancre: 'rcp-9' },
          ],
        }],
      },
    });
    // Huit colonnes de rubrique, plus la molécule et le fourre-tout.
    assert.equal((html.match(/col-rubrique/g) || []).length, COLONNES.length);
    // La 2 n'a pas de colonne réservée, mais elle se nomme au lieu de disparaître.
    assert.match(html, /class="puce puce-autre"[^>]*>2</);
    // La 4.4, absente de ce résultat, laisse sa cellule vide sans décaler les autres.
    assert.match(html, /<td class="cellule-rubrique"><\/td>/);
  });

  // `title` attend une seconde avant de paraître : sur une ligne de huit
  // numéros, c'est huit secondes pour lire ce que la ligne annonce.
  it('porte son infobulle plutôt que celle du navigateur', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /data-titre="4\.4 Mises en garde"/);
    assert.match(html, /aria-label="4\.4 Mises en garde"/);
    assert.doesNotMatch(html, /<a class="puce"[^>]*title=/);
  });

  // La rangée d'onglets listait les huit mêmes rubriques que l'en-tête du
  // tableau, deux lignes au-dessus de lui : la même liste écrite deux fois sur
  // le même écran, dont l'une ne portait aucune donnée.
  it('filtre depuis l’en-tête, sans rangée d’onglets', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.doesNotMatch(html, /class="filtres"/);
    assert.match(html, /class="th-lien" href="\/documents\?q=QT&amp;rubrique=4\.5"/);
  });

  // Filtrée, la page n'a plus de colonnes à montrer — toutes les trouvailles
  // sont dans la rubrique choisie — et l'extrait devient la réponse.
  it('replie les colonnes quand une rubrique est choisie', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: '4.5', documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.doesNotMatch(html, /col-rubrique/);
    assert.doesNotMatch(html, /cellule-autres/);
    // La rubrique active et son retrait vivent dans la ligne d'état.
    assert.match(html, /class="jeton"[^>]*>rubrique 4\.5/);
    assert.match(html, /class="jeton" href="\/documents\?q=QT"/);
    assert.match(html, /<details class="preuve" open="open">/);
  });

  // Le repli annonçait « Extrait » quand la ligne montre quatre rubriques :
  // rien ne disait de laquelle il venait.
  it('le repli nomme la rubrique de son extrait', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /class="preuve-rubrique">4\.4 Mises en garde spéciales/);
  });

  // L'aperçu au survol se demande au serveur : la puce porte de quoi le
  // désigner, sa clé primaire, et rien de plus.
  it('chaque numéro porte de quoi demander son extrait', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /data-cis="66297966" data-type="rcp" data-position="21"/);
  });

  // L'encoche pointe la colonne d'où vient l'extrait. Sa position se calcule
  // sur des largeurs fixes ancrées à droite : rien à mesurer au navigateur.
  it('pointe la colonne de l’extrait', () => {
    const encoche = (numero) => {
      const html = rendre('documents', {
        query: 'QT',
        rubrique: null,
        page: 1,
        documents: {
          ...RECHERCHE_PLEINE,
          resultats: [{
            ...TROUVAILLE,
            numero,
            rubriques: [{ numero, libelle: 'L', cis: '1', ancre: 'rcp-1' }],
          }],
        },
      });
      return (html.match(/--encoche: ([^"]+)/) || [])[1];
    };
    // Première colonne : sept colonnes de rubrique la séparent du fourre-tout.
    assert.equal(encoche('4.1'), 'calc(5.5rem + 7 * 2.6rem + 1.3rem)');
    // Dernière : elle jouxte le fourre-tout.
    assert.equal(encoche('5.1'), 'calc(5.5rem + 0 * 2.6rem + 1.3rem)');
    // Hors des huit : l'encoche vise « Autres », qui porte le numéro.
    assert.equal(encoche('2'), '2.75rem');
  });

  // Filtrée, la page n'a plus de colonnes : une encoche pointerait le vide.
  it('n’en pose pas quand il n’y a plus de colonnes', () => {
    const html = rendre('documents', {
      query: 'QT', rubrique: '4.5', documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.doesNotMatch(html, /--encoche/);
  });

  // « Substituer » mêle deux provenances que le titre confond : le Répertoire
  // de l'ANSM, qui fonde la substitution, et notre rapprochement par principe
  // actif, qui ne la fonde pas. Les taire laisserait entendre qu'une liste
  // officielle autorise tout ce qui figure sous ce titre.
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

  // Sans voisin de DCI, la mise en garde n'a pas lieu d'être : un avertissement
  // qui ne porte sur rien s'apprend à ne plus être lu.
  it('se tait sur « Même DCI » quand il n’y en a pas', () => {
    const html = rendre('product', produit({
      substitutions: [{ id: '1', denomination_medicament: 'MYCOSTER', role: 'Princeps' }],
    }));
    assert.match(html, /Répertoire des groupes génériques/);
    assert.doesNotMatch(html, /sans substitution de droit/);
  });

  // Le décompte ne paraissait que si la recherche avait été plafonnée —
  // c'est-à-dire jamais quand on filtre, puisque filtrer fait passer sous le
  // plafond. C'était l'écran où le chiffre manquait le plus.
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

  // Le champ partait vide : affiner imposait de tout retaper. Et il resoumet
  // dans le mode courant — prérempli mais pointant vers la recherche par nom,
  // il aurait fait croire qu'on affine quand on change de question.
  it('la barre porte la requête et resoumet au bon endroit', () => {
    const html = rendre('documents', {
      query: 'intervalle QT', rubrique: null, documents: RECHERCHE_PLEINE, page: 1,
    });
    assert.match(html, /action="\/documents"/);
    assert.match(html, /value="intervalle QT"/);
  });
});
