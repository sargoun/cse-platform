/**
 * Das Wachbuch der eigenen Schicht (SEC-05, EMP-13, O-151, § 34a GewO).
 *
 * **Warum das hier steht und nicht in `security/wachbuch.ts`.** Der Dienst dort
 * liest das Buch der GESELLSCHAFT — mit `wachbuch.lesen`, dem Recht der
 * Leitung. Was die Wache auf ihrer Schicht sieht, ist etwas anderes: ihre
 * eigenen Seiten (immer) und die Uebergabe der vorigen Schicht an DIESEM
 * Objekt (nur im eingestellten Fenster, 0302). Beides beantwortet dieselbe
 * Abfrage — `leseBuch` —, und was sie zurueckgibt, entscheidet die RLS. Diese
 * Datei legt nur das Fenster daneben, damit die Seite den Unterschied zwischen
 * „nichts passiert" und „das Fenster ist zu" AUSSPRECHEN kann.
 *
 * **Eine leere Liste ist keine Auskunft.** Ohne die Einstellung
 * `wachbuch.uebergabe_fenster` ist das Fenster `interval '0'`, und dann steht
 * hier nur, was die Wache selbst geschrieben hat. Das als „keine Eintraege" zu
 * zeigen hiesse, eine offene Geschaeftsfrage (O-151) als Tatsache auszugeben.
 */
import type { LeseKontext } from '../../kontext/index.js';
import { leseBuch, type EintragZeile } from '../security/wachbuch.js';

/**
 * Ist das Uebergabefenster OFFEN?
 *
 * Drei Zustaende, und sie sind nicht zwei: `null` heisst „gar nicht
 * eingestellt", `00:00:00` heisst „eingestellt und aus" (der Seed-Vorgabewert
 * aus 0033), alles andere heisst offen. Die Seite zeigt fuer die ersten beiden
 * denselben Satz — trennen muss sie sie trotzdem, damit ein spaeterer Bericht
 * „nie eingerichtet" von „bewusst abgeschaltet" unterscheiden kann.
 *
 * Als eigene Funktion, weil das die einzige ENTSCHEIDUNG dieser Datei ist und
 * eine Entscheidung ohne Test eine Behauptung waere.
 */
export function istFensterOffen(wert: string | null): boolean {
  if (wert === null) return false;
  // `00:00:00`, `00:00:00.000` und `00:00` meinen dasselbe: kein Fenster.
  return !/^0+(:0+)*(\.0+)?$/u.test(wert.trim());
}

export interface Schichtbuch {
  /** Was diese Anmeldung an diesem Objekt sehen darf, neueste zuerst. */
  readonly eintraege: readonly EintragZeile[];
  /**
   * Das Uebergabefenster dieser Gesellschaft als Text (`12:00:00`) — oder
   * `null`, wenn es gar nicht eingestellt ist.
   *
   * `00:00:00` heisst „eingestellt, aber aus" und ist der Seed-Vorgabewert
   * (0033). Beides fuehrt zu derselben Anzeige; unterschieden wird es hier
   * trotzdem, damit ein spaeterer Bericht die zwei Faelle trennen kann.
   */
  readonly uebergabeFenster: string | null;
  /** Steht die Uebergabe offen? `false` heisst: nur eigene Seiten. */
  readonly uebergabeOffen: boolean;
}

/**
 * Das Buch dieses Objekts, so weit diese Anmeldung es sehen darf.
 *
 * Der Mandant wird MITGEGEBEN und nicht geraten: im Personen-Scope ist
 * `app.aktiver_mandant()` NULL (K-20), und eine Funktion, die das Fenster aus
 * der Sitzung liest, antwortete dort immer mit Null — genau der Fehler, den
 * 0302 repariert hat.
 */
export async function leseSchichtbuch(
  kontext: LeseKontext,
  bezug: { readonly objektId: string; readonly mandantId: string },
): Promise<Schichtbuch> {
  const eintraege = await leseBuch(kontext, { objektId: bezug.objektId, grenze: 50 });

  const [fenster] = await kontext.abfrage<{ wert: string | null; gesetzt: boolean }>(
    `select app.uebergabe_fenster($1::uuid)::text as wert,
            (app.einstellung($1::uuid, 'wachbuch.uebergabe_fenster') is not null) as gesetzt`,
    [bezug.mandantId],
  );

  const wert = fenster?.gesetzt === true ? fenster.wert : null;
  return { eintraege, uebergabeFenster: wert, uebergabeOffen: istFensterOffen(wert) };
}
