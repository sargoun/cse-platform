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
import { berlinFormularZeitpunkt } from '@/lib/datum/formularzeit';
import {
  LaufenderEintragFehler, LaufenderEintragNichtGefunden,
  schliesseLaufendenEintrag, storniereLaufendenEintrag,
} from '@/server/services/zeit/laufender-eintrag';

/**
 * `POST /api/zeit/laufend` — einen laufenden Zeiteintrag schliessen oder
 * stornieren (V-064, TIM-11, Invariante 5).
 *
 * **Warum diese Route fehlte und was daran teuer war.**
 * `korrigiereZeiteintrag` weist einen laufenden Eintrag ab („wird bearbeitet,
 * nicht korrigiert") — und den Weg, auf den der Satz verweist, gab es nicht.
 * Wer am Freitagabend das Ausstempeln vergisst, erzeugte damit einen Eintrag,
 * der über das Wochenende weiterläuft: keine Dauer, kein Stundenkonto, kein
 * Monatsnachweis — und `z_offen_uk` lässt je Person genau EINEN offenen
 * Eintrag zu, also konnte die Person am Montag nicht einmal wieder
 * einstempeln.
 *
 * **`zeit.korrigieren` und nicht `zeit.schreiben`.** Wer Zeiten ERFASST,
 * setzt damit noch keine fremde Arbeitszeit fest. Dasselbe Recht, das die
 * Korrektur eines abgeschlossenen Eintrags verlangt (TIM-11) — und dieselbe
 * Begründungspflicht.
 *
 * **Die Uhrzeit kommt als BERLINER Wanduhrzeit.** `datetime-local` schickt
 * sie ohne Zone; `new Date(...)` läse sie als Ortszeit des Prozesses, auf
 * Vercel also UTC — aus „17:00" würde 19:00 Berliner Zeit. Aufgelöst wird sie
 * über dieselbe getestete Funktion wie beim Einwand (§7.2).
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const zurueck = String(daten.get('zurueck') ?? '/portal');
  const id = String(daten.get('eintrag') ?? '');
  const aktion = String(daten.get('aktion') ?? '');
  const begruendung = String(daten.get('begruendung') ?? '');

  if (id === '') return NextResponse.json({ fehler: 'kein_eintrag' }, { status: 400 });
  if (aktion !== 'schliessen' && aktion !== 'stornieren') {
    return NextResponse.json({ fehler: 'unbekannter_vorgang' }, { status: 400 });
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
          { recht: 'zeit.korrigieren', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'stornieren') {
          await storniereLaufendenEintrag(kontext, {
            zeiteintragId: id, grund: begruendung, benutzerId: sitzung.benutzerId,
          });
          return;
        }

        const roh = String(daten.get('ende') ?? '');
        const ende = berlinFormularZeitpunkt(roh);
        if (ende === null) {
          throw new LaufenderEintragFehler(
            'Ohne Feierabendzeit lässt sich der Eintrag nicht schliessen.',
            'ende_fehlt');
        }
        const pauseRoh = String(daten.get('pause') ?? '').trim();
        const pause = pauseRoh === '' ? undefined : Number(pauseRoh);
        if (pause !== undefined && !Number.isInteger(pause)) {
          throw new LaufenderEintragFehler(
            'Die Pause ist eine ganze Zahl von Minuten.', 'pause_ungueltig');
        }
        await schliesseLaufendenEintrag(kontext, {
          zeiteintragId: id,
          endeZeitpunkt: ende,
          ...(pause === undefined ? {} : { pauseMinuten: pause }),
          begruendung,
          benutzerId: sitzung.benutzerId,
        });
      }));
  } catch (fehler) {
    if (fehler instanceof LaufenderEintragFehler
      || fehler instanceof LaufenderEintragNichtGefunden) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}meldung=${encodeURIComponent(fehler.message)}`,
        '/portal', anfrage), 303);
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

  return NextResponse.redirect(internesZiel(zurueck, '/portal', anfrage), 303);
}
