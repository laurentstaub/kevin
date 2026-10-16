/**
 * Extrait de l'annexe européenne des excipients à effet notoire (PDF conservé
 * dans sources/ema/) la liste des excipients, telle quelle : nom, numéros E,
 * exemples, voies et seuils, dans data/excipients-ema/annexe.json.
 *
 *   npm run extraire-annexe-ema
 *
 * Nécessite pdftotext (poppler). Les termes français qui servent à chercher
 * ces excipients dans les RCP sont dans data/excipients-ema/francais.json : une
 * traduction, la seule partie qui ne vient pas de l'annexe.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { lireAnnexe } from '../src/annexe-ema.js';

const SOURCE = {
  titre: 'Annex to the European Commission guideline on ‘Excipients in the labelling and package leaflet of medicinal products for human use’ (SANTE-2017-11668)',
  reference: 'EMA/CHMP/302620/2017 Rev. 1',
  date: '22 novembre 2019',
  url: 'https://www.ema.europa.eu/en/annex-european-commission-guideline-excipients-labelling-package-leaflet-medicinal-products-human',
  fichier: 'sources/ema/annex-excipients-labelling-package-leaflet-sante-2017-11668-rev1_en.pdf',
};

const texte = execFileSync('pdftotext', ['-layout', path.join(ROOT, SOURCE.fichier), '-'], { encoding: 'utf8' });
const excipients = lireAnnexe(texte);
mkdirSync(path.join(ROOT, 'data', 'excipients-ema'), { recursive: true });
writeFileSync(path.join(ROOT, 'data', 'excipients-ema', 'annexe.json'), `${JSON.stringify({
  source: SOURCE,
  extrait_le: new Date().toISOString().slice(0, 10),
  note: 'Excipients à effet notoire de l’annexe européenne, repris tels quels. Généré par scripts/extraire-annexe-ema.js : ne pas modifier à la main.',
  excipients,
}, null, 2)}\n`);
console.log(`${excipients.length} excipients → data/excipients-ema/annexe.json`);
