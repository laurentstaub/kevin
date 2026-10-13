import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signaletique, pictoForme, abregerForme } from '../../src/signaletique.js';
import { classer } from '../../src/delivrance.js';
import { resumerEvaluation } from '../../src/has.js';

const produit = (extra = {}) => ({
  denomination_medicament: 'SKENAN L.P. 10 mg, gélule à libération prolongée',
  forme_pharmaceutique: 'gélule à libération prolongée',
  commercialise: true,
  type_generique: 0,
  cip_products: [
    { code_cip13: '3400934071485', libelle_presentation: 'plaquette(s) de 14 gélules', commercialise: true, taux: '65%', prix: '3.47' },
    { code_cip13: '3400934071546', libelle_presentation: 'plaquette(s) de 28 gélules', commercialise: false, taux: '65%', prix: '6.60' },
  ],
  ...extra,
});

const mention = (cle, court, portee = 'verifier') => ({ cle, court, long: `${court} (long)`, portee });
const cles = (cases) => cases.map((cas) => cas.cle);
const valeur = (cases, cle) => cases.find((cas) => cas.cle === cle)?.valeur;

describe('bande signalétique', () => {
  it('ordonne les cases : délivrer, payer, substituer, forme, classer', () => {
    const cases = signaletique(produit(), { resume: [
      mention('classement', 'Stupéfiant', 'bloque'), mention('duree', '28 j max'), mention('support', 'Ordo sécurisée'),
    ] }, { feuille: { code: 'N02AA01', label: 'MORPHINE' } }, 'Morphine 10 mg', false);
    assert.deepEqual(cles(cases), ['ordonnance', 'duree', 'cadre', 'prix', 'generique', 'forme', 'atc']);
  });

  it('marque le stupéfiant par le cadenas et l\'aplat', () => {
    const cases = signaletique(produit(), { resume: [mention('classement', 'Stupéfiant', 'bloque')] }, null, null, false);
    const ordonnance = cases.find((cas) => cas.cle === 'ordonnance');
    assert.equal(ordonnance.picto, 'cadenas');
    assert.equal(ordonnance.portee, 'bloque');
    // Le classement n'est pas répété dans la case Prescription.
    assert.equal(cases.find((cas) => cas.cle === 'cadre'), undefined);
  });

  it('bloque la case Prescription sur une mention bloquante hors classement', () => {
    const cases = signaletique(produit(), { resume: [mention('cadre', 'Hôpital seulement', 'bloque'), mention('support', 'Ordo sécurisée')] }, null, null, false);
    const cadre = cases.find((cas) => cas.cle === 'cadre');
    assert.equal(cadre.valeur, 'Hôpital seulement · Ordo sécurisée');
    assert.equal(cadre.portee, 'bloque');
  });

  it('sans mention, dit « Sans ordonnance »', () => {
    assert.equal(valeur(signaletique(produit(), { resume: [] }, null, null, false), 'ordonnance'), 'Sans ordonnance');
  });

  it('ne compte que les présentations commercialisées pour le prix', () => {
    const cases = signaletique(produit(), { resume: [] }, null, null, false);
    assert.equal(valeur(cases, 'prix'), '65\u202f% · 3,47\u202f€');
    assert.equal(cles(cases).includes('cip'), false);
  });

  it('montre le plus petit prix, la fourchette en détail', () => {
    const cases = signaletique(produit({
      cip_products: [
        { code_cip13: '1', libelle_presentation: 'a', taux: '30%', prix: '2' },
        { code_cip13: '2', libelle_presentation: 'b', taux: '65%', prix: '4.5' },
      ],
    }), { resume: [] }, null, null, false);
    assert.equal(valeur(cases, 'prix'), '30\u202f% / 65\u202f% · 2,00\u202f€');
    assert.match(cases.find((cas) => cas.cle === 'prix').detail, /a : 2,00\u202f€ ; b : 4,50\u202f€/);
  });

  it('donne les deux prix, honoraire compris d’abord, quel que soit l’ordre des colonnes', () => {
    for (const [prix, prix2] of [['19.5', '20.52'], ['20,52', '19,50']]) {
      const cases = signaletique(produit({
        cip_products: [{ code_cip13: '1', libelle_presentation: 'a', taux: '65%', prix, prix_2: prix2 }],
      }), { resume: [] }, null, null, false);
      assert.equal(valeur(cases, 'prix'), '65\u202f% · 20,52\u202f€ · 19,50\u202f€ hors hon.');
    }
  });

  it('dit « Non remboursé » sans taux ni prix', () => {
    const cases = signaletique(produit({ cip_products: [{ code_cip13: '1', libelle_presentation: 'a' }] }), { resume: [] }, null, null, false);
    assert.equal(valeur(cases, 'prix'), 'Non remboursé');
  });

  it('nomme la place dans le groupe et l\'importation', () => {
    const cases = signaletique(produit({ type_generique: 1 }), { resume: [] }, null, 'Morphine 10 mg', true);
    const generique = cases.find((cas) => cas.cle === 'generique');
    assert.equal(generique.valeur, 'Générique');
    assert.equal(generique.detail, 'Morphine 10 mg');
    assert.equal(valeur(cases, 'importation'), 'Importation parallèle');
    assert.equal(cles(signaletique(produit({ type_generique: null }), { resume: [] }, null, null, false)).includes('generique'), false);
  });

  // La bande reste visible partout : porte d'entrée du bloc Alternatives.
  it('compte les alternatives et mène au bloc', () => {
    const cases = signaletique(produit(), { resume: [] }, null, 'Morphine 10 mg', false, null, 14);
    const generique = cases.find((cas) => cas.cle === 'generique');
    assert.equal(generique.valeur, 'Princeps · 14\u00a0options');
    assert.equal(generique.lien, '#alternatives');
    const une = signaletique(produit({ type_generique: 1 }), { resume: [] }, null, null, false, null, 1);
    assert.equal(valeur(une, 'generique'), 'Générique · 1\u00a0option');
  });

  it('hors groupe générique, une case Alternatives s’il y en a', () => {
    const cases = signaletique(produit({ type_generique: null }), { resume: [] }, null, null, false, null, 6);
    assert.equal(valeur(cases, 'generique'), 'Alternatives · 6');
    assert.equal(cases.find((cas) => cas.cle === 'generique').lien, '#alternatives');
    const sans = signaletique(produit(), { resume: [] }, null, null, false, null, 0);
    assert.equal(sans.find((cas) => cas.cle === 'generique').lien, null);
  });

  it('abrège la forme, le libellé complet en détail, et choisit son picto', () => {
    const cases = signaletique(produit(), { resume: [] }, null, null, false);
    const forme = cases.find((cas) => cas.cle === 'forme');
    assert.equal(forme.picto, 'gelule');
    assert.equal(forme.valeur, 'gélule LP');
    assert.equal(forme.detail, 'gélule à libération prolongée');
  });

  it('signale la spécialité non commercialisée comme bloquante', () => {
    const cases = signaletique(produit({ commercialise: false }), { resume: [] }, null, null, false);
    assert.deepEqual(cases.find((cas) => cas.cle === 'etat'), { cle: 'etat', picto: 'barre', libelle: 'État', valeur: 'Non commercialisé', portee: 'bloque' });
  });

  it('place l’évaluation HAS après le prix, avec un lien vers le bloc s’il y a des avis', () => {
    const cases = signaletique(produit(), { resume: [] }, null, null, false,
      { valeur: 'SMR important · ASMR V', detail: 'Dernier avis CT du 04/03/2026', avis: 2 });
    assert.deepEqual(cles(cases).slice(1, 3), ['prix', 'has']);
    assert.equal(cases.find((cas) => cas.cle === 'has').lien, '#evaluation');
    const sans = signaletique(produit(), { resume: [] }, null, null, false, { valeur: 'Pas d’avis HAS', detail: null, avis: 0 });
    assert.equal(sans.find((cas) => cas.cle === 'has').lien, null);
  });

  it('relie la feuille ATC à sa classe', () => {
    const cases = signaletique(produit(), { resume: [] }, { feuille: { code: 'N02AA01', label: 'MORPHINE' } }, null, false);
    assert.equal(cases.find((cas) => cas.cle === 'atc').lien, '/classe/N02AA01');
  });
});

describe('picto de la forme', () => {
  it('reconnaît les grandes familles', () => {
    assert.equal(pictoForme('comprimé pelliculé sécable'), 'comprime');
    assert.equal(pictoForme('solution injectable en seringue préremplie'), 'injection');
    assert.equal(pictoForme('collyre en solution'), 'goutte');
    assert.equal(pictoForme('crème'), 'tube');
    assert.equal(pictoForme('poudre pour solution buvable en sachet'), 'sachet');
    assert.equal(pictoForme('solution buvable'), 'flacon');
    assert.equal(pictoForme('dispositif transdermique'), 'patch');
    assert.equal(pictoForme(''), 'boite');
  });
});

describe('forme abrégée', () => {
  it('garde la tête du libellé et met LP / LM / GR en sigle', () => {
    assert.equal(abregerForme('gélule à libération prolongée'), 'gélule LP');
    assert.equal(abregerForme('comprimé pelliculé sécable'), 'comprimé');
    assert.equal(abregerForme('comprimé à libération modifiée'), 'comprimé LM');
    assert.equal(abregerForme('comprimé gastro-résistant'), 'comprimé GR');
    assert.equal(abregerForme('solution injectable en seringue préremplie'), 'solution injectable');
    assert.equal(abregerForme('poudre et solvant pour solution injectable'), 'solution injectable');
    assert.equal(abregerForme('poudre pour solution buvable en sachet'), 'solution buvable');
    assert.equal(abregerForme('comprimé orodispersible'), 'comprimé orodispersible');
    assert.equal(abregerForme(''), '');
  });
});

describe('bande signalétique — conditions illisibles', () => {
  // Une panne ne doit jamais se lire « Sans ordonnance ».
  it('dit « Conditions indisponibles », sans aplat bloquant, et mène au bloc', () => {
    const cases = signaletique(produit(), { resume: [], groupes: [], liens: [], indisponible: true }, null, null, false);
    const ordonnance = cases.find((cas) => cas.cle === 'ordonnance');
    assert.equal(ordonnance.valeur, 'Conditions indisponibles');
    assert.notEqual(ordonnance.portee, 'bloque');
    assert.equal(ordonnance.lien, '#delivrance');
    assert.ok(!cases.some((cas) => cas.valeur === 'Sans ordonnance'));
  });
});

describe('bande signalétique — ordonnance d’après les conditions', () => {
  const ordonnance = (libelles) => valeur(signaletique(produit(), classer(libelles), null, null, false), 'ordonnance');

  it('« Sans ordonnance » seulement sans aucune condition', () => {
    assert.equal(ordonnance([]), 'Sans ordonnance');
  });

  // Iodure de potassium : une condition, aucune règle pour la résumer.
  it('des conditions non résumées ne valent pas « Sans ordonnance »', () => {
    const cases = signaletique(produit(), classer(['à ne prendre que sur instructions des autorités compétentes']), null, null, false);
    const cas = cases.find((entree) => entree.cle === 'ordonnance');
    assert.equal(cas.valeur, 'Conditions particulières');
    assert.match(cas.detail, /autorités compétentes/);
    assert.equal(cas.lien, '#delivrance');
  });

  it('« soumis à prescription médicale » se lit « Sur ordonnance »', () => {
    assert.equal(ordonnance(['médicament soumis à prescription médicale']), 'Sur ordonnance');
  });

  it('une liste I suffit, sans « Sur ordonnance » en plus', () => {
    assert.equal(ordonnance(['liste I', 'médicament soumis à prescription médicale']), 'Liste I');
  });

  it('une restriction sans classement ne crée pas de case Ordonnance', () => {
    const cases = signaletique(produit(), classer(['prescription hospitalière']), null, null, false);
    assert.equal(valeur(cases, 'ordonnance'), undefined);
    assert.equal(valeur(cases, 'cadre'), 'Prescr. hosp.');
  });
});

describe('bande signalétique — évaluation HAS illisible', () => {
  it('dit « Évaluation indisponible », pas « Pas d’avis HAS »', () => {
    const cases = signaletique(produit(), classer([]), null, null, false, resumerEvaluation(null));
    assert.equal(valeur(cases, 'has'), 'Évaluation indisponible');
  });
});

describe('bande signalétique — condition complétée', () => {
  it('affiche la liste, et dit en infobulle qu’elle ne vient pas de la BDPM', () => {
    const delivrance = { ...classer(['liste I']), complement: { motif: 'Ses équivalentes sont en liste I.', confirme_le: '2026-10-13' } };
    const cas = signaletique(produit(), delivrance, null, null, false).find((entree) => entree.cle === 'ordonnance');
    assert.equal(cas.valeur, 'Liste I');
    assert.match(cas.detail, /complété, absent de la BDPM : Ses équivalentes sont en liste I\./);
  });
});
