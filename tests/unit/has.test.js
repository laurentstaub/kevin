import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { regrouperAvis, resumerEvaluation } from '../../src/has.js';

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
