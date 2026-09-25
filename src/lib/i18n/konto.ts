/**
 * Die Wörter der Sicherheitsseite — in allen vier Portalsprachen
 * (V-039, SPEC §10, D-419).
 *
 * **Warum sie hier liegen und nicht im Seitenrumpf.** Die Wache
 * `seite-ohne-uebersetzung` liest den Syntaxbaum jeder Datei unter
 * `src/app/portal/` und meldet jede feste Beschriftung — auch die vier
 * `titel`-Zeilen einer Übersetzungstabelle, denn von innen sieht eine Tabelle
 * aus wie vier Verdrahtungen. Sie hat recht damit, dass der Text nicht in die
 * Seite gehört: hier steht er neben den übrigen Portalwörtern, und wer eine
 * fünfte Sprache ergänzt, findet ihn.
 *
 * **Vier Sprachen und nicht zwei.** Die Seite gehört dem KONTO, nicht der
 * Verwaltung: eine Reinigungskraft mit arabischer Portalsprache ändert hier
 * ihr Kennwort. `src/lib/i18n/verwaltung/` wäre deshalb der falsche Ort —
 * dort stehen die zweisprachigen Verwaltungstexte (D-82).
 */
import type { PortalSprache } from './texte.js';

export interface SicherheitTexte {
  readonly titel: string;
  readonly kennwort: string;
  readonly kennwortText: string;
  readonly zweiFaktor: string;
  readonly zweiFaktorText: string;
  readonly wiederherstellung: string;
  readonly wiederherstellungText: string;
  readonly anmeldungen: string;
  readonly anmeldungenText: string;
  readonly diese: string;
  readonly beenden: string;
  readonly keine: string;
  readonly zuletzt: string;
  readonly seit: string;
  readonly laeuftAb: string;
  readonly beendet: string;
}

export const SICHERHEIT_TEXTE: Readonly<Record<PortalSprache, SicherheitTexte>> =
{
  de: {
    titel: 'Sicherheit',
    kennwort: 'Kennwort ändern',
    kennwortText: 'Ein neues Kennwort beendet nicht die anderen Anmeldungen — '
      + 'dafür ist die Liste unten da.',
    zweiFaktor: 'Zweite Stufe einrichten',
    zweiFaktorText: 'Für Verwaltungsrollen ist sie Pflicht (AUT-02). Eingerichtet '
      + 'wird sie mit einer Authenticator-App.',
    wiederherstellung: 'Wiederherstellungscodes',
    wiederherstellungText: 'Für den Fall, dass das Telefon weg ist. Jeder Code gilt '
      + 'einmal.',
    anmeldungen: 'Aktive Anmeldungen',
    anmeldungenText: 'Jede Zeile ist ein Gerät, auf dem Sie angemeldet sind. Kommt '
      + 'Ihnen eine nicht bekannt vor, beenden Sie sie und ändern Sie danach Ihr '
      + 'Kennwort.',
    diese: 'diese hier',
    beenden: 'Beenden',
    keine: 'Nur diese eine Anmeldung.',
    zuletzt: 'zuletzt aktiv',
    seit: 'angemeldet seit',
    laeuftAb: 'läuft ab',
    beendet: 'Die Anmeldung ist beendet.',
  },
  en: {
    titel: 'Security',
    kennwort: 'Change password',
    kennwortText: 'A new password does not end your other sessions — that is what '
      + 'the list below is for.',
    zweiFaktor: 'Set up second factor',
    zweiFaktorText: 'Required for administrative roles (AUT-02). Set up with an '
      + 'authenticator app.',
    wiederherstellung: 'Recovery codes',
    wiederherstellungText: 'For the case where the phone is gone. Each code works '
      + 'once.',
    anmeldungen: 'Active sessions',
    anmeldungenText: 'Each row is a device you are signed in on. If one looks '
      + 'unfamiliar, end it and then change your password.',
    diese: 'this one',
    beenden: 'End',
    keine: 'Only this one session.',
    zuletzt: 'last active',
    seit: 'signed in since',
    laeuftAb: 'expires',
    beendet: 'The session has been ended.',
  },
  ar: {
    titel: 'الأمان',
    kennwort: 'تغيير كلمة المرور',
    kennwortText: 'كلمة مرور جديدة لا تُنهي جلساتك الأخرى — لذلك توجد القائمة أدناه.',
    zweiFaktor: 'إعداد الخطوة الثانية',
    zweiFaktorText: 'إلزامية للأدوار الإدارية (AUT-02). تُعدّ عبر تطبيق مصادقة.',
    wiederherstellung: 'رموز الاسترداد',
    wiederherstellungText: 'لحالة فقدان الهاتف. كل رمز يُستخدم مرة واحدة.',
    anmeldungen: 'الجلسات النشطة',
    anmeldungenText: 'كل سطر جهاز أنت مسجّل الدخول عليه. إذا لم تعرف أحدها، أنهِه ثم '
      + 'غيّر كلمة المرور.',
    diese: 'هذه الجلسة',
    beenden: 'إنهاء',
    keine: 'هذه الجلسة فقط.',
    zuletzt: 'آخر نشاط',
    seit: 'مسجّل منذ',
    laeuftAb: 'ينتهي',
    beendet: 'تم إنهاء الجلسة.',
  },
  tr: {
    titel: 'Güvenlik',
    kennwort: 'Parolayı değiştir',
    kennwortText: 'Yeni bir parola diğer oturumlarınızı sonlandırmaz — aşağıdaki '
      + 'liste bunun içindir.',
    zweiFaktor: 'İkinci adımı kur',
    zweiFaktorText: 'Yönetim rolleri için zorunludur (AUT-02). Bir kimlik doğrulama '
      + 'uygulamasıyla kurulur.',
    wiederherstellung: 'Kurtarma kodları',
    wiederherstellungText: 'Telefonun kaybolması durumu için. Her kod bir kez geçerli.',
    anmeldungen: 'Etkin oturumlar',
    anmeldungenText: 'Her satır giriş yaptığınız bir cihazdır. Tanımadığınız biri '
      + 'varsa sonlandırın ve ardından parolanızı değiştirin.',
    diese: 'bu oturum',
    beenden: 'Sonlandır',
    keine: 'Yalnızca bu oturum.',
    zuletzt: 'son etkinlik',
    seit: 'giriş zamanı',
    laeuftAb: 'bitiş',
    beendet: 'Oturum sonlandırıldı.',
  },
} as const;

/* ═════════════════════════════════════════════════════════════════════════
 * Die Kontowurzel `/portal/konto` (V-200, EMP-12, SEITENKARTE §12)
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Die Wörter der Kontowurzel. In der Hülle der Beschäftigten in ihrer
 * Sprache — hier stand im Kommentar „der Inhalt bleibt deutsch, bis das
 * Profil gebaut ist"; das Profil gibt es seit D-557, der Inhalt blieb
 * trotzdem deutsch. Die Verwaltung liest `de`, wie bisher.
 */
export interface KontoWurzelTexte {
  readonly name: string;
  readonly anmeldung: string;
  readonly ansicht: string;
  readonly rolle: string;
  readonly zweiteStufe: string;
  readonly gruppenansicht: string;
  readonly zweiteStufeAktiv: string;
  readonly zweiteStufeNicht: string;
  readonly bereiche: string;
  readonly keinBereich: string;
  readonly aktiv: string;
  readonly wechselVor: string;
  readonly wechselLink: string;
  readonly wechselNach: string;
  readonly ihrKonto: string;
  readonly profil: string;
  readonly profilText: string;
  readonly sicherheit: string;
  readonly sicherheitText: string;
  readonly benachrichtigungen: string;
  readonly benachrichtigungenText: string;
  readonly kalenderFeed: string;
  readonly kalenderFeedText: string;
}

export const KONTO_WURZEL_TEXTE: Readonly<Record<PortalSprache, KontoWurzelTexte>> = {
  de: {
    name: 'Name',
    anmeldung: 'Anmeldung',
    ansicht: 'Ansicht',
    rolle: 'Rolle',
    zweiteStufe: 'Zweite Stufe',
    gruppenansicht: 'Gruppenübersicht (nur lesen)',
    zweiteStufeAktiv: 'aktiv in dieser Sitzung',
    zweiteStufeNicht: 'in dieser Sitzung nicht verlangt',
    bereiche: 'Bereiche dieses Kontos',
    keinBereich:
      'Diesem Konto ist kein Bereich zugewiesen. Das ist keine Störung der Anmeldung: die '
      + 'Zuweisung erfolgt in der Benutzerverwaltung.',
    aktiv: 'aktiv',
    wechselVor: 'Gewechselt wird über',
    wechselLink: 'Bereich wechseln',
    wechselNach: '— der Wechsel wird protokolliert.',
    ihrKonto: 'Ihr Konto',
    profil: 'Profil',
    profilText: 'Name, Anmeldung und die Sprache der Oberfläche (de · en · ar · tr).',
    sicherheit: 'Sicherheit',
    sicherheitText:
      'Kennwort, zweite Stufe, Wiederherstellungscodes — und die Liste Ihrer aktiven '
      + 'Anmeldungen, jede einzeln beendbar.',
    benachrichtigungen: 'Benachrichtigungen',
    benachrichtigungenText:
      'Je Art: was in den Posteingang kommt und was zusätzlich hinausgeht. Der Posteingang '
      + 'selbst lässt sich nicht abschalten — er ist das Protokoll dessen, was Ihnen '
      + 'mitgeteilt wurde.',
    kalenderFeed: 'Kalender-Feed',
    kalenderFeedText: 'Die persönliche iCal-Adresse: einmal anzeigen, erneuern, widerrufen.',
  },
  en: {
    name: 'Name',
    anmeldung: 'Sign-in',
    ansicht: 'View',
    rolle: 'Role',
    zweiteStufe: 'Second factor',
    gruppenansicht: 'Group overview (read only)',
    zweiteStufeAktiv: 'active in this session',
    zweiteStufeNicht: 'not required in this session',
    bereiche: 'Areas of this account',
    keinBereich:
      'No area is assigned to this account. This is not a sign-in fault: areas are assigned '
      + 'in user management.',
    aktiv: 'active',
    wechselVor: 'Switch via',
    wechselLink: 'Switch area',
    wechselNach: '— the switch is logged.',
    ihrKonto: 'Your account',
    profil: 'Profile',
    profilText: 'Name, sign-in and the language of the interface (de · en · ar · tr).',
    sicherheit: 'Security',
    sicherheitText:
      'Password, second factor, recovery codes — and the list of your active sessions, each '
      + 'one can be ended on its own.',
    benachrichtigungen: 'Notifications',
    benachrichtigungenText:
      'Per type: what goes into the inbox and what is also sent out. The inbox itself cannot '
      + 'be switched off — it is the record of what you have been told.',
    kalenderFeed: 'Calendar feed',
    kalenderFeedText: 'Your personal iCal address: show once, renew, revoke.',
  },
  ar: {
    name: 'الاسم',
    anmeldung: 'تسجيل الدخول',
    ansicht: 'العرض',
    rolle: 'الدور',
    zweiteStufe: 'الخطوة الثانية',
    gruppenansicht: 'نظرة عامة على المجموعة (للقراءة فقط)',
    zweiteStufeAktiv: 'مفعّلة في هذه الجلسة',
    zweiteStufeNicht: 'غير مطلوبة في هذه الجلسة',
    bereiche: 'مجالات هذا الحساب',
    keinBereich:
      'لم يُخصَّص أي مجال لهذا الحساب. هذا ليس خللاً في تسجيل الدخول: يتم التخصيص في إدارة '
      + 'المستخدمين.',
    aktiv: 'نشط',
    wechselVor: 'يتم التبديل عبر',
    wechselLink: 'تبديل المجال',
    wechselNach: '— ويُسجَّل التبديل.',
    ihrKonto: 'حسابك',
    profil: 'الملف الشخصي',
    profilText: 'الاسم وتسجيل الدخول ولغة الواجهة (de · en · ar · tr).',
    sicherheit: 'الأمان',
    sicherheitText:
      'كلمة المرور والخطوة الثانية ورموز الاسترداد — وقائمة جلساتك النشطة، ويمكن إنهاء كل واحدة '
      + 'منها على حدة.',
    benachrichtigungen: 'الإشعارات',
    benachrichtigungenText:
      'لكل نوع: ما يصل إلى صندوق الوارد وما يُرسل إضافةً إلى ذلك. لا يمكن إيقاف صندوق الوارد '
      + 'نفسه — فهو سجل ما أُبلغت به.',
    kalenderFeed: 'رابط التقويم',
    kalenderFeedText: 'عنوان iCal الشخصي: يُعرض مرة واحدة، ويمكن تجديده أو إلغاؤه.',
  },
  tr: {
    name: 'Ad',
    anmeldung: 'Giriş',
    ansicht: 'Görünüm',
    rolle: 'Rol',
    zweiteStufe: 'İkinci adım',
    gruppenansicht: 'Grup genel görünümü (salt okunur)',
    zweiteStufeAktiv: 'bu oturumda etkin',
    zweiteStufeNicht: 'bu oturumda gerekmiyor',
    bereiche: 'Bu hesabın alanları',
    keinBereich:
      'Bu hesaba bir alan atanmamış. Bu bir giriş arızası değildir: atama kullanıcı '
      + 'yönetiminde yapılır.',
    aktiv: 'etkin',
    wechselVor: 'Değişiklik şuradan yapılır:',
    wechselLink: 'Alan değiştir',
    wechselNach: '— değişiklik kayda geçirilir.',
    ihrKonto: 'Hesabınız',
    profil: 'Profil',
    profilText: 'Ad, giriş ve arayüz dili (de · en · ar · tr).',
    sicherheit: 'Güvenlik',
    sicherheitText:
      'Parola, ikinci adım, kurtarma kodları — ve etkin oturumlarınızın listesi; her biri ayrı '
      + 'ayrı sonlandırılabilir.',
    benachrichtigungen: 'Bildirimler',
    benachrichtigungenText:
      'Tür başına: gelen kutusuna ne düşer ve ayrıca ne gönderilir. Gelen kutusunun kendisi '
      + 'kapatılamaz — size bildirilenlerin kaydıdır.',
    kalenderFeed: 'Takvim bağlantısı',
    kalenderFeedText: 'Kişisel iCal adresiniz: bir kez gösterilir, yenilenir, iptal edilir.',
  },
};

/* ═════════════════════════════════════════════════════════════════════════
 * Die Benachrichtigungseinstellungen `/portal/konto/benachrichtigungen`
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Die Wörter der Benachrichtigungseinstellungen (V-200).
 *
 * **Die Arten heissen nach ihrem Namen, nicht nach ihrem Schlüssel.** Hier
 * stand der hintere Teil des Schlüssels (`plan_veroeffentlicht`) als
 * Überschrift jeder Zeile — auf Arabisch wie auf Deutsch. Die Tabelle `art`
 * ist nach diesem hinteren Teil geordnet; der volle Schlüssel steht hier
 * bewusst NICHT, weil der Rechtekatalog-Scanner jede Zeichenkette der Form
 * `modul.etwas` als Rechteschlüssel liest.
 *
 * Die Verwaltung liest `de` und bekommt alle Arten; die Hülle der
 * Beschäftigten liest ihre Sprache und bekommt nur die Arten, die einen
 * Menschen im Arbeiterportal erreichen — die, deren Ziel unter
 * `/portal/mein` liegt (V-102). Für sie trägt jede Sprache einen Namen
 * (`tests/kern/konto-sprachen.test.ts`).
 */
export interface KontoBenachrichtigungTexte {
  readonly titel: string;
  readonly konto: string;
  readonly zumPosteingang: string;
  readonly einleitungFett: string;
  readonly einleitung: string;
  readonly gespeichertTitel: string;
  readonly gespeichert: string;
  readonly emailTitel: string;
  readonly email: string;
  readonly sofort: string;
  /** Mit `{art}`. */
  readonly kanaeleFuer: string;
  readonly kanalApp: string;
  readonly kanalEmail: string;
  readonly speichern: string;
  readonly modul: Readonly<Record<string, string>>;
  readonly art: Readonly<Record<string, string>>;
}

export const KONTO_BENACHRICHTIGUNG_TEXTE:
  Readonly<Record<PortalSprache, KontoBenachrichtigungTexte>> = {
    de: {
      titel: 'Benachrichtigungen',
      konto: 'Konto',
      zumPosteingang: 'Zum Posteingang',
      einleitungFett: 'Diese Einstellung gehört Ihnen',
      einleitung:
        'und gilt in allen Bereichen, in denen Sie Mitglied sind — nicht der Gesellschaft. Der '
        + 'Eintrag im Portal lässt sich nicht abschalten: er ist das Protokoll dessen, was Ihnen '
        + 'mitgeteilt wurde. Abgeschaltet wird der Weg nach draussen.',
      gespeichertTitel: 'Gespeichert.',
      gespeichert:
        'Die Einstellung wirkt ab der nächsten Meldung — nicht erst nach einem Neustart.',
      emailTitel: 'E-Mail-Versand: nicht verbunden.',
      email:
        'Es ist kein Postausgang hinterlegt (offene Frage O-501). „E-Mail" lässt sich hier '
        + 'bereits einstellen; zugestellt wird nichts, solange kein Anbieter mit '
        + 'Auftragsverarbeitungsvertrag in der EU eingerichtet ist. Bis dahin ist der '
        + 'Posteingang der einzige Weg.',
      sofort: 'Kommt immer sofort — nie in einer Tageszusammenfassung.',
      kanaeleFuer: 'Kanäle für {art}',
      kanalApp: 'Portal',
      kanalEmail: 'E-Mail',
      speichern: 'Speichern',
      modul: {
        agent: 'KI-Agenten', bau: 'Bau', crm: 'Vertrieb', dienstplan: 'Dienstplan',
        nachweis: 'Nachweise', personal: 'Personal', radar: 'Vergaberadar', zeit: 'Zeiterfassung',
      },
      art: {
        budget_erschoepft: 'KI-Budget erschöpft',
        nachtrag_ueberfaellig: 'Nachtrag überfällig',
        wiedervorlage_erinnerung: 'Erinnerung an eine Wiedervorlage',
        neuer_lead: 'Neue Anfrage',
        lead_sla_ueberschritten: 'Reaktionszeit einer Anfrage überschritten',
        plan_veroeffentlicht: 'Dienstplan veröffentlicht',
        schicht_ohne_zeiteintrag: 'Schicht ohne Zeiteintrag',
        morgen_unbesetzt: 'Morgen unbesetzte Schicht',
        ablauf_60: 'Nachweis läuft in 60 Tagen ab',
        ablauf_30: 'Nachweis läuft in 30 Tagen ab',
        ablauf_7: 'Nachweis läuft in 7 Tagen ab',
        frist_knapp: 'Ausschreibung: Frist wird knapp',
        treffer: 'Ausschreibung: neuer Treffer',
        einwand_entschieden: 'Entscheidung über Ihre Zeitmeldung',
      },
    },
    en: {
      titel: 'Notifications',
      konto: 'Account',
      zumPosteingang: 'To the inbox',
      einleitungFett: 'This setting belongs to you',
      einleitung:
        'and applies in every area you are a member of — not to the company. The entry in the '
        + 'portal cannot be switched off: it is the record of what you have been told. What '
        + 'can be switched off is the way out.',
      gespeichertTitel: 'Saved.',
      gespeichert: 'The setting applies from the next message on — no restart needed.',
      emailTitel: 'Email sending: not connected.',
      email:
        'No outgoing mail service is configured (open question O-501). “Email” can already be '
        + 'set here; nothing is delivered until a provider with a data processing agreement in '
        + 'the EU is set up. Until then the inbox is the only way.',
      sofort: 'Always arrives immediately — never in a daily summary.',
      kanaeleFuer: 'Channels for {art}',
      kanalApp: 'Portal',
      kanalEmail: 'Email',
      speichern: 'Save',
      modul: { dienstplan: 'Shift plan', nachweis: 'Certificates', zeit: 'Time recording' },
      art: {
        plan_veroeffentlicht: 'Shift plan published',
        ablauf_60: 'Certificate expires in 60 days',
        ablauf_30: 'Certificate expires in 30 days',
        ablauf_7: 'Certificate expires in 7 days',
        einwand_entschieden: 'Decision on your time report',
      },
    },
    ar: {
      titel: 'الإشعارات',
      konto: 'الحساب',
      zumPosteingang: 'إلى صندوق الوارد',
      einleitungFett: 'هذا الإعداد يخصّك أنت',
      einleitung:
        'ويسري في كل المجالات التي أنت عضو فيها — لا على الشركة. لا يمكن إيقاف الإدخال في '
        + 'البوابة: فهو سجل ما أُبلغت به. ما يمكن إيقافه هو الإرسال إلى الخارج.',
      gespeichertTitel: 'تم الحفظ.',
      gespeichert: 'يسري الإعداد ابتداءً من الرسالة التالية — دون حاجة إلى إعادة تشغيل.',
      emailTitel: 'إرسال البريد الإلكتروني: غير متصل.',
      email:
        'لا توجد خدمة بريد صادر مُعدّة (سؤال مفتوح O-501). يمكن ضبط «البريد الإلكتروني» هنا '
        + 'مسبقاً؛ لكن لا يُرسل شيء ما لم يُعدّ مزوّد في الاتحاد الأوروبي بعقد معالجة بيانات. '
        + 'وحتى ذلك الحين يبقى صندوق الوارد الطريق الوحيد.',
      sofort: 'يصل دائماً فوراً — وليس ضمن ملخص يومي أبداً.',
      kanaeleFuer: 'القنوات لـ {art}',
      kanalApp: 'البوابة',
      kanalEmail: 'البريد الإلكتروني',
      speichern: 'حفظ',
      modul: { dienstplan: 'جدول المناوبات', nachweis: 'الشهادات', zeit: 'تسجيل الوقت' },
      art: {
        plan_veroeffentlicht: 'نشر جدول المناوبات',
        ablauf_60: 'تنتهي الشهادة خلال 60 يوماً',
        ablauf_30: 'تنتهي الشهادة خلال 30 يوماً',
        ablauf_7: 'تنتهي الشهادة خلال 7 أيام',
        einwand_entschieden: 'قرار بشأن بلاغ الوقت الخاص بك',
      },
    },
    tr: {
      titel: 'Bildirimler',
      konto: 'Hesap',
      zumPosteingang: 'Gelen kutusuna',
      einleitungFett: 'Bu ayar size aittir',
      einleitung:
        've üyesi olduğunuz tüm alanlarda geçerlidir — şirkette değil. Portaldaki kayıt '
        + 'kapatılamaz: size bildirilenlerin kaydıdır. Kapatılabilen, dışarıya giden yoldur.',
      gespeichertTitel: 'Kaydedildi.',
      gespeichert: 'Ayar bir sonraki bildirimden itibaren geçerlidir — yeniden başlatma gerekmez.',
      emailTitel: 'E-posta gönderimi: bağlı değil.',
      email:
        'Giden posta hizmeti tanımlı değil (açık soru O-501). “E-posta” burada şimdiden '
        + 'ayarlanabilir; AB’de veri işleme sözleşmesi olan bir sağlayıcı kurulana kadar hiçbir '
        + 'şey gönderilmez. O zamana kadar tek yol gelen kutusudur.',
      sofort: 'Her zaman hemen gelir — asla günlük özet içinde değil.',
      kanaeleFuer: '{art} için kanallar',
      kanalApp: 'Portal',
      kanalEmail: 'E-posta',
      speichern: 'Kaydet',
      modul: { dienstplan: 'Vardiya planı', nachweis: 'Belgeler', zeit: 'Zaman kaydı' },
      art: {
        plan_veroeffentlicht: 'Vardiya planı yayımlandı',
        ablauf_60: 'Belgenin süresi 60 gün içinde doluyor',
        ablauf_30: 'Belgenin süresi 30 gün içinde doluyor',
        ablauf_7: 'Belgenin süresi 7 gün içinde doluyor',
        einwand_entschieden: 'Zaman bildiriminiz hakkında karar',
      },
    },
  };

/* ═════════════════════════════════════════════════════════════════════════
 * Der Kalender-Feed `/portal/konto/kalender-feed` (CAL-03, V-200 Nachtrag)
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Die Wörter der Seite des Kalender-Feeds — in der Hülle der Beschäftigten in
 * ihrer Sprache, in der Verwaltung deutsch wie Kontowurzel und
 * Benachrichtigungen (D-694 Nr. 7, D-750).
 *
 * **Warum gerade diese Seite nicht deutsch bleiben darf.** Die übersetzte
 * Kontowurzel verweist jede Kraft hierher („رابط التقويم", „Takvim
 * bağlantısı"), und die Seite sagt das Wichtigste, das eine Kraft über den
 * Zugang wissen muss: die Adresse IST der Zugang, ohne Anmeldung, bis sie
 * widerrufen wird. Eine Warnung, die die Kraft nicht lesen kann, warnt nicht.
 *
 * Die Namen der Kalenderprogramme, `iCal` und die Fundstelle `O-510` bleiben
 * in jeder Sprache stehen, wie sie heissen.
 */
export interface KalenderFeedTexte {
  readonly titel: string;
  readonly konto: string;
  readonly zumKalender: string;
  readonly nurLesend: string;
  readonly einleitung: string;
  readonly neuTitel: string;
  readonly neuText: string;
  readonly widerrufenTitel: string;
  readonly widerrufenText: string;
  readonly widerrufenVeraltet: string;
  readonly warnungTitel: string;
  readonly warnungText: string;
  readonly zugaenge: string;
  readonly leer: string;
  readonly angelegt: string;
  readonly zuletztAbgerufen: string;
  readonly nochNie: string;
  /** Mit `{anzahl}` — die Zahl der Abrufe. */
  readonly abrufe: string;
  readonly widerrufen: string;
  readonly anlegen: string;
  readonly zweiterZugang: string;
  /** Der Name, den ein Zugang ohne eigenen Namen trägt (`FEED_STANDARD_BEZEICHNUNG`). */
  readonly standardName: string;
}

export const KALENDER_FEED_TEXTE: Readonly<Record<PortalSprache, KalenderFeedTexte>> = {
  de: {
    titel: 'Kalender abonnieren',
    konto: 'Konto',
    zumKalender: 'Zum Kalender',
    nurLesend: 'Nur lesend.',
    einleitung:
      'Ein Zugang für Ihr Kalenderprogramm — Apple Kalender, Outlook, Thunderbird. Er zeigt '
      + 'Ihre Termine, Ihre Schichten und Ihre Fristen aus allen Bereichen, in denen Sie '
      + 'Mitglied sind. Ändern lässt sich darüber nichts.',
    neuTitel: 'Diese Adresse sehen Sie genau einmal.',
    neuText:
      'Kopieren Sie sie jetzt in Ihr Kalenderprogramm. Gespeichert ist nur ihre Prüfsumme — '
      + 'wir können sie Ihnen später nicht noch einmal zeigen, und niemand kann sie aus der '
      + 'Datenbank lesen.',
    widerrufenTitel: 'Widerrufen.',
    widerrufenText:
      'Der nächste Abruf mit dieser Adresse bekommt nichts mehr — sofort, nicht beim nächsten '
      + 'Abgleich.',
    widerrufenVeraltet:
      'Sollte der Zugang unten noch stehen, ist das eine veraltete Anzeige und kein offener '
      + 'Zugang (O-510): ein Neuladen der Seite zeigt den richtigen Stand.',
    warnungTitel: 'Die Adresse IST der Zugang.',
    warnungText:
      'Wer sie hat, sieht Ihre Termine — ohne Anmeldung und ohne zweiten Faktor, bis Sie '
      + 'widerrufen. Ein Kalenderprogramm kann sich nicht anmelden; das ist der Grund, und es '
      + 'ist auch die Grenze. Geben Sie die Adresse nicht weiter, und widerrufen Sie sie, wenn '
      + 'ein Gerät abhandenkommt.',
    zugaenge: 'Ihre Zugänge',
    leer:
      'Sie haben noch keinen Zugang. Ohne einen holt kein Kalenderprogramm etwas ab — und das '
      + 'ist der Ruhezustand, nicht ein fehlender Schritt.',
    angelegt: 'Angelegt',
    zuletztAbgerufen: 'zuletzt abgerufen',
    nochNie: 'noch nie',
    abrufe: '{anzahl}×',
    widerrufen: 'Widerrufen',
    anlegen: 'Neuen Zugang anlegen',
    zweiterZugang:
      'Ein zweiter Zugang ist sinnvoll, wenn Sie zwei Geräte getrennt widerrufen können '
      + 'wollen. Der alte bleibt gültig, bis Sie ihn widerrufen.',
    standardName: 'Mein Kalender',
  },
  en: {
    titel: 'Subscribe to calendar',
    konto: 'Account',
    zumKalender: 'To the calendar',
    nurLesend: 'Read only.',
    einleitung:
      'An address for your calendar app — Apple Calendar, Outlook, Thunderbird. It shows your '
      + 'appointments, your shifts and your deadlines from every area you are a member of. '
      + 'Nothing can be changed through it.',
    neuTitel: 'You see this address exactly once.',
    neuText:
      'Copy it into your calendar app now. Only its checksum is stored — we cannot show it to '
      + 'you again later, and nobody can read it from the database.',
    widerrufenTitel: 'Revoked.',
    widerrufenText:
      'The next request with this address gets nothing — immediately, not at the next sync.',
    widerrufenVeraltet:
      'If the address still appears below, that is an out-of-date display, not an open address '
      + '(O-510): reloading the page shows the correct state.',
    warnungTitel: 'The address IS the access.',
    warnungText:
      'Whoever has it sees your appointments — without signing in and without a second factor, '
      + 'until you revoke it. A calendar app cannot sign in; that is the reason, and it is also '
      + 'the limit. Do not pass the address on, and revoke it if a device is lost.',
    zugaenge: 'Your addresses',
    leer:
      'You do not have an address yet. Without one, no calendar app fetches anything — and that '
      + 'is the resting state, not a missing step.',
    angelegt: 'Created',
    zuletztAbgerufen: 'last fetched',
    nochNie: 'never',
    abrufe: '{anzahl}×',
    widerrufen: 'Revoke',
    anlegen: 'Create new address',
    zweiterZugang:
      'A second address makes sense if you want to be able to revoke two devices separately. '
      + 'The old one stays valid until you revoke it.',
    standardName: 'My calendar',
  },
  ar: {
    titel: 'الاشتراك في التقويم',
    konto: 'الحساب',
    zumKalender: 'إلى التقويم',
    nurLesend: 'للقراءة فقط.',
    einleitung:
      'عنوان لبرنامج التقويم لديك — Apple Calendar وOutlook وThunderbird. يعرض مواعيدك '
      + 'ونوباتك ومواعيدك النهائية من جميع المجالات التي أنت عضو فيها. لا يمكن تغيير أي شيء '
      + 'من خلاله.',
    neuTitel: 'سترى هذا العنوان مرة واحدة فقط.',
    neuText:
      'انسخه الآن إلى برنامج التقويم لديك. لا يُحفظ إلا مجموعه الاختباري — لا يمكننا عرضه لك '
      + 'مرة أخرى لاحقًا، ولا يستطيع أحد قراءته من قاعدة البيانات.',
    widerrufenTitel: 'تم الإلغاء.',
    widerrufenText:
      'الطلب التالي بهذا العنوان لن يحصل على شيء — فورًا، وليس عند المزامنة التالية.',
    widerrufenVeraltet:
      'إذا ظل العنوان ظاهرًا أدناه، فهذا عرض قديم وليس وصولًا مفتوحًا (O-510): إعادة تحميل '
      + 'الصفحة تعرض الحالة الصحيحة.',
    warnungTitel: 'العنوان هو الوصول نفسه.',
    warnungText:
      'من يملكه يرى مواعيدك — دون تسجيل دخول ودون خطوة ثانية، إلى أن تلغيه. برنامج التقويم '
      + 'لا يستطيع تسجيل الدخول؛ هذا هو السبب، وهو أيضًا الحد. لا تعطِ العنوان لأحد، وألغِه '
      + 'إذا فُقد جهاز.',
    zugaenge: 'عناوين الوصول الخاصة بك',
    leer:
      'ليس لديك عنوان وصول بعد. من دونه لا يجلب أي برنامج تقويم شيئًا — وهذه حالة السكون، وليست '
      + 'خطوة ناقصة.',
    angelegt: 'أُنشئ',
    zuletztAbgerufen: 'آخر جلب',
    nochNie: 'لم يحدث بعد',
    abrufe: '{anzahl}×',
    widerrufen: 'إلغاء',
    anlegen: 'إنشاء عنوان جديد',
    zweiterZugang:
      'يفيد عنوان ثانٍ إذا أردت أن تستطيع إلغاء جهازين كلٌّ على حدة. يبقى العنوان القديم صالحًا '
      + 'إلى أن تلغيه.',
    standardName: 'تقويمي',
  },
  tr: {
    titel: 'Takvime abone ol',
    konto: 'Hesap',
    zumKalender: 'Takvime',
    nurLesend: 'Salt okunur.',
    einleitung:
      'Takvim programınız için bir adres — Apple Takvim, Outlook, Thunderbird. Üyesi olduğunuz '
      + 'tüm alanlardaki randevularınızı, vardiyalarınızı ve son tarihlerinizi gösterir. Bu '
      + 'yolla hiçbir şey değiştirilemez.',
    neuTitel: 'Bu adresi yalnızca bir kez görürsünüz.',
    neuText:
      'Şimdi takvim programınıza kopyalayın. Yalnızca sağlama toplamı saklanır — adresi size '
      + 'daha sonra tekrar gösteremeyiz ve kimse onu veritabanından okuyamaz.',
    widerrufenTitel: 'İptal edildi.',
    widerrufenText:
      'Bu adresle yapılan bir sonraki istek artık hiçbir şey almaz — hemen, bir sonraki '
      + 'eşitlemede değil.',
    widerrufenVeraltet:
      'Adres aşağıda hâlâ görünüyorsa bu eski bir görüntüdür, açık bir erişim değildir (O-510): '
      + 'sayfayı yeniden yüklemek doğru durumu gösterir.',
    warnungTitel: 'Adresin kendisi erişimdir.',
    warnungText:
      'Adrese sahip olan herkes randevularınızı görür — giriş yapmadan ve ikinci adım olmadan, '
      + 'siz iptal edene kadar. Bir takvim programı giriş yapamaz; nedeni budur ve sınırı da '
      + 'budur. Adresi kimseyle paylaşmayın ve bir cihaz kaybolursa iptal edin.',
    zugaenge: 'Erişimleriniz',
    leer:
      'Henüz bir erişiminiz yok. Erişim olmadan hiçbir takvim programı bir şey almaz — bu bir '
      + 'bekleme durumudur, eksik bir adım değil.',
    angelegt: 'Oluşturuldu',
    zuletztAbgerufen: 'son alınma',
    nochNie: 'hiç',
    abrufe: '{anzahl}×',
    widerrufen: 'İptal et',
    anlegen: 'Yeni erişim oluştur',
    zweiterZugang:
      'İki cihazı ayrı ayrı iptal edebilmek istiyorsanız ikinci bir erişim mantıklıdır. Eskisi '
      + 'siz iptal edene kadar geçerli kalır.',
    standardName: 'Takvimim',
  },
};
