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
import { NachtragFehler, reicheEin } from '@/server/services/bau/nachtrag';

/**
 * `POST /api/bau/nachtraege/[id]/einreichen` — die Einreichung beim
 * Auftraggeber (BAU-04, Invariante 7).
 *
 * **Das ist der Uebergang, an dem etwas das Haus verlaesst.** Er verlangt
 * deshalb die Kennung einer genehmigten `freigabe` mit benanntem Menschen;
 * ohne sie ist der Zustand `eingereicht` nicht einmal in der Datenbank
 * darstellbar (`nachtrag_eingereicht_freigegeben`, 0080). Der Dienst prueft
 * es lesbar, die Tabelle noch einmal hart — die Oberflaeche ist die erste
 * Linie, nie die einzige.
 *
 * **Ohne Anmeldung keine Einreichung.** § 2 Abs. 6 Nr. 1 VOB/B knuepft den
 * Anspruch an die Ankuendigung vor Ausfuehrungsbeginn; ein eingereichter
 * Nachtrag ohne Anmeldedatum sagt dem Auftraggeber, es habe keine gegeben.
 *
 * Eigenes Recht `bau.nachtrag_einreichen`: wer ankuendigen darf, hat damit
 * noch nichts an den Auftraggeber geschickt. Die Freigabe wird hier GEPRUEFT
 * und nicht erteilt (D-250).
 *
 * // TODO(client, O-260): Wer gibt die Einreichung eines Nachtrags nach § 2
 * VOB/B frei — die Bauleitung selbst oder ein Zweiter? `versand.freigeben` ist
 * heute an `super_admin`/`admin` gebunden und fuer `leitung` nur bindbar.
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
  const eingereichtAm = feld('eingereicht_am');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(eingereichtAm)) {
    return NextResponse.json({
      fehler: 'ungueltige_eingabe',
      meldung: 'Das Einreichungsdatum ist kein Kalendertag (JJJJ-MM-TT).',
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
          { recht: 'bau.nachtrag_einreichen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await reicheEin(kontext, {
          id, eingereichtAm, freigabeId: feld('freigabe'),
        });
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
  return NextResponse.json({ eingereicht_am: eingereichtAm });
}
