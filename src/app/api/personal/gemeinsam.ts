import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { internesZiel, istGleicherUrsprung } from '@/server/auth/ursprung';
import { rechtepruefer } from '@/server/auth/zugang';
import { db } from '@/server/db/pool';
import { type SchreibKontext, withTenant } from '@/server/kontext/index';
import { grundAufsFormular } from '../formular-antwort';
import { liesRumpf, type Rumpf } from '../rumpf';

/**
 * Das Geruest der schreibenden Personalrouten — dieselbe Form wie bei
 * Recruiting (`api/recruiting/gemeinsam.ts`) und Social, aus demselben Grund:
 * Ursprungspruefung, Sitzung, genau ein aktiver Mandant, `authorize`,
 * Transaktion und Fehlerbild sind bei allen fuenf dasselbe, und fuenf Kopien
 * sind fuenf Stellen, an denen eines davon beim naechsten Umbau fehlt.
 *
 * **Ein Formular darf nicht auf einer weissen Seite mit JSON enden.** Die
 * Portalformulare haben kein JavaScript; ein `{"fehler":"…"}` nach dem
 * Absenden hat den Menschen verloren — sein Entwurf ist weg, der Rueckweg ist
 * der Zurueck-Knopf. Ein Dienstfehler geht deshalb als `?fehler=<grund>` auf
 * die Seite zurueck, die ihn ausloeste, und die Seite schlaegt ihren Satz
 * nach (D-771; bis V-273 reiste der Satz des Dienstes als `?meldung=`). Ein
 * JSON-Aufrufer bekommt seinen Status.
 *
 * **Was `authorize` wirft, uebersetzt `server/auth/antwort.ts` — und zwar
 * zuerst.** Wer das nicht faengt, beantwortet ein FEHLENDES RECHT mit 500 —
 * und 500 sagt „hier ist etwas", wo AUT-06 nichts sagen will. Wer es nach der
 * allgemeinen Weiche faengt, schickt es als Abweisung aufs Formular.
 */

/** Der Wegweiser, wenn `zurueck` nicht in diese Anwendung zeigt (D-560). */
const HEIMWEG = '/portal';

export interface PersonalLauf {
  /** Das Recht, das dieser Schreibvorgang verlangt. */
  readonly recht: string;
  /**
   * Weitere Rechte derselben Handlung.
   *
   * **Ein Tor am Bildschirm ist kein Tor.** Wer gleichen Ursprungs POSTet,
   * geht nie durch `mandantTor` — was die Seite nur versteckt, muss die Route
   * verweigern.
   */
  readonly weitereRechte?: readonly string[];
  readonly handle: (kontext: SchreibKontext, rumpf: Rumpf) => Promise<void>;
  /** Wohin es nach dem Erfolg geht — `slug` ist der Bereich aus der SITZUNG. */
  readonly ziel: (slug: string) => string;
}

export async function fuehrePersonalAus(
  anfrage: NextRequest, lauf: PersonalLauf,
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }
  const rumpf = await liesRumpf(anfrage).catch(() => null);
  if (rumpf === null) {
    return NextResponse.json({ fehler: 'unlesbarer_rumpf' }, { status: 400 });
  }

  let slug = '';
  try {
    slug = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const pruefer = rechtepruefer(kontext.abfrage.bind(kontext));
        await authorize(sitzung, { recht: lauf.recht, schreibend: true }, pruefer);
        for (const weiteres of lauf.weitereRechte ?? []) {
          await authorize(sitzung, { recht: weiteres, schreibend: true }, pruefer);
        }
        /*
         * Der Bereich kommt aus der SITZUNG und nicht aus dem Formular
         * (Invariante 3). Ein `mandant`-Feld im Rumpf waere ein Mandant, den
         * der Absender bestimmt — und das Ziel der Umleitung entschiede
         * darueber, welche Gesellschaft der Mensch danach sieht.
         */
        const [m] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        await lauf.handle(kontext, rumpf);
        return m?.slug ?? '';
      }))) as string;
  } catch (fehler: unknown) {
    /*
     * **Die Anmeldung und das Recht ZUERST** (D-766, D-769 Nr. 7, D-771).
     * `NichtGefundenFehler` (ein fehlendes Recht, ein fremder Mandant),
     * `NichtAngemeldetFehler` und `ZweiterFaktorFehler` tragen `status` und
     * `code` wie ein Dienstfehler. Stand die allgemeine Weiche unten davor,
     * wurde ein fehlendes Recht `?meldung=Nicht gefunden` auf dem Formular
     * statt der byte-gleichen 404 aller Schreibwege (AUT-06, D-656 Nr. 2) —
     * eine Antwort, an der sich „gibt es nicht" von „darf nicht" unterschied.
     */
    const autorisierung = autorisierungsAntwort(fehler, anfrage, { felder: rumpf });
    if (autorisierung !== null) return autorisierung;
    const status = (fehler as { status?: unknown }).status;
    const code = (fehler as { code?: unknown }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      /*
       * **Zurück aufs Formular reist nur der GRUND** (D-769, D-771): nie der
       * Satz des Dienstes. Der ist deutsch, trägt eine Kennung
       * (`AnstellungNichtGefunden`, `PersonNichtGefunden`), die Eingabe
       * (`PersonalnummerVergeben`) oder einen Namen aus der Datenbank
       * (`DubletteImHaus`) — und eine Seite, die `?meldung=` zeigte, zeigte
       * auch jeden Satz aus einem präparierten Link. Die Seite schlägt den
       * Grund in ihrer Tabelle nach; eine Schnittstelle bekommt `{ fehler,
       * meldung }` mit Status wie bisher (D-599).
       */
      const meldung = (fehler as { message?: unknown }).message;
      const aufsFormular = grundAufsFormular(anfrage, {
        json: rumpf.json, zurueck: rumpf.felder['zurueck'], grund: grundDes(fehler, code),
      });
      if (aufsFormular !== null) return aufsFormular;
      return NextResponse.json(
        { fehler: code, meldung: typeof meldung === 'string' ? meldung : '' }, { status });
    }
    throw fehler;
  }

  if (rumpf.json) return NextResponse.json({ ergebnis: 'ok' }, { status: 200 });
  return NextResponse.redirect(
    internesZiel(lauf.ziel(slug), HEIMWEG, anfrage), 303);
}

/** Ein Schlüssel und nichts sonst — kein Leerzeichen, kein Satz, keine Kennung. */
const SCHLUESSEL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

/**
 * Der Grund, mit dem eine Abweisung aufs Formular zurückreist: der `grund`
 * der Fehlerklasse (jede Klasse der Personaldienste trägt einen, D-771),
 * sonst ihr `code` — wie in D-753.
 *
 * **Nur, was ein Schlüssel ist, reist.** Ein `grund`, der doch ein Satz ist
 * (so heissen Felder anderer Dienste, die den Text einer SQL-Funktion
 * weiterreichen), fällt auf den `code` zurück — nie in die Adresse. Und ist
 * auch der keiner, reist `abgewiesen`: die Seite kennt ihn nicht und sagt
 * ihren allgemeinen Satz.
 */
function grundDes(fehler: unknown, code: string): string {
  const eigener = (fehler as { grund?: unknown }).grund;
  if (typeof eigener === 'string' && SCHLUESSEL.test(eigener)) return eigener;
  return SCHLUESSEL.test(code) ? code : 'abgewiesen';
}
