/**
 * Die Wege in die CRM-Masken — in beiden Sprachen (D-82, V-035, V-036).
 *
 * **Der Befund, der diese Datei gebracht hat.** Die Masken „Neuer Kunde" und
 * „Neuer Lead" waren vollständig gebaut, getestet und über `POST
 * /api/crm/kunde` beziehungsweise `/api/crm/lead` angeschlossen — und von
 * **keiner Oberfläche** aus verlinkt. Der einzige Weg dorthin war, die Adresse
 * von Hand einzutippen. Gebaut und unerreichbar ist teurer als nicht gebaut,
 * weil niemand danach sucht.
 *
 * **`Lead` bleibt `Lead`, auch im Deutschen** — es ist der Begriff, unter dem
 * die Anfrage in `lead.leadnummer`, im Posteingang und in jedem Bericht
 * steht. `Kunde` bleibt im Englischen stehen, weil er in `kunde.kundennummer`
 * und auf jeder Rechnung dieselbe Zeichenkette ist; die Erklärung steht
 * daneben (siehe `./basis.ts`).
 */
import type { InternSprache } from '../intern.js';

export interface CrmWegeTexte {
  /** Der Name des Bereichs in Brotkrumen und Rückwegen (V-149). */
  readonly crm: string;
  readonly neuerKunde: string;
  readonly neuerLead: string;
  readonly erstenKundenAnlegen: string;
  readonly erstenLeadAnlegen: string;
  readonly leadVonHand: string;
}

export const CRM_WEGE_TEXTE: Readonly<Record<InternSprache, CrmWegeTexte>> = {
  de: {
    crm: 'Vertrieb (CRM)',
    neuerKunde: 'Neuer Kunde',
    neuerLead: 'Neuer Lead',
    erstenKundenAnlegen: 'Den ersten Kunden anlegen.',
    erstenLeadAnlegen: 'Einen Lead von Hand anlegen.',
    leadVonHand:
      'Ein Lead entsteht sonst aus dem Angebotsformular der Website. Von Hand '
      + 'angelegt wird er, wenn die Anfrage am Telefon oder auf einer Messe kam.',
  },
  en: {
    crm: 'Sales (CRM)',
    neuerKunde: 'New Kunde',
    neuerLead: 'New Lead',
    erstenKundenAnlegen: 'Create the first Kunde (customer).',
    erstenLeadAnlegen: 'Create a Lead by hand.',
    leadVonHand:
      'A Lead usually arrives through the quote form on the website. You create '
      + 'one by hand when the enquiry came by telephone or at a trade fair.',
  },
};
