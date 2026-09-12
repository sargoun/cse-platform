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

/**
 * `POST /api/konflikt` — einen Planungskonflikt quittieren (TIM-05).
 *
 * **Quittieren heisst nicht wegräumen.** Der Konflikt bleibt stehen und
 * bekommt Zeitpunkt, Urheber und **Begruendung**; genau das ist die Spur,
 * die im Streit zaehlt: jemand hat die Warnung gesehen und trotzdem geplant,
 * und hier steht, warum.
 *
 * **Eine blockierende Sperre laesst sich nicht quittieren.** § 34a GewO und
 * SEC-04 kennen keinen Uebergehen-Knopf: ein Wachmann ohne gueltigen
 * Nachweis darf nicht eingeteilt werden, auch nicht mit Begruendung. Der
 * Auslöser in der Datenbank weist das ab; dieser Weg prueft es zusaetzlich,
 * damit die Oberflaeche nicht erst durch einen Datenbankfehler erfaehrt, was
 * sie haette wissen koennen.
 *
 * **Ohne Begruendung passiert nichts.** Eine leere Quittung ist keine
 * Entscheidung, sondern ein Klick.
 */
export const dynamic = 'force-dynamic';

const MINDESTLAENGE = 10;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const id = daten.get('konflikt');
  const begruendung = daten.get('begruendung');
  if (typeof id !== 'string' || id === '') {
    return NextResponse.json({ fehler: 'kein_konflikt' }, { status: 400 });
  }
  if (typeof begruendung !== 'string' || begruendung.trim().length < MINDESTLAENGE) {
    return NextResponse.json(
      { fehler: 'begruendung_zu_kurz', mindestens: MINDESTLAENGE }, { status: 400 },
    );
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /**
         * `dienstplan.konflikt_quittieren`, nicht `dienstplan.schreiben`.
         *
         * Wer quittiert, aendert den Plan nicht — er uebernimmt die
         * Verantwortung dafuer, ihn so zu lassen. Zwei Entscheidungen, zwei
         * Rechte; wer die eine darf, darf darum nicht die andere.
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
          { recht: 'dienstplan.konflikt_quittieren', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const [k] = await kontext.abfrage<{ blockiert: boolean; status: string }>(
          `select blockiert, status::text as status from planungs_konflikt where id = $1`, [id]);
        // AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten.
        if (k === undefined) throw new KonfliktFehler('nicht_gefunden', 404);
        if (k.blockiert) throw new KonfliktFehler('blockierend_nicht_quittierbar', 409);
        if (k.status !== 'offen') throw new KonfliktFehler('nicht_offen', 409);

        await kontext.schreibe(
          `update planungs_konflikt
              set status = 'quittiert',
                  quittiert_am = now(),
                  quittiert_von = app.aktueller_benutzer(),
                  quittierung_begruendung = $2
            where id = $1`,
          [id, begruendung.trim()],
        );
      }));
  } catch (fehler) {
    if (fehler instanceof KonfliktFehler) {
      return NextResponse.json({ fehler: fehler.schluessel }, { status: fehler.status });
    }
    // AUT-06: fehlendes Recht sieht von aussen aus wie eine fehlende Zeile.
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

  const ziel = internesZiel(
    daten.get('zurueck') as string | null,
    `/portal/${String(daten.get('mandant') ?? '')}/dienstplan/konflikte`,
    anfrage,
  );
  return NextResponse.redirect(ziel, 303);
}

class KonfliktFehler extends Error {
  constructor(readonly schluessel: string, readonly status: number) {
    super(schluessel);
    this.name = 'KonfliktFehler';
  }
}
