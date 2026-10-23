/**
 * Signaler une erreur : un courriel préparé, sans compte ni formulaire. Le
 * sujet et le corps portent ce qu'il faut pour retrouver la rubrique (CIS,
 * document, numéro, adresse) ; celui qui signale n'a qu'à dire ce qui est faux.
 */
import { config } from './config.js';

const DOCUMENTS = { rcp: 'RCP', notice: 'Notice', rcp_notice: 'RCP et notice' };

/**
 * @param {{ cis: string, denomination: string, type: string, numero?: string, libelle?: string, adresse: string }} cible
 * @returns {string} lien mailto
 */
export function lienSignalement({ cis, denomination, type, numero, libelle, adresse }) {
  const document = DOCUMENTS[type] ?? type;
  const rubrique = [numero, libelle].filter(Boolean).join(' ').trim();
  const sujet = `Erreur · ${denomination} · ${document}${numero ? ` ${numero}` : ''}`;
  const corps = [
    `Spécialité : ${denomination} (CIS ${cis})`,
    `Document : ${document}`,
    rubrique ? `Rubrique : ${rubrique}` : null,
    `Page : ${adresse}`,
    '',
    'Ce qui est faux ou manque :',
    '',
  ].filter((ligne) => ligne !== null).join('\n');
  return `mailto:${config.contact}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}
