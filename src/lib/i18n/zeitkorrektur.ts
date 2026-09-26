/**
 * Die Nachricht, die eine Mitarbeiterin bekommt, wenn ihre Zeit korrigiert
 * wurde — in allen vier Portalsprachen (EMP-12, TIM-11, SPEC §10).
 *
 * **Warum ueberhaupt eine Nachricht.** `/portal/[mandant]/zeiten/[id]/korrektur`
 * verlangt Art, Grund und Begruendung als Pflichtfelder — sorgfaeltig gebaut.
 * Nur erfuhr der Mensch, dessen Stunden sich aenderten, davon nichts: der
 * Dienst schrieb die Korrekturzeile und schwieg. Wer seine Stunden nicht
 * zufaellig nachsah, sah die Aenderung nie.
 *
 * **Warum in IHRER Sprache.** Die Korrektur aendert eine Zahl, aus der am
 * Monatsende Geld wird. Ein deutscher Satz an eine Reinigungskraft, die
 * Arabisch eingestellt hat, ist derselbe Fall wie die Statuspille ohne
 * `sprache`: formal zugestellt, tatsaechlich nicht angekommen. Die Sprache
 * kommt aus `person.sprache` (0165).
 *
 * **Was NICHT uebersetzt wird: die Begruendung.** Sie ist der Wortlaut eines
 * Menschen und steht in Anfuehrungszeichen, unveraendert. Sie maschinell zu
 * uebertragen hiesse, einem Menschen Worte zuzuschreiben, die er nicht
 * gesagt hat — und diese Zeile kann in einem Streit ueber Lohn zitiert
 * werden. Uebersetzt wird der RAHMEN, nicht die Aussage.
 *
 * **Fachbegriffe bleiben deutsch**, auch hier: `Storno` und `Objekt` tragen
 * Rechtsbedeutung und stehen mit einer Erklaerung in Klammern statt mit
 * einer erfundenen Entsprechung.
 */
import type { PortalSprache } from './texte.js';

export type KorrekturArtSchluessel =
  | 'zeit_korrektur' | 'pause_korrektur' | 'zuordnung_korrektur'
  | 'nacherfassung' | 'storno';

export type KorrekturGrundSchluessel =
  | 'vergessen_auszustempeln' | 'geraet_defekt' | 'falsches_objekt'
  | 'einwand_mitarbeiter' | 'nachtrag_offline' | 'sonstiges';

export interface KorrekturNachrichtTexte {
  readonly betreff: string;
  readonly betreffStorno: string;
  /** `{datum}` wird ersetzt. */
  readonly einleitung: string;
  readonly einleitungStorno: string;
  readonly artZeile: string;
  readonly grundZeile: string;
  readonly begruendungZeile: string;
  readonly widerspruch: string;
  readonly art: Readonly<Record<KorrekturArtSchluessel, string>>;
  readonly grund: Readonly<Record<KorrekturGrundSchluessel, string>>;
}

export const KORREKTUR_NACHRICHT:
Readonly<Record<PortalSprache, KorrekturNachrichtTexte>> = {
  de: {
    betreff: 'Ihre erfasste Zeit wurde korrigiert',
    betreffStorno: 'Ihre erfasste Zeit wurde storniert',
    einleitung: 'Ihre erfasste Zeit vom {datum} wurde von der Leitung korrigiert.',
    einleitungStorno: 'Ihre erfasste Zeit vom {datum} wurde storniert (Storno — '
      + 'der Eintrag bleibt stehen und wird als ungültig gekennzeichnet).',
    artZeile: 'Art',
    grundZeile: 'Grund',
    begruendungZeile: 'Begründung der Leitung',
    widerspruch: 'Wenn das nicht stimmt, können Sie widersprechen. Der Eintrag '
      + 'steht unter „Meine Zeiten"; dort finden Sie den Weg zum Einwand.',
    art: {
      zeit_korrektur: 'Zeit korrigiert',
      pause_korrektur: 'Pause korrigiert',
      zuordnung_korrektur: 'Zuordnung korrigiert',
      nacherfassung: 'Nachträglich erfasst',
      storno: 'Storniert (Storno)',
    },
    grund: {
      vergessen_auszustempeln: 'Ausstempeln vergessen',
      geraet_defekt: 'Gerät defekt',
      falsches_objekt: 'Falsches Objekt',
      einwand_mitarbeiter: 'Einwand der Mitarbeiterin',
      nachtrag_offline: 'Nachtrag, offline erfasst',
      sonstiges: 'Sonstiges',
    },
  },
  en: {
    betreff: 'Your recorded time was corrected',
    betreffStorno: 'Your recorded time was reversed',
    einleitung: 'Your recorded time for {datum} was corrected by management.',
    einleitungStorno: 'Your recorded time for {datum} was reversed by a Storno '
      + '(reversing entry — the record stays and is marked invalid).',
    artZeile: 'Type',
    grundZeile: 'Reason',
    begruendungZeile: 'Explanation from management',
    widerspruch: 'If this is not correct, you can object. The entry is under '
      + '„My times"; the way to raise an objection is there.',
    art: {
      zeit_korrektur: 'Time corrected',
      pause_korrektur: 'Break corrected',
      zuordnung_korrektur: 'Assignment corrected',
      nacherfassung: 'Recorded afterwards',
      storno: 'Reversed (Storno)',
    },
    grund: {
      vergessen_auszustempeln: 'Forgot to clock out',
      geraet_defekt: 'Device fault',
      falsches_objekt: 'Wrong Objekt (site)',
      einwand_mitarbeiter: 'Objection by the employee',
      nachtrag_offline: 'Added afterwards, recorded offline',
      sonstiges: 'Other',
    },
  },
  ar: {
    betreff: 'تم تصحيح وقت العمل المسجَّل لك',
    betreffStorno: 'تم إلغاء وقت العمل المسجَّل لك',
    einleitung: 'تم تصحيح وقت عملك المسجَّل بتاريخ {datum} من قِبل الإدارة.',
    einleitungStorno: 'تم إلغاء وقت عملك المسجَّل بتاريخ {datum} بقيد عكسي '
      + '(Storno — يبقى السجلّ موجوداً ويُوسَم بأنه غير سارٍ).',
    artZeile: 'النوع',
    grundZeile: 'السبب',
    begruendungZeile: 'تبرير الإدارة',
    widerspruch: 'إذا لم يكن هذا صحيحاً، يمكنك الاعتراض. السجلّ موجود تحت '
      + '«أوقاتي»، وهناك تجد طريق الاعتراض.',
    art: {
      zeit_korrektur: 'تصحيح الوقت',
      pause_korrektur: 'تصحيح الاستراحة',
      zuordnung_korrektur: 'تصحيح الإسناد',
      nacherfassung: 'تسجيل لاحق',
      storno: 'إلغاء (Storno — قيد عكسي)',
    },
    grund: {
      vergessen_auszustempeln: 'نسيان تسجيل الخروج',
      geraet_defekt: 'عطل في الجهاز',
      falsches_objekt: 'موقع خاطئ (Objekt)',
      einwand_mitarbeiter: 'اعتراض الموظف',
      nachtrag_offline: 'إضافة لاحقة، سُجِّلت دون اتصال',
      sonstiges: 'سبب آخر',
    },
  },
  tr: {
    betreff: 'Kaydedilen çalışma saatiniz düzeltildi',
    betreffStorno: 'Kaydedilen çalışma saatiniz iptal edildi',
    einleitung: '{datum} tarihli kaydedilen çalışma saatiniz yönetim '
      + 'tarafından düzeltildi.',
    einleitungStorno: '{datum} tarihli kaydedilen çalışma saatiniz bir ters '
      + 'kayıtla iptal edildi (Storno — kayıt kalır ve geçersiz işaretlenir).',
    artZeile: 'Tür',
    grundZeile: 'Neden',
    begruendungZeile: 'Yönetimin gerekçesi',
    widerspruch: 'Bu doğru değilse itiraz edebilirsiniz. Kayıt „Saatlerim" '
      + 'altındadır; itiraz yolu oradadır.',
    art: {
      zeit_korrektur: 'Saat düzeltildi',
      pause_korrektur: 'Mola düzeltildi',
      zuordnung_korrektur: 'Atama düzeltildi',
      nacherfassung: 'Sonradan kaydedildi',
      storno: 'İptal edildi (Storno)',
    },
    grund: {
      vergessen_auszustempeln: 'Çıkış yapmayı unutma',
      geraet_defekt: 'Cihaz arızası',
      falsches_objekt: 'Yanlış Objekt (çalışma yeri)',
      einwand_mitarbeiter: 'Çalışanın itirazı',
      nachtrag_offline: 'Sonradan eklendi, çevrimdışı kaydedildi',
      sonstiges: 'Diğer',
    },
  },
};

/**
 * Setzt die Nachricht zusammen — Rahmen uebersetzt, Begruendung woertlich.
 *
 * Das Datum kommt FERTIG herein, als Zeichenkette. Es in dieser Funktion aus
 * einem `Date` zu bilden hiesse, die Zeitzone in JavaScript zu entscheiden;
 * `Europe/Berlin` gehoert nach Invariante 2 in die Datenbank
 * (`at time zone 'Europe/Berlin'`), und eine Schicht ueber Mitternacht macht
 * den Unterschied sichtbar.
 */
export function korrekturNachricht(
  sprache: PortalSprache,
  eingabe: {
    readonly art: KorrekturArtSchluessel;
    readonly grund: KorrekturGrundSchluessel;
    readonly begruendung: string;
    readonly datum: string;
  },
): { readonly betreff: string; readonly koerper: string } {
  const t = KORREKTUR_NACHRICHT[sprache];
  const storno = eingabe.art === 'storno';
  const einleitung = (storno ? t.einleitungStorno : t.einleitung)
    .replace('{datum}', eingabe.datum);

  return {
    betreff: storno ? t.betreffStorno : t.betreff,
    koerper: [
      einleitung,
      '',
      `${t.artZeile}: ${t.art[eingabe.art]}`,
      `${t.grundZeile}: ${t.grund[eingabe.grund]}`,
      '',
      `${t.begruendungZeile}:`,
      `„${eingabe.begruendung}"`,
      '',
      t.widerspruch,
    ].join('\n'),
  };
}
