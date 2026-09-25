import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { RecruitingFehler } from '@/server/services/recruiting/dienst';
import {
  aendere, entwirf, legeVor, sende, type AntwortArt, ANTWORT_ARTEN,
} from '@/server/services/recruiting/antwort';
import { emailDienst } from '@/server/versand/email';

/**
 * `POST /api/recruiting/antwort` — entwerfen, ändern, vorlegen, senden (REC-03).
 *
 * **Vier Handlungen und zwei verschiedene Rechte.** Entwerfen und ändern darf,
 * wer bewertet; vorlegen und senden nur, wer entscheidet. Das ist keine
 * Feinheit: eine Absage IST die Entscheidung, aus Sicht der Empfängerin, und
 * wer sie hinausschickt, trifft sie — gleich, wer den Text geschrieben hat.
 *
 * **Der Postausgang wird HIER gewählt und nicht im Dienst.** `emailDienst()`
 * liest `CSE_DEV_FLAECHEN`, und das ist eine Frage der Umgebung, nicht der
 * Fachlichkeit. Der Dienst bekommt ihn als Parameter — damit der Test einen
 * verbundenen und einen nicht verbundenen fahren kann, ohne eine
 * Umgebungsvariable zu setzen.
 */
export const dynamic = 'force-dynamic';

const ENTWURFS_HANDLUNGEN = new Set(['entwerfen', 'aendern']);

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const handlung = String(daten.get('handlung') ?? '');
  const bewerbungId = String(daten.get('bewerbung') ?? '');
  const antwortId = String(daten.get('antwort') ?? '');
  const art = String(daten.get('art') ?? '') as AntwortArt;
  const zurueck = daten.get('zurueck') as string | null;

  if (!['entwerfen', 'aendern', 'vorlegen', 'senden'].includes(handlung)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }
  if (handlung === 'entwerfen' && !ANTWORT_ARTEN.includes(art)) {
    return NextResponse.json({ fehler: 'unbekannte_art' }, { status: 400 });
  }

  /*
   * Entwerfen und ändern: `bewerbung_bewerten`. Vorlegen und senden:
   * `entscheiden`. Das Recht wird VOR der Handlung geprüft und nicht in ihr —
   * ein Dienst, der selbst autorisiert, autorisiert irgendwann einmal nicht.
   */
  const recht = ENTWURFS_HANDLUNGEN.has(handlung)
    ? 'recruiting.bewerbung_bewerten'
    : 'recruiting.entscheiden';

  let meldung: string | null = null;
  try {
    meldung = await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (handlung === 'entwerfen') {
          await entwirf(kontext, {
            bewerbungId, art,
            offen: String(daten.get('offen') ?? '') || undefined,
          });
          return null;
        }
        if (handlung === 'aendern') {
          await aendere(kontext, antwortId,
                        String(daten.get('betreff') ?? ''), String(daten.get('text') ?? ''));
          return null;
        }
        if (handlung === 'vorlegen') {
          await legeVor(kontext, antwortId);
          return null;
        }
        const ergebnis = await sende(
          kontext, antwortId, emailDienst(process.env['CSE_DEV_FLAECHEN'] === '1'));
        /*
         * Ein gescheiterter Versand ist KEIN Fehler dieser Route — er ist ein
         * Ergebnis, und es steht in `versand_fehler`. Ein 500 hier liesse die
         * Transaktion zurückrollen und damit genau die Zeile verschwinden, die
         * dem Personalbereich sagt, warum nichts hinausging.
         */
        return ergebnis.gesendet ? null : 'versand';
      }));
  } catch (fehler) {
    if (fehler instanceof RecruitingFehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
                               { status: fehler.status });
    }
    /*
     * Der AGG-Riegel aus 0174 wirft eine `check_violation` mit einem Satz für
     * einen Menschen. Ein 500 wäre hier die falsche Antwort: die Eingabe ist
     * nicht kaputt, sie ist rechtlich heikel — und genau das soll dastehen.
     */
    const code = (fehler as { code?: string }).code;
    if (code === '23514') {
      return NextResponse.json(
        { fehler: 'agg', meldung: (fehler as Error).message }, { status: 400 });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  const ziel = meldung === null
    ? zurueck
    : `${zurueck ?? '/portal'}${(zurueck ?? '').includes('?') ? '&' : '?'}hinweis=${meldung}`;
  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
