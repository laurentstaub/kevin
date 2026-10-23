import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { regrouperAvis, resumerEvaluation, lignesLibelle } from '../../src/has.js';

const ligne = (nature, dossier, date, valeur, motif = 'Inscription (CT)') => ({
  nature, code_dossier_has: dossier, motif_evaluation: motif, date_avis: new Date(date), valeur, libelle: `${nature} ${valeur}`, lien: null,
});

describe('avis HAS', () => {
  it('regroupe SMR et ASMR d’un même dossier, dans l’ordre reçu', () => {
    const avis = regrouperAvis([
      ligne('smr', 'CT-2', '2026-03-04', 'Important'),
      ligne('asmr', 'CT-2', '2026-03-04', 'V'),
      ligne('smr', 'CT-1', '2019-01-10', 'Modéré'),
    ]);
    assert.equal(avis.length, 2);
    assert.equal(avis[0].dossier, 'CT-2');
    assert.deepEqual(avis[0].smr.map((item) => item.valeur), ['Important']);
    assert.deepEqual(avis[0].asmr.map((item) => item.valeur), ['V']);
  });

  it('résume le dernier avis : SMR en minuscule, ASMR en chiffre romain', () => {
    const resume = resumerEvaluation(regrouperAvis([
      ligne('smr', 'CT-2', '2026-03-04', 'Important'),
      ligne('asmr', 'CT-2', '2026-03-04', 'V'),
      ligne('smr', 'CT-1', '2019-01-10', 'Insuffisant'),
    ]));
    assert.equal(resume.valeur, 'SMR important · ASMR V');
    assert.match(resume.detail, /^Dernier avis CT du 04\/03\/2026 \(Inscription \(CT\)\)$/);
    assert.equal(resume.avis, 2);
  });

  it('dit « selon indication » quand le dernier avis porte plusieurs valeurs', () => {
    const resume = resumerEvaluation(regrouperAvis([
      ligne('smr', 'CT-2', '2026-03-04', 'Important'),
      ligne('smr', 'CT-2', '2026-03-04', 'Insuffisant'),
    ]));
    assert.equal(resume.valeur, 'SMR selon indication');
  });

  it('prend l’ASMR du dernier avis qui en donne une, et la dit non chiffrée sans chiffre', () => {
    const resume = resumerEvaluation(regrouperAvis([
      ligne('smr', 'CT-3', '2026-03-04', 'Important', 'Renouvellement'),
      ligne('smr', 'CT-1', '2019-01-10', 'Important'),
      ligne('asmr', 'CT-1', '2019-01-10', 'Commentaires sans chiffrage de l’ASMR'),
    ]));
    assert.equal(resume.valeur, 'SMR important · ASMR non chiffrée');
    assert.match(resume.detail, /04\/03\/2026.*10\/01\/2019/);
  });

  it('sans avis : la case reste, sans lien', () => {
    assert.deepEqual(resumerEvaluation([]), { valeur: 'Pas d’avis HAS', detail: null, avis: 0 });
  });
});

describe('libellé HAS', () => {
  it('découpe sur les <br> littéraux, rend l’apostrophe, retire le « ; » final', () => {
    const source = 'Le SMR est important dans : <br> la prise en charge des douleurs d\u0092origine cancéreuse,<br>  la lombalgie chronique. ;';
    assert.deepEqual(lignesLibelle(source), {
      intro: 'Le SMR est important dans :',
      items: ['la prise en charge des douleurs d’origine cancéreuse', 'la lombalgie chronique.'],
    });
  });

  it('rend aussi l’apostrophe perdue en caractère de remplacement', () => {
    assert.equal(lignesLibelle('dans l\uFFFDarthrose').intro, 'dans l’arthrose');
  });

  it('laisse un libellé simple sur une ligne', () => {
    assert.deepEqual(lignesLibelle('Pas d’amélioration (ASMR V). ;'), { intro: 'Pas d’amélioration (ASMR V).', items: [] });
    assert.deepEqual(lignesLibelle(null), { intro: '', items: [] });
  });
});

describe('resumerEvaluation — panne', () => {
  // null : avis illisibles ; [] : aucun avis. Les confondre disait « Pas d’avis HAS » en panne.
  it('distingue la panne de l’absence d’avis', () => {
    const panne = resumerEvaluation(null);
    assert.equal(panne.valeur, 'Évaluation indisponible');
    assert.equal(panne.indisponible, true);
    assert.equal(panne.avis, 0);
    assert.equal(resumerEvaluation([]).valeur, 'Pas d’avis HAS');
  });
});

describe('regrouperAvis — lien de l’avis', () => {
  it('ne garde que les liens http ou https', () => {
    const avec = (lien) => regrouperAvis([{ ...ligne('smr', 'CT-1', '2026-01-01', 'Important'), lien }])[0].lien;
    assert.equal(avec('https://www.has-sante.fr/jcms/c_1'), 'https://www.has-sante.fr/jcms/c_1');
    assert.equal(avec('javascript:alert(1)'), null);
    assert.equal(avec(null), null);
  });
});
