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
import { bestaetigeLvPosition } from '@/server/services/bau/lv';

/**
 * `POST /api/bau/lv-positionen/[id]/bestaetigung` — eine maschinell gelesene
 * LV-Position bestätigen (APR-03, K-10, BAU-01).
 *
 * **Warum dieser Endpunkt der Engpass einer ganzen Abrechnung ist.** Der
 * Auslöser `bau.pruefe_lv_geprueft()` (0072) weist jede Aufmasszeile ab, die
 * auf eine unbestätigte, maschinell gelesene Position bucht — ein Preis, den
 * ein Modell aus einem PDF gelesen hat, darf keine abrechenbare Menge tragen,
 * bevor ein benannter Mensch ihn bestätigt hat. Ohne diesen Endpunkt gäbe es
 * das Hindernis `lv_ungeprueft` in `pruefeVorlage` und keinen Weg, es zu
 * beheben: das Aufmass liesse sich nie gegenzeichnen, und niemand könnte
 * sagen, warum.
 *
 * **`bau.schreiben` und nicht `bau.preis_lesen`.** Bestätigen ist eine
 * Aussage über die Richtigkeit der Position, kein Blick auf den Preis. Und
 * nicht `bau.aufmass_erfassen`: die Kraft auf der Baustelle bestätigt keine
 * Vertragsposition — das ist die Bauleitung.
 *
 * Der Dienst setzt `geprueft_am` auf die SERVERZEIT und `geprueft_von` auf den
 * angemeldeten Benutzer (Invariante 5); eine zweite Bestätigung wird
 * abgewiesen, weil die erste die ist, die zählt.
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

  let ergebnis: { readonly id: string; readonly oz: string } | null;
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
          { recht: 'bau.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return bestaetigeLvPosition(kontext, id);
      }))) as { readonly id: string; readonly oz: string } | null;
  } catch (fehler: unknown) {
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

  if (ergebnis === null) {
    /**
     * Drei Fälle, eine Antwort: die Position gehört nicht zu dieser
     * Gesellschaft, sie wurde nicht maschinell gelesen (dann ist nichts zu
     * bestätigen), oder sie ist längst bestätigt. Sie zu unterscheiden
     * verriete, welche Positionen es gibt (AUT-06) — und für den Menschen
     * davor ist die Antwort in allen drei Fällen dieselbe: hier ist nichts zu
     * tun.
     */
    return NextResponse.json(
      {
        fehler: 'nicht_zu_bestaetigen',
        meldung: 'Diese Position ist nicht (mehr) zu bestätigen.',
      },
      { status: 409 },
    );
  }

  const mandant = feld('mandant');
  if (mandant !== '') {
    return NextResponse.redirect(internesZiel(
      feld('zurueck') === '' ? null : feld('zurueck'),
      `/portal/${mandant}/bau/projekte`,
      anfrage,
    ), 303);
  }
  return NextResponse.json({ id: ergebnis.id, oz: ergebnis.oz });
}
