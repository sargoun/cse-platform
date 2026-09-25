/**
 * Das Wachbuch auf der eigenen Schicht — die Sätze, die mit V-180 dazukamen,
 * in den vier Sprachen des Mitarbeiterportals (SEC-05, SEC-07, EMP-12,
 * SPEC §10).
 *
 * **Warum eine eigene Datei und nicht vier neue Zeilen in `texte.ts`.** Die
 * Sätze gehören zu EINER Seite und zu ihrer Route; hier stehen sie beisammen,
 * mit der Tabelle der Abweisungen, die die Route als `?fehler=` zurückschickt
 * (D-599) und die Seite nur als eigenen Eintrag nachschlägt (D-728).
 *
 * `Wachbuch` bleibt im Deutschen stehen, wo es ein Eigenname der Pflicht nach
 * § 34a GewO ist; im Arabischen und Türkischen wird erklärt, nicht ersetzt.
 */
import type { PortalSprache } from './texte.js';

export interface WachbuchSchichtTexte {
  readonly schluessel: string;
  readonly schluesselHinweis: string;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerUnbekannt: string;
}

export const WACHBUCH_SCHICHT_TEXTE: Readonly<Record<PortalSprache, WachbuchSchichtTexte>> = {
  de: {
    schluessel: 'Schlüssel',
    schluesselHinweis: 'Pflicht bei der Art „Schlüssel" — nur Schlüssel dieses Objekts.',
    abgewiesen: 'Der Eintrag wurde nicht geschrieben.',
    fehler: {
      unbekannte_art: 'Bitte die Art des Eintrags wählen.',
      kein_betreff: 'Bitte einen Betreff angeben.',
      kein_text: 'Ein Eintrag ohne Text dokumentiert nichts. Was ist passiert?',
      schluessel_fehlt: 'Ein Schlüsseleintrag nennt den Schlüssel, um den es geht.',
      fremder_schluessel: 'Dieser Schlüssel gehört zu einem anderen Objekt.',
      fremder_kontrollpunkt: 'Dieser Kontrollpunkt gehört zu einem anderen Objekt.',
      ungueltige_eingabe: 'Die Eingabe ist unvollständig — bitte prüfen.',
      kein_urheber: 'Für diese Gesellschaft ist keine Beschäftigung von Ihnen hinterlegt.',
      kein_objekt: 'Diese Schicht hat kein Objekt — ein Wachbuch gibt es nur für ein Objekt.',
      nicht_gefunden: 'Diese Schicht ist nicht (mehr) Ihre.',
    },
    fehlerUnbekannt: 'Der Eintrag wurde nicht geschrieben.',
  },
  en: {
    schluessel: 'Key',
    schluesselHinweis: 'Required for type “Key” — only keys of this site.',
    abgewiesen: 'The entry was not written.',
    fehler: {
      unbekannte_art: 'Please choose the type of entry.',
      kein_betreff: 'Please enter a subject.',
      kein_text: 'An entry without text documents nothing. What happened?',
      schluessel_fehlt: 'A key entry names the key it concerns.',
      fremder_schluessel: 'This key belongs to another site.',
      fremder_kontrollpunkt: 'This checkpoint belongs to another site.',
      ungueltige_eingabe: 'The input is incomplete — please check.',
      kein_urheber: 'No employment of yours is recorded for this company.',
      kein_objekt: 'This shift has no site — a Wachbuch exists only for a site.',
      nicht_gefunden: 'This shift is not (or no longer) yours.',
    },
    fehlerUnbekannt: 'The entry was not written.',
  },
  ar: {
    schluessel: 'المفتاح',
    schluesselHinweis: 'إلزامي لنوع «مفتاح» — مفاتيح هذا الموقع فقط.',
    abgewiesen: 'لم تتم كتابة القيد.',
    fehler: {
      unbekannte_art: 'يرجى اختيار نوع القيد.',
      kein_betreff: 'يرجى إدخال الموضوع.',
      kein_text: 'القيد بلا نص لا يوثّق شيئًا. ماذا حدث؟',
      schluessel_fehlt: 'قيد المفتاح يذكر المفتاح المعني.',
      fremder_schluessel: 'هذا المفتاح يخص موقعًا آخر.',
      fremder_kontrollpunkt: 'نقطة التفتيش هذه تخص موقعًا آخر.',
      ungueltige_eingabe: 'الإدخال غير مكتمل — يرجى المراجعة.',
      kein_urheber: 'لا يوجد لك عقد عمل مسجّل لدى هذه الشركة.',
      kein_objekt: 'هذه المناوبة بلا موقع — سجل الحراسة (Wachbuch) يوجد فقط لموقع.',
      nicht_gefunden: 'هذه المناوبة ليست لك (أو لم تعد لك).',
    },
    fehlerUnbekannt: 'لم تتم كتابة القيد.',
  },
  tr: {
    schluessel: 'Anahtar',
    schluesselHinweis: '„Anahtar" türünde zorunludur — yalnızca bu tesisin anahtarları.',
    abgewiesen: 'Kayıt yazılmadı.',
    fehler: {
      unbekannte_art: 'Lütfen kaydın türünü seçin.',
      kein_betreff: 'Lütfen bir konu girin.',
      kein_text: 'Metinsiz bir kayıt hiçbir şeyi belgelemez. Ne oldu?',
      schluessel_fehlt: 'Bir anahtar kaydı, ilgili anahtarı belirtir.',
      fremder_schluessel: 'Bu anahtar başka bir tesise ait.',
      fremder_kontrollpunkt: 'Bu kontrol noktası başka bir tesise ait.',
      ungueltige_eingabe: 'Giriş eksik — lütfen kontrol edin.',
      kein_urheber: 'Bu şirkette size ait kayıtlı bir istihdam yok.',
      kein_objekt: 'Bu vardiyanın tesisi yok — Wachbuch (nöbet defteri) yalnızca bir tesis için tutulur.',
      nicht_gefunden: 'Bu vardiya sizin değil (artık değil).',
    },
    fehlerUnbekannt: 'Kayıt yazılmadı.',
  },
};
