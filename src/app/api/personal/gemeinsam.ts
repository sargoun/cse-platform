import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { internesZiel, istGleicherUrsprung } from '@/server/auth/ursprung';
import { rechtepruefer } from '@/server/auth/zugang';
import { db } from '@/server/db/pool';
import { type SchreibKontext, withTenant } from '@/server/kontext/index';
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
 * der Zurueck-Knopf. Ein Dienstfehler geht deshalb als `?meldung=` auf die
 * Seite zurueck, die ihn ausloeste, und die Seite sagt den Satz. Ein
 * JSON-Aufrufer bekommt seinen Status.
 *
 * **Was `authorize` wirft, uebersetzt `server/auth/antwort.ts`.** Wer das
 * nicht faengt, beantwortet ein FEHLENDES RECHT mit 500 — und 500 sagt „hier
 * ist etwas", wo AUT-06 nichts sagen will.
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
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
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
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    const meldung = (fehler as { message?: string }).message ?? '';
    if (typeof status === 'number' && typeof code === 'string') {
      if (rumpf.json) {
        return NextResponse.json({ fehler: code, meldung }, { status });
      }
      const zurueck = rumpf.felder['zurueck'];
      if (zurueck !== undefined && zurueck !== '') {
        const trenner = zurueck.includes('?') ? '&' : '?';
        return NextResponse.redirect(
          internesZiel(
            `${zurueck}${trenner}meldung=${encodeURIComponent(meldung)}`,
            HEIMWEG, anfrage),
          303);
      }
      return NextResponse.json({ fehler: code, meldung }, { status });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  if (rumpf.json) return NextResponse.json({ ergebnis: 'ok' }, { status: 200 });
  return NextResponse.redirect(
    internesZiel(lauf.ziel(slug), HEIMWEG, anfrage), 303);
}
