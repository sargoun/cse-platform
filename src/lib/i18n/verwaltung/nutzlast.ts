/**
 * Die Feldnamen einer Freigabe-Nutzlast — in beiden Sprachen.
 *
 * **Warum eine Tabelle und nicht der rohe Schlüssel.** Auf dem Blatt, auf dem
 * ein Mensch entscheidet, stand bis zuletzt `JSON.stringify` — mit
 * `objektId`, `teilnehmer` und einem Zeitstempel in UTC-Schreibweise. Wer das
 * nicht liest, drückt trotzdem auf „Freigeben"; damit ist die Freigabe
 * wertlos, und sie ist der einzige Riegel vor allem, was das Haus verlässt
 * (Invariante 7).
 *
 * **Die Liste deckt, was der Bestand kennt — der Rest wird lesbar gemacht.**
 * Eine Nutzlast entsteht zur Laufzeit aus einem Agentenwerkzeug und kann
 * morgen ein Feld mehr tragen. Ein unbekannter Name wird deshalb NICHT
 * versteckt, sondern aus `liefer_datum` zu „Liefer Datum" — damit ein neues
 * Feld auffällt und hier nachgetragen wird, statt vom Bildschirm zu
 * verschwinden.
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `basis.ts`): `Objekt`, `Leistungsnachweis`, `Nachtrag` tragen
 * Rechtsbedeutung.
 */
import type { InternSprache } from '../intern.js';
import type { NutzlastTexte } from '@/components/ui/Nutzlastblatt';

/** Was auf dem Freigabeblatt über der Nutzlast steht. */
export interface NutzlastSeitenTexte extends NutzlastTexte {
  readonly ueberschrift: string;
}

export const NUTZLAST_TEXTE:
Readonly<Record<InternSprache, NutzlastSeitenTexte>> = {
  de: {
    ueberschrift: 'Das wird entschieden',
    ja: 'Ja',
    nein: 'Nein',
    leer: 'nicht angegeben',
    nichtsDrin: 'Dieser Vorschlag trägt keine Felder.',
    kennung: 'Kennung',
    pruefsumme: 'Prüfsumme',
    pruefsummeErklaerung:
      'Dieser Vorschlag ist mit einer Prüfsumme versiegelt — entschieden wird '
      + 'genau dieser Inhalt und kein anderer.',
    eintrag: 'Eintrag',
    felder: {
      /* ── Ort, Zeit, Beteiligte ──────────────────────────────────────── */
      objektId: 'Objekt',
      objekt: 'Objekt',
      termin: 'Termin',
      terminAm: 'Termin am',
      datum: 'Datum',
      von: 'Von',
      bis: 'Bis',
      teilnehmer: 'Teilnehmer',
      protokoll: 'Grundlage',
      ort: 'Ort',
      anstellungId: 'Anstellung',
      personId: 'Person',
      kundeId: 'Kunde',
      lieferantId: 'Lieferant',
      projektId: 'Bauvorhaben',
      auftragId: 'Auftrag',
      rechnungId: 'Rechnung',
      anfrageId: 'Anfrage',
      bewerbungId: 'Bewerbung',

      /* ── Text und Aussendung ────────────────────────────────────────── */
      empfaenger: 'Empfänger',
      betreff: 'Betreff',
      text: 'Text',
      nachricht: 'Nachricht',
      hinweis: 'Hinweis',
      empfehlung: 'Empfehlung',
      begruendung: 'Begründung',
      kanal: 'Kanal',
      anhang: 'Anhang',
      anhaenge: 'Anhänge',

      /* ── Zahlen ─────────────────────────────────────────────────────── */
      tage: 'Tage',
      menge: 'Menge',
      anzahl: 'Anzahl',
      betragCent: 'Betrag',
      betrag_cent: 'Betrag',
      nettoCent: 'Netto',
      bruttoCent: 'Brutto',
      steuerCent: 'Steuer',
      prozent: 'Prozent',
      frist: 'Frist',
      fristAm: 'Frist am',
    },
  },

  en: {
    ueberschrift: 'What is being decided',
    ja: 'Yes',
    nein: 'No',
    leer: 'not given',
    nichtsDrin: 'This proposal carries no fields.',
    kennung: 'Reference',
    pruefsumme: 'Checksum',
    pruefsummeErklaerung:
      'This proposal is sealed with a checksum — what is decided is exactly '
      + 'this content and no other.',
    eintrag: 'Entry',
    felder: {
      objektId: 'Objekt (site)',
      objekt: 'Objekt (site)',
      termin: 'Appointment',
      terminAm: 'Appointment on',
      datum: 'Date',
      von: 'From',
      bis: 'To',
      teilnehmer: 'Participants',
      protokoll: 'Basis',
      ort: 'Place',
      anstellungId: 'Anstellung (employment)',
      personId: 'Person',
      kundeId: 'Kunde (customer)',
      lieferantId: 'Lieferant (supplier)',
      projektId: 'Construction project',
      auftragId: 'Auftrag (order)',
      rechnungId: 'Invoice',
      anfrageId: 'Enquiry',
      bewerbungId: 'Application',

      empfaenger: 'Recipient',
      betreff: 'Subject',
      text: 'Text',
      nachricht: 'Message',
      hinweis: 'Note',
      empfehlung: 'Recommendation',
      begruendung: 'Reason',
      kanal: 'Channel',
      anhang: 'Attachment',
      anhaenge: 'Attachments',

      tage: 'Days',
      menge: 'Quantity',
      anzahl: 'Count',
      betragCent: 'Amount',
      betrag_cent: 'Amount',
      nettoCent: 'Net',
      bruttoCent: 'Gross',
      steuerCent: 'Tax',
      prozent: 'Percent',
      frist: 'Deadline',
      fristAm: 'Deadline on',
    },
  },
};
