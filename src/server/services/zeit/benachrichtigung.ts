import 'server-only';
import { sicherRegistriert, type ArtDefinition } from '../../benachrichtigung/registry.js';

/**
 * Die Meldung, mit der eine Entscheidung über einen Zeit-Einwand bei der
 * meldenden Person ankommt (V-051, EMP-07, TIM-11, NOT-01, NOT-03).
 *
 * **Warum ausgerechnet diese Meldung.** `entscheideEinwand` setzte Zustand,
 * Zeitpunkt und Begründung — und danach passierte nichts. Die betroffene
 * Person erfuhr es nur, wenn sie von sich aus dieselbe Seite noch einmal
 * öffnete. Bei einer Meldung über falsch erfasste ARBEITSZEIT ist das die
 * eine Stelle, an der Schweigen teuer ist: wer nicht weiss, dass abgelehnt
 * wurde, widerspricht nicht.
 *
 * **Der Text nennt den Zustand und die Begründung, nicht nur „entschieden".**
 * Eine Meldung, die sagt, es gebe etwas zu lesen, ist eine halbe Meldung: sie
 * verlangt einen zweiten Weg für die Auskunft, die in sie hineingepasst
 * hätte. Die Begründung steht in der Sprache, in der die Planung sie
 * geschrieben hat, und wird NICHT übersetzt — sie ist die Aussage eines
 * Menschen über einen Einzelfall, keine Beschriftung.
 *
 * **Ziel ist der eigene Vorgang, nicht der Verwaltungsposteingang.** NOT-03
 * verlangt ein Ziel, das die Empfängerin öffnen darf; `/portal/mein/zeiten/…`
 * ist Personen-Scope und trägt deshalb kein `[mandant]`-Segment (Befund PR
 * 12). Migration 0377 liest das gegen: ein Ziel ausserhalb `/portal/mein/`
 * wird abgewiesen.
 *
 * **Nicht sammelbar.** Eine Entscheidung über den eigenen Lohn gehört nicht
 * in eine Tageszusammenfassung.
 *
 * **Zusammengesetzter Schlüssel** — ein Literal der Form `<modul>.<etwas>`
 * läse der Rechtekatalog-Scanner sonst als Rechteschlüssel (K-19, D-493).
 */

const ZEIT = 'zeit';

export const ART_EINWAND_ENTSCHIEDEN = `${ZEIT}.einwand_entschieden`;

/**
 * Die Zustandswörter DER MELDUNG — deutsch, weil eine Benachrichtigung heute
 * in einer Sprache entsteht.
 *
 * // TODO(client, O-889): Soll eine Benachrichtigung in der Sprache der Empfängerin entstehen (person.sprache) oder in der Sprache der Gesellschaft, die sie versendet?
 *
 * Die Oberfläche des Arbeiterportals steht in vier Sprachen
 * (`EINWAND_STATUS_TEXTE`); der Posteingang trägt dagegen GESPEICHERTEN Text,
 * und der ist in dem Moment festgelegt, in dem er entsteht. Beides an dieser
 * Stelle zusammenzuführen hiesse, die Sprache der Empfängerin in einen Dienst
 * zu reichen, der sie sonst nicht kennt — und eine Meldung, deren Sprache
 * sich später ändert, gibt es nicht: was zugestellt ist, ist zugestellt.
 * Solange die Frage offen ist, steht hier Deutsch, und die Seite daneben
 * übersetzt.
 */
const ZUSTAND_WORT: Readonly<Record<string, string>> = {
  anerkannt: 'anerkannt',
  teilweise_anerkannt: 'teilweise anerkannt',
  abgelehnt: 'abgelehnt',
};

function einwandEntschieden(): ArtDefinition {
  return ({
    schluessel: ART_EINWAND_ENTSCHIEDEN,
    titel: (k) => {
      const zustand = String(k.daten['status'] ?? '');
      return `Ihre Zeitmeldung wurde ${ZUSTAND_WORT[zustand] ?? 'entschieden'}`;
    },
    text: (k) => {
      const zustand = String(k.daten['status'] ?? '');
      const datum = k.daten['betrifftDatum'];
      const grund = k.daten['begruendung'];
      return 'Ihre Meldung'
        + (typeof datum === 'string' && datum !== '' ? ` zum ${datum}` : '')
        + ` wurde ${ZUSTAND_WORT[zustand] ?? 'entschieden'}.`
        + (typeof grund === 'string' && grund.trim() !== ''
          ? ` Begründung: ${grund.trim()}`
          : ' Eine Begründung wurde nicht eingetragen.')
        + ' Ändert sich dadurch Ihre erfasste Zeit, steht die neue Fassung in'
        + ' „Meine Zeiten"; die alte bleibt daneben stehen.';
    },
    /*
     * Der eigene Vorgang, wenn es einen Zeiteintrag gibt — sonst die Liste.
     * Ein Einwand der Art `eintrag_fehlt` hat keinen (§6.27), und ein Ziel
     * `/portal/mein/zeiten/null/einwand` waere ein Verweis ins Leere.
     */
    ziel: (k) => {
      const eintrag = k.daten['zeiteintragId'];
      return typeof eintrag === 'string' && eintrag !== ''
        ? `/portal/mein/zeiten/${eintrag}/einwand`
        : '/portal/mein/zeiten';
    },
    kanaeleVorgabe: ['app'],
    sammelbar: false,
  });
}

/** Idempotent (D-493) — der Bootstrap läuft im Test mehrfach. */
export function registriereZeitArten(): readonly ArtDefinition[] {
  return sicherRegistriert([einwandEntschieden()]);
}
