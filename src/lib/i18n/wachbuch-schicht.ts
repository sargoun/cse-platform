/**
 * Das Wachbuch auf der eigenen Schicht — die Sätze, die mit V-180
 * (Schlüssel) und V-181 (Fotos) dazukamen, in den vier Sprachen des
 * Mitarbeiterportals (SEC-05, SEC-07, EMP-12, SPEC §10).
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
  /** V-181: Fotos am Eintrag — nur beim Schreiben, nie danach. */
  readonly fotos: string;
  readonly fotoHinweis: string;
  readonly fotoNichtVerbunden: string;
  readonly fotoOhneAdresse: string;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerUnbekannt: string;
}

export const WACHBUCH_SCHICHT_TEXTE: Readonly<Record<PortalSprache, WachbuchSchichtTexte>> = {
  de: {
    schluessel: 'Schlüssel',
    schluesselHinweis: 'Pflicht bei der Art „Schlüssel" — nur Schlüssel dieses Objekts.',
    fotos: 'Fotos',
    fotoHinweis: 'Freiwillig. Die Fotos gehören zu diesem Eintrag und lassen sich später nicht ergänzen — ein späteres Foto ist ein neuer Eintrag. Ortsdaten werden vor dem Speichern entfernt.',
    fotoNichtVerbunden: 'Der Medienspeicher ist nicht verbunden — Fotos lassen sich gerade nicht anhängen. Der Eintrag selbst geht.',
    fotoOhneAdresse: 'Das Foto ist gespeichert, lässt sich aber gerade nicht anzeigen.',
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
      foto_zu_gross: 'Ein Foto ist zu groß — bitte ohne dieses Foto oder mit einem kleineren erneut senden.',
      foto_leer: 'Ein Foto ist leer.',
      foto_typ_unbekannt: 'Eine Datei ist kein erkennbares Foto.',
      foto_typ_nicht_erlaubt: 'Dieser Dateityp ist für Fotos nicht zugelassen.',
      foto_widerspruch: 'Eine Datei ist nicht das, als was sie ausgegeben wird.',
      foto_bereinigung: 'Aus einem Foto ließen sich die Ortsdaten nicht entfernen, deshalb wurde nichts gespeichert.',
      speicher_nicht_verbunden: 'Der Medienspeicher ist nicht verbunden — bitte ohne Foto senden.',
    },
    fehlerUnbekannt: 'Der Eintrag wurde nicht geschrieben.',
  },
  en: {
    schluessel: 'Key',
    schluesselHinweis: 'Required for type “Key” — only keys of this site.',
    fotos: 'Photos',
    fotoHinweis: 'Optional. The photos belong to this entry and cannot be added later — a later photo is a new entry. Location data is removed before saving.',
    fotoNichtVerbunden: 'The media storage is not connected — photos cannot be attached right now. The entry itself works.',
    fotoOhneAdresse: 'The photo is saved but cannot be shown right now.',
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
      foto_zu_gross: 'A photo is too large — please send again without this photo or with a smaller one.',
      foto_leer: 'A photo is empty.',
      foto_typ_unbekannt: 'A file is not a recognisable photo.',
      foto_typ_nicht_erlaubt: 'This file type is not allowed for photos.',
      foto_widerspruch: 'A file is not what it claims to be.',
      foto_bereinigung: 'Location data could not be removed from a photo, so nothing was saved.',
      speicher_nicht_verbunden: 'The media storage is not connected — please send without a photo.',
    },
    fehlerUnbekannt: 'The entry was not written.',
  },
  ar: {
    schluessel: 'المفتاح',
    schluesselHinweis: 'إلزامي لنوع «مفتاح» — مفاتيح هذا الموقع فقط.',
    fotos: 'الصور',
    fotoHinweis: 'اختياري. الصور تتبع هذا القيد ولا يمكن إضافتها لاحقًا — الصورة اللاحقة قيد جديد. تُحذف بيانات الموقع قبل الحفظ.',
    fotoNichtVerbunden: 'مخزن الوسائط غير متصل — لا يمكن إرفاق صور حاليًا. يمكن كتابة القيد نفسه.',
    fotoOhneAdresse: 'الصورة محفوظة، لكن لا يمكن عرضها حاليًا.',
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
      foto_zu_gross: 'إحدى الصور كبيرة جدًا — يرجى الإرسال مجددًا بدون هذه الصورة أو بصورة أصغر.',
      foto_leer: 'إحدى الصور فارغة.',
      foto_typ_unbekannt: 'أحد الملفات ليس صورة يمكن التعرف عليها.',
      foto_typ_nicht_erlaubt: 'نوع هذا الملف غير مسموح به للصور.',
      foto_widerspruch: 'أحد الملفات ليس ما يُدّعى أنه هو.',
      foto_bereinigung: 'تعذّر حذف بيانات الموقع من إحدى الصور، لذلك لم يُحفظ شيء.',
      speicher_nicht_verbunden: 'مخزن الوسائط غير متصل — يرجى الإرسال بدون صورة.',
    },
    fehlerUnbekannt: 'لم تتم كتابة القيد.',
  },
  tr: {
    schluessel: 'Anahtar',
    schluesselHinweis: '„Anahtar" türünde zorunludur — yalnızca bu tesisin anahtarları.',
    fotos: 'Fotoğraflar',
    fotoHinweis: 'İsteğe bağlı. Fotoğraflar bu kayda aittir ve sonradan eklenemez — sonraki bir fotoğraf yeni bir kayıttır. Konum verileri kaydetmeden önce silinir.',
    fotoNichtVerbunden: 'Medya deposu bağlı değil — şu anda fotoğraf eklenemiyor. Kaydın kendisi yazılabilir.',
    fotoOhneAdresse: 'Fotoğraf kaydedildi ancak şu anda gösterilemiyor.',
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
      foto_zu_gross: 'Bir fotoğraf çok büyük — lütfen bu fotoğraf olmadan veya daha küçük bir fotoğrafla tekrar gönderin.',
      foto_leer: 'Bir fotoğraf boş.',
      foto_typ_unbekannt: 'Bir dosya tanınabilir bir fotoğraf değil.',
      foto_typ_nicht_erlaubt: 'Bu dosya türüne fotoğraflar için izin verilmiyor.',
      foto_widerspruch: 'Bir dosya, iddia edildiği şey değil.',
      foto_bereinigung: 'Bir fotoğraftan konum verileri silinemedi, bu yüzden hiçbir şey kaydedilmedi.',
      speicher_nicht_verbunden: 'Medya deposu bağlı değil — lütfen fotoğrafsız gönderin.',
    },
    fehlerUnbekannt: 'Kayıt yazılmadı.',
  },
};
