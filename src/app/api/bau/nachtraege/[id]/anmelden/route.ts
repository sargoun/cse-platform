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
import { NachtragFehler, traegeAnmeldungNach } from '@/server/services/bau/nachtrag';

/**
 * `POST /api/bau/nachtraege/[id]/anmelden` — die Ankuendigung nachtragen
 * (BAU-04, § 2 Abs. 6 Nr. 1 VOB/B).
 *
 * **Write-once, und das ist der ganze Zweck der eigenen Adresse.** Ueber den
 * Anspruch auf besondere Verguetung entscheidet, ob VOR Ausfuehrungsbeginn
 * angekuendigt wurde. Ein Datum, das sich verschieben laesst, beweist nichts;
 * `traegeAnmeldungNach` setzt es deshalb nur, solange keines steht, und die
 * Abweisung sagt das im Klartext.
 *
 * Getrennt von `…/einreichen`, weil es zwei Spalten, zwei Rechte und zwei
 * Vorgaenge sind — nicht zwei Zustaende eines Feldes.
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
  const angemeldetAm = feld('angemeldet_am');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(angemeldetAm)) {
    return NextResponse.json({
      fehler: 'ungueltige_eingabe',
      meldung: 'Das Anmeldedatum ist kein Kalendertag (JJJJ-MM-TT).',
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
          { recht: 'bau.nachtrag_anmelden', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await traegeAnmeldungNach(kontext, id, angemeldetAm);
      }));
  } catch (fehler: unknown) {
    if (fehler instanceof NachtragFehler) {
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
      `/portal/${mandant}/bau/projekte/${projekt}/nachtraege/${id}`,
      anfrage,
    ), 303);
  }
  return NextResponse.json({ angemeldet_am: angemeldetAm });
}
