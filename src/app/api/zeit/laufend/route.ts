import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { grundAufsFormular } from '../../formular-antwort';
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
 *
 * **Eine Abweisung geht als GRUND zurück aufs Brett** (V-275, D-773, D-769):
 * `?fehler=<grund>`, nie der Satz des Dienstes und nie die Kennung des
 * Eintrags; `/zeiten/live` schlägt ihn in `LAUFEND_FEHLER_TEXTE` nach. Ein
 * Aufruf ohne `zurueck` ist kein Formular, sondern ein Programm und bekommt
 * `{ fehler, meldung }` mit Status (D-599).
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const zurueck = String(daten.get('zurueck') ?? '/portal');
  /* Das Feld, wie das Formular es schickt — fehlt es, fragt ein Programm (D-599). */
  const zurueckFeld = daten.get('zurueck');
  const formularZurueck = typeof zurueckFeld === 'string' && zurueckFeld !== ''
    ? zurueckFeld : undefined;
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
    /*
     * **Die Anmeldung zuerst** (D-766, D-769 Nr. 7): ein fehlendes Recht ist
     * die byte-gleiche 404 — von aussen wie eine fehlende Zeile (AUT-06) —,
     * ohne zweiten Faktor geht es auf den Faktor-Schritt. Keines davon wird
     * je ein Rückweg aufs Formular.
     */
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    if (fehler instanceof LaufenderEintragFehler
      || fehler instanceof LaufenderEintragNichtGefunden) {
      return grundAufsFormular(anfrage, {
        json: false, zurueck: formularZurueck, grund: fehler.grund,
      }) ?? NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message }, { status: fehler.status });
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(zurueck, '/portal', anfrage), 303);
}
