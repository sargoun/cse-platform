import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, erwarteterUrsprung, internesZiel } from '@/server/auth/ursprung';
import { rechtepruefer } from '@/server/auth/zugang';
import { db } from '@/server/db/pool';
import { type SchreibKontext, withTenant } from '@/server/kontext/index';
import { maskeMitEingaben } from '@/lib/formular/maske';
import { liesRumpf, type Rumpf } from './rumpf';

/**
 * Das Geruest eines ZUSTANDSUEBERGANGS — Preisfreigabe, Versand, Annahme,
 * Abschluss, Kundenfreigabe, Katalogpflege, Raumpflege.
 *
 * **Warum ein Geruest und keine sieben Kopien.** `api/social/gemeinsam.ts`
 * hat dieselbe Begruendung und dieselbe Form; nur war es auf `SocialFehler`
 * festgelegt. Die sieben Routen dieser Runde werfen sieben verschiedene
 * Dienstfehler (`AngebotFehler`, `KatalogFehler`, `AbschlussFehler`,
 * `KundenfreigabeFehler`, `DokumentfreigabeFehler`, `RaumFehler`,
 * `NummernkreisFehler`) — allen gemeinsam ist ein `grund`. Das Geruest nimmt
 * deshalb eine Abbildung `grundVon` statt einer Klasse: was sie als
 * Zeichenkette zurueckgibt, wird zu 409 (oder 404/403), alles andere bleibt
 * ein Wurf und damit ein roter Lauf.
 *
 * **Die drei Dinge, die hier nicht vergessen werden koennen:**
 *
 *  1. `istGleicherUrsprung` — ein Uebergang, den eine fremde Seite ausloest,
 *     ist keiner, den jemand entschieden hat.
 *  2. `authorize` IN der gebundenen Transaktion: `app.hat_recht` liest die
 *     Sitzungsbindung, und ausserhalb antwortet es `false` auf alles. Eine
 *     Pruefung, die immer dasselbe sagt, ist keine.
 *  3. `autorisierungsAntwort` — sonst wird ein FEHLENDES RECHT eine 500, und
 *     500 heisst „hier ist etwas", wo AUT-06 nichts sagen will.
 *
 * Und `POST`, nie `GET`: jeder dieser Uebergaenge laesst etwas hinaus, friert
 * etwas ein oder gibt etwas frei (Invariante 7). Eine Adresse, die das per
 * GET tut, wird von jedem Vorschau-Abruf ausgeloest.
 */

export { liesRumpf, UUID, type Rumpf } from './rumpf';

/** `/portal` ist der Wegweiser (D-560) und kein Ziel, das jemand vorgeben kann. */
const HEIMWEG = '/portal';

export interface Uebergang<T> {
  /** Der Rechteschluessel, oder die Regel, die ihn aus dem Rumpf ableitet. */
  readonly recht: string | ((rumpf: Rumpf) => string);
  readonly handle: (kontext: SchreibKontext, rumpf: Rumpf) => Promise<T>;
  /** Wohin ein Formular danach zeigt. `slug` ist der Bereich aus der SITZUNG. */
  readonly ziel: (slug: string, ergebnis: T) => string;
  /**
   * Der `grund` eines Dienstfehlers — oder `null`, wenn dieser Fehler nicht
   * hierher gehoert und weitergeworfen werden soll.
   */
  readonly grundVon: (fehler: unknown) => string | null;
  /**
   * Die Formularfelder, die bei einer Abweisung mit auf die Maske reisen
   * (V-240, `maskeMitEingaben`, D-599). Ohne Angabe reist nur der Grund —
   * wie bisher. Nur Stammdaten eines Vorgangs, nie etwas Geheimes.
   */
  readonly maskeFelder?: readonly string[];
}

export async function fuehreUebergangAus<T>(
  anfrage: NextRequest, uebergang: Uebergang<T>,
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  /**
   * GENAU EIN aktiver Mandant (Invariante 10). Die Gruppenansicht fuehrt
   * keinen, und ohne ihn gibt es keinen Schreibweg — nicht „einen, der
   * fehlschlaegt", sondern keinen.
   */
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const rumpf = await liesRumpf(anfrage).catch(() => null);
  if (rumpf === null) {
    return NextResponse.json({ fehler: 'unlesbarer_rumpf' }, { status: 400 });
  }
  const recht = typeof uebergang.recht === 'string'
    ? uebergang.recht : uebergang.recht(rumpf);

  try {
    const { ergebnis, slug } = await (db().begin(
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        await authorize(sitzung, { recht, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        /**
         * Der Slug kommt aus der SITZUNG, nie aus `?mandant=` (Invariante 3).
         * Die Adresszeile darf das Ziel benennen, nie den Mandanten.
         */
        const [m] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        const e = await uebergang.handle(kontext, rumpf);
        return { ergebnis: e, slug: m?.slug ?? '' };
      }))) as { ergebnis: T; slug: string };

    if (rumpf.json) return NextResponse.json({ ergebnis }, { status: 200 });
    return NextResponse.redirect(
      new URL(uebergang.ziel(slug, ergebnis), erwarteterUrsprung(anfrage)), 303);
  } catch (fehler: unknown) {
    const grund = uebergang.grundVon(fehler);
    if (grund !== null) {
      const meldung = fehler instanceof Error ? fehler.message : String(fehler);
      /**
       * Ein FORMULAR bekommt seine Seite zurueck, kein JSON.
       *
       * Sonst landet ein Mensch, der „Preis freigeben" gedrueckt hat, auf
       * einer weissen Seite mit `{"fehler":"kalkulation_offen"}` — der Satz,
       * den er lesen soll, als Datenfeld, ohne Formular und ohne Rueckweg.
       * `internesZiel` laesst nur einen Pfad DIESER Anwendung durch (D-562);
       * ein fremdes Ziel im versteckten Feld waere eine offene Umleitung.
       */
      const zurueck = rumpf.felder['zurueck'];
      if (!rumpf.json && zurueck !== undefined && zurueck !== '') {
        /*
         * V-240: nennt der Uebergang Maskenfelder, reisen deren Eingaben mit —
         * eine abgewiesene Pflege zeigt dann, was getippt wurde, nicht wieder
         * den alten Stand aus der Datenbank.
         */
        if (uebergang.maskeFelder !== undefined) {
          const werte = Object.fromEntries(
            uebergang.maskeFelder.map((name) => [name, rumpf.felder[name]]));
          return NextResponse.redirect(
            internesZiel(maskeMitEingaben(zurueck, grund, werte), HEIMWEG, anfrage), 303);
        }
        const trenner = zurueck.includes('?') ? '&' : '?';
        return NextResponse.redirect(
          internesZiel(
            `${zurueck}${trenner}fehler=${encodeURIComponent(grund)}`, HEIMWEG, anfrage),
          303);
      }
      /**
       * `kein_recht` ist 403 und nicht 409 (D-585): keine Zustandskollision,
       * sondern eine fehlende Erlaubnis. Ein 409 hiesse „gleich noch einmal
       * versuchen", und das waere jedes Mal falsch.
       */
      const status = grund === 'nicht_gefunden' ? 404
        : grund === 'kein_recht' ? 403 : 409;
      return NextResponse.json({ fehler: grund, meldung }, { status });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}

/**
 * Der `grund` eines Fehlers, wenn er zu einer dieser Klassen gehoert.
 *
 * Als Helfer, weil jede der sieben Routen denselben Satz schreibt — und weil
 * ein `instanceof`-Vergleich gegen die falsche Klasse still `null` ergibt und
 * damit aus einem Zustandskonflikt eine 500 macht.
 */
export function grundAus(
  fehler: unknown, ...klassen: readonly (abstract new (...a: never[]) => Error)[]
): string | null {
  for (const klasse of klassen) {
    if (fehler instanceof klasse) {
      const grund = (fehler as Error & { grund?: unknown }).grund;
      return typeof grund === 'string' ? grund : 'unbekannt';
    }
  }
  return null;
}
