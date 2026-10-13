import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classer, estLP, voie, dosage, estSecable, MARGE_ETROITE, regrouperAlternatives,
  factoriser } from '../../src/substitution.js';

const ref = {
  atc5: 'C08CA01', substances: ['Amlodipine (bésilate d\')'],
  forme: 'comprimé', voies: 'orale', dosage: '10 mg', denomination: 'AMLOR 10 mg, gélule',
};
const cand = (extra = {}) => ({
  atc5: 'C08CA01', substances: ['Amlodipine (bésilate d\')'],
  forme: 'comprimé', voies: 'orale', dosage: '5 mg',
  code_cis: '12345678', denomination: 'AMLODIPINE 5 mg, comprimé',
  meme_groupe_generique: false, statut: 'Aucun signalement', ...extra,
});

describe('lecture des présentations', () => {
  it('reconnaît la libération prolongée sous ses graphies courantes', () => {
    assert.equal(estLP('comprimé LP 400 mg'), true);
    assert.equal(estLP('comprimé à libération prolongée'), true);
    assert.equal(estLP('TERALITHE LP 400 mg'), true);
    assert.equal(estLP('comprimé pelliculé'), false);
  });

  it('ramène les voies à des familles comparables', () => {
    assert.equal(voie('solution injectable IV'), 'parenterale');
    assert.equal(voie('comprimé, voie orale'), 'orale');
    assert.equal(voie('collyre'), 'ophtalmique');
  });

  it('normalise les dosages et distingue les concentrations', () => {
    assert.deepEqual(dosage('1,00 mg'), { valeur: 1, unite: 'mg', concentration: false });
    assert.deepEqual(dosage('1 g'), { valeur: 1000, unite: 'mg', concentration: false });
    assert.equal(dosage('50 mg/mL').concentration, true);
  });
});

describe('classification', () => {
  it('le groupe générique prime sur toute règle calculée', () => {
    const res = classer(ref, cand({ meme_groupe_generique: true, forme: 'solution injectable' }));
    assert.equal(res.categorie, 'SUBSTITUABLE');
    assert.equal(res.action, 'Génériques du groupe');
  });

  it('autre dosage : aucune équivalence calculée, le pharmacien décide', () => {
    for (const autre of ['5 mg', '20 mg', '7 mg']) {
      const res = classer(ref, cand({ dosage: autre }));            // réf 10 mg
      assert.equal(res.categorie, 'AUTRE_PRESENTATION');
      assert.equal(res.action, 'Même molécule, autre présentation');
      assert.equal(res.motif, '');
    }
  });

  it('la fraction n\'est évoquée que si la BDPM déclare la forme sécable', () => {
    assert.equal(estSecable('comprimé pelliculé'), false);
    assert.equal(estSecable('comprimé sécable'), true);
  });

  it('même molécule, même dosage, autre spécialité hors groupe', () => {
    const res = classer(ref, cand({ dosage: '10 mg' }));
    assert.equal(res.motif, 'Même dosage');
  });

  it('LP contre libération immédiate : bloqué, avec le motif', () => {
    const res = classer(ref, cand({ forme: 'comprimé à libération prolongée', dosage: '10 mg' }));
    assert.equal(res.categorie, 'BLOQUE');
    assert.match(res.motif, /Libération prolongée/);
  });

  it('la marge étroite ne bloque PAS une autre molécule de la classe', () => {
    // Face à un zonisamide en rupture, la lamotrigine est une option que le
    // prescripteur peut retenir : la contrainte MTE porte sur le changement de
    // présentation d'une même molécule, pas sur le choix d'une autre molécule.
    const zoni = { atc5: 'N03AX15', substances: ['Zonisamide'], forme: 'gélule', voies: 'orale', dosage: '100 mg' };
    const res = classer(zoni, cand({ atc5: 'N03AX09', substances: ['Lamotrigine'],
      forme: 'comprimé', dosage: '100 mg', denomination: 'LAMOTRIGINE 100 mg, comprimé' }));
    assert.equal(res.categorie, 'ALTERNATIVE_CLASSE');
  });

  it('marge thérapeutique étroite : jamais de changement de présentation', () => {
    const levo = { atc5: 'H03AA01', substances: ['Lévothyroxine sodique'], forme: 'comprimé', voies: 'orale', dosage: '100 µg' };
    const res = classer(levo, cand({ atc5: 'H03AA01', substances: ['Lévothyroxine sodique'], dosage: '50 µg' }));
    assert.equal(res.categorie, 'BLOQUE');
    assert.match(res.motif, /Marge thérapeutique étroite/);
  });

  it('voie différente : bloqué', () => {
    const res = classer(ref, cand({ forme: 'solution injectable', voies: 'intraveineuse', dosage: '10 mg' }));
    assert.equal(res.categorie, 'BLOQUE');
    assert.match(res.motif, /Voie différente/);
  });

  it('dermocorticoïdes : autre molécule = prescripteur, sans exception de classe', () => {
    // NERISONE pour DIPROSONE est une substitution courante en pratique, mais
    // elle reste un changement de molécule : décision du prescripteur. Décidé
    // ainsi plutôt que d'entretenir un catalogue d'exceptions par classe.
    const diprosone = { atc5: 'D07AC01', substances: ['Bétaméthasone dipropionate'],
      forme: 'crème', voies: 'cutanée', dosage: '0,05 %' };
    const res = classer(diprosone, cand({ atc5: 'D07AC06', substances: ['Diflucortolone valérate'],
      forme: 'crème', voies: 'cutanée', dosage: '0,1 %', denomination: 'NERISONE 0,1 %, crème' }));
    assert.equal(res.categorie, 'ALTERNATIVE_CLASSE');
    assert.equal(res.action, 'Même sous-classe ATC');
  });

  it('tous les antiépileptiques sont couverts par la marge étroite, pas seulement les historiques', () => {
    const zoni = { atc5: 'N03AX15', substances: ['Zonisamide'], forme: 'gélule', voies: 'orale', dosage: '100 mg' };
    const res = classer(zoni, cand({ atc5: 'N03AX15', substances: ['Zonisamide'],
      forme: 'gélule', dosage: '50 mg', denomination: 'ZONISAMIDE 50 mg, gélule' }));
    assert.equal(res.categorie, 'BLOQUE');
    assert.match(res.motif, /classe N03/);
  });

  it('autre molécule de la même sous-classe : renvoi au prescripteur', () => {
    const res = classer(ref, cand({ atc5: 'C08CA02', substances: ['Félodipine'], dosage: '10 mg' }));
    assert.equal(res.categorie, 'ALTERNATIVE_CLASSE');
    assert.equal(res.action, 'Même sous-classe ATC');
  });

  it('classe ATC sans rapport : aucune proposition', () => {
    assert.equal(classer(ref, cand({ atc5: 'J01CA04', substances: ['Amoxicilline'] })), null);
  });

});

describe('garde-fous de la liste MTE', () => {
  it('les molécules sont écrites sans accent ni casse pour la comparaison', () => {
    MARGE_ETROITE.forEach((mol) => assert.equal(mol, mol.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')));
  });
});

describe('regroupement pour la fiche', () => {
  const diprosone = { atc5: 'D07AC01', substances: ['BÉTAMÉTHASONE (DIPROPIONATE DE)'], forme: 'crème',
    voies: 'cutanée', dosage: '0,05 %', denomination: 'DIPROSONE 0,05 %, crème' };
  const spe = (id, denomination, extra) => ({ id, code_cis: id, denomination, voies: 'cutanée', ...extra });

  it('ouvre le groupe générique par le princeps, les génériques ensuite par nom', () => {
    const monuril = { atc5: 'J01XX01', substances: ['FOSFOMYCINE TROMÉTAMOL'], forme: 'granulés pour solution buvable',
      voies: 'orale', dosage: '3 g', denomination: 'FOSFOMYCINE ARROW 3 g' };
    const groupe = (id, denomination, role) => ({ id, code_cis: id, denomination, voies: 'orale', atc5: 'J01XX01',
      substances: monuril.substances, forme: monuril.forme, dosage: '3 g', meme_groupe_generique: true, role });
    const [substituables] = regrouperAlternatives(monuril, [
      groupe('1', 'FOSFOMYCINE ZYDUS 3 g', 'Générique'),
      groupe('2', 'MONURIL 3 g', 'Princeps'),
      groupe('3', 'FOSFOMYCINE BIOGARAN 3 g', 'Générique'),
    ]);
    assert.deepEqual(substituables.lignes.map((ligne) => ligne.id), ['2', '3', '1']);
  });

  it('range par action, la classe regroupée par molécule et la même forme d’abord', () => {
    const categories = regrouperAlternatives(diprosone, [
      spe('1', 'BETAMETHASONE ARROW 0,05 %, crème', { atc5: 'D07AC01', substances: diprosone.substances,
        forme: 'crème', dosage: '0,05 %', meme_groupe_generique: true, role: 'Générique' }),
      spe('2', 'LOCOID 0,1 %, pommade', { atc5: 'D07AB02', substances: ['HYDROCORTISONE (BUTYRATE D\')'],
        forme: 'pommade', dosage: '0,1 %' }),
      spe('3', 'NERISONE GRAS 0,1 %, pommade', { atc5: 'D07AC06', substances: ['DIFLUCORTOLONE (VALÉRATE DE)'],
        forme: 'pommade', dosage: '0,1 %' }),
      spe('4', 'NERISONE 0,1 %, crème', { atc5: 'D07AC06', substances: ['DIFLUCORTOLONE (VALÉRATE DE)'],
        forme: 'crème', dosage: '0,1 %' }),
      spe('5', 'DIPROLENE 0,05 %, pommade', { atc5: 'D07AC01', substances: diprosone.substances,
        forme: 'pommade', dosage: '0,05 %' }),
    ]);
    assert.deepEqual(categories.map((cat) => cat.cle), ['SUBSTITUABLE', 'AUTRE_PRESENTATION', 'ALTERNATIVE_CLASSE']);
    const classe = categories.find((cat) => cat.cle === 'ALTERNATIVE_CLASSE');
    assert.equal(classe.total, 2);
    assert.equal(classe.molecules.length, 1);
    // Hydrocortisone (D07AB, activité modérée) hors sous-classe : rien.
    assert.equal(classe.molecules[0].nom, 'DIFLUCORTOLONE (VALÉRATE DE)');
    assert.deepEqual(classe.molecules[0].specialites.map((sp) => sp.id), ['4', '3']);
  });
});

describe('dosage et forme communs du groupe', () => {
  const ligne = (denomination) => ({ denomination });

  it('dit une fois le dosage et la forme partagés', () => {
    const { commun, lignes } = factoriser([
      ligne('MONURIL 3 g, granulés pour solution buvable en sachet'),
      ligne('FOSFOMYCINE CRISTERS 3 g ADULTES, granulés pour solution buvable en sachet'),
      ligne('FOSFOMYCINE EG ADULTES 3 g, granulés pour solution buvable en sachet'),
    ]);
    assert.equal(commun, '3 g, granulés pour solution buvable en sachet');
    assert.deepEqual(lignes.map((item) => item.court), ['MONURIL', 'FOSFOMYCINE CRISTERS ADULTES', 'FOSFOMYCINE EG ADULTES']);
    assert.equal(lignes[0].denomination, 'MONURIL 3 g, granulés pour solution buvable en sachet');
  });

  it('ne factorise que ce qui est partagé', () => {
    const { commun, lignes } = factoriser([
      ligne('DOLIPRANE 500 mg, comprimé'),
      ligne('PARACETAMOL ARROW 500 mg, gélule'),
    ]);
    assert.equal(commun, '500 mg');
    assert.deepEqual(lignes.map((item) => item.court), ['DOLIPRANE, comprimé', 'PARACETAMOL ARROW, gélule']);
  });

  it('laisse une ligne seule ou sans rien de commun intacte', () => {
    assert.equal(factoriser([ligne('MONURIL 3 g, granulés')]).commun, null);
    const rien = factoriser([ligne('A 1 g, crème'), ligne('B 2 g, pommade')]);
    assert.equal(rien.commun, null);
    assert.equal(rien.lignes[0].court, undefined);
  });
});
