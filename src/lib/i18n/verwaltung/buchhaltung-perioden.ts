/**
 * Das Periodenschloss meldet zurück — Erfolg und Abweisung als SATZ,
 * nachgeschlagen nach einem SCHLÜSSEL (D-769, D-774, D-728).
 *
 * **Der Befund.** `POST /api/buchhaltung/perioden` schickte einen fertigen
 * Satz als `?meldung=`: den Erfolg („Monat 03/2026 vorläufig geschlossen."),
 * den Satz von `PeriodenschlussFehler` und die Meldung der Datenbank
 * (`restrict_violation` aus `fin.periode_schliessen_pruefen`, samt Monat und
 * Anzahl). Die Seite zeigte ihn roh, im Erfolgs- wie im Warnkasten — also auch
 * jeden Text eines präparierten Links.
 *
 * **Deutsch, in der Form der zweisprachigen Tabellen.** Die Seite steht auf
 * der Ausnahmeliste der Übersetzungswache
 * (`scripts/guards/uebersetzung-ausnahmen.ts`); kommt sie herunter, ergänzt
 * die Umstellung hier nur `en`.
 *
 * **Der Monat steht nicht in den Sätzen.** Die Route schickt ihn als
 * geprüften Wert (`?monat=JJJJ-MM`), und die Seite nennt ihn nur, wenn er
 * einer IHRER Monate ist — mit dessen eigenem Namen („März 2026").
 */

/** Der Zustand, in dem der Monat nach einer gelungenen Handlung steht (`?erfolg=`). */
export const PERIODE_ERFOLGE = ['vorlaeufig_geschlossen', 'geschlossen', 'geoeffnet'] as const;
export type PeriodeErfolg = (typeof PERIODE_ERFOLGE)[number];

/**
 * Jeder Grund, den die Route zurückschickt: die von `PeriodenschlussFehler`
 * und `datenbank` für die Abweisung der Datenbank (23001).
 */
export const PERIODE_FEHLER_GRUENDE = [
  'laufend', 'endgueltig', 'zustand', 'recht', 'unklar', 'monat', 'datenbank',
] as const;
export type PeriodeFehlerGrund = (typeof PERIODE_FEHLER_GRUENDE)[number];

export interface PeriodenRueckwegTexte {
  /** Die fett gesetzten ersten Worte des Erfolgskastens (DESIGN §5 „Notices"). */
  readonly vermerkt: string;
  /** Statt des Monatsnamens, wenn der Monat nicht zu den Monaten der Seite gehört. */
  readonly monat: string;
  /** Was mit dem Monat geschehen ist — hinter seinem Namen. */
  readonly erfolg: Readonly<Record<PeriodeErfolg, string>>;
  /** Die fett gesetzten ersten Worte des Warnkastens. */
  readonly nichtGeaendert: string;
  readonly fehler: Readonly<Record<PeriodeFehlerGrund, string>>;
  /** Für einen Grund, den die Tabelle nicht kennt. */
  readonly sonst: string;
}

export const PERIODEN_RUECKWEG_TEXTE: Readonly<Record<'de', PeriodenRueckwegTexte>> = {
  de: {
    vermerkt: 'Vermerkt:',
    monat: 'Monat',
    erfolg: {
      vorlaeufig_geschlossen: 'vorläufig geschlossen.',
      geschlossen: 'geschlossen — endgültig; die Monatszahlen sind eingefroren.',
      geoeffnet: 'wieder geöffnet.',
    },
    nichtGeaendert: 'Nicht geändert.',
    fehler: {
      laufend:
        'Der Monat läuft noch — endgültig geschlossen wird ein Monat erst, wenn er vorbei ist. '
        + 'Vorläufig schließen geht jederzeit.',
      endgueltig:
        'Der Monat ist geschlossen und öffnet nicht wieder — korrigiert wird im offenen Monat '
        + 'durch Gegenbuchung (GoBD).',
      zustand:
        'Das geht in diesem Stand nicht: vorläufig schließen lässt sich nur ein offener Monat, '
        + 'wieder öffnen nur ein vorläufig geschlossener. Die Liste zeigt den aktuellen Stand.',
      recht:
        'Einen Monat schließt oder öffnet, wer Buchungen festschreiben darf — dieses Konto darf '
        + 'es in dieser Gesellschaft nicht.',
      unklar:
        'Das Wirtschaftsjahr beginnt nicht am Ersten eines Monats. Wie die Buchungsperioden '
        + 'dann zu schneiden und zu benennen sind, steht in der DATEV-Einrichtung des '
        + 'Steuerberaters (O-05) — die Plattform rät das nicht.',
      monat: 'Das ist kein Buchungsmonat.',
      datenbank:
        'Die Datenbank hat das Schließen abgewiesen: im Monat stehen noch Buchungszeilen ohne '
        + 'Konto oder Buchungen, die nicht aufgehen. Erst kontieren und ausgleichen, dann '
        + 'schließen — die Arbeitsliste steht unter Finanzen › Buchungen.',
    },
    sonst: 'Die Handlung wurde abgewiesen.',
  },
};
