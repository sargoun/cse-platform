import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { BehinderungFehler, zeigeWegfallAn } from '@/server/services/bau/behinderung';

/**
 * `POST /api/bau/behinderungen/[id]/wegfall` — der Wegfall nach § 6 Abs. 3
 * VOB/B (BAU-06).
 *
 * **Der Wegfall ist ebenfalls anzuzeigen**, und er aendert die Anzeige NICHT:
 * die ist seit dem Versand eingefroren (`kern.behinderung_einfrieren`). Was
 * hier entsteht, sind `ende_am`, `wegfall_angezeigt_am` und der Zustand.
 *
 * Ohne diesen Weg bliebe jede Behinderung fuer immer laufend, und
 * `behinderung_laufend_idx` waere eine Liste, die nur waechst — die
 * Bauzeitverlaengerung stuende dann auf einer Behinderung, die seit Monaten
 * vorbei ist.
 *
 * Dasselbe Recht wie das Erstellen: wer die Anzeige verantwortet, verantwortet
 * auch ihren Wegfall. Eine Freigabe braucht er nicht — der Wegfall geht nicht
 * hinaus, er wird festgehalten; das Schreiben an den Auftraggeber ist der
 * VERSAND, und der hat sein eigenes Tor.
 *
 * `POST` statt `PATCH`: der Aufrufer ist ein HTML-Formular.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest,
  kontextParams: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const { id } = await kontextParams.params;
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const endeAm = feld('ende_am');
  const angezeigtAm = feld('wegfall_angezeigt_am');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(endeAm) || !/^\d{4}-\d{2}-\d{2}$/u.test(angezeigtAm)) {
    return NextResponse.json({
      fehler: 'ungueltige_eingabe',
      meldung: 'Ende der Behinderung und Tag der Wegfallanzeige sind Kalendertage (JJJJ-MM-TT).',
    }, { status: 422 });
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'bau.behinderung_erstellen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await zeigeWegfallAn(kontext, { id, endeAm, angezeigtAm });
      }));
  } catch (fehler: unknown) {
    if (fehler instanceof BehinderungFehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.grund === 'nicht_gefunden' ? 404 : fehler.status });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    throw fehler;
  }

  const mandant = feld('mandant');
  const projekt = feld('projekt');
  if (mandant !== '' && projekt !== '') {
    return NextResponse.redirect(internesZiel(
      feld('zurueck') === '' ? null : feld('zurueck'),
      `/portal/${mandant}/bau/projekte/${projekt}/behinderungen/${id}`,
      anfrage,
    ), 303);
  }
  return NextResponse.json({ ende_am: endeAm, wegfall_angezeigt_am: angezeigtAm });
}
