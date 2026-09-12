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
import {
  EinwandBereitsEntschiedenFehler, EinwandNichtGefundenFehler, entscheideEinwand,
  type EntscheidungEingabe,
} from '@/server/services/zeit/einwand';

/**
 * `POST /api/zeit/einwand/entscheidung` — die Planung entscheidet (EMP-07).
 *
 * `zeit.einwand_entscheiden` und **nicht** `zeit.schreiben`: wer Zeiten
 * erfasst, befindet damit nicht ueber die Meldung eines Kollegen. Zwei
 * Entscheidungen, zwei Rechte — dieselbe Trennung, die
 * `dienstplan.konflikt_quittieren` von `dienstplan.schreiben` trennt.
 *
 * **Anerkennen schreibt hier keine Korrektur.** Die Entscheidung sagt, DASS
 * die Meldung zutrifft; die neue Fassung des Zeiteintrags praegt
 * `korrigiereZeiteintrag` mit ihrer eigenen Spur und ihrem eigenen Recht
 * (`zeit.korrigieren`, TIM-11). Beides in einem Aufruf zu verschmelzen
 * versteckte den Fall, den man sehen will: eine anerkannte Meldung, zu der
 * nie eine Korrektur kam.
 *
 * **Ohne Begruendung passiert nichts** — ausser beim Uebergang „in Pruefung",
 * der noch keine Entscheidung ist. Eine leere Ablehnung ist kein Vorgang,
 * sondern ein Klick, und im Streit steht dann da, dass jemand etwas
 * weggeklickt hat.
 */
export const dynamic = 'force-dynamic';

const MIT_BEGRUENDUNG = new Set(['anerkannt', 'teilweise_anerkannt', 'abgelehnt']);
const ZULAESSIG = new Set([
  'in_pruefung', 'anerkannt', 'teilweise_anerkannt', 'abgelehnt', 'zurueckgezogen',
]);
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
  const id = daten.get('einwand');
  const status = daten.get('status');
  const begruendung = daten.get('begruendung');

  if (typeof id !== 'string' || id === '') {
    return NextResponse.json({ fehler: 'kein_einwand' }, { status: 400 });
  }
  if (typeof status !== 'string' || !ZULAESSIG.has(status)) {
    return NextResponse.json({ fehler: 'unbekannter_status' }, { status: 400 });
  }
  const text = typeof begruendung === 'string' ? begruendung.trim() : '';
  if (MIT_BEGRUENDUNG.has(status) && text.length < MINDESTLAENGE) {
    return NextResponse.json(
      { fehler: 'begruendung_zu_kurz', mindestens: MINDESTLAENGE }, { status: 400 },
    );
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
          { recht: 'zeit.einwand_entscheiden', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await entscheideEinwand(kontext, {
          einwandId: id,
          status: status as EntscheidungEingabe['status'],
          // `exactOptionalPropertyTypes`: ein fehlendes Feld und ein Feld mit
          // `undefined` sind zwei verschiedene Dinge. „In Pruefung" traegt
          // keine Begruendung — also fehlt sie, statt leer dazustehen.
          ...(text === '' ? {} : { begruendung: text }),
          entschiedenVon: sitzung.benutzerId,
        });
      }));
  } catch (fehler) {
    if (fehler instanceof EinwandNichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof EinwandBereitsEntschiedenFehler) {
      return NextResponse.json({ fehler: 'bereits_entschieden' }, { status: 409 });
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
    `/portal/${String(daten.get('mandant') ?? '')}/zeiten/einwaende`,
    anfrage,
  );
  return NextResponse.redirect(ziel, 303);
}
