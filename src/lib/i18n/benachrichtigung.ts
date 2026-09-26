import { PORTAL_SPRACHEN, type PortalSprache } from './texte.js';

/**
 * **Die drei Systemmeldungen, die einen ARBEITER erreichen — in vier
 * Sprachen** (V-102, NOT-01, SPEC §10).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `benachrichtigung` trägt GESPEICHERTEN Text: Titel und Text entstehen beim
 * Erzeugen und stehen danach fest. Sie entstanden hart deutsch — auch die
 * Ablaufwarnung eines Nachweises, die eine **Sperre nach § 34a GewO**
 * ankündigt. Das Arbeiterportal steht in vier Sprachen, weil die Menschen
 * dort nicht alle Deutsch lesen; die eine Meldung, die ihnen sagt, dass sie
 * ab einem bestimmten Tag nicht mehr eingeteilt werden können, stand nur auf
 * Deutsch da.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Welche Sprache — und warum diese** (O-889).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Frage ist gestellt und nicht beantwortet: die Sprache der EMPFÄNGERIN
 * (`person.sprache`) oder die der Gesellschaft, die sendet? **Ausgeliefert
 * ist die Sprache der Empfängerin**, und der Grund ist der Zweck der
 * Meldung: sie soll gelesen werden. Eine Sperrankündigung, die ihr Adressat
 * nicht versteht, hat ihren Zweck verfehlt, und der Schaden trägt einen
 * Namen — jemand erscheint zur Schicht und wird weggeschickt.
 *
 * Die andere Lesart bleibt möglich und ist EINE Zeile: die drei Erzeuger
 * reichen die Sprache herein, sie steht nicht in diesen Texten fest. Ändert
 * sich die Sprache eines Menschen SPÄTER, bleibt eine zugestellte Meldung
 * wie sie ist — was zugestellt ist, ist zugestellt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier NICHT übersetzt wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Meldungen an die VERWALTUNG bleiben deutsch: das interne Portal ist
 * deutsch (CLAUDE.md), und seine Begriffe tragen juristische Bedeutung. Hier
 * stehen die drei Arten, die in `/portal/mein` landen — und sonst keine.
 *
 * Und der eingesetzte Text bleibt, wie er kommt: der Name einer
 * Qualifikation, eine Begründung, der Name der Gesellschaft. Sie zu
 * übersetzen hiesse, sie zu erfinden.
 */

export interface NachweisAblaufTexte {
  /** `{tage}` = Warnstufe, `{nachweis}` = Bezeichnung. */
  readonly titel: string;
  /** `{nachweis}`, `{bis}`. */
  readonly text: string;
  /** Der harte Zusatz, wenn die Qualifikation eine Einteilung sperrt. */
  readonly sperrt: string;
  /** Der milde Zusatz, wenn sie es nicht tut. */
  readonly verlaengern: string;
}

export interface EinwandTexte {
  readonly anerkannt: string;
  readonly teilweise: string;
  readonly abgelehnt: string;
  readonly entschieden: string;
  /** `{zustand}`. */
  readonly titel: string;
  /** `{zum}` = „ zum 03.04.2026" oder leer, `{zustand}`. */
  readonly text: string;
  /** `{grund}`. */
  readonly mitGrund: string;
  readonly ohneGrund: string;
  readonly nachsatz: string;
  /** `{datum}` — eingesetzt in `{zum}`. */
  readonly zum: string;
}

export interface PlanTexte {
  /** `{zeitraum}`. */
  readonly titel: string;
  /** `{zeitraum}`, `{gesellschaft}` — Letzteres fertig geklammert oder leer. */
  readonly text: string;
  /** `{name}` — die Klammer um den Namen der Gesellschaft, oder leer. */
  readonly gesellschaft: string;
  /**
   * `{von}`, `{bis}` — die Fügung zwischen zwei Kalendertagen.
   *
   * `zeitraumText()` baut „15.05.2028 bis 21.05.2028", und das „bis" darin
   * ist ein DEUTSCHES Wort, das wir selbst erzeugen — keine Firmierung und
   * kein Name. In einem arabischen Satz stand es als Fremdkörper mitten
   * drin. Die Tage selbst bleiben, wie sie geschrieben werden (TT.MM.JJJJ,
   * Europe/Berlin).
   */
  readonly zeitraum: string;
  /**
   * Die Zahl der Schichten — drei Formen, weil eine Sprache mit einer nicht
   * auskommt.
   *
   * Deutsch und Englisch unterscheiden Ein- und Mehrzahl; Tuerkisch haengt
   * hinter einer Zahl gar kein Mehrzahlzeichen an; Arabisch kennt fuer 2, fuer
   * 3–10 und ab 11 verschiedene Formen. Statt ein Zahlwortsystem fuer vier
   * Sprachen zu bauen, nennt `mehrere` im Arabischen die ZAHL („Zahl deiner
   * Schichten: 12") — das ist fuer jede Zahl richtig.
   */
  readonly eine: string;
  /** `{schichten}`. */
  readonly mehrere: string;
  readonly keine: string;
  /** Der Satz zur Zeitzone — Invariante 2, und die Nachtschicht steht abends. */
  readonly zeitzone: string;
}

export interface BenachrichtigungsTexte {
  readonly nachweisAblauf: NachweisAblaufTexte;
  readonly einwand: EinwandTexte;
  readonly plan: PlanTexte;
}

export const BENACHRICHTIGUNG_TEXTE:
Readonly<Record<PortalSprache, BenachrichtigungsTexte>> = {
  de: {
    nachweisAblauf: {
      titel: 'Nachweis läuft in {tage} Tagen ab: {nachweis}',
      text: 'Der Nachweis „{nachweis}" ist nur noch bis zum {bis} gültig.',
      /* Kein Schönreden: SEC-04 ist eine Hartsperre, keine Warnung. */
      sperrt: ' Ohne gültigen Nachweis ist ab diesem Tag keine Einteilung mehr '
        + 'möglich (§ 34a GewO).',
      verlaengern: ' Bitte rechtzeitig verlängern.',
    },
    einwand: {
      anerkannt: 'anerkannt', teilweise: 'teilweise anerkannt',
      abgelehnt: 'abgelehnt', entschieden: 'entschieden',
      titel: 'Ihre Zeitmeldung wurde {zustand}',
      text: 'Ihre Meldung{zum} wurde {zustand}.',
      zum: ' zum {datum}',
      mitGrund: ' Begründung: {grund}',
      ohneGrund: ' Eine Begründung wurde nicht eingetragen.',
      nachsatz: ' Ändert sich dadurch Ihre erfasste Zeit, steht die neue Fassung '
        + 'in „Meine Zeiten"; die alte bleibt daneben stehen.',
    },
    plan: {
      titel: 'Dienstplan veröffentlicht: {zeitraum}',
      text: 'Der Dienstplan für {zeitraum} ist veröffentlicht{gesellschaft}.',
      gesellschaft: ' ({name})',
      zeitraum: '{von} bis {bis}',
      eine: ' Für Sie ist darin 1 Schicht eingeteilt.',
      mehrere: ' Für Sie sind darin {schichten} Schichten eingeteilt.',
      keine: ' Für Sie ist darin keine Schicht eingeteilt.',
      zeitzone: ' Die Zeiten stehen in Europe/Berlin; eine Nachtschicht steht '
        + 'an dem Abend, an dem sie beginnt.',
    },
  },
  en: {
    nachweisAblauf: {
      titel: 'Certificate expires in {tage} days: {nachweis}',
      text: 'The certificate “{nachweis}” is only valid until {bis}.',
      sperrt: ' Without a valid certificate you cannot be scheduled from that '
        + 'day on (§ 34a GewO — German Trade Regulation Act).',
      verlaengern: ' Please renew it in good time.',
    },
    einwand: {
      anerkannt: 'accepted', teilweise: 'partly accepted',
      abgelehnt: 'rejected', entschieden: 'decided',
      titel: 'Your time report was {zustand}',
      text: 'Your report{zum} was {zustand}.',
      zum: ' for {datum}',
      mitGrund: ' Reason: {grund}',
      ohneGrund: ' No reason was recorded.',
      nachsatz: ' If this changes your recorded time, the new version is under '
        + '“My times”; the old one stays next to it.',
    },
    plan: {
      titel: 'Roster published: {zeitraum}',
      text: 'The roster for {zeitraum} has been published{gesellschaft}.',
      gesellschaft: ' ({name})',
      zeitraum: '{von} to {bis}',
      eine: ' You are scheduled for 1 shift in it.',
      mehrere: ' You are scheduled for {schichten} shifts in it.',
      keine: ' You are not scheduled for any shift in it.',
      zeitzone: ' Times are given in Europe/Berlin; a night shift is listed on '
        + 'the evening it starts.',
    },
  },
  ar: {
    nachweisAblauf: {
      titel: 'تنتهي صلاحية الشهادة خلال {tage} يوماً: {nachweis}',
      text: 'الشهادة «{nachweis}» صالحة حتى {bis} فقط.',
      sperrt: ' بدون شهادة سارية لا يمكن إدراجك في الجدول اعتباراً من ذلك اليوم '
        + '(المادة 34a من قانون المهن الألماني).',
      verlaengern: ' يرجى تجديدها في الوقت المناسب.',
    },
    einwand: {
      anerkannt: 'قُبل', teilweise: 'قُبل جزئياً',
      abgelehnt: 'رُفض', entschieden: 'تم البت فيه',
      titel: 'بلاغ الوقت الخاص بك {zustand}',
      text: 'بلاغك{zum} {zustand}.',
      zum: ' عن {datum}',
      mitGrund: ' السبب: {grund}',
      ohneGrund: ' لم يُسجَّل أي سبب.',
      nachsatz: ' إذا تغيّر بذلك وقتك المسجَّل، تجد النسخة الجديدة في «أوقاتي»؛ '
        + 'وتبقى النسخة القديمة بجانبها.',
    },
    plan: {
      titel: 'تم نشر جدول الدوام: {zeitraum}',
      text: 'تم نشر جدول الدوام للفترة {zeitraum}{gesellschaft}.',
      gesellschaft: ' ({name})',
      zeitraum: '{von} إلى {bis}',
      eine: ' لديك مناوبة واحدة في هذه الفترة.',
      mehrere: ' عدد مناوباتك في هذه الفترة: {schichten}.',
      keine: ' لا توجد لديك أي مناوبة في هذه الفترة.',
      zeitzone: ' الأوقات بتوقيت Europe/Berlin؛ والمناوبة الليلية تُدرَج في '
        + 'المساء الذي تبدأ فيه.',
    },
  },
  tr: {
    nachweisAblauf: {
      titel: 'Belge {tage} gün içinde sona eriyor: {nachweis}',
      text: '“{nachweis}” belgesi yalnızca {bis} tarihine kadar geçerli.',
      sperrt: ' Geçerli belge olmadan o günden itibaren vardiyaya '
        + 'yazılamazsınız (§ 34a GewO — Alman Ticaret Yönetmeliği).',
      verlaengern: ' Lütfen zamanında yenileyin.',
    },
    einwand: {
      anerkannt: 'kabul edildi', teilweise: 'kısmen kabul edildi',
      abgelehnt: 'reddedildi', entschieden: 'karara bağlandı',
      titel: 'Zaman bildiriminiz {zustand}',
      text: 'Bildiriminiz{zum} {zustand}.',
      zum: ' ({datum} tarihli)',
      mitGrund: ' Gerekçe: {grund}',
      ohneGrund: ' Herhangi bir gerekçe kaydedilmedi.',
      nachsatz: ' Bu nedenle kayıtlı süreniz değişirse yeni sürüm '
        + '“Zamanlarım” altındadır; eskisi yanında kalır.',
    },
    plan: {
      titel: 'Vardiya planı yayımlandı: {zeitraum}',
      text: '{zeitraum} dönemi için vardiya planı yayımlandı{gesellschaft}.',
      gesellschaft: ' ({name})',
      zeitraum: '{von} ile {bis} arası',
      eine: ' Bu dönemde 1 vardiyanız var.',
      mehrere: ' Bu dönemde {schichten} vardiyanız var.',
      keine: ' Bu dönemde size vardiya planlanmadı.',
      zeitzone: ' Saatler Europe/Berlin zaman dilimindedir; gece vardiyası, '
        + 'başladığı akşamda listelenir.',
    },
  },
};

/**
 * Platzhalter einsetzen — `{name}` gegen den Wert.
 *
 * **Kein Template-Literal in den Texten.** Sie stehen als Daten da und werden
 * je Sprache gepflegt; ein Literal bräuchte je Sprache eine Funktion, und
 * eine davon würde eines Tages einen Platzhalter vergessen. So fällt ein
 * vergessener Platzhalter als `{name}` im Text auf, statt als fehlendes Wort.
 */
export function setze(
  vorlage: string, werte: Readonly<Record<string, string | number>>,
): string {
  let text = vorlage;
  for (const [name, wert] of Object.entries(werte)) {
    text = text.split(`{${name}}`).join(String(wert));
  }
  return text;
}

/** Die Texte einer Sprache — unbekannt heisst Deutsch (fail closed). */
export function texteFuer(sprache: string | null | undefined): BenachrichtigungsTexte {
  const s = (PORTAL_SPRACHEN as readonly string[]).includes(sprache ?? '')
    ? (sprache as PortalSprache) : 'de';
  return BENACHRICHTIGUNG_TEXTE[s];
}
