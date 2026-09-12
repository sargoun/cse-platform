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
import { AufmassFehler, gegenzeichne } from '@/server/services/bau/aufmass';

/**
 * `POST /api/bau/aufmasse/[id]/gegenzeichnung` — die Gegenzeichnung (BAU-03).
 *
 * **Der Uebergang, an dem beide Tore fallen.** Ohne Messfoto und ohne
 * bestaetigte LV-Positionen kommt das Blatt nicht aus dem Entwurf; ohne
 * Unterschrift des AUFTRAGGEBERS wird es nicht `gegengezeichnet`. Beides
 * prueft der Dienst lesbar und die Datenbank noch einmal hart — die
 * Oberflaeche ist die erste Linie, nie die einzige.
 *
 * **Was unterschrieben wird, entsteht auf dem Server.** Der Schnappschuss wird
 * aus den gespeicherten Zeilen gebaut, nicht aus etwas, das der Browser
 * mitschickt: ein Digest ueber eine vom Client gelieferte Fassung
 * beglaubigte genau die manipulierte (Review B25, K-12).
 *
 * Eigenes Recht: `bau.aufmass_freigeben`. Wer ein Blatt aufnimmt, stellt damit
 * noch nicht fest, dass der Auftraggeber es anerkannt hat.
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
  const name = feld('unterzeichner_name');
  if (name === '') {
    return NextResponse.json(
      { fehler: 'ungueltige_eingabe', meldung: 'Der Name des Unterzeichners fehlt.' },
      { status: 422 },
    );
  }

  let ergebnis: { readonly status: string; readonly hash: string };
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'bau.aufmass_freigeben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        return gegenzeichne(kontext, {
          aufmassId: id,
          unterzeichnerName: name,
          unterzeichnerFunktion: feld('unterzeichner_funktion') === ''
            ? null : feld('unterzeichner_funktion'),
          vorbehalt: feld('vorbehalt') === '' ? null : feld('vorbehalt'),
          signaturMedienId: feld('unterschrift_medien_id') === ''
            ? null : feld('unterschrift_medien_id'),
        });
      }))) as { readonly status: string; readonly hash: string };
  } catch (fehler: unknown) {
    if (fehler instanceof AufmassFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.grund === 'nicht_gefunden' ? 404 : fehler.status },
      );
    }
    // AUT-06: ein fehlendes Recht sieht von aussen aus wie eine fehlende Zeile.
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
      `/portal/${mandant}/bau/projekte/${projekt}/aufmass/${id}`,
      anfrage,
    ), 303);
  }
  return NextResponse.json({ status: ergebnis.status, hash: ergebnis.hash });
}
