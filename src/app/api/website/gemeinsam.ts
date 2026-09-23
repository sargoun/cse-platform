import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { rechtepruefer } from '@/server/auth/zugang';
import { db } from '@/server/db/pool';
import { type SchreibKontext, withTenant } from '@/server/kontext/index';
import { RedaktionFehler } from '@/server/services/inhalt/redaktion';
import { liesRumpf as liesRumpfIntern, type Rumpf } from '../rumpf';

/**
 * Das Gerüst der schreibenden Website-Routen.
 *
 * **Warum es das jetzt gibt.** Die drei vorhandenen Routen
 * (`api/website/seite`, `…/galerie`, `…/referenzen`) tragen dasselbe Gerüst
 * je einmal ausgeschrieben — Ursprungsprüfung, Sitzung, genau ein aktiver
 * Mandant, `authorize`, Transaktion, Fehlerbild. Mit fünf weiteren wären es
 * acht Kopien, und die achte ist die, in der eines davon fehlt. Was sich
 * unterscheidet, ist die Handlung; die steht im Aufrufer.
 *
 * **`authorize` wirft, und der Wurf wird übersetzt.** Wer nur
 * `RedaktionFehler` fängt, beantwortet ein FEHLENDES RECHT mit **500** — und
 * 500 heisst „hier ist etwas", wo AUT-06 nichts sagen will. Genau dieser
 * Fehler steht heute in `api/website/referenzen`: ein `admin` sieht in der
 * Referenzliste den Veröffentlichen-Knopf (das Recht
 * `referenz.veroeffentlichen` hält nur `super_admin`), drückt ihn, und
 * `NichtGefundenFehler` fliegt durch den `catch` hindurch. Die Übersetzung
 * steht in `server/auth/antwort.ts`, damit sie nicht in jeder Route neu und
 * irgendwann anders geschrieben wird.
 *
 * **Ein Formular bekommt seine Seite zurück, kein JSON.** `RedaktionFehler`
 * kommt als `?fehler=<grund>` auf der Seite an, die den POST geschickt hat;
 * dort steht der Satz, den ein Mensch lesen soll (dieselbe Form wie
 * `api/social/gemeinsam.ts`, D-585). `internesZiel` lässt nur einen Pfad
 * DIESER Anwendung durch (D-562) — `zurueck` kommt aus dem Rumpf, also vom
 * Aufrufer.
 */

export { UUID, liesRumpf, type Rumpf } from '../rumpf';

/**
 * Eine Handlung, die NICHT auf ihre Seite zurückführt, sondern weiter — auf
 * das Blatt dessen, was sie eben angelegt hat (V-154).
 *
 * Nach „Neue Referenz" ist der nächste Schritt immer derselbe: die
 * Kundenfreigabe eintragen, und die steht auf dem Blatt der neuen Zeile. Ein
 * Rücksprung auf das leere Anlegeformular liesse den Menschen raten, ob etwas
 * entstanden ist — und beim zweiten Klick entstünde es zweimal.
 *
 * Das Ziel läuft wie `zurueck` durch `internesZiel` (D-560).
 */
export interface WebsiteWeiter {
  readonly weiter: string;
}

export interface WebsiteLauf {
  /** Der Rechteschlüssel — oder die Regel, die ihn aus dem Rumpf ableitet. */
  readonly recht: string | ((rumpf: Rumpf) => string);
  /**
   * Die Handlung. Was sie zurückgibt, wird an `zurueck` angehängt — als
   * Abfrageteil, etwa `gespeichert=1` oder `neu=<id>`. `null` heisst: nur
   * zurück. `{ weiter }` heisst: auf eine ANDERE Seite dieser Anwendung.
   */
  readonly handle: (
    kontext: SchreibKontext, rumpf: Rumpf,
  ) => Promise<string | null | WebsiteWeiter>;
}

/** Wohin es geht, wenn `zurueck` nicht in diese Anwendung zeigt (D-560). */
const HEIMWEG = '/portal';

function mitAbfrage(zurueck: string, teil: string): string {
  return `${zurueck}${zurueck.includes('?') ? '&' : '?'}${teil}`;
}

export async function fuehreWebsiteAus(
  anfrage: NextRequest, lauf: WebsiteLauf,
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const rumpf = await liesRumpfIntern(anfrage).catch(() => null);
  if (rumpf === null) {
    return NextResponse.json({ fehler: 'unlesbarer_rumpf' }, { status: 400 });
  }
  const recht = typeof lauf.recht === 'string' ? lauf.recht : lauf.recht(rumpf);
  const zurueck = rumpf.felder['zurueck'] ?? '';

  try {
    const ergebnis = await (db().begin(
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        await authorize(sitzung, { recht, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        return lauf.handle(kontext, rumpf);
      }))) as string | null | WebsiteWeiter;

    if (rumpf.json) return NextResponse.json({ ergebnis }, { status: 200 });
    const ziel = ergebnis !== null && typeof ergebnis === 'object'
      ? ergebnis.weiter
      : ergebnis === null || zurueck === ''
        ? zurueck : mitAbfrage(zurueck, ergebnis);
    return NextResponse.redirect(internesZiel(ziel, HEIMWEG, anfrage), 303);
  } catch (fehler: unknown) {
    if (fehler instanceof RedaktionFehler) {
      if (!rumpf.json && zurueck !== '') {
        return NextResponse.redirect(
          internesZiel(
            mitAbfrage(zurueck, `fehler=${encodeURIComponent(fehler.grund)}`),
            HEIMWEG, anfrage),
          303);
      }
      /*
       * Ohne Rückweg bleibt es beim JSON: ein Aufrufer ohne `zurueck` hat
       * keine Seite, auf die man ihn schicken könnte. `nicht_gefunden` ist
       * 404, alles andere 400 — ein Konflikt im Zustand ist keine kaputte
       * Anfrage, aber auch kein Serverfehler.
       */
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.grund === 'nicht_gefunden' ? 404 : 400 });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}

/** Leere Felder werden `null` und nicht `''` — ein leeres `<h2>` ist eine Lücke. */
export function leerZuNull(wert: string | undefined): string | null {
  const t = (wert ?? '').trim();
  return t === '' ? null : t;
}

/** Eine ganze Zahl aus dem Formular — `null`, wo nichts stand. */
export function zahlOderNull(wert: string | undefined): number | null {
  const t = (wert ?? '').trim();
  if (t === '') return null;
  const n = Number.parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}
