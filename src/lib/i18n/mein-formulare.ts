/**
 * Die Sätze, mit denen ein abgewiesenes Formular des Mitarbeiterportals
 * zurückkommt — in allen vier Portalsprachen (EMP-10, EMP-12, SPEC §10,
 * D-599, V-187, V-188).
 *
 * **Der Befund, der diese Datei gebaut hat.** `POST /api/mein/antraege` und
 * `POST /api/mein/abwesenheit` antworteten auf eine Abweisung mit JSON — und
 * auf eine Abweisung der DATENBANK (fehlendes Pflichtfeld, doppelte Meldung,
 * Bescheinigung vor Beginn) mit einer rohen 500. Beide werden nur von
 * Formularen ohne JavaScript angesprochen; die Kraft landete auf einer weissen
 * Seite, ihre Eingaben waren weg.
 *
 * **Es reist nur der Grund, nie ein Satz** (`grundAufsFormular`, V-158): die
 * Seite schlägt ihn hier in der Sprache der Kraft nach, über
 * `eigenerEintrag` (D-728). Ein Grund, den die Tabelle nicht kennt, bekommt
 * den allgemeinen Satz — nie den rohen Schlüssel.
 *
 * **Keine Entwurfskennung im Text** (D-663): die offene Frage O-925 steht in
 * DECISIONS.md, nicht auf dem Telefon der Kraft.
 */
import type { PortalSprache } from './texte.js';

/** Die Gründe, aus denen `POST /api/mein/antraege` die Maske zurückgibt. */
export const ANTRAG_GRUENDE = [
  'keine_anstellung', 'keine_antragsart', 'kein_datum', 'art_nicht_waehlbar',
  'zeitraum_fehlt', 'zeitraum_verkehrt', 'abwesenheitsart_fehlt',
  'schicht_fehlt', 'schicht_nicht_waehlbar',
  'tauschpartner_fehlt', 'tauschpartner_nicht_waehlbar',
  'ungueltige_eingabe',
] as const;
export type AntragGrund = (typeof ANTRAG_GRUENDE)[number];

/** Die Gründe, aus denen `POST /api/mein/abwesenheit` die Maske zurückgibt. */
export const MELDUNG_GRUENDE = [
  'keine_anstellung', 'keine_art', 'kein_datum', 'art_nicht_waehlbar',
  'art_ungeklaert', 'zeitraum_verkehrt', 'zeitraum_zu_lang', 'au_bis_vor_von',
  'ueberlappt', 'ungueltige_eingabe',
] as const;
export type MeldungGrund = (typeof MELDUNG_GRUENDE)[number];

export interface AntragFormTexte {
  /** Überschrift über dem Satz einer Abweisung. */
  readonly nichtGesendet: string;
  readonly gruende: Readonly<Record<AntragGrund, string>>;
  /** Für einen Grund, den die Tabelle nicht kennt. */
  readonly unbekannt: string;
  /** Die Nachricht reist nicht in der Adresse mit (Datenschutz). */
  readonly nachrichtErneut: string;
  /** „Pflicht bei: Urlaubsantrag, Krankmeldung". */
  readonly pflichtBei: (arten: string) => string;
  readonly schicht: string;
  readonly schichtWaehlen: string;
  readonly keineKommendeSchicht: string;
  /** Hinter der Uhrzeit einer Schicht, die am nächsten Tag endet. */
  readonly folgetag: string;
  readonly tauschpartner: string;
  readonly tauschpartnerWaehlen: string;
  /** Für Arten, die hier (noch) nicht einreichbar sind. */
  readonly nichtMoeglich: (arten: string) => string;
}

export interface MeldungFormTexte {
  readonly nichtGesendet: string;
  readonly gruende: Readonly<Record<MeldungGrund, string>>;
  readonly unbekannt: string;
  readonly bemerkungErneut: string;
}

export const ANTRAG_FORM_TEXTE: Readonly<Record<PortalSprache, AntragFormTexte>> = {
  de: {
    nichtGesendet: 'Der Antrag wurde nicht gesendet.',
    gruende: {
      keine_anstellung: 'Bitte wählen Sie die Gesellschaft, bei der Sie den Antrag stellen.',
      keine_antragsart: 'Bitte wählen Sie die Art des Antrags.',
      kein_datum: 'Ein Datum ließ sich nicht lesen. Bitte wählen Sie es im Kalender.',
      art_nicht_waehlbar: 'Diese Antragsart gibt es nicht mehr. Bitte wählen Sie eine andere.',
      zeitraum_fehlt: 'Für diese Antragsart brauchen wir „Von" und „Bis".',
      zeitraum_verkehrt: '„Bis" liegt vor „Von". Bitte prüfen Sie die beiden Tage.',
      abwesenheitsart_fehlt: 'Für diese Antragsart brauchen wir die Art der Abwesenheit.',
      schicht_fehlt: 'Für diese Antragsart brauchen wir die Schicht.',
      schicht_nicht_waehlbar:
        'Diese Schicht ist keine kommende Schicht der gewählten Beschäftigung. '
        + 'Bitte wählen Sie eine aus der Liste.',
      tauschpartner_fehlt: 'Für diese Antragsart brauchen wir den Tauschpartner.',
      tauschpartner_nicht_waehlbar:
        'Einen Tauschpartner können Sie hier noch nicht wählen. Für einen '
        + 'Schichttausch sprechen Sie bitte die Planung an.',
      ungueltige_eingabe:
        'Die Angaben passen nicht zusammen. Bitte prüfen Sie sie und senden Sie erneut.',
    },
    unbekannt: 'Der Antrag wurde abgewiesen. Bitte prüfen Sie Ihre Angaben.',
    nachrichtErneut: 'Ihre Nachricht geben Sie bitte noch einmal ein.',
    pflichtBei: (arten) => `Pflicht bei: ${arten}`,
    schicht: 'Schicht',
    schichtWaehlen: '— Schicht wählen —',
    keineKommendeSchicht: 'Sie haben keine kommende Schicht, die sich hier wählen ließe.',
    folgetag: '(+1 Tag)',
    tauschpartner: 'Tauschpartner',
    tauschpartnerWaehlen: '— Person wählen —',
    nichtMoeglich: (arten) =>
      `${arten}: kann hier noch nicht beantragt werden. Sprechen Sie dafür bitte die Planung an.`,
  },
  en: {
    nichtGesendet: 'The request was not sent.',
    gruende: {
      keine_anstellung: 'Please choose the company you are making the request to.',
      keine_antragsart: 'Please choose the type of request.',
      kein_datum: 'A date could not be read. Please pick it in the calendar.',
      art_nicht_waehlbar: 'This type of request no longer exists. Please choose another one.',
      zeitraum_fehlt: 'This type of request needs "From" and "To".',
      zeitraum_verkehrt: '"To" is before "From". Please check both days.',
      abwesenheitsart_fehlt: 'This type of request needs the type of absence.',
      schicht_fehlt: 'This type of request needs the shift.',
      schicht_nicht_waehlbar:
        'This is not an upcoming shift of the employment you chose. '
        + 'Please pick one from the list.',
      tauschpartner_fehlt: 'This type of request needs the swap partner.',
      tauschpartner_nicht_waehlbar:
        'You cannot choose a swap partner here yet. For a shift swap, '
        + 'please speak to the planners.',
      ungueltige_eingabe: 'The details do not fit together. Please check them and send again.',
    },
    unbekannt: 'The request was refused. Please check your details.',
    nachrichtErneut: 'Please type your message again.',
    pflichtBei: (arten) => `Required for: ${arten}`,
    schicht: 'Shift',
    schichtWaehlen: '— Choose a shift —',
    keineKommendeSchicht: 'You have no upcoming shift that could be chosen here.',
    folgetag: '(+1 day)',
    tauschpartner: 'Swap partner',
    tauschpartnerWaehlen: '— Choose a person —',
    nichtMoeglich: (arten) =>
      `${arten}: cannot be requested here yet. Please speak to the planners.`,
  },
  ar: {
    nichtGesendet: 'لم يتم إرسال الطلب.',
    gruende: {
      keine_anstellung: 'يرجى اختيار الشركة التي تقدّم إليها الطلب.',
      keine_antragsart: 'يرجى اختيار نوع الطلب.',
      kein_datum: 'تعذّرت قراءة أحد التواريخ. يرجى اختياره من التقويم.',
      art_nicht_waehlbar: 'نوع الطلب هذا لم يعد موجودًا. يرجى اختيار نوع آخر.',
      zeitraum_fehlt: 'يتطلب هذا النوع من الطلبات تاريخَي «من» و«إلى».',
      zeitraum_verkehrt: 'تاريخ «إلى» يسبق تاريخ «من». يرجى التحقق من اليومين.',
      abwesenheitsart_fehlt: 'يتطلب هذا النوع من الطلبات نوع الغياب.',
      schicht_fehlt: 'يتطلب هذا النوع من الطلبات تحديد الوردية.',
      schicht_nicht_waehlbar:
        'هذه ليست وردية قادمة لك في جهة العمل التي اخترتها. يرجى اختيار وردية من القائمة.',
      tauschpartner_fehlt: 'يتطلب هذا النوع من الطلبات تحديد الزميل الذي ستتبادل معه.',
      tauschpartner_nicht_waehlbar:
        'لا يمكنك اختيار زميل للتبادل هنا بعد. لتبادل وردية يرجى التحدث إلى قسم التخطيط.',
      ungueltige_eingabe: 'البيانات غير متوافقة. يرجى التحقق منها وإعادة الإرسال.',
    },
    unbekannt: 'تم رفض الطلب. يرجى التحقق من بياناتك.',
    nachrichtErneut: 'يرجى كتابة رسالتك مرة أخرى.',
    pflichtBei: (arten) => `إلزامي لـ: ${arten}`,
    schicht: 'الوردية',
    schichtWaehlen: '— اختر وردية —',
    keineKommendeSchicht: 'ليست لديك وردية قادمة يمكن اختيارها هنا.',
    folgetag: '(+1 يوم)',
    tauschpartner: 'زميل التبادل',
    tauschpartnerWaehlen: '— اختر شخصًا —',
    nichtMoeglich: (arten) =>
      `${arten}: لا يمكن تقديم هذا الطلب هنا بعد. يرجى التحدث إلى قسم التخطيط.`,
  },
  tr: {
    nichtGesendet: 'Talep gönderilmedi.',
    gruende: {
      keine_anstellung: 'Lütfen talebi yönelttiğiniz şirketi seçin.',
      keine_antragsart: 'Lütfen talep türünü seçin.',
      kein_datum: 'Bir tarih okunamadı. Lütfen takvimden seçin.',
      art_nicht_waehlbar: 'Bu talep türü artık mevcut değil. Lütfen başka bir tür seçin.',
      zeitraum_fehlt: 'Bu talep türü için „Başlangıç" ve „Bitiş" gerekli.',
      zeitraum_verkehrt: '„Bitiş" tarihi „Başlangıç" tarihinden önce. Lütfen iki günü kontrol edin.',
      abwesenheitsart_fehlt: 'Bu talep türü için devamsızlık türü gerekli.',
      schicht_fehlt: 'Bu talep türü için vardiya gerekli.',
      schicht_nicht_waehlbar:
        'Bu, seçtiğiniz işteki yaklaşan bir vardiyanız değil. Lütfen listeden bir vardiya seçin.',
      tauschpartner_fehlt: 'Bu talep türü için değişim yapılacak kişi gerekli.',
      tauschpartner_nicht_waehlbar:
        'Burada henüz değişim ortağı seçemezsiniz. Vardiya değişimi için lütfen '
        + 'planlamayla konuşun.',
      ungueltige_eingabe: 'Bilgiler birbirine uymuyor. Lütfen kontrol edip tekrar gönderin.',
    },
    unbekannt: 'Talep reddedildi. Lütfen bilgilerinizi kontrol edin.',
    nachrichtErneut: 'Lütfen mesajınızı yeniden yazın.',
    pflichtBei: (arten) => `Zorunlu: ${arten}`,
    schicht: 'Vardiya',
    schichtWaehlen: '— Vardiya seçin —',
    keineKommendeSchicht: 'Burada seçilebilecek yaklaşan bir vardiyanız yok.',
    folgetag: '(+1 gün)',
    tauschpartner: 'Değişim ortağı',
    tauschpartnerWaehlen: '— Kişi seçin —',
    nichtMoeglich: (arten) =>
      `${arten}: burada henüz talep edilemez. Lütfen planlamayla konuşun.`,
  },
};

export const MELDUNG_FORM_TEXTE: Readonly<Record<PortalSprache, MeldungFormTexte>> = {
  de: {
    nichtGesendet: 'Die Meldung wurde nicht gesendet.',
    gruende: {
      keine_anstellung: 'Bitte wählen Sie die Gesellschaft, bei der Sie sich abmelden.',
      keine_art: 'Bitte wählen Sie die Art der Abwesenheit.',
      kein_datum: 'Ein Datum ließ sich nicht lesen. Bitte wählen Sie es im Kalender.',
      art_nicht_waehlbar: 'Diese Art der Abwesenheit gibt es nicht mehr. Bitte wählen Sie eine andere.',
      art_ungeklaert:
        'Für diese Art ist noch nicht hinterlegt, ob sie bezahlt wird. Bitte melden Sie '
        + 'sich dafür direkt bei der Planung.',
      zeitraum_verkehrt: '„Bis" liegt vor „Von". Bitte prüfen Sie die beiden Tage.',
      zeitraum_zu_lang: 'Der Zeitraum ist länger als ein Jahr. Bitte prüfen Sie die Jahreszahl.',
      au_bis_vor_von:
        '„Bescheinigung gültig bis" liegt vor dem ersten Tag. Bitte prüfen Sie das Datum.',
      ueberlappt:
        'Für diese Tage haben Sie sich mit dieser Art schon gemeldet. Ihre Meldungen '
        + 'stehen unter „Anträge".',
      ungueltige_eingabe:
        'Die Angaben passen nicht zusammen. Bitte prüfen Sie sie und senden Sie erneut.',
    },
    unbekannt: 'Die Meldung wurde abgewiesen. Bitte prüfen Sie Ihre Angaben.',
    bemerkungErneut: 'Ihre Nachricht geben Sie bitte noch einmal ein.',
  },
  en: {
    nichtGesendet: 'The report was not sent.',
    gruende: {
      keine_anstellung: 'Please choose the company you are reporting your absence to.',
      keine_art: 'Please choose the type of absence.',
      kein_datum: 'A date could not be read. Please pick it in the calendar.',
      art_nicht_waehlbar: 'This type of absence no longer exists. Please choose another one.',
      art_ungeklaert:
        'It is not yet recorded whether this type is paid. Please report it '
        + 'directly to the planners.',
      zeitraum_verkehrt: '"To" is before "From". Please check both days.',
      zeitraum_zu_lang: 'The period is longer than a year. Please check the year.',
      au_bis_vor_von:
        '"Certificate valid until" is before the first day. Please check the date.',
      ueberlappt:
        'You have already reported these days with this type. Your reports are '
        + 'listed under "Requests".',
      ungueltige_eingabe: 'The details do not fit together. Please check them and send again.',
    },
    unbekannt: 'The report was refused. Please check your details.',
    bemerkungErneut: 'Please type your message again.',
  },
  ar: {
    nichtGesendet: 'لم يتم إرسال البلاغ.',
    gruende: {
      keine_anstellung: 'يرجى اختيار الشركة التي تبلغها بغيابك.',
      keine_art: 'يرجى اختيار نوع الغياب.',
      kein_datum: 'تعذّرت قراءة أحد التواريخ. يرجى اختياره من التقويم.',
      art_nicht_waehlbar: 'نوع الغياب هذا لم يعد موجودًا. يرجى اختيار نوع آخر.',
      art_ungeklaert:
        'لم يُسجَّل بعد ما إذا كان هذا النوع مدفوع الأجر. يرجى إبلاغ قسم التخطيط مباشرة.',
      zeitraum_verkehrt: 'تاريخ «إلى» يسبق تاريخ «من». يرجى التحقق من اليومين.',
      zeitraum_zu_lang: 'المدة أطول من سنة. يرجى التحقق من السنة.',
      au_bis_vor_von: 'تاريخ «الشهادة سارية حتى» يسبق اليوم الأول. يرجى التحقق من التاريخ.',
      ueberlappt: 'لقد أبلغت عن هذه الأيام بهذا النوع من قبل. بلاغاتك مدرجة تحت «الطلبات».',
      ungueltige_eingabe: 'البيانات غير متوافقة. يرجى التحقق منها وإعادة الإرسال.',
    },
    unbekannt: 'تم رفض البلاغ. يرجى التحقق من بياناتك.',
    bemerkungErneut: 'يرجى كتابة رسالتك مرة أخرى.',
  },
  tr: {
    nichtGesendet: 'Bildirim gönderilmedi.',
    gruende: {
      keine_anstellung: 'Lütfen devamsızlığınızı bildirdiğiniz şirketi seçin.',
      keine_art: 'Lütfen devamsızlık türünü seçin.',
      kein_datum: 'Bir tarih okunamadı. Lütfen takvimden seçin.',
      art_nicht_waehlbar: 'Bu devamsızlık türü artık mevcut değil. Lütfen başka bir tür seçin.',
      art_ungeklaert:
        'Bu türün ücretli olup olmadığı henüz kayıtlı değil. Lütfen doğrudan '
        + 'planlamaya bildirin.',
      zeitraum_verkehrt: '„Bitiş" tarihi „Başlangıç" tarihinden önce. Lütfen iki günü kontrol edin.',
      zeitraum_zu_lang: 'Süre bir yıldan uzun. Lütfen yılı kontrol edin.',
      au_bis_vor_von:
        '„Rapor geçerlilik sonu" ilk günden önce. Lütfen tarihi kontrol edin.',
      ueberlappt:
        'Bu günler için bu türle zaten bildirim yaptınız. Bildirimleriniz '
        + '„Talepler" altında.',
      ungueltige_eingabe: 'Bilgiler birbirine uymuyor. Lütfen kontrol edip tekrar gönderin.',
    },
    unbekannt: 'Bildirim reddedildi. Lütfen bilgilerinizi kontrol edin.',
    bemerkungErneut: 'Lütfen mesajınızı yeniden yazın.',
  },
};
