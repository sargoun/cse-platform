/**
 * Warum ein Formular des Arbeiterportals abgewiesen wurde — als SATZ in der
 * Sprache der Person (V-198, D-599, D-692, EMP-07, EMP-10, EMP-12).
 *
 * **Der Befund.** Die Arbeiterseiten schicken bewusst echte
 * `<form method="post">` ohne JavaScript — und mehrere Routen antworteten
 * darauf mit JSON: ein Einwand auch bei ERFOLG mit `{"einwand":"<uuid>"}`,
 * eine Krankmeldung mit ungeklärter Art (O-139) mit dem deutschen Satz des
 * Dienstes, das Wachbuch bei „Präsenz bestätigt" ohne Kontrollpunkt, ein
 * Urlaubsantrag ohne Datum mit einer 500 ohne Text. Wer Arabisch eingestellt
 * hat, sah JSON oder Deutsch.
 *
 * **Die Route schickt einen GRUND, die Seite den Satz.** `?fehler=<grund>`
 * reist zurück auf die Seite des Formulars (`grundAufsFormularweg`), und die
 * Seite schlägt ihn hier nach — nur als eigener Eintrag (D-728). Ein Grund,
 * den diese Tabelle nicht kennt, bekommt den allgemeinen Satz, nie den
 * rohen Schlüssel.
 *
 * **Kein Satz verspricht, was die Plattform nicht weiss.** „Wenden Sie sich an
 * Ihre Einsatzleitung" steht nur, wo es in diesem Portal keinen anderen Weg
 * gibt (Schichttausch, O-139); eine Frist, eine Zuständigkeit oder eine
 * Rechtsfolge steht nirgends.
 */
import { eigenerEintrag } from '../nachschlagen.js';
import type { PortalSprache } from './texte.js';

/** Jeder Grund, den eine Route unter `api/mein` oder `api/zeit/einwand` zurückschickt. */
export const FORMULAR_FEHLER_GRUENDE = [
  /* allgemein — der `code` eines Dienstes */
  'ungueltige_eingabe', 'ungueltiger_zustand', 'nicht_gefunden', 'konflikt',
  /* Einwand (EMP-07) */
  'keine_anstellung', 'unbekannte_art', 'kein_datum', 'keine_begruendung',
  'pause_ungueltig', 'kein_zeiteintrag',
  /* Abwesenheit (EMP-10) */
  'keine_art', 'art_ungeklaert', 'zeitraum',
  /* Antrag (EMP-10) */
  'keine_antragsart', 'fehlt_zeitraum', 'fehlt_abwesenheitsart', 'fehlt_einsatz',
  'fehlt_tauschpartner',
  /* Wachbuch (SEC-05) */
  'kein_betreff', 'kein_text', 'kein_objekt', 'schluessel_art',
  'praesenz_ohne_kontrollpunkt', 'kein_korrekturgrund', 'kein_urheber',
  /* Leistungsnachweis (CLN-04) */
  'menge_ungueltig', 'keine_position', 'kein_name', 'keine_pruefsumme',
  /* Bautagebuch (BAU-07) */
  'kein_gewerk', 'personen_ungueltig', 'dauer_ungueltig', 'kein_projekt',
  'keine_bezeichnung', 'keine_zeile', 'kein_grund', 'tag_abgeschlossen',
  'tag_storniert', 'schon_storniert', 'tag_vorhanden',
  /* Fotos (TIM-10) */
  'zu_gross', 'leer', 'typ_unbekannt', 'typ_nicht_erlaubt', 'widerspruch',
  'bereinigung', 'nicht_verbunden', 'keine_datei',
  /* Dienstanweisung (EMP-09) und Nachricht (EMP-11) */
  'neue_fassung', 'keine_fassung', 'faden_geschlossen', 'unvollstaendig',
] as const;
export type FormularFehlerGrund = (typeof FORMULAR_FEHLER_GRUENDE)[number];

export interface MeinFormularTexte {
  /** Die fett gesetzten ersten Worte des Kastens (DESIGN §5 „Notices"). */
  readonly titel: string;
  /** Für einen Grund, den die Tabelle nicht kennt. */
  readonly sonst: string;
  readonly gruende: Readonly<Record<FormularFehlerGrund, string>>;
  /**
   * Die Bestätigung nach einem Einwand — er ist eingegangen, nicht
   * entschieden. Der erste Satz steht fett (DESIGN §5 „Notices", §9).
   */
  readonly einwandGesendetTitel: string;
  readonly einwandGesendet: string;
  /**
   * Am Antragsformular: welche Arten ein Feld verlangen (`{arten}`), gelesen
   * aus `antragsart.erfordert_*` — dieselben Spalten, die der Auslöser
   * `antrag_pflichtfelder` (0074) prüft. Ohne JavaScript kann das Feld nicht
   * je nach Art `required` werden; der Satz sagt es vorher.
   */
  readonly pflichtBei: string;
  /** Eine Art, deren Pflichtfelder dieses Formular nicht anbietet. */
  readonly nichtHier: string;
}

export const MEIN_FORMULAR_TEXTE: Readonly<Record<PortalSprache, MeinFormularTexte>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: 'Das ging nicht durch. Es wurde nichts gespeichert.',
    einwandGesendetTitel: 'Ihre Meldung ist eingegangen.',
    einwandGesendet: 'Der Zeiteintrag bleibt, wie er ist, bis die Planung entschieden hat.',
    pflichtBei: 'Pflicht bei: {arten}',
    nichtHier: '(hier noch nicht möglich)',
    gruende: {
      ungueltige_eingabe: 'Eine Angabe fehlt oder passt nicht. Bitte prüfen Sie das Formular.',
      ungueltiger_zustand: 'Das geht in diesem Stand nicht mehr. Die Seite zeigt den aktuellen Stand.',
      nicht_gefunden: 'Das gibt es für Ihre Anmeldung nicht (mehr).',
      konflikt:
        'Die angezeigten Angaben sind nicht mehr die aktuellen. Laden Sie die Seite neu und '
        + 'versuchen Sie es noch einmal.',
      keine_anstellung: 'Bitte wählen Sie die Gesellschaft.',
      unbekannte_art: 'Bitte wählen Sie eine Art aus der Liste.',
      kein_datum: 'Bitte geben Sie gültige Daten ein.',
      keine_begruendung: 'Bitte schreiben Sie, was nicht stimmt — ohne Begründung kann niemand entscheiden.',
      pause_ungueltig: 'Die Pause ist eine ganze Zahl von Minuten.',
      kein_zeiteintrag: 'Zu dieser Meldung fehlt der Zeiteintrag.',
      keine_art: 'Bitte wählen Sie die Art der Abwesenheit.',
      art_ungeklaert:
        'Für diese Art ist noch nicht geklärt, ob sie bezahlt wird (O-139). Sie lässt sich '
        + 'deshalb hier noch nicht melden — bitte melden Sie sich bei Ihrer Einsatzleitung.',
      zeitraum: 'Der Zeitraum passt nicht: das Ende liegt vor dem Beginn, oder er ist länger als ein Jahr.',
      keine_antragsart: 'Bitte wählen Sie die Art des Antrags.',
      fehlt_zeitraum: 'Diese Antragsart braucht einen Zeitraum — bitte „Von" und „Bis" eintragen.',
      fehlt_abwesenheitsart: 'Diese Antragsart braucht eine Abwesenheitsart.',
      fehlt_einsatz:
        'Ein Schichttausch braucht die Schicht und die Person, mit der getauscht wird. Beides '
        + 'lässt sich hier noch nicht wählen — bitte wenden Sie sich an Ihre Einsatzleitung.',
      fehlt_tauschpartner:
        'Ein Schichttausch braucht die Person, mit der getauscht wird. Sie lässt sich hier noch '
        + 'nicht wählen — bitte wenden Sie sich an Ihre Einsatzleitung.',
      kein_betreff: 'Ein Eintrag braucht einen Betreff.',
      kein_text: 'Ein Eintrag braucht einen Text: Was ist passiert?',
      kein_objekt: 'Diese Schicht hat kein Objekt — dafür gibt es hier kein Buch.',
      schluessel_art:
        'Schlüsselbewegungen werden noch nicht hier erfasst. Tragen Sie sie als „Übergabe" ein '
        + 'und nennen Sie den Schlüssel im Text.',
      praesenz_ohne_kontrollpunkt:
        'Ein Präsenznachweis braucht den Kontrollpunkt, an dem er entstanden ist. Bitte wählen '
        + 'Sie den Kontrollpunkt — oder nehmen Sie den Haken „Präsenz bestätigt" heraus.',
      kein_korrekturgrund: 'Eine Korrektur braucht einen Grund: Warum war der Eintrag falsch?',
      kein_urheber: 'Eintragen kann nur, wer in dieser Gesellschaft beschäftigt ist.',
      menge_ungueltig: 'Eine Menge ist keine Zahl mit höchstens drei Nachkommastellen.',
      keine_position: 'Der Nachweis braucht mindestens eine Position.',
      kein_name: 'Bitte tragen Sie den Namen der Person ein, die unterschreibt.',
      keine_pruefsumme: 'Das Blatt ist nicht mehr vollständig. Laden Sie es neu.',
      kein_gewerk: 'Bitte wählen Sie das Gewerk.',
      personen_ungueltig: 'Die Zahl der Personen ist eine ganze Zahl ab 1.',
      dauer_ungueltig: 'Die Dauer ist keine gültige Zeit.',
      kein_projekt: 'Diese Schicht hat keine Baustelle — dafür gibt es hier kein Bautagebuch.',
      keine_bezeichnung: 'Bitte geben Sie eine Bezeichnung ein.',
      keine_zeile: 'Die Zeile, die korrigiert werden sollte, fehlt.',
      kein_grund: 'Eine Korrektur braucht einen Grund.',
      tag_abgeschlossen: 'Dieser Tag ist abgeschlossen — er ändert sich nicht mehr.',
      tag_storniert: 'Dieser Tag ist storniert.',
      schon_storniert: 'Diese Zeile ist schon storniert.',
      tag_vorhanden: 'Für diesen Tag gibt es schon ein Blatt. Die Seite zeigt es.',
      zu_gross: 'Die Datei ist zu gross.',
      leer: 'Die Datei ist leer.',
      typ_unbekannt: 'Diese Datei ist kein Foto und kein Video, das hier angenommen wird.',
      typ_nicht_erlaubt: 'Diese Art von Datei wird hier nicht angenommen.',
      widerspruch: 'Die Datei ist nicht das, was ihr Name sagt.',
      bereinigung: 'Die Ortsdaten liessen sich nicht entfernen — die Aufnahme wurde nicht gespeichert.',
      nicht_verbunden: 'Der Medienspeicher ist nicht verbunden. Es wurde nichts gespeichert.',
      keine_datei: 'Es wurde keine Datei übertragen.',
      neue_fassung:
        'Es gibt inzwischen eine neuere Fassung. Die Seite zeigt jetzt den Text, der gilt — '
        + 'bitte lesen und bestätigen Sie ihn.',
      keine_fassung: 'Die Fassung fehlt. Laden Sie die Seite neu.',
      faden_geschlossen: 'Dieses Gespräch ist geschlossen — eine Antwort ist nicht mehr möglich.',
      unvollstaendig: 'Bitte schreiben Sie eine Antwort.',
    },
  },
  en: {
    titel: 'Not saved.',
    sonst: 'That did not go through. Nothing was saved.',
    einwandGesendetTitel: 'Your report has been received.',
    einwandGesendet: 'The time entry stays as it is until planning has decided.',
    pflichtBei: 'Required for: {arten}',
    nichtHier: '(not possible here yet)',
    gruende: {
      ungueltige_eingabe: 'Something is missing or does not fit. Please check the form.',
      ungueltiger_zustand: 'This is no longer possible in the current state. The page shows the current state.',
      nicht_gefunden: 'This does not exist (any more) for your account.',
      konflikt: 'The details shown are no longer current. Reload the page and try again.',
      keine_anstellung: 'Please choose the company.',
      unbekannte_art: 'Please choose a type from the list.',
      kein_datum: 'Please enter valid dates.',
      keine_begruendung: 'Please write what is wrong — without a reason nobody can decide.',
      pause_ungueltig: 'The break is a whole number of minutes.',
      kein_zeiteintrag: 'The time entry for this report is missing.',
      keine_art: 'Please choose the type of absence.',
      art_ungeklaert:
        'For this type it has not yet been decided whether it is paid (O-139). It cannot be '
        + 'reported here yet — please contact your site manager.',
      zeitraum: 'The period does not fit: the end is before the start, or it is longer than a year.',
      keine_antragsart: 'Please choose the type of request.',
      fehlt_zeitraum: 'This type of request needs a period — please enter “From” and “To”.',
      fehlt_abwesenheitsart: 'This type of request needs a type of absence.',
      fehlt_einsatz:
        'A shift swap needs the shift and the person you swap with. Neither can be chosen '
        + 'here yet — please contact your site manager.',
      fehlt_tauschpartner:
        'A shift swap needs the person you swap with. They cannot be chosen here yet — '
        + 'please contact your site manager.',
      kein_betreff: 'An entry needs a subject.',
      kein_text: 'An entry needs a text: what happened?',
      kein_objekt: 'This shift has no site — there is no book for it here.',
      schluessel_art:
        'Key movements are not recorded here yet. Enter them as “Handover” and name the '
        + 'key in the text.',
      praesenz_ohne_kontrollpunkt:
        'A presence check needs the checkpoint where it was made. Please choose the '
        + 'checkpoint — or untick “Presence confirmed”.',
      kein_korrekturgrund: 'A correction needs a reason: why was the entry wrong?',
      kein_urheber: 'Only someone employed by this company can make entries.',
      menge_ungueltig: 'A quantity is not a number with at most three decimal places.',
      keine_position: 'The record needs at least one line.',
      kein_name: 'Please enter the name of the person signing.',
      keine_pruefsumme: 'The sheet is no longer complete. Reload it.',
      kein_gewerk: 'Please choose the trade.',
      personen_ungueltig: 'The number of people is a whole number from 1.',
      dauer_ungueltig: 'The duration is not a valid time.',
      kein_projekt: 'This shift has no construction site — there is no site diary for it here.',
      keine_bezeichnung: 'Please enter a description.',
      keine_zeile: 'The line that was to be corrected is missing.',
      kein_grund: 'A correction needs a reason.',
      tag_abgeschlossen: 'This day is closed — it does not change any more.',
      tag_storniert: 'This day has been cancelled.',
      schon_storniert: 'This line has already been cancelled.',
      tag_vorhanden: 'There is already a sheet for this day. The page shows it.',
      zu_gross: 'The file is too large.',
      leer: 'The file is empty.',
      typ_unbekannt: 'This file is not a photo or video accepted here.',
      typ_nicht_erlaubt: 'This kind of file is not accepted here.',
      widerspruch: 'The file is not what its name says.',
      bereinigung: 'The location data could not be removed — the photo was not saved.',
      nicht_verbunden: 'The media storage is not connected. Nothing was saved.',
      keine_datei: 'No file was uploaded.',
      neue_fassung:
        'There is a newer version in the meantime. The page now shows the text that applies '
        + '— please read and confirm it.',
      keine_fassung: 'The version is missing. Reload the page.',
      faden_geschlossen: 'This conversation is closed — a reply is no longer possible.',
      unvollstaendig: 'Please write a reply.',
    },
  },
  ar: {
    titel: 'لم يُحفظ.',
    sonst: 'لم ينجح ذلك. لم يُحفظ أي شيء.',
    einwandGesendetTitel: 'وصل بلاغك.',
    einwandGesendet: 'يبقى إدخال الوقت كما هو حتى يقرر قسم التخطيط.',
    pflichtBei: 'إلزامي في: {arten}',
    nichtHier: '(غير ممكن هنا بعد)',
    gruende: {
      ungueltige_eingabe: 'هناك معلومة ناقصة أو غير مناسبة. يرجى مراجعة النموذج.',
      ungueltiger_zustand: 'لم يعد هذا ممكناً في الحالة الحالية. تعرض الصفحة الحالة الحالية.',
      nicht_gefunden: 'هذا غير موجود (بعد الآن) لحسابك.',
      konflikt: 'المعلومات المعروضة لم تعد الحالية. أعد تحميل الصفحة وحاول مرة أخرى.',
      keine_anstellung: 'يرجى اختيار الشركة.',
      unbekannte_art: 'يرجى اختيار نوع من القائمة.',
      kein_datum: 'يرجى إدخال تواريخ صحيحة.',
      keine_begruendung: 'يرجى كتابة ما هو غير صحيح — لا يستطيع أحد أن يقرر دون سبب.',
      pause_ungueltig: 'الاستراحة عدد صحيح من الدقائق.',
      kein_zeiteintrag: 'إدخال الوقت الخاص بهذا البلاغ غير موجود.',
      keine_art: 'يرجى اختيار نوع الغياب.',
      art_ungeklaert:
        'لم يتحدد بعد ما إذا كان هذا النوع مدفوع الأجر (O-139). لذلك لا يمكن الإبلاغ عنه هنا '
        + 'بعد — يرجى التواصل مع مسؤول العمل.',
      zeitraum: 'الفترة غير مناسبة: النهاية قبل البداية، أو أنها أطول من سنة.',
      keine_antragsart: 'يرجى اختيار نوع الطلب.',
      fehlt_zeitraum: 'يحتاج هذا النوع من الطلبات إلى فترة — يرجى إدخال «من» و«إلى».',
      fehlt_abwesenheitsart: 'يحتاج هذا النوع من الطلبات إلى نوع غياب.',
      fehlt_einsatz:
        'يحتاج تبادل المناوبة إلى المناوبة والشخص الذي تتبادل معه. لا يمكن اختيار أيٍّ منهما هنا '
        + 'بعد — يرجى التواصل مع مسؤول العمل.',
      fehlt_tauschpartner:
        'يحتاج تبادل المناوبة إلى الشخص الذي تتبادل معه. لا يمكن اختياره هنا بعد — يرجى '
        + 'التواصل مع مسؤول العمل.',
      kein_betreff: 'يحتاج الإدخال إلى موضوع.',
      kein_text: 'يحتاج الإدخال إلى نص: ماذا حدث؟',
      kein_objekt: 'هذه المناوبة ليس لها موقع — لا يوجد لها سجل هنا.',
      schluessel_art:
        'لا تُسجَّل حركات المفاتيح هنا بعد. أدخلها كـ«التسليم» واذكر المفتاح في النص.',
      praesenz_ohne_kontrollpunkt:
        'يحتاج إثبات الحضور إلى نقطة التفتيش التي تم فيها. يرجى اختيار نقطة التفتيش — أو إزالة '
        + 'علامة «تم تأكيد الحضور».',
      kein_korrekturgrund: 'يحتاج التصحيح إلى سبب: لماذا كان الإدخال خاطئاً؟',
      kein_urheber: 'لا يستطيع الإدخال إلا من يعمل لدى هذه الشركة.',
      menge_ungueltig: 'الكمية ليست رقماً بثلاث خانات عشرية على الأكثر.',
      keine_position: 'يحتاج الإثبات إلى بند واحد على الأقل.',
      kein_name: 'يرجى إدخال اسم الشخص الذي يوقّع.',
      keine_pruefsumme: 'الورقة لم تعد كاملة. أعد تحميلها.',
      kein_gewerk: 'يرجى اختيار الحرفة.',
      personen_ungueltig: 'عدد الأشخاص عدد صحيح ابتداءً من 1.',
      dauer_ungueltig: 'المدة ليست وقتاً صالحاً.',
      kein_projekt: 'هذه المناوبة ليس لها موقع بناء — لا يوجد لها سجل بناء هنا.',
      keine_bezeichnung: 'يرجى إدخال وصف.',
      keine_zeile: 'السطر المراد تصحيحه غير موجود.',
      kein_grund: 'يحتاج التصحيح إلى سبب.',
      tag_abgeschlossen: 'هذا اليوم مغلق — لم يعد يتغير.',
      tag_storniert: 'تم إلغاء هذا اليوم.',
      schon_storniert: 'تم إلغاء هذا السطر من قبل.',
      tag_vorhanden: 'توجد ورقة لهذا اليوم من قبل. تعرضها الصفحة.',
      zu_gross: 'الملف كبير جداً.',
      leer: 'الملف فارغ.',
      typ_unbekannt: 'هذا الملف ليس صورة أو فيديو مقبولاً هنا.',
      typ_nicht_erlaubt: 'هذا النوع من الملفات غير مقبول هنا.',
      widerspruch: 'الملف ليس ما يدل عليه اسمه.',
      bereinigung: 'تعذّرت إزالة بيانات الموقع — لم تُحفظ الصورة.',
      nicht_verbunden: 'تخزين الوسائط غير متصل. لم يُحفظ أي شيء.',
      keine_datei: 'لم يُرفع أي ملف.',
      neue_fassung: 'توجد الآن نسخة أحدث. تعرض الصفحة الآن النص الساري — يرجى قراءته وتأكيده.',
      keine_fassung: 'النسخة غير موجودة. أعد تحميل الصفحة.',
      faden_geschlossen: 'هذه المحادثة مغلقة — لم يعد الرد ممكناً.',
      unvollstaendig: 'يرجى كتابة رد.',
    },
  },
  tr: {
    titel: 'Kaydedilmedi.',
    sonst: 'Bu işlem gerçekleşmedi. Hiçbir şey kaydedilmedi.',
    einwandGesendetTitel: 'Bildiriminiz alındı.',
    einwandGesendet: 'Zaman kaydı, planlama karar verene kadar olduğu gibi kalır.',
    pflichtBei: 'Zorunlu olduğu türler: {arten}',
    nichtHier: '(burada henüz mümkün değil)',
    gruende: {
      ungueltige_eingabe: 'Bir bilgi eksik veya uygun değil. Lütfen formu kontrol edin.',
      ungueltiger_zustand: 'Bu, mevcut durumda artık mümkün değil. Sayfa mevcut durumu gösteriyor.',
      nicht_gefunden: 'Bu, hesabınız için (artık) mevcut değil.',
      konflikt: 'Gösterilen bilgiler artık güncel değil. Sayfayı yenileyip tekrar deneyin.',
      keine_anstellung: 'Lütfen şirketi seçin.',
      unbekannte_art: 'Lütfen listeden bir tür seçin.',
      kein_datum: 'Lütfen geçerli tarihler girin.',
      keine_begruendung: 'Lütfen neyin yanlış olduğunu yazın — gerekçe olmadan kimse karar veremez.',
      pause_ungueltig: 'Mola, tam sayı olarak dakikadır.',
      kein_zeiteintrag: 'Bu bildirime ait zaman kaydı eksik.',
      keine_art: 'Lütfen devamsızlık türünü seçin.',
      art_ungeklaert:
        'Bu türün ücretli olup olmadığı henüz belirlenmedi (O-139). Bu nedenle burada henüz '
        + 'bildirilemez — lütfen ekip yöneticinize başvurun.',
      zeitraum: 'Süre uygun değil: bitiş başlangıçtan önce ya da süre bir yıldan uzun.',
      keine_antragsart: 'Lütfen talep türünü seçin.',
      fehlt_zeitraum: 'Bu talep türü bir süre gerektirir — lütfen “Başlangıç” ve “Bitiş” girin.',
      fehlt_abwesenheitsart: 'Bu talep türü bir devamsızlık türü gerektirir.',
      fehlt_einsatz:
        'Vardiya değişimi, vardiyayı ve değiştireceğiniz kişiyi gerektirir. İkisi de burada '
        + 'henüz seçilemez — lütfen ekip yöneticinize başvurun.',
      fehlt_tauschpartner:
        'Vardiya değişimi, değiştireceğiniz kişiyi gerektirir. Burada henüz seçilemez — lütfen '
        + 'ekip yöneticinize başvurun.',
      kein_betreff: 'Bir kaydın konusu olmalıdır.',
      kein_text: 'Bir kaydın metni olmalıdır: Ne oldu?',
      kein_objekt: 'Bu vardiyanın bir nesnesi yok — burada bunun için bir defter yok.',
      schluessel_art:
        'Anahtar hareketleri burada henüz kaydedilmiyor. Bunları “Devir teslim” olarak girin ve '
        + 'anahtarı metinde belirtin.',
      praesenz_ohne_kontrollpunkt:
        'Bir varlık kaydı, yapıldığı kontrol noktasını gerektirir. Lütfen kontrol noktasını '
        + 'seçin — ya da “Mevcudiyet onaylandı” işaretini kaldırın.',
      kein_korrekturgrund: 'Bir düzeltme gerekçe gerektirir: Kayıt neden yanlıştı?',
      kein_urheber: 'Yalnızca bu şirkette çalışan biri kayıt girebilir.',
      menge_ungueltig: 'Miktar, en fazla üç ondalık basamaklı bir sayı değil.',
      keine_position: 'Belge en az bir kalem gerektirir.',
      kein_name: 'Lütfen imzalayan kişinin adını girin.',
      keine_pruefsumme: 'Sayfa artık eksiksiz değil. Lütfen yenileyin.',
      kein_gewerk: 'Lütfen iş kolunu seçin.',
      personen_ungueltig: 'Kişi sayısı 1’den başlayan bir tam sayıdır.',
      dauer_ungueltig: 'Süre geçerli bir zaman değil.',
      kein_projekt: 'Bu vardiyanın şantiyesi yok — burada bunun için bir şantiye defteri yok.',
      keine_bezeichnung: 'Lütfen bir açıklama girin.',
      keine_zeile: 'Düzeltilecek satır eksik.',
      kein_grund: 'Bir düzeltme gerekçe gerektirir.',
      tag_abgeschlossen: 'Bu gün kapatıldı — artık değişmez.',
      tag_storniert: 'Bu gün iptal edildi.',
      schon_storniert: 'Bu satır zaten iptal edildi.',
      tag_vorhanden: 'Bu gün için zaten bir sayfa var. Sayfa onu gösteriyor.',
      zu_gross: 'Dosya çok büyük.',
      leer: 'Dosya boş.',
      typ_unbekannt: 'Bu dosya burada kabul edilen bir fotoğraf veya video değil.',
      typ_nicht_erlaubt: 'Bu dosya türü burada kabul edilmiyor.',
      widerspruch: 'Dosya, adının söylediği şey değil.',
      bereinigung: 'Konum verileri silinemedi — fotoğraf kaydedilmedi.',
      nicht_verbunden: 'Medya deposu bağlı değil. Hiçbir şey kaydedilmedi.',
      keine_datei: 'Dosya yüklenmedi.',
      neue_fassung:
        'Bu arada daha yeni bir sürüm var. Sayfa şimdi geçerli metni gösteriyor — lütfen '
        + 'okuyup onaylayın.',
      keine_fassung: 'Sürüm eksik. Sayfayı yenileyin.',
      faden_geschlossen: 'Bu konuşma kapatıldı — artık yanıt verilemez.',
      unvollstaendig: 'Lütfen bir yanıt yazın.',
    },
  },
};

/**
 * Der Satz zu einem Grund aus der Adresse — oder `null`, wenn keiner da ist.
 * Nachgeschlagen wird nur ein eigener Eintrag (D-728); ein fremder Grund
 * bekommt den allgemeinen Satz.
 */
export function formularFehlerSatz(
  sprache: PortalSprache, grund: unknown,
): string | null {
  if (typeof grund !== 'string' || grund === '') return null;
  const t = MEIN_FORMULAR_TEXTE[sprache];
  return eigenerEintrag(t.gruende, grund) ?? t.sonst;
}
