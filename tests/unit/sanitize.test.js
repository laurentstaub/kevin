import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDocument, safeDocumentUrl, lienWeb } from '../../src/sanitize.js';

describe('sanitizeDocument', () => {
  it('supprime les balises script', () => {
    const html = sanitizeDocument('<p>Posologie</p><script>alert(1)</script>');
    assert.ok(!html.includes('script'));
    assert.ok(html.includes('<p>Posologie</p>'));
  });

  it('supprime les gestionnaires d’événements', () => {
    const html = sanitizeDocument('<p onclick="steal()">texte</p>');
    assert.ok(!html.includes('onclick'));
    assert.ok(html.includes('texte'));
  });

  it('supprime les iframes, objets et formulaires', () => {
    const html = sanitizeDocument(
      '<iframe src="//evil"></iframe><object></object><form action="javascript:x"></form><p>ok</p>',
    );
    for (const tag of ['iframe', 'object', 'form', 'action']) {
      assert.ok(!html.includes(tag), `balise ou attribut non filtré : ${tag}`);
    }
    assert.ok(html.includes('<p>ok</p>'));
  });

  it('neutralise les URL javascript:', () => {
    const html = sanitizeDocument('<a href="javascript:alert(1)">clic</a>');
    assert.ok(!html.includes('javascript:'));
  });

  it('conserve la structure utile d’un RCP', () => {
    const html = sanitizeDocument(
      '<h2>4.2 Posologie</h2><table><tr><th>Âge</th><td>Dose</td></tr></table><ul><li>a</li></ul>',
    );
    assert.ok(html.includes('<h2>4.2 Posologie</h2>'));
    assert.ok(html.includes('<table>'));
    assert.ok(html.includes('<li>a</li>'));
  });

  it('isole les liens sortants', () => {
    const html = sanitizeDocument('<a href="https://ansm.sante.fr/x">doc</a>');
    assert.match(html, /rel="noopener noreferrer nofollow"/);
  });

  it('accepte une entrée vide', () => {
    for (const value of [null, undefined, '']) {
      assert.equal(sanitizeDocument(value), '');
    }
  });
});

describe('safeDocumentUrl', () => {
  it('accepte les hôtes déclarés et leurs sous-domaines', () => {
    assert.equal(safeDocumentUrl('https://ansm.sante.fr/doc.pdf'), 'https://ansm.sante.fr/doc.pdf');
    assert.ok(safeDocumentUrl('https://cdn.ansm.sante.fr/a.pdf'));
  });

  it('refuse un domaine non déclaré', () => {
    assert.equal(safeDocumentUrl('https://evil.example.com/x'), null);
  });

  it('refuse un domaine qui imite un hôte déclaré', () => {
    assert.equal(safeDocumentUrl('https://ansm.sante.fr.evil.com/x'), null);
  });

  it('refuse les schémas dangereux', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd']) {
      assert.equal(safeDocumentUrl(url), null, `schéma non bloqué : ${url}`);
    }
  });

  it('refuse les URL protocol-relative', () => {
    assert.equal(safeDocumentUrl('//evil.example.com/x'), null);
  });

  it('résout un chemin relatif contre la base des documents', () => {
    // Balisage réel de la BDPM : file_path = « /documents/<CIS>/rcp_notice.pdf »
    assert.equal(
      safeDocumentUrl('/documents/61512595/rcp_notice.pdf'),
      'https://base-donnees-publique.medicaments.gouv.fr/documents/61512595/rcp_notice.pdf',
    );
  });

  it('accepte une valeur vide sans jeter', () => {
    assert.equal(safeDocumentUrl(null), null);
    assert.equal(safeDocumentUrl('pas une url'), null);
  });
});

describe('liens relatifs du document', () => {
  // Servis tels quels, les chemins relatifs de la BDPM mèneraient à une 404 locale.
  it('résout un chemin contre le site source', () => {
    const rendu = sanitizeDocument('<a href="/medicament/61234567">Imodium</a>');
    assert.match(rendu, /href="https:\/\/base-donnees-publique\.medicaments\.gouv\.fr\/medicament\/61234567"/);
  });

  it('résout aussi une requête seule', () => {
    const rendu = sanitizeDocument('<a href="?searchGroupeGenerique=123">Groupe</a>');
    assert.match(rendu, /href="https:\/\/base-donnees-publique\.medicaments\.gouv\.fr\/\?searchGroupeGenerique=123"/);
  });

  it('laisse une adresse absolue intacte', () => {
    const rendu = sanitizeDocument('<a href="https://ansm.sante.fr/x">doc</a>');
    assert.match(rendu, /href="https:\/\/ansm\.sante\.fr\/x"/);
  });

  // Sans target="_blank".
  it('garde une ancre interne dans la page', () => {
    const rendu = sanitizeDocument('<a href="#rub-4">voir 4</a>');
    assert.match(rendu, /href="#rub-4"/);
    assert.doesNotMatch(rendu, /target=/);
  });

  // « //ailleurs.fr/x » est une adresse absolue, pas un chemin de la BDPM.
  it('refuse une adresse protocol-relative', () => {
    const rendu = sanitizeDocument('<a href="//ailleurs.fr/x">ailleurs</a>');
    assert.equal(rendu, 'ailleurs');
  });
});

describe('ancres sans href', () => {
  // Privé de `name` (hors liste blanche), un « <a name> » resterait une coquille stylée comme un lien.
  it('déballe l’ancre et garde son texte', () => {
    assert.equal(
      sanitizeDocument('<p><a name="RcpCompo">Sulfate de morphine</a></p>'),
      '<p>Sulfate de morphine</p>',
    );
  });

  it('laisse intact un vrai lien', () => {
    const rendu = sanitizeDocument('<p><a href="https://ansm.fr">Voir</a></p>');
    assert.match(rendu, /href="https:\/\/ansm\.fr"/);
    assert.match(rendu, />Voir<\/a>/);
  });

  it('n’avale pas ce qui suit l’ancre', () => {
    const rendu = sanitizeDocument('<p><a name="x">Nom</a> puis <a href="https://a.fr">lien</a></p>');
    assert.match(rendu, /^<p>Nom puis <a href/);
  });
});

describe('lienWeb', () => {
  it('garde http et https, écarte les autres schémas et le relatif', () => {
    assert.equal(lienWeb('https://www.has-sante.fr/jcms/c_1'), 'https://www.has-sante.fr/jcms/c_1');
    assert.equal(lienWeb(' http://ameli.fr/a '), 'http://ameli.fr/a');
    for (const brut of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', '/relatif', 'pas une url', '', null, undefined]) {
      assert.equal(lienWeb(brut), null, String(brut));
    }
  });
});
