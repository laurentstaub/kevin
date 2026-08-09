import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { organiser, planDe, raccourcis } from '../../src/sections.js';
import { withSections } from '../../src/documents.js';

const rubrique = (type, position, numero, libelle, texte, profondeur = 2) => ({
  document_type: type,
  position,
  numero,
  libelle,
  profondeur,
  canonical: true,
  html: texte ? `<p>${texte}</p>` : '',
  texte,
});

const RUBRIQUES = [
  rubrique('rcp', 0, '1', 'Dénomination du médicament', 'KEYVAX 50 mg', 1),
  rubrique('rcp', 1, '4', 'Données cliniques', '', 1),
  rubrique('rcp', 2, '4.1', 'Indications thérapeutiques', 'Infection à virus X.'),
  rubrique('rcp', 3, '5.1', 'Propriétés pharmacodynamiques', 'Antiviral.'),
  rubrique('notice', 0, '1', 'Qu’est-ce que KEYVAX', 'Antiviral.', 1),
];

const ETATS = [
  { document_type: 'rcp', statut: 'partiel', manquantes: ['4.2'], source: 'bdpm_pdf', parsed_at: null },
  { document_type: 'notice', statut: 'ok', manquantes: [], source: 'bdpm_html', parsed_at: null },
];

describe('organiser', () => {
  it('sépare les documents et conserve l’ordre des rubriques', () => {
    const parType = organiser(RUBRIQUES, ETATS);
    assert.deepEqual([...parType.keys()].sort(), ['notice', 'rcp']);
    assert.deepEqual(
      parType.get('rcp').rubriques.map((r) => r.numero),
      ['1', '4', '4.1', '5.1'],
    );
  });

  it('distingue les rubriques du socle', () => {
    const rcp = organiser(RUBRIQUES, ETATS).get('rcp');
    const par = (n) => rcp.rubriques.find((r) => r.numero === n);

    assert.equal(par('1').essentielle, true, 'dénomination');
    assert.equal(par('4.1').essentielle, true, 'indications');
    assert.equal(par('5.1').essentielle, false, 'pharmacodynamie');
  });

  it('juge la notice sur son propre plan', () => {
    const notice = organiser(RUBRIQUES, ETATS).get('notice');
    assert.equal(notice.rubriques[0].essentielle, true);
  });

  it('n’ouvre aucune rubrique d’office', () => {
    const rcp = organiser(RUBRIQUES, ETATS).get('rcp');
    assert.ok(rcp.rubriques.every((r) => r.ouverte === undefined));
  });

  it('marque comme charnière une rubrique sans contenu propre', () => {
    const rcp = organiser(RUBRIQUES, ETATS).get('rcp');
    const par = (n) => rcp.rubriques.find((r) => r.numero === n);

    assert.equal(par('4').charniere, true, '« 4. Données cliniques » précède 4.1');
    assert.equal(par('4.1').charniere, false);
  });

  it('reporte l’état du découpage sur le document', () => {
    const rcp = organiser(RUBRIQUES, ETATS).get('rcp');
    assert.equal(rcp.statut, 'partiel');
    assert.deepEqual(rcp.manquantes, ['4.2']);
    assert.equal(rcp.source, 'bdpm_pdf');
  });

  it('écarte un document dont aucune rubrique n’a été retenue', () => {
    const parType = organiser([], [{ document_type: 'rcp', statut: 'echec', manquantes: [], source: 'bdpm_pdf' }]);
    assert.equal(parType.size, 0);
  });

  it('accepte des rubriques sans état enregistré', () => {
    const parType = organiser(RUBRIQUES, []);
    assert.equal(parType.get('rcp').rubriques.length, 4);
    assert.equal(parType.get('rcp').statut, 'ok');
  });
});

describe('planDe', () => {
  it('rend le plan entier, charnières comprises', () => {
    const plan = planDe(organiser(RUBRIQUES, ETATS).get('rcp'));
    assert.deepEqual(plan.map((e) => e.number), ['1', '4', '4.1', '5.1']);
    assert.equal(plan[0].id, 'rcp-0');
    assert.equal(plan[2].depth, 2);
  });
});

describe('raccourcis', () => {
  it('ne retient que les rubriques du comptoir', () => {
    const rcp = organiser(
      [
        rubrique('rcp', 0, '1', 'Dénomination', 'K', 1),
        rubrique('rcp', 1, '4.1', 'Indications', 'a'),
        rubrique('rcp', 2, '4.2', 'Posologie', 'b'),
        rubrique('rcp', 3, '5.1', 'Pharmacodynamie', 'c'),
        rubrique('rcp', 4, '6.1', 'Excipients', 'd'),
      ],
      [],
    ).get('rcp');

    assert.deepEqual(raccourcis(rcp).map((e) => e.number), ['4.1', '4.2']);
  });

  it('laisse la notice sans raccourci : son plan tient en six lignes', () => {
    const notice = organiser(RUBRIQUES, ETATS).get('notice');
    assert.deepEqual(raccourcis(notice), []);
  });
});

describe('withSections', () => {
  const documents = [
    { type: 'rcp', anchor: 'doc-rcp', label: 'RCP', html: '<p>brut</p>', sections: [] },
    { type: 'main', anchor: 'doc-main', label: 'Fiche info', html: '<p>info</p>', sections: [] },
  ];

  it('greffe les rubriques sur le document correspondant', () => {
    const fusion = withSections(documents, organiser(RUBRIQUES, ETATS));
    assert.equal(fusion[0].rubriques.length, 4);
    assert.equal(fusion[0].source, 'bdpm_pdf');
  });

  it('laisse intact un document non découpé', () => {
    const fusion = withSections(documents, organiser(RUBRIQUES, ETATS));
    assert.deepEqual(fusion[1].rubriques, []);
    assert.equal(fusion[1].html, '<p>info</p>', 'la fiche info reste servie d’un bloc');
  });

  it('n’altère pas les métadonnées du document', () => {
    const fusion = withSections(documents, organiser(RUBRIQUES, ETATS));
    assert.equal(fusion[0].label, 'RCP');
    assert.equal(fusion[0].anchor, 'doc-rcp');
  });

  // Les spécialités centralisées n'ont qu'une ligne « rcp_notice » en base,
  // alors que le découpage du PDF en produit deux : un RCP et une notice.
  describe('spécialité centralisée', () => {
    const porteur = [
      {
        cis: '60966449',
        type: 'rcp_notice',
        anchor: 'doc-rcp_notice',
        label: 'Résumé des caractéristiques et notice',
        html: '',
        sections: [],
        url: 'https://base-donnees-publique.medicaments.gouv.fr/affichageDoc.php?specid=60966449&typedoc=R',
        lastUpdated: '2025-05-06',
      },
      { cis: '60966449', type: 'main', anchor: 'doc-main', label: 'Fiche info', html: '<p>i</p>', sections: [], url: null },
    ];

    const fusion = () => withSections(porteur, organiser(RUBRIQUES, ETATS));

    it('crée le RCP et la notice absents de cis_documents', () => {
      const types = fusion().map((d) => d.type).sort();
      assert.deepEqual(types, ['main', 'notice', 'rcp']);
    });

    it('leur donne leurs rubriques', () => {
      const rcp = fusion().find((d) => d.type === 'rcp');
      assert.equal(rcp.rubriques.length, 4);
      assert.equal(rcp.source, 'bdpm_pdf');
    });

    it('leur transmet le lien et la date du document porteur', () => {
      const rcp = fusion().find((d) => d.type === 'rcp');
      assert.match(rcp.url, /affichageDoc\.php\?specid=60966449/);
      assert.equal(rcp.lastUpdated, '2025-05-06');
    });

    it('retire le document porteur, devenu vide', () => {
      assert.equal(fusion().some((d) => d.type === 'rcp_notice'), false);
    });

    it('garde le porteur tant que rien n’est découpé', () => {
      const intact = withSections(porteur, new Map());
      assert.equal(intact.some((d) => d.type === 'rcp_notice'), true);
    });
  });
});
