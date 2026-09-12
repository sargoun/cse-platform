import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { versucheRechenansatz } from '@/server/services/bau/rechenansatz';

/**
 * `POST /api/bau/aufmasse/vorschau` — den Rechenansatz rechnen, ohne etwas zu
 * speichern (BAU-02, API-KARTE §C.15).
 *
 * Das ist das lebende Feld im Formular: der Polier tippt
 * `3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)` und sieht daneben `30,87 m²`.
 *
 * **Gerechnet wird auf dem SERVER, auch hier.** Die naheliegende Fassung — im
 * Browser rechnen, weil es schneller aussieht — haette zwei Parser, und der
 * zweite waere der, den niemand prueft. Dann zeigt das Formular eine Zahl und
 * die Datenbank speichert eine andere, und beide sehen richtig aus.
 *
 * **Sie schreibt nichts.** Kein Blatt, keine Zeile, kein Protokolleintrag —
 * die Vorschau ist eine Rechnung, kein Vorgang.
 */
export const dynamic = 'force-dynamic';

interface VorschauEingabe {
  readonly rechenansatz?: unknown;
  readonly einheit?: unknown;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  let eingabe: VorschauEingabe;
  try {
    eingabe = (await anfrage.json()) as VorschauEingabe;
  } catch {
    return NextResponse.json({ fehler: 'ungueltige_eingabe' }, { status: 422 });
  }
  const rechenansatz = typeof eingabe.rechenansatz === 'string' ? eingabe.rechenansatz : '';
  const einheit = typeof eingabe.einheit === 'string' ? eingabe.einheit : '';

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /**
         * `bau.aufmass_erfassen` und nicht `bau.lesen`: die Vorschau gehoert
         * zum Erfassungsbildschirm (Seitenkarte §5.9, `…/aufmass/neu`), und
         * genau dieses Recht haelt auch die Kraft vor Ort.
         */
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
          { recht: 'bau.aufmass_erfassen', schreibend: false },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
      }));
  } catch (fehler: unknown) {
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

  const ergebnis = versucheRechenansatz(rechenansatz);
  if (!ergebnis.ok) {
    /**
     * 200 mit `gueltig: false`, nicht 422: waehrend jemand tippt, ist eine
     * halbe Formel der Normalfall und kein Fehler der Anfrage. Der OFFSET
     * geht mit, damit das Feld die Stelle markieren kann.
     */
    return NextResponse.json({
      gueltig: false,
      grund: ergebnis.grund,
      offset: ergebnis.offset,
      meldung: ergebnis.meldung,
    });
  }

  return NextResponse.json({
    gueltig: true,
    // Die Formel woertlich zurueck — sie wird angezeigt, nicht ersetzt.
    formel: ergebnis.ergebnis.formel,
    // Ganze Zahl in fester Skala, als TEXT: ein `number` verloere ab 2^53 die
    // Genauigkeit, um die es hier geht (R-12/R-15).
    ergebnis_skaliert: ergebnis.ergebnis.skaliert.toString(),
    menge: ergebnis.ergebnis.mengePostgres,
    formatiert: `${ergebnis.ergebnis.anzeige}${einheit === '' ? '' : ` ${einheit}`}`,
    parser_version: ergebnis.ergebnis.parserVersion,
  });
}
