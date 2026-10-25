import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { versHtml } from '../../src/pdf.js';

/** Rangées d'un rendu : cellules en texte, en-tête compris. */
const rangees = (html) => [...html.matchAll(/<tr>(.*?)<\/tr>/g)]
  .map(([, rangee]) => [...rangee.matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map(([, cellule]) => cellule));

// Extraits de `pdftotext -layout` sur des PDF de l'EMA, raccourcis.
describe('PDF : tableaux reconstruits', () => {
  it('tableau dense : une rangée par ligne, la première en en-tête', () => {
    const html = versHtml([
      'Poids                Dose unitaire   Maximum par jour',
      '30 a 50 kg           500 mg          3 g',
      'Plus de 50 kg        1 g             3 g',
    ].join('\n'));
    assert.match(html, /<thead><tr><th>Poids<\/th><th>Dose unitaire<\/th><th>Maximum par jour<\/th><\/tr><\/thead>/);
    assert.deepEqual(rangees(html).slice(1), [['30 a 50 kg', '500 mg', '3 g'], ['Plus de 50 kg', '1 g', '3 g']]);
    assert.doesNotMatch(html, /<pre>/);
  });

  it('interactions (Paxlovid) : cellules sur plusieurs lignes, commentaire centré, saut de page', () => {
    const html = versHtml([
      '                        Médicament de la classe',
      ' Classe des               (variation de l’ASC,',
      ' médicaments              variation de la Cmax)               Commentaires cliniques',
      ' Antagoniste des       ↑Alfuzosine                Une augmentation des concentrations',
      ' récepteurs Alpha1-                               plasmatiques d’alfuzosine est contre-',
      ' adrénergiques                                    indiquée (voir rubrique 4.3).',
      '                       ↑Tamsulosine               Éviter l’utilisation concomitante.',
      '',
      '                                                  Le ritonavir inhibe le CYP3A4 et devrait par',
      ' Analgésiques          ↑Fentanyl                  conséquent augmenter les concentrations.',
      '                       ↑Péthidine',
      '                                                  L’administration concomitante pourrait',
      '                                                  prolonger les effets des opioïdes.',
      '                       ↓Piroxicam',
      '',
      '',
      '                Médicament de la classe',
      'Classe des       (variation de l’ASC,',
      'médicaments      variation de la Cmax)               Commentaires cliniques',
      '                                           Diminution de l’exposition au piroxicam.',
      'Antiangineux     ↑Ranolazine              La co-administration est contre-indiquée.',
      '                 ↑Ivabradine              Suite du tableau.',
    ].join('\n'));

    assert.equal((html.match(/<table>/g) ?? []).length, 1, 'un seul tableau malgré le saut de page');
    const [tete, ...corps] = rangees(html);
    assert.deepEqual(tete, ['Classe des médicaments', 'Médicament de la classe (variation de l’ASC, variation de la Cmax)', 'Commentaires cliniques']);
    assert.deepEqual(corps, [
      ['Antagoniste des récepteurs Alpha1-adrénergiques', '↑Alfuzosine', 'Une augmentation des concentrations plasmatiques d’alfuzosine est contre-indiquée (voir rubrique 4.3).'],
      ['', '↑Tamsulosine', 'Éviter l’utilisation concomitante.'],
      ['Analgésiques', '↑Fentanyl', 'Le ritonavir inhibe le CYP3A4 et devrait par conséquent augmenter les concentrations.'],
      ['', '↑Péthidine', 'L’administration concomitante pourrait prolonger les effets des opioïdes.'],
      ['', '↓Piroxicam', 'Diminution de l’exposition au piroxicam.'],
      ['Antiangineux', '↑Ranolazine', 'La co-administration est contre-indiquée.'],
      ['', '↑Ivabradine', 'Suite du tableau.'],
    ]);
  });

  it('effets indésirables (Eliquis) : intitulés de groupe sur toute la largeur, valeurs centrées', () => {
    const html = versHtml([
      ' Classe de systèmes             Prévention       Traitement          Pédiatrie',
      ' d’organes                      (pETEV)          (tETEV)',
      ' Affections hématologiques et du système lymphatique',
      ' Anémie                          Fréquent         Fréquent           Fréquent',
      ' Thrombocytopénie              Peu fréquent     Peu fréquent           Fréquent',
      ' Affections oculaires',
      ' Hémorragie de l’œil (y            Rare             Fréquent         Indéterminé',
      ' compris hémorragie',
      ' conjonctivale)',
      ' Affections vasculaires',
      ' Hématome                        Fréquent         Fréquent           Fréquent',
    ].join('\n'));

    const lignes = rangees(html);
    assert.deepEqual(lignes[0], ['Classe de systèmes d’organes', 'Prévention (pETEV)', 'Traitement (tETEV)', 'Pédiatrie']);
    assert.match(html, /<th colspan="4" scope="colgroup">Affections hématologiques et du système lymphatique<\/th>/);
    assert.match(html, /<th colspan="4" scope="colgroup">Affections vasculaires<\/th>/);
    assert.deepEqual(lignes.find((rangee) => rangee[0] === 'Thrombocytopénie'), ['Thrombocytopénie', 'Peu fréquent', 'Peu fréquent', 'Fréquent']);
    assert.deepEqual(lignes.find((rangee) => rangee[0].startsWith('Hémorragie')),
      ['Hémorragie de l’œil (y compris hémorragie conjonctivale)', 'Rare', 'Fréquent', 'Indéterminé']);
  });

  it('deux cellules séparées par une seule espace (Xarelto) : chaque mot dans sa colonne', () => {
    const html = versHtml([
      '   Indication                                 Tout saignement      Anémie',
      '   Prévention des ETEV chez les               6,8% des patients    5,9% des patients',
      '   patients adultes',
      '   Traitement de la TVP, de l’EP              23% des patients     1,6% des patients',
      '   Traitement des ETEV chez l’enfant          39,5% des patients   4,6% des patients',
      '   Prévention des AVC                         28% des patients     2,5% des patients',
      '   Prévention des événements                  22% des patients     1,4% des patients',
      '   athérothrombotiques',
      '   Prévention des ETEV en médecine            12,6% des patients 2,1% des patients',
      '   Prévention chez l’adulte opéré             9,1% des patients    3,3% des patients',
      '   Traitement prolongé                        15% des patients     1,2% des patients',
      '   Autres indications                         8% des patients      0,9% des patients',
    ].join('\n'));
    assert.deepEqual(rangees(html).find((rangee) => rangee[0].startsWith('Prévention des ETEV en')),
      ['Prévention des ETEV en médecine', '12,6% des patients', '2,1% des patients']);
  });

  it('répartition incertaine : la zone garde son alignement, d’un seul bloc', () => {
    const html = versHtml([
      'Classe de systèmes     Fréquence      Effets indésirables',
      'Infections             Fréquent       Infection des voies',
      '                                      respiratoires',
      'Affections du sang Peu fréquent thrombopénie, anémie',
      'Troubles du métabolisme Très fréquent appétit diminué',
      '                       Fréquent       hypokaliémie',
    ].join('\n'));
    assert.doesNotMatch(html, /<table>/);
    assert.equal((html.match(/<pre>/g) ?? []).length, 1);
    assert.match(html, /<pre>Classe de systèmes[\s\S]*hypokaliémie<\/pre>/);
  });

  it('une phrase espacée seule, ou une légende, ne fait pas un tableau', () => {
    const html = versHtml([
      'Tableau 3 :    Interactions avec d’autres médicaments',
      '',
      'Une phrase    avec de grands espaces.',
    ].join('\n'));
    assert.doesNotMatch(html, /<table>/);
  });
});
