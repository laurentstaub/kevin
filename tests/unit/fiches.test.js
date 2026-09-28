import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pug from 'pug';
import { ROOT } from '../../src/config.js';
import {
  lireEnTete, lireDirective, decouper, lireFiche, listerFiches, lireCalcul, publiee,
} from '../../src/fiches.js';
import { phrases, phrasesPertinentes, motifs } from '../../src/citations.js';
import { choisirCitations, dejaInscrite, motifSubstance } from '../../src/fiches-calcul.js';
import { chargerThesaurus } from '../../src/thesaurus.js';

/**
 * Les fiches sont publiées : ce qui s'y écrit doit sortir échappé, ce qui s'y
 * cite doit sortir entier, et ce qui n'est pas relu ne doit pas sortir.
 */

const html = (corps) => decouper(corps).filter((b) => b.type === 'html').map((b) => b.html).join('');

describe('fiches — Markdown', () => {
  it('échappe le HTML brut', () => {
    assert.equal(html('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('refuse un lien javascript:, garde le libellé', () => {
    assert.equal(html('[clic](javascript:alert(1))'), '<p>clic</p>');
  });

  it('ouvre les liens externes dans une nouvelle fenêtre, pas les liens du site', () => {
    assert.match(html('[ANSM](https://ansm.sante.fr)'), /target="_blank" rel="noopener noreferrer"/);
    assert.doesNotMatch(html('[Recherche](/documents?q=QT)'), /target=/);
  });

  it('admet une paire de parenthèses dans l’URL', () => {
    assert.match(html('[QT](https://fr.wikipedia.org/wiki/QT_(ECG))'), /href="https:\/\/fr\.wikipedia\.org\/wiki\/QT_\(ECG\)"/);
  });

  it('titres, listes, gras, italique', () => {
    assert.equal(html('## Titre\n\n- **un**\n- *deux*\n\ntexte'),
      '<h2>Titre</h2><ul><li><strong>un</strong></li><li><em>deux</em></li></ul><p>texte</p>');
  });

  it('lit l’en-tête et les directives', () => {
    const { meta, corps } = lireEnTete('---\ntitre: QT long\nrelu:\n---\nCorps');
    assert.deepEqual(meta, { titre: 'QT long', relu: '' });
    assert.equal(corps, 'Corps');
    assert.deepEqual(lireDirective('::: citations rubriques=4.3,4.4 termes=QT'),
      { nom: 'citations', argument: null, options: { rubriques: ['4.3', '4.4'], termes: ['QT'] } });
    assert.equal(lireDirective('::: substances torsadogenes').argument, 'torsadogenes');
  });
});

describe('fiches — lecture et publication', () => {
  let dossier;
  before(() => {
    dossier = mkdtempSync(path.join(tmpdir(), 'fiches-'));
    writeFileSync(path.join(dossier, 'relue.md'), '---\ntitre: Relue\nrelu: 2026-09-01\n---\nTexte');
    writeFileSync(path.join(dossier, 'brouillon.md'), '---\ntitre: Brouillon\nrelu:\n---\nTexte');
    writeFileSync(path.join(dossier, '_modele.md'), 'x');
    writeFileSync(path.join(dossier, 'README.md'), 'x');
  });

  it('ne publie que ce qui est daté relu', () => {
    assert.equal(publiee(lireFiche('relue', dossier)), true);
    assert.equal(publiee(lireFiche('brouillon', dossier)), false);
    assert.equal(publiee(null), false);
  });

  it('ignore le modèle et le README', () => {
    assert.deepEqual(listerFiches(dossier).map((f) => f.slug).sort(), ['brouillon', 'relue']);
  });

  it('refuse un slug qui sort du dossier', () => {
    assert.equal(lireFiche('../package', dossier), null);
    assert.equal(lireCalcul('../../package', dossier), null);
  });
});

describe('citations — la phrase entière', () => {
  before(() => chargerThesaurus(path.join(ROOT, 'data', 'thesaurus.json')));

  it('ne coupe ni sur une décimale ni sur une minuscule', () => {
    assert.deepEqual(phrases('Dose de 2.5 mg. Chez le sujet âgé, p. ex. réduire. Fin.'),
      ['Dose de 2.5 mg.', 'Chez le sujet âgé, p. ex. réduire.', 'Fin.']);
  });

  it('garde les phrases qui portent le terme, au plus deux', () => {
    const texte = 'Aucun effet. Allongement de l’intervalle QT observé. Le QTc doit être surveillé. Un troisième QT.';
    assert.deepEqual(phrasesPertinentes(texte, motifs(['QT'])),
      ['Allongement de l’intervalle QT observé.', 'Le QTc doit être surveillé.']);
  });

  it('ne trouve pas le terme au milieu d’un mot', () => {
    assert.deepEqual(phrasesPertinentes('Le paramètre XQT est normal.', motifs(['QT'])), []);
  });
});

describe('calcul d’une fiche', () => {
  const ligne = (cis, texte, extra = {}) => ({
    code_cis: cis, denomination_medicament: `SPÉ ${cis}`,
    document_type: 'rcp', position: 7, numero: '4.4', libelle: 'Mises en garde', texte, ...extra,
  });

  it('prend la première spécialité qui cite, avec son ancre', () => {
    const r = choisirCitations([ligne('1', 'Rien.'), ligne('2', 'Allongement du QT.')], ['QT']);
    assert.equal(r.manque, false);
    assert.equal(r.specialite.cis, '2');
    assert.deepEqual(r.citations[0], { numero: '4.4', libelle: 'Mises en garde', ancre: 'rcp-7', phrase: 'Allongement du QT.' });
  });

  it('dit quand aucun RCP ne cite, au lieu de se taire', () => {
    assert.deepEqual(choisirCitations([ligne('1', 'Rien.')], ['QT']),
      { specialite: { cis: '1', denomination: 'SPÉ 1' }, citations: [], manque: true });
    assert.equal(choisirCitations([], ['QT']).specialite, null);
  });

  it('reconnaît une substance inscrite quel que soit le sel', () => {
    assert.equal(dejaInscrite('CHLORHYDRATE D’AMIODARONE', [{ substance: 'amiodarone' }]), true);
    assert.equal(dejaInscrite('SOTALOL', [{ substance: 'amiodarone' }]), false);
  });

  it('borne le motif Postgres aux limites de mot', () => {
    assert.equal(motifSubstance('Érythromycine'), '\\merythromycine\\M');
  });
});

describe('fiche — rendu', () => {
  const fiche = { slug: 't', meta: { titre: 'T', auteur: 'A' }, blocs: decouper('Texte\n\n::: substances t') };
  const rendre = (calcul) => pug.renderFile(path.join(ROOT, 'views', 'fiche.pug'),
    { v: 'test', fiche, calcul, brouillon: true, title: 'T' });

  it('sans calcul, avec une liste vide, avec des lignes', () => {
    assert.match(rendre(null), /pas encore été calculée/);
    const base = { calcule_le: '2026-09-01', rubriques: ['4.4'], liste: { titre: 'L', amorce: { source: 'ANSM', version: 'v' } } };
    assert.match(rendre({ ...base, lignes: [] }), /pas encore établie/);
    const page = rendre({ ...base, lignes: [{
      substance: 'amiodarone', origine: 'ajout', valide_le: '2026-09-02',
      specialite: { cis: '1', denomination: 'CORDARONE' },
      citations: [{ numero: '4.4', libelle: 'Mises en garde', ancre: 'rcp-7', phrase: 'Allongement du QT.' }],
    }] });
    assert.match(page, /href="\/product\/1#rcp-7"/);
    assert.match(page, /Ajout du 2026-09-02/);
    assert.match(page, /Le RCP fait foi/);
    assert.match(page, /Brouillon/);
  });
});
