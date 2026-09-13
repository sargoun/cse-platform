import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { AbschlagFehler, schreibeVerrechnung }
  from '@/server/services/finanz/abschlag/index';

/**
 * `POST /api/rechnungen/abschlaege` — die Abschläge eines Auftrags in einer
 * Schlussrechnung abziehen (FIN-08).
 *
 * **`finanzen.schreiben`, nicht `finanzen.festschreiben`.** Der Abzug ändert
 * einen ENTWURF; er vergibt keine Nummer und macht nichts unveränderlich. Ihn
 * an das Festschreibungsrecht zu binden hiesse, dass eine Buchhaltungskraft
 * die Rechnung nicht vorbereiten kann, die eine andere dann festschreibt.
 *
 * **POST und kein GET.** Ein Abzug, den ein weitergeleiteter Link auslösen
 * kann, ist keiner, den jemand entschieden hat.
 */
export const dynamic = 'force-dynamic';

/**
 * Die Abweisungen der DATENBANK, die ein Mensch lesen soll. Dieselbe Liste
 * wie bei der Festschreibung — und aus demselben Grund eine Liste und kein
 * `catch(alles)`: ein echter Programmfehler soll laut bleiben.
 */
const ABWEISUNGEN = new Set([
  'P0001', // raise_exception — der Trigger `fin.abschlag_pruefen`
  '23514', // check_violation
  '23505', // unique_violation — der Abschlag hängt schon an einer anderen
  '42501', // insufficient_privilege
]);

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const rechnungId = daten.get('rechnungId');
  if (typeof rechnungId !== 'string' || rechnungId === '') {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'finanzen.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return schreibeVerrechnung(kontext, rechnungId);
      })));

    const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
    return NextResponse.redirect(
      new URL(`/portal/${slug}/finanzen/rechnungen/${rechnungId}`, anfrage.nextUrl.origin), 303);
  } catch (fehler) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    /**
     * Ein stornierter Abschlag ist keine Panne, sondern eine Frage an die
     * Buchhaltung — 409 mit den NUMMERN, damit die Oberfläche sie benennen
     * kann, statt „abgewiesen" anzuzeigen.
     */
    if (fehler instanceof AbschlagFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, text: fehler.message, nummern: fehler.nummern },
        { status: 409 });
    }
    const pg = fehler as { code?: unknown; message?: unknown; hint?: unknown };
    if (typeof pg.code === 'string' && ABWEISUNGEN.has(pg.code)) {
      return NextResponse.json(
        { fehler: 'abgewiesen', text: String(pg.message ?? ''), hinweis: String(pg.hint ?? '') },
        { status: 409 });
    }
    throw fehler;
  }
}
