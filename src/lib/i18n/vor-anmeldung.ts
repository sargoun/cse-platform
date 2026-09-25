/**
 * Die Wörter der Flächen, die eine Kraft OHNE Sitzung bedient — die
 * Stempeluhr unter `/check-in/[token]` und die Anmeldung unter
 * `/auth/mitarbeiter` samt `/code` (EMP-12, SEITENKARTE §12, V-200).
 *
 * **Der Befund, aus dem diese Datei entstand.** SEITENKARTE §12 zählt genau
 * diese drei Adressen zu den übersetzten Arbeiterflächen — und alle drei
 * waren fest deutsch. Die Stempeluhr ist die einzige Fläche, die eine Kraft
 * ohne Anmeldung bedienen MUSS, jeden Tag, um 05:55 im Treppenhaus; wer kein
 * Deutsch liest, las „Zeiterfassung", „Einstempeln", „Ohne Verbindung
 * gemerkt" und „Dieser Link ist nicht gültig.".
 *
 * **Die Sprache kommt vom Gerät** (`geraetesprache.ts`): Sprachkeks, dann
 * `Accept-Language`, dann Deutsch.
 *
 * **Ein `Record` über `PortalSprache`, kein `t()` mit freiem Schlüssel** —
 * dieselbe Begründung wie `MeinTexte`: ein fehlender Eintrag ist ein Fehler
 * zur Bauzeit und kein deutsches Wort auf dem Bildschirm eines Menschen, der
 * WEGEN der Übersetzung hier liest.
 *
 * **Was NICHT übersetzt wird**: die Uhrzeit (Berliner Zeit, `TT.MM.JJ HH:MM`,
 * Invariante 2 — dieselbe Form wie im Monatsnachweis), die Fundstellen
 * (`TIM-10`, `O-82`) und die Namen der Verwaltungsmenüs (`Personal → Person →
 * Zugang`): wer der Einsatzleitung sagt, wo sie klicken soll, braucht das Wort,
 * das dort steht.
 *
 * **Kein Rechtstext — aber ein Satz über die Verarbeitung.** Auf diesen
 * Flächen steht keine Erklärung, an die sich jemand bindet. Der Satz über die
 * Mobilnummer beschreibt aber einen Zweck der Verarbeitung, und verbindlich
 * ist dafür die deutsche Datenschutzerklärung. Die Anmeldung verweist deshalb
 * auf sie, und jede Übersetzung sagt dabei, dass die deutsche Fassung gilt —
 * dieselbe Regel wie auf der Website (D-84, `rechtsverbindlichHinweis`).
 */
import type { PortalSprache } from './texte.js';
import { setzeEin } from './vorlage.js';

/* ═════════════════════════════════════════════════════════════════════════
 * Die Stempeluhr — `/check-in/[token]`
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Nur Zeichenketten — die Texte gehen als Eigenschaft in `Stempeluhr` und
 * `Schichtfoto`, zwei Client-Komponenten. Sätze mit einer Zahl sind Vorlagen
 * mit `{anzahl}` bzw. `{mb}` (`setzeEin`).
 */
export interface StempelTexte {
  /** `<title>` — WCAG 2.4.2. */
  readonly seitentitel: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly einstempeln: string;
  readonly sendet: string;
  readonly eingestempelt: string;
  readonly ausgestempelt: string;
  readonly serverUhr: string;
  /** Kein Netz: festgehalten, noch nicht erfasst (§9.4). */
  readonly gemerkt: string;
  readonly gemerktText: string;
  readonly wartetEiner: string;
  readonly wartenMehrere: string;
  readonly uebertragungEiner: string;
  readonly uebertragungMehrere: string;
  /** Jede Ablehnung der Marke — EIN Satz, kein Grund (AUT-06). */
  readonly ungueltig: string;
  /** `kein_benutzerkonto`: die Marke bleibt benutzbar. */
  readonly keinZugang: string;
  /**
   * `kein_offener_eintrag` (D-752): eine gültige Ausstempelmarke, zu der
   * keine Zeiterfassung läuft — die Marke bleibt benutzbar.
   */
  readonly keinOffenerEintrag: string;

  readonly fotoAufnehmen: string;
  readonly fotoSendet: string;
  readonly fotoHinweis: string;
  readonly fotoFertig: string;
  readonly fotoOhneOrt: string;
  readonly fotoZuGross: string;
  readonly fotoTyp: string;
  readonly fotoNichtVerbunden: string;
  readonly fotoFehler: string;
  readonly fotoKeineVerbindung: string;
  /** Der Name der Sprachwahl für Screenreader. */
  readonly sprachwahl: string;
}

export const STEMPEL_TEXTE: Readonly<Record<PortalSprache, StempelTexte>> = {
  de: {
    seitentitel: 'Einstempeln',
    titel: 'Zeiterfassung',
    untertitel: 'Ein Tipp genügt. Die Zeit kommt vom Server.',
    einstempeln: 'Einstempeln',
    sendet: 'Wird gesendet …',
    eingestempelt: 'Eingestempelt',
    ausgestempelt: 'Ausgestempelt',
    serverUhr: 'Erfasst mit der Uhr des Servers, angezeigt in Berliner Zeit.',
    gemerkt: 'Ohne Verbindung gemerkt',
    gemerktText:
      'Die Zeit wird nachgereicht, sobald wieder Netz da ist. Sie zählt erst, '
      + 'wenn die Planung sie bestätigt hat.',
    wartetEiner: '1 Eintrag wartet',
    wartenMehrere: '{anzahl} Einträge warten',
    uebertragungEiner: '1 Eintrag wartet auf die Übertragung.',
    uebertragungMehrere: '{anzahl} Einträge warten auf die Übertragung.',
    ungueltig: 'Dieser Link ist nicht gültig.',
    keinZugang: 'Für diese Person besteht noch kein Zugang. Der Link bleibt gültig.',
    keinOffenerEintrag:
      'Zu dieser Schicht läuft keine Zeiterfassung — vielleicht wartet das Einstempeln '
      + 'noch auf die Übertragung. Der Link bleibt gültig; wenden Sie sich an die '
      + 'Einsatzleitung.',
    fotoAufnehmen: 'Foto von der Schicht',
    fotoSendet: 'Wird übertragen …',
    fotoHinweis: 'Freiwillig. Ortsdaten werden vor der Ablage entfernt (TIM-10).',
    fotoFertig: 'Aufnahme übertragen',
    fotoOhneOrt: '— ohne Ortsdaten abgelegt.',
    fotoZuGross: 'Die Aufnahme ist zu gross (erlaubt sind {mb} MB).',
    fotoTyp: 'Diese Datei ist kein Foto und kein Video, das hier angenommen wird.',
    fotoNichtVerbunden:
      'Der Medienspeicher ist nicht verbunden. Die Aufnahme wurde nicht gespeichert.',
    fotoFehler: 'Die Aufnahme ging nicht durch.',
    fotoKeineVerbindung:
      'Keine Verbindung. Die Aufnahme wurde nicht übertragen; der Stempel oben '
      + 'ist davon nicht betroffen.',
    sprachwahl: 'Sprache',
  },
  en: {
    seitentitel: 'Clock in',
    titel: 'Time recording',
    untertitel: 'One tap is enough. The time comes from the server.',
    einstempeln: 'Clock in',
    sendet: 'Sending …',
    eingestempelt: 'Clocked in',
    ausgestempelt: 'Clocked out',
    serverUhr: 'Recorded with the server clock, shown in Berlin time.',
    gemerkt: 'Noted while offline',
    gemerktText:
      'The time will be sent as soon as there is a network again. It only counts '
      + 'once planning has confirmed it.',
    wartetEiner: '1 entry waiting',
    wartenMehrere: '{anzahl} entries waiting',
    uebertragungEiner: '1 entry is waiting to be sent.',
    uebertragungMehrere: '{anzahl} entries are waiting to be sent.',
    ungueltig: 'This link is not valid.',
    keinZugang: 'There is no access for this person yet. The link stays valid.',
    keinOffenerEintrag:
      'No time recording is running for this shift — the clock-in may still be waiting '
      + 'to be sent. The link stays valid; please contact your site manager.',
    fotoAufnehmen: 'Photo of the shift',
    fotoSendet: 'Uploading …',
    fotoHinweis: 'Optional. Location data is removed before the photo is stored (TIM-10).',
    fotoFertig: 'Photo uploaded',
    fotoOhneOrt: '— stored without location data.',
    fotoZuGross: 'The file is too large ({mb} MB allowed).',
    fotoTyp: 'This file is not a photo or video accepted here.',
    fotoNichtVerbunden: 'The media storage is not connected. The photo was not saved.',
    fotoFehler: 'The photo did not go through.',
    fotoKeineVerbindung:
      'No connection. The photo was not uploaded; the clock-in above is not affected.',
    sprachwahl: 'Language',
  },
  ar: {
    seitentitel: 'تسجيل الحضور',
    titel: 'تسجيل الوقت',
    untertitel: 'نقرة واحدة تكفي. الوقت يأتي من الخادم.',
    einstempeln: 'تسجيل الحضور',
    sendet: 'جارٍ الإرسال …',
    eingestempelt: 'تم تسجيل الحضور',
    ausgestempelt: 'تم تسجيل الانصراف',
    serverUhr: 'سُجّل بساعة الخادم، ويُعرض بتوقيت برلين.',
    gemerkt: 'تم التدوين دون اتصال',
    gemerktText:
      'سيُرسل الوقت فور عودة الشبكة. ولا يُحتسب إلا بعد أن يؤكده قسم التخطيط.',
    wartetEiner: 'إدخال واحد ينتظر',
    wartenMehrere: '{anzahl} إدخالات تنتظر',
    uebertragungEiner: 'إدخال واحد ينتظر الإرسال.',
    uebertragungMehrere: '{anzahl} إدخالات تنتظر الإرسال.',
    ungueltig: 'هذا الرابط غير صالح.',
    keinZugang: 'لا يوجد وصول لهذا الشخص بعد. يبقى الرابط صالحاً.',
    keinOffenerEintrag:
      'لا يوجد تسجيل وقت جارٍ لهذه النوبة — ربما لا يزال تسجيل الدخول ينتظر الإرسال. '
      + 'يبقى الرابط صالحاً؛ يُرجى التواصل مع إدارة العمليات.',
    fotoAufnehmen: 'صورة من المناوبة',
    fotoSendet: 'جارٍ الرفع …',
    fotoHinweis: 'اختياري. تُزال بيانات الموقع قبل حفظ الصورة (TIM-10).',
    fotoFertig: 'تم رفع الصورة',
    fotoOhneOrt: '— حُفظت دون بيانات الموقع.',
    fotoZuGross: 'الملف كبير جداً (المسموح {mb} ميغابايت).',
    fotoTyp: 'هذا الملف ليس صورة أو فيديو مقبولاً هنا.',
    fotoNichtVerbunden: 'تخزين الوسائط غير متصل. لم تُحفظ الصورة.',
    fotoFehler: 'لم يتم رفع الصورة.',
    fotoKeineVerbindung: 'لا يوجد اتصال. لم تُرفع الصورة؛ ولا يتأثر تسجيل الحضور أعلاه.',
    sprachwahl: 'اللغة',
  },
  tr: {
    seitentitel: 'Mesai girişi',
    titel: 'Zaman kaydı',
    untertitel: 'Tek dokunuş yeterli. Saat sunucudan gelir.',
    einstempeln: 'Giriş yap',
    sendet: 'Gönderiliyor …',
    eingestempelt: 'Giriş yapıldı',
    ausgestempelt: 'Çıkış yapıldı',
    serverUhr: 'Sunucu saatiyle kaydedildi, Berlin saatiyle gösteriliyor.',
    gemerkt: 'Bağlantı yokken not edildi',
    gemerktText:
      'Süre, ağ geri geldiğinde gönderilecek. Planlama onayladıktan sonra geçerli olur.',
    wartetEiner: '1 kayıt bekliyor',
    wartenMehrere: '{anzahl} kayıt bekliyor',
    uebertragungEiner: '1 kayıt gönderilmeyi bekliyor.',
    uebertragungMehrere: '{anzahl} kayıt gönderilmeyi bekliyor.',
    ungueltig: 'Bu bağlantı geçerli değil.',
    keinZugang: 'Bu kişi için henüz erişim yok. Bağlantı geçerli kalır.',
    keinOffenerEintrag:
      'Bu vardiya için çalışan bir zaman kaydı yok — giriş kaydı belki hâlâ gönderilmeyi '
      + 'bekliyor. Bağlantı geçerli kalır; lütfen operasyon yönetimine başvurun.',
    fotoAufnehmen: 'Vardiyadan fotoğraf',
    fotoSendet: 'Yükleniyor …',
    fotoHinweis: 'İsteğe bağlı. Konum verileri kaydetmeden önce silinir (TIM-10).',
    fotoFertig: 'Fotoğraf yüklendi',
    fotoOhneOrt: '— konum verisi olmadan kaydedildi.',
    fotoZuGross: 'Dosya çok büyük (izin verilen {mb} MB).',
    fotoTyp: 'Bu dosya burada kabul edilen bir fotoğraf veya video değil.',
    fotoNichtVerbunden: 'Medya deposu bağlı değil. Fotoğraf kaydedilmedi.',
    fotoFehler: 'Fotoğraf gönderilemedi.',
    fotoKeineVerbindung:
      'Bağlantı yok. Fotoğraf yüklenmedi; yukarıdaki giriş kaydı bundan etkilenmez.',
    sprachwahl: 'Dil',
  },
};

/* ═════════════════════════════════════════════════════════════════════════
 * Die Anmeldung — `/auth/mitarbeiter` und `/auth/mitarbeiter/code`
 * ═════════════════════════════════════════════════════════════════════════ */

export interface AnmeldungTexte {
  /* ── Der Rahmen (`AuthSchale`) ──────────────────────────────────────── */
  readonly marke: string;
  readonly zurWebsite: string;
  /** `{schritt}` und `{schritte}` werden eingesetzt. */
  readonly schritt: string;
  readonly sprachwahl: string;

  /* ── Schritt 1 — die Nummer ─────────────────────────────────────────── */
  readonly seitentitel: string;
  readonly titel: string;
  readonly unterzeileOhneZustellung: string;
  readonly unterzeileSms: string;
  readonly abgelaufenTitel: string;
  readonly abgelaufenText: string;
  readonly vorfuehrTitel: string;
  readonly vorfuehrText: string;
  readonly smsTitel: string;
  readonly smsText: string;
  readonly smsEntwicklung: string;
  readonly smsOhne: string;
  readonly mobilnummer: string;
  readonly mobilHinweis: string;
  readonly weiterZurCodeeingabe: string;
  readonly codeAnfordern: string;
  readonly nummerNurZurAnmeldung: string;
  readonly nummerOhneAuskunft: string;
  readonly nummerMitSms: string;
  /** Der Verweis auf die Datenschutzerklärung — in jeder Übersetzung mit Vorrangvermerk (D-84). */
  readonly datenschutzHinweis: string;
  readonly datenschutzLink: string;

  /* ── Schritt 2 — der Code ───────────────────────────────────────────── */
  readonly codeSeitentitel: string;
  readonly codeTitel: string;
  readonly codeHinweisOhneZustellung: string;
  readonly codeHinweisSms: string;
  readonly kontoFehltTitel: string;
  readonly kontoFehltText: string;
  readonly codeFalschTitel: string;
  readonly codeFalschText: string;
  readonly devTitel: string;
  readonly devCode: string;
  readonly codeLabel: string;
  readonly codeFeldHinweis: string;
  readonly neuerCodeVonLeitung: string;
  readonly neuerCodeAnfordern: string;
  readonly anmelden: string;
  readonly andereNummer: string;
}

export const ANMELDUNG_TEXTE: Readonly<Record<PortalSprache, AnmeldungTexte>> = {
  de: {
    marke: 'CSE Gruppe',
    zurWebsite: 'Zur Website',
    schritt: 'Schritt {schritt} von {schritte}',
    sprachwahl: 'Sprache',

    seitentitel: 'Anmeldung für Mitarbeitende — CSE Gruppe',
    titel: 'Anmeldung für Mitarbeitende',
    unterzeileOhneZustellung:
      'Geben Sie Ihre Mobilnummer ein und danach den sechsstelligen Code, den Ihnen '
      + 'Ihre Einsatzleitung nennt. Ein Kennwort brauchen Sie nicht.',
    unterzeileSms:
      'Geben Sie Ihre Mobilnummer ein. Sie erhalten einen sechsstelligen Code per SMS. '
      + 'Ein Kennwort brauchen Sie nicht.',
    abgelaufenTitel: 'Die angefangene Anmeldung gilt nicht mehr.',
    abgelaufenText:
      'Bitte geben Sie Ihre Nummer noch einmal ein; Sie bekommen dann einen neuen Code. '
      + 'Ein Code gilt zehn Minuten, und der Browser muss das kleine Anmelde-Merkzeichen '
      + 'behalten dürfen — im privaten Modus oder bei gesperrten Cookies kommt die '
      + 'Anmeldung nicht durch.',
    vorfuehrTitel: 'Vorführfläche.',
    vorfuehrText:
      'Diese Installation läuft ohne verschlüsselte Verbindung, damit die Anmeldung im '
      + 'selben Netz am Telefon funktioniert. Für den Echtbetrieb gehört die Plattform '
      + 'hinter HTTPS — dann tragen die Anmelde-Merkzeichen wieder das Merkmal „Secure“.',
    smsTitel: 'SMS-Versand: nicht verbunden.',
    smsText:
      'Es ist kein Gateway hinterlegt (offene Frage O-82: welcher in der EU gehostete '
      + 'Anbieter mit Auftragsverarbeitungsvertrag, und ab welchem Monatsbetrag gilt ein '
      + 'harter Stopp).',
    smsEntwicklung:
      'Auf dieser Entwicklungsfläche wird der Code stattdessen sichtbar angezeigt.',
    smsOhne:
      'Bis dahin kommt hier keine SMS an. Ihre Einsatzleitung stellt Ihnen den Code im '
      + 'Portal aus (Personal → Person → Zugang) und nennt ihn Ihnen; er gilt zehn '
      + 'Minuten. Die Zeiterfassung läuft daneben über den Check-in-Link, der ohne '
      + 'Anmeldung funktioniert.',
    mobilnummer: 'Mobilnummer',
    mobilHinweis: 'Deutsche Nummern mit 0 beginnend; ausländische mit + und Ländervorwahl.',
    weiterZurCodeeingabe: 'Weiter zur Codeeingabe',
    codeAnfordern: 'Code anfordern',
    nummerNurZurAnmeldung: 'Ihre Nummer wird ausschliesslich zur Anmeldung verwendet.',
    nummerOhneAuskunft: 'Ob sie hinterlegt ist, sagt diese Seite bewusst nicht.',
    nummerMitSms:
      'Wenn sie hinterlegt ist, kommt gleich ein Code — ob sie es ist, sagt diese Seite '
      + 'bewusst nicht.',
    datenschutzHinweis: 'Einzelheiten zur Verarbeitung stehen in der Datenschutzerklärung.',
    datenschutzLink: 'Zur Datenschutzerklärung',

    codeSeitentitel: 'Code eingeben — CSE Gruppe',
    codeTitel: 'Code eingeben',
    codeHinweisOhneZustellung:
      'Es wurde keine SMS versendet — es ist kein Gateway verbunden (O-82). Geben Sie den '
      + 'sechsstelligen Code ein, den Ihnen Ihre Einsatzleitung genannt hat. Er gilt zehn '
      + 'Minuten.',
    codeHinweisSms:
      'Falls Ihre Nummer hinterlegt ist, haben wir einen sechsstelligen Code geschickt. '
      + 'Er gilt zehn Minuten.',
    kontoFehltTitel: 'Der Code war richtig — das Konto fehlt.',
    kontoFehltText:
      'Zu dieser Mobilnummer gehört noch kein aktiver Portalzugang, deshalb kommt die '
      + 'Anmeldung nicht durch. Ein neuer Code ändert daran nichts; Ihre Einsatzleitung '
      + 'lässt das Konto anlegen oder entsperren.',
    codeFalschTitel: 'Die Anmeldung hat nicht geklappt.',
    codeFalschText:
      'Der Code stimmt nicht, ist abgelaufen oder wurde schon benutzt. Ein Code gilt '
      + 'zehn Minuten und genau einmal.',
    devTitel: 'Entwicklungsfläche — es wurde nichts versendet.',
    devCode: 'Der Code lautet',
    codeLabel: 'Sechsstelliger Code',
    codeFeldHinweis: 'Sechs Ziffern. Leerzeichen dürfen mitkommen.',
    neuerCodeVonLeitung: 'Lassen Sie sich von Ihrer Einsatzleitung einen neuen Code ausstellen.',
    neuerCodeAnfordern: 'Fordern Sie einen neuen Code an.',
    anmelden: 'Anmelden',
    andereNummer: 'Andere Nummer oder neuen Code',
  },
  en: {
    marke: 'CSE Group',
    zurWebsite: 'To the website',
    schritt: 'Step {schritt} of {schritte}',
    sprachwahl: 'Language',

    seitentitel: 'Staff sign-in — CSE Group',
    titel: 'Staff sign-in',
    unterzeileOhneZustellung:
      'Enter your mobile number and then the six-digit code your site manager gives '
      + 'you. You do not need a password.',
    unterzeileSms:
      'Enter your mobile number. You will receive a six-digit code by SMS. You do not '
      + 'need a password.',
    abgelaufenTitel: 'The sign-in you started is no longer valid.',
    abgelaufenText:
      'Please enter your number again; you will then get a new code. A code is valid '
      + 'for ten minutes, and the browser must be allowed to keep the small sign-in '
      + 'cookie — in private mode or with cookies blocked, the sign-in does not go '
      + 'through.',
    vorfuehrTitel: 'Demo installation.',
    vorfuehrText:
      'This installation runs without an encrypted connection so that signing in works '
      + 'on a phone in the same network. In production the platform belongs behind '
      + 'HTTPS — then the sign-in cookies carry the “Secure” attribute again.',
    smsTitel: 'SMS sending: not connected.',
    smsText:
      'No gateway is configured (open question O-82: which EU-hosted provider with a '
      + 'data processing agreement, and from which monthly amount a hard stop applies).',
    smsEntwicklung: 'On this development installation the code is shown on screen instead.',
    smsOhne:
      'Until then no SMS arrives here. Your site manager issues your code in the portal '
      + '(Personal → Person → Zugang) and tells it to you; it is valid for ten minutes. '
      + 'Time recording works meanwhile through the check-in link, which needs no '
      + 'sign-in.',
    mobilnummer: 'Mobile number',
    mobilHinweis: 'German numbers starting with 0; foreign numbers with + and the country code.',
    weiterZurCodeeingabe: 'Continue to code entry',
    codeAnfordern: 'Request code',
    nummerNurZurAnmeldung: 'Your number is used only for signing in.',
    nummerOhneAuskunft: 'Whether it is on file, this page deliberately does not say.',
    nummerMitSms:
      'If it is on file, a code is on its way — whether it is, this page deliberately '
      + 'does not say.',
    datenschutzHinweis:
      'Details of the processing are in the privacy policy. The German version is the legally '
      + 'binding one; this translation is provided for convenience.',
    datenschutzLink: 'Privacy policy',

    codeSeitentitel: 'Enter code — CSE Group',
    codeTitel: 'Enter code',
    codeHinweisOhneZustellung:
      'No SMS was sent — no gateway is connected (O-82). Enter the six-digit code your '
      + 'site manager gave you. It is valid for ten minutes.',
    codeHinweisSms:
      'If your number is on file, we have sent a six-digit code. It is valid for ten '
      + 'minutes.',
    kontoFehltTitel: 'The code was correct — the account is missing.',
    kontoFehltText:
      'There is no active portal access for this mobile number yet, so the sign-in '
      + 'does not go through. A new code does not change that; your site manager has '
      + 'the account created or unlocked.',
    codeFalschTitel: 'The sign-in did not work.',
    codeFalschText:
      'The code is wrong, has expired or has already been used. A code is valid for '
      + 'ten minutes and exactly once.',
    devTitel: 'Development installation — nothing was sent.',
    devCode: 'The code is',
    codeLabel: 'Six-digit code',
    codeFeldHinweis: 'Six digits. Spaces are fine.',
    neuerCodeVonLeitung: 'Ask your site manager to issue a new code.',
    neuerCodeAnfordern: 'Request a new code.',
    anmelden: 'Sign in',
    andereNummer: 'Different number or new code',
  },
  ar: {
    marke: 'مجموعة CSE',
    zurWebsite: 'إلى الموقع',
    schritt: 'الخطوة {schritt} من {schritte}',
    sprachwahl: 'اللغة',

    seitentitel: 'تسجيل دخول الموظفين — مجموعة CSE',
    titel: 'تسجيل دخول الموظفين',
    unterzeileOhneZustellung:
      'أدخل رقم هاتفك المحمول ثم الرمز المكوّن من ستة أرقام الذي يعطيك إياه مسؤول العمل. '
      + 'لا تحتاج إلى كلمة مرور.',
    unterzeileSms:
      'أدخل رقم هاتفك المحمول. ستتلقى رمزاً من ستة أرقام عبر رسالة SMS. لا تحتاج إلى كلمة مرور.',
    abgelaufenTitel: 'لم يعد تسجيل الدخول الذي بدأته صالحاً.',
    abgelaufenText:
      'يرجى إدخال رقمك مرة أخرى، وستحصل عندها على رمز جديد. الرمز صالح لمدة عشر دقائق، '
      + 'ويجب أن يُسمح للمتصفح بالاحتفاظ بملف تعريف الارتباط الصغير الخاص بتسجيل الدخول — '
      + 'في الوضع الخاص أو عند حظر ملفات تعريف الارتباط لا يكتمل تسجيل الدخول.',
    vorfuehrTitel: 'نسخة عرض.',
    vorfuehrText:
      'تعمل هذه النسخة دون اتصال مشفّر حتى يعمل تسجيل الدخول على الهاتف في الشبكة نفسها. '
      + 'في التشغيل الفعلي يجب أن تعمل المنصة خلف HTTPS — وعندها تحمل ملفات تعريف الارتباط '
      + 'الخاصة بتسجيل الدخول السمة «Secure» من جديد.',
    smsTitel: 'إرسال الرسائل القصيرة: غير متصل.',
    smsText:
      'لم تُحدَّد بوابة إرسال (سؤال مفتوح O-82: أي مزوّد مستضاف في الاتحاد الأوروبي مع عقد '
      + 'معالجة بيانات، ومن أي مبلغ شهري يُطبَّق إيقاف صارم).',
    smsEntwicklung: 'في نسخة التطوير هذه يُعرض الرمز على الشاشة بدلاً من ذلك.',
    smsOhne:
      'حتى ذلك الحين لن تصل أي رسالة SMS إلى هنا. يُصدر مسؤول العمل الرمز لك في البوابة '
      + '(Personal → Person → Zugang) ويخبرك به؛ وهو صالح لمدة عشر دقائق. أما تسجيل الوقت '
      + 'فيعمل في هذه الأثناء عبر رابط تسجيل الحضور الذي لا يحتاج إلى تسجيل دخول.',
    mobilnummer: 'رقم الهاتف المحمول',
    mobilHinweis: 'الأرقام الألمانية تبدأ بـ 0؛ والأرقام الأجنبية بـ + ورمز الدولة.',
    weiterZurCodeeingabe: 'المتابعة إلى إدخال الرمز',
    codeAnfordern: 'طلب الرمز',
    nummerNurZurAnmeldung: 'يُستخدم رقمك لتسجيل الدخول فقط.',
    nummerOhneAuskunft: 'هذه الصفحة لا تقول عمداً ما إذا كان الرقم مسجلاً.',
    nummerMitSms:
      'إذا كان الرقم مسجلاً فسيصلك رمز بعد قليل — أما هل هو مسجل فهذه الصفحة لا تقوله عمداً.',
    datenschutzHinweis:
      'تفاصيل المعالجة موجودة في سياسة الخصوصية. النسخة الألمانية هي الملزمة قانوناً، وهذه '
      + 'الترجمة للتيسير فقط.',
    datenschutzLink: 'سياسة الخصوصية (بالألمانية)',

    codeSeitentitel: 'إدخال الرمز — مجموعة CSE',
    codeTitel: 'أدخل الرمز',
    codeHinweisOhneZustellung:
      'لم تُرسل أي رسالة SMS — لا توجد بوابة متصلة (O-82). أدخل الرمز المكوّن من ستة أرقام '
      + 'الذي أعطاك إياه مسؤول العمل. وهو صالح لمدة عشر دقائق.',
    codeHinweisSms:
      'إذا كان رقمك مسجلاً فقد أرسلنا رمزاً من ستة أرقام. وهو صالح لمدة عشر دقائق.',
    kontoFehltTitel: 'كان الرمز صحيحاً — لكن الحساب غير موجود.',
    kontoFehltText:
      'لا يوجد بعد وصول نشط إلى البوابة لرقم الهاتف هذا، لذلك لا يكتمل تسجيل الدخول. لن '
      + 'يغيّر رمز جديد ذلك؛ يطلب مسؤول العمل إنشاء الحساب أو إلغاء قفله.',
    codeFalschTitel: 'لم ينجح تسجيل الدخول.',
    codeFalschText:
      'الرمز غير صحيح أو انتهت صلاحيته أو استُخدم من قبل. الرمز صالح لمدة عشر دقائق '
      + 'ولمرة واحدة فقط.',
    devTitel: 'نسخة التطوير — لم يُرسل شيء.',
    devCode: 'الرمز هو',
    codeLabel: 'الرمز المكوّن من ستة أرقام',
    codeFeldHinweis: 'ستة أرقام. لا بأس بالمسافات.',
    neuerCodeVonLeitung: 'اطلب من مسؤول العمل إصدار رمز جديد.',
    neuerCodeAnfordern: 'اطلب رمزاً جديداً.',
    anmelden: 'تسجيل الدخول',
    andereNummer: 'رقم آخر أو رمز جديد',
  },
  tr: {
    marke: 'CSE Grubu',
    zurWebsite: 'Web sitesine',
    schritt: 'Adım {schritt} / {schritte}',
    sprachwahl: 'Dil',

    seitentitel: 'Çalışan girişi — CSE Grubu',
    titel: 'Çalışan girişi',
    unterzeileOhneZustellung:
      'Cep telefonu numaranızı ve ardından ekip yöneticinizin size söylediği altı haneli '
      + 'kodu girin. Parolaya ihtiyacınız yok.',
    unterzeileSms:
      'Cep telefonu numaranızı girin. SMS ile altı haneli bir kod alacaksınız. Parolaya '
      + 'ihtiyacınız yok.',
    abgelaufenTitel: 'Başlattığınız giriş artık geçerli değil.',
    abgelaufenText:
      'Lütfen numaranızı yeniden girin; ardından yeni bir kod alacaksınız. Bir kod on '
      + 'dakika geçerlidir ve tarayıcının küçük giriş çerezini saklamasına izin '
      + 'verilmelidir — gizli modda veya çerezler engellendiğinde giriş tamamlanmaz.',
    vorfuehrTitel: 'Tanıtım kurulumu.',
    vorfuehrText:
      'Bu kurulum, girişin aynı ağdaki bir telefonda çalışması için şifreli bağlantı '
      + 'olmadan çalışıyor. Gerçek kullanımda platform HTTPS arkasında olmalıdır — o '
      + 'zaman giriş çerezleri yeniden “Secure” özelliğini taşır.',
    smsTitel: 'SMS gönderimi: bağlı değil.',
    smsText:
      'Tanımlı bir ağ geçidi yok (açık soru O-82: veri işleme sözleşmesi olan, AB’de '
      + 'barındırılan hangi sağlayıcı ve hangi aylık tutardan itibaren kesin durdurma '
      + 'uygulanır).',
    smsEntwicklung: 'Bu geliştirme kurulumunda kod bunun yerine ekranda gösterilir.',
    smsOhne:
      'O zamana kadar buraya SMS gelmez. Ekip yöneticiniz kodunuzu portalda oluşturur '
      + '(Personal → Person → Zugang) ve size söyler; kod on dakika geçerlidir. Zaman '
      + 'kaydı bu arada giriş gerektirmeyen check-in bağlantısıyla çalışır.',
    mobilnummer: 'Cep telefonu numarası',
    mobilHinweis: 'Alman numaraları 0 ile başlar; yabancı numaralar + ve ülke koduyla.',
    weiterZurCodeeingabe: 'Kod girişine devam et',
    codeAnfordern: 'Kod iste',
    nummerNurZurAnmeldung: 'Numaranız yalnızca giriş için kullanılır.',
    nummerOhneAuskunft: 'Kayıtlı olup olmadığını bu sayfa bilerek söylemez.',
    nummerMitSms:
      'Kayıtlıysa birazdan bir kod gelir — kayıtlı olup olmadığını bu sayfa bilerek '
      + 'söylemez.',
    datenschutzHinweis:
      'İşlemeyle ilgili ayrıntılar gizlilik politikasında yer alır. Hukuken bağlayıcı olan '
      + 'Almanca sürümdür; bu çeviri kolaylık amacıyla sunulmuştur.',
    datenschutzLink: 'Gizlilik politikası (Almanca)',

    codeSeitentitel: 'Kodu girin — CSE Grubu',
    codeTitel: 'Kodu girin',
    codeHinweisOhneZustellung:
      'SMS gönderilmedi — bağlı bir ağ geçidi yok (O-82). Ekip yöneticinizin size '
      + 'verdiği altı haneli kodu girin. Kod on dakika geçerlidir.',
    codeHinweisSms:
      'Numaranız kayıtlıysa altı haneli bir kod gönderdik. Kod on dakika geçerlidir.',
    kontoFehltTitel: 'Kod doğruydu — hesap eksik.',
    kontoFehltText:
      'Bu cep telefonu numarasına ait henüz etkin bir portal erişimi yok, bu yüzden giriş '
      + 'tamamlanmıyor. Yeni bir kod bunu değiştirmez; ekip yöneticiniz hesabın '
      + 'oluşturulmasını veya kilidinin açılmasını sağlar.',
    codeFalschTitel: 'Giriş başarısız oldu.',
    codeFalschText:
      'Kod yanlış, süresi dolmuş ya da daha önce kullanılmış. Bir kod on dakika ve '
      + 'yalnızca bir kez geçerlidir.',
    devTitel: 'Geliştirme kurulumu — hiçbir şey gönderilmedi.',
    devCode: 'Kod:',
    codeLabel: 'Altı haneli kod',
    codeFeldHinweis: 'Altı rakam. Boşluklar sorun değil.',
    neuerCodeVonLeitung: 'Ekip yöneticinizden yeni bir kod oluşturmasını isteyin.',
    neuerCodeAnfordern: 'Yeni bir kod isteyin.',
    anmelden: 'Giriş yap',
    andereNummer: 'Başka numara veya yeni kod',
  },
};

/* ═════════════════════════════════════════════════════════════════════════
 * Die Ablehnungen der Stempel-Routen — nach `error.code`, nie nach dem Satz
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Der Satz zu einer Ablehnung von `POST /api/check-in/[token]` (V-200, D-752).
 *
 * Die Route antwortet mit `error.code` und einem deutschen `message`. Gezeigt
 * wurde die `message` — auf Arabisch wie auf Deutsch derselbe deutsche Satz.
 * Jetzt zählt nur der Code. Zwei Fälle haben einen eigenen Satz, weil die
 * Marke dabei GÜLTIG und unverbraucht bleibt und der Fall behebbar ist:
 * `kein_benutzerkonto` und `kein_offener_eintrag` (Ausstempeln ohne laufende
 * Zeiterfassung, meist ein Einstempeln, das noch in der Offline-Schlange
 * wartet). Beide entstehen erst, nachdem die Marke jede Prüfung bestanden hat;
 * sie zu unterscheiden verrät keinem Durchprobierenden etwas. JEDE Ablehnung
 * der Marke selbst bekommt denselben Satz (AUT-06).
 */
export function stempelMeldung(t: StempelTexte, code: unknown): string {
  switch (code) {
    case 'kein_benutzerkonto': return t.keinZugang;
    case 'kein_offener_eintrag': return t.keinOffenerEintrag;
    default: return t.ungueltig;
  }
}

/**
 * Der Satz zu einer Ablehnung der Aufnahme (`…/medien`) — nach `error.code`
 * bzw. dem Grund von `MedienFehler`, in der Sprache des Geräts (V-200).
 */
export function fotoMeldung(t: StempelTexte, code: unknown, mb: number): string {
  switch (code) {
    case 'zu_gross': return setzeEin(t.fotoZuGross, { mb: String(mb) });
    case 'typ_unbekannt':
    case 'typ_nicht_erlaubt':
    case 'widerspruch': return t.fotoTyp;
    case 'KANAL_NICHT_VERBUNDEN': return t.fotoNichtVerbunden;
    case 'kein_benutzerkonto': return t.keinZugang;
    case 'ungueltiger_zustand': return t.ungueltig;
    default: return t.fotoFehler;
  }
}
