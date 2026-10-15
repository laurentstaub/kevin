import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupByType, isEmpty, DOCUMENT_TYPES, nettoyerFicheInfo } from '../../src/documents.js';

describe('groupByType', () => {
  it('regroupe par type et laisse les types absents vides', () => {
    const grouped = groupByType([{ type: 'rcp' }, { type: 'rcp' }, { type: 'notice' }]);
    assert.equal(grouped.rcp.length, 2);
    assert.equal(grouped.notice.length, 1);
    assert.equal(grouped.main.length, 0);
  });

  it('ignore un type inconnu', () => {
    assert.equal(groupByType([{ type: 'exploit' }]).rcp.length, 0);
  });

  it('expose les quatre types présents en base, dans l’ordre d’affichage', () => {
    assert.deepEqual(DOCUMENT_TYPES, ['rcp', 'rcp_notice', 'notice', 'main']);
  });

  it('ne jette pas les documents de type rcp_notice', () => {
    // Environ 15 % des CIS.
    const grouped = groupByType([{ type: 'rcp_notice' }, { type: 'main' }]);
    assert.equal(grouped.rcp_notice.length, 1);
    assert.equal(grouped.main.length, 1);
  });
});

describe('isEmpty', () => {
  it('détecte l’absence totale de document', () => {
    assert.equal(isEmpty(groupByType([])), true);
    assert.equal(isEmpty(groupByType([{ type: 'rcp' }])), false);
  });
});

describe('fiche info', () => {
  it('sort le titre de son tableau de mise en page et retire le mode d’emploi BDPM', () => {
    const source = '<table><tbody><tr><td colspan="3"></td></tr><tr><td> </td><td><h1>DUROGESIC 50 µg/h</h1></td><td></td></tr>'
      + '<tr><td colspan="3"></td></tr></tbody></table>\n<p>\n  Cliquez sur un pictogramme pour aller à la rubrique. <br />\n  Voir <a href="x">l\'aide</a>.\n</p>\n<br />\n<h2>Indications</h2>';
    assert.equal(nettoyerFicheInfo(source), '<h1>DUROGESIC 50 µg/h</h1>\n\n<h2>Indications</h2>');
  });

  it('mène « cliquez ici… groupes génériques » à la section du même nom', () => {
    const source = '<h2>Groupe(s) générique(s)</h2><p>x</p><h2>Service médical rendu (SMR)</h2>'
      + '<p>Voir <a href="#grpgene" target="_blank">(cliquez ici pour aller à la rubrique des groupes génériques)</a></p>';
    const html = nettoyerFicheInfo(source);
    assert.match(html, /^<h2 id="doc-main-generiques">Groupe\(s\) générique\(s\)<\/h2>/);
    assert.match(html, /<a href="#doc-main-generiques">\(cliquez ici pour aller à la rubrique des groupes génériques\)<\/a>/);
  });

  it('rend au texte un lien interne sans cible, garde les liens externes', () => {
    const html = nettoyerFicheInfo('<p><a href="#nulle-part">ici</a> et <a>là</a> ou <a href="https://x.fr">ailleurs</a></p>');
    assert.equal(html, '<p>ici et là ou <a href="https://x.fr">ailleurs</a></p>');
  });

  it('laisse un vrai tableau', () => {
    const tableau = '<table><tr><th><h3>Dose</h3></th><td>10 mg</td></tr></table>';
    assert.equal(nettoyerFicheInfo(tableau), tableau);
  });
});
