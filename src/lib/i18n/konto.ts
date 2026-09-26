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
