import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signaletique, pictoForme, abregerForme, titreCourt } from '../../src/signaletique.js';

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

describe('titre court', () => {
  it('garde le nom et le dosage abrégé, sans la forme', () => {
    assert.equal(titreCourt('SKENAN L.P. 10 mg, gélule à libération prolongée'), 'SKENAN L.P. 10 mg');
    assert.equal(titreCourt('EDEX 20 microgrammes, poudre et solvant'), 'EDEX 20 µg');
    assert.equal(titreCourt('DOLIPRANE, sirop'), 'DOLIPRANE');
  });
});
