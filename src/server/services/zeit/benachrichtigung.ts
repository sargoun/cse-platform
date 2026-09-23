import 'server-only';
import { sicherRegistriert, type ArtDefinition } from '../../benachrichtigung/registry.js';
import { setze, texteFuer, type EinwandTexte }
  from '../../../lib/i18n/benachrichtigung.js';

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
 * **Die Meldung steht in der Sprache der Empfängerin** (V-102, O-889).
 *
 * Die Frage war gestellt und offen: die Sprache der Empfängerin oder die der
 * Gesellschaft, die sendet? **Ausgeliefert ist die Sprache der Empfängerin.**
 * Das Arbeiterportal steht in vier Sprachen, weil die Menschen dort nicht alle
 * Deutsch lesen — und diese Meldung sagt jemandem, wie über seine ARBEITSZEIT
 * entschieden wurde. Wer sie nicht lesen kann, widerspricht nicht.
 *
 * `person.sprache` kommt vom Erzeuger herein (`einwand.ts`); fehlt sie, gilt
 * Deutsch. Was zugestellt ist, bleibt, wie es zugestellt wurde: ändert der
 * Mensch später seine Sprache, ändert sich die Meldung nicht.
 *
 * Das Zustandswort der MELDUNG ist nicht dasselbe wie das der Seite
 * (`EINWAND_STATUS_TEXTE`): dort steht eine Beschriftung, hier ein Satzteil.
 */
function zustandWort(t: EinwandTexte, status: string): string {
  if (status === 'anerkannt') return t.anerkannt;
  if (status === 'teilweise_anerkannt') return t.teilweise;
  if (status === 'abgelehnt') return t.abgelehnt;
  return t.entschieden;
}

function einwandEntschieden(): ArtDefinition {
  return ({
    schluessel: ART_EINWAND_ENTSCHIEDEN,
    titel: (k) => {
      const t = texteFuer(k.sprache).einwand;
      return setze(t.titel, {
        zustand: zustandWort(t, String(k.daten['status'] ?? '')),
      });
    },
    text: (k) => {
      const t = texteFuer(k.sprache).einwand;
      const datum = k.daten['betrifftDatum'];
      const grund = k.daten['begruendung'];
      return setze(t.text, {
        zum: typeof datum === 'string' && datum !== ''
          ? setze(t.zum, { datum }) : '',
        zustand: zustandWort(t, String(k.daten['status'] ?? '')),
      })
        /* Die Begründung eines Menschen über einen Einzelfall — nicht
           übersetzt, weil sie keine Beschriftung ist. */
        + (typeof grund === 'string' && grund.trim() !== ''
          ? setze(t.mitGrund, { grund: grund.trim() })
          : t.ohneGrund)
        + t.nachsatz;
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
