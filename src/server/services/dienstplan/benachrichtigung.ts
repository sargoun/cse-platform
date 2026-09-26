import 'server-only';
import { sicherRegistriert, type ArtDefinition, type BenachrichtigungsKontext }
  from '../../benachrichtigung/registry.js';
import { setze, texteFuer, type PlanTexte } from '../../../lib/i18n/benachrichtigung.js';

/**
 * Die Meldung, die NOT-01 unter „schedule change" fuehrt (TIM-01, NOT-01,
 * NOT-03).
 *
 * **Sie hat gefehlt, und zwar genau diese eine.** Zwei `dienstplan.*`-Arten
 * waren registriert — `dienstplan.schicht_ohne_zeiteintrag` und
 * `dienstplan.morgen_unbesetzt`, beide aus dem Nachtwaechter
 * (`services/waechter/benachrichtigung.ts`) —, und das Modul `dienstplan`
 * steht in `MODUL_TITEL`. Es fehlte also kein Modulaufbau, sondern die Art
 * fuer die Bekanntgabe selbst: `dienstplan.veroeffentlichen` kam im Baum nur
 * im Rechtekatalog, im Routenregister und als Kommentar vor.
 *
 * **Ziel ist der eigene Plan, nicht der Verwaltungsvorgang.** Die Person
 * bekommt einen Verweis auf `/portal/mein/schichten` — ihre Schichten, in
 * ihrer Sprache, ueber alle Gesellschaften hinweg (EMP-14). Der
 * Veroeffentlichungsvorgang mit seinen Zahlen ueber die ganze Kolonne gehoert
 * der Planung; er waere fuer die Empfaengerin ein Ziel, das sie nicht oeffnen
 * darf, und NOT-03 nennt genau das den Fehler.
 *
 * **Kein Mandanten-Slug im Ziel.** `/portal/mein/…` ist Personen-Scope und
 * traegt kein `[mandant]`-Segment — ein Ziel aus dem Slug waere hier die
 * falsche Adresse, und `slugTor()` antwortete darauf mit 404 (Befund PR 12).
 *
 * **Nicht sammelbar.** Ein Dienstplan, den man am Einsatztag in einer
 * Tageszusammenfassung liest, ist einer, den man zu spaet liest.
 *
 * **Zusammengesetzter Schluessel** — ein Literal der Form `<modul>.<etwas>`
 * läse der Rechtekatalog-Scanner sonst als Rechteschluessel (K-19, D-493).
 */

const DIENSTPLAN = 'dienstplan';

export const ART_PLAN_VEROEFFENTLICHT = `${DIENSTPLAN}.plan_veroeffentlicht`;

/** Das eine Ziel — Personen-Scope, ohne Bereichssegment. */
export const ZIEL_MEINE_SCHICHTEN = '/portal/mein/schichten';

/**
 * **Der Plan steht in der Sprache der Empfaengerin** (V-102, O-889, SPEC §10).
 *
 * Diese Meldung geht an einen ARBEITER: sie sagt ihm, wann er zu arbeiten hat.
 * `/portal/mein/schichten` steht in vier Sprachen — die Meldung, die dorthin
 * fuehrt, stand nur auf Deutsch da. `person.sprache` kommt vom Erzeuger
 * herein (`veroeffentlichung.ts`); fehlt sie, gilt Deutsch.
 *
 * Der NAME der Gesellschaft bleibt, wie er ist: „REALTIME Service GmbH" ist
 * eine Firmierung im Handelsregister und keine Beschriftung.
 */
/**
 * Der Zeitraum als Text — aus ZWEI Tagen, nicht aus einer fertigen Zeile.
 *
 * `zeitraumText()` fügt sie mit dem deutschen Wort „bis" zusammen; in einem
 * arabischen Satz stand das mitten drin. Die beiden Tage kommen deshalb
 * einzeln herein und werden je Sprache gefügt. `zeitraum` bleibt als Rückfall
 * stehen: die Vorschau auf der Einstellungsseite ruft mit leeren Daten, und
 * eine ältere Meldung im Posteingang ist ohnehin längst geschrieben.
 */
function zeitraumAus(t: PlanTexte, k: BenachrichtigungsKontext): string {
  const von = String(k.daten['von'] ?? '');
  const bis = String(k.daten['bis'] ?? '');
  if (von === '' || bis === '') return String(k.daten['zeitraum'] ?? '');
  return von === bis ? von : setze(t.zeitraum, { von, bis });
}

function planVeroeffentlicht(): ArtDefinition {
  return ({
    schluessel: ART_PLAN_VEROEFFENTLICHT,
    titel: (k) => {
      const t = texteFuer(k.sprache).plan;
      return setze(t.titel, { zeitraum: zeitraumAus(t, k) });
    },
    text: (k) => {
      const t = texteFuer(k.sprache).plan;
      const schichten = Number(k.daten['schichten'] ?? 0);
      const gesellschaft = k.daten['gesellschaft'];
      /*
       * Die Zahl der Schichten in DREI Formen (siehe `PlanTexte`). Die
       * fruehere Fassung kannte zwei — Ein- und Mehrzahl — und schrieb bei
       * null „0 Schichten eingeteilt"; die Empfaengerliste enthaelt zwar nur
       * Menschen mit mindestens einer Schicht, aber ein Text, der bei null
       * Unsinn ergibt, ist einer, der auf die naechste Aufrufstelle wartet.
       */
      const zahl = schichten === 0 ? t.keine
        : schichten === 1 ? t.eine
          : setze(t.mehrere, { schichten });
      return setze(t.text, {
        zeitraum: zeitraumAus(t, k),
        gesellschaft: typeof gesellschaft === 'string' && gesellschaft !== ''
          ? setze(t.gesellschaft, { name: gesellschaft })
          : '',
      }) + zahl + t.zeitzone;
    },
    ziel: () => ZIEL_MEINE_SCHICHTEN,
    kanaeleVorgabe: ['app'],
    sammelbar: false,
  });
}

/**
 * Idempotent (D-493): der Bootstrap laeuft im Test mehrfach, und
 * `sicherRegistriert` prueft je Schluessel — nicht ueber einen
 * Stellvertreter.
 */
export function registriereDienstplanArten(): readonly ArtDefinition[] {
  return sicherRegistriert([planVeroeffentlicht()]);
}
