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
import { gibCheckinAus, widerrufeCheckin } from '@/server/services/zeit/checkin';
import { MARKE_KEKS, markeKeksOptionen } from './keks';

/**
 * `POST /api/checkin-marken` — eine Marke ausgeben oder widerrufen
 * (TIM-07).
 *
 * **Die Hälfte, die fehlte.** Das Einlösen der Marke ist seit 0035 komplett
 * gebaut — Stempeluhr, Route, Offline-Warteschlange, Schichtfoto. Die Ausgabe
 * hatte genau einen Aufrufer: den Seed. In einer Auslieferung kam damit
 * niemand je an einen Check-in-Link, und TIM-07 ist der EINZIGE Weg, auf dem
 * eine Mitarbeiterin ihre Zeit selbst erfasst (EMP-07 verbietet ihr, den
 * Eintrag zu schreiben). Die Zeiterfassung war also nicht von der
 * Arbeiterseite verschlossen, sondern von der Planerseite.
 *
 * **Das Geheimnis geht NICHT durch die Adresszeile.** `app.checkin_ausgeben`
 * gibt die Marke genau einmal im Klartext zurück; danach existiert sie
 * nirgends mehr, auch nicht in der Datenbank. Sie in die Weiterleitung zu
 * hängen hiesse: im Verlauf, im `Referer` und im Zugriffsprotokoll jedes
 * Vermittlers dazwischen — bei einer Zugangsmarke schlimmer als bei der
 * Telefonnummer, für die derselbe Weg schon abgelehnt wurde
 * (`auth/mitarbeiter/anmeldung.ts`). Sie reist deshalb in einem kurzlebigen
 * `httpOnly`-Keks, den die Zielseite liest und sofort löscht.
 *
 * **Ein Recht für beides.** `zeit.checkin_verwalten` deckt Ausgeben und
 * Widerrufen: wer eine Marke ausstellen darf, darf sie auch zurücknehmen —
 * eine zweite Berechtigung dafür wäre eine, die niemand vergibt, und dann
 * stünde der Widerruf still. Die Datenbank prüft es ohnehin ein zweites Mal,
 * und zwar im Mandanten der MARKE (0164).
 *
 * **303 und kein JSON.** Die Formulare sind gewöhnliche `<form method="post">`,
 * damit die Seite ohne JavaScript funktioniert — dieselbe Bauart wie die
 * Einwandsentscheidung daneben.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ZWECKE = new Set(['checkin', 'checkout']);
/** Ein Widerruf ohne Grund ist keine Auskunft — dieselbe Schwelle wie 0164. */
const GRUND_MINDESTENS = 3;

function feld(daten: FormData, name: string): string {
  const wert = daten.get(name);
  return typeof wert === 'string' ? wert.trim() : '';
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const aktion = feld(daten, 'aktion');
  const mandant = feld(daten, 'mandant');

  let marke: string | null = null;
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
          { recht: 'zeit.checkin_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'ausgeben') {
          const zuordnung = feld(daten, 'zuordnung');
          const zweck = feld(daten, 'zweck');
          if (!UUID.test(zuordnung) || !ZWECKE.has(zweck)) {
            throw Object.assign(new Error('unbrauchbare Eingabe'), { code: 'eingabe' });
          }
          /*
           * `unverbunden` ist keine Platzhalterlüge, sondern der Zustand:
           * es ist kein Ausgabeadapter verbunden (O-93), die Marke wird also
           * von Hand weitergegeben. Die Spalte sagt das, statt einen Versand
           * zu behaupten, den es nicht gab.
           */
          marke = await gibCheckinAus(kontext, zuordnung, zweck as 'checkin' | 'checkout',
            'unverbunden');
          return;
        }
        if (aktion === 'widerrufen') {
          const token = feld(daten, 'marke');
          const grund = feld(daten, 'grund');
          if (!UUID.test(token) || grund.length < GRUND_MINDESTENS) {
            throw Object.assign(new Error('unbrauchbare Eingabe'), { code: 'eingabe' });
          }
          await widerrufeCheckin(kontext, token, grund);
          return;
        }
        throw Object.assign(new Error('unbekannte Aktion'), { code: 'eingabe' });
      }));
  } catch (fehler) {
    if ((fehler as { code?: string }).code === 'eingabe') {
      return NextResponse.json({ fehler: 'unbrauchbare_eingabe' }, { status: 400 });
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
    /*
     * Auch die Datenbank prüft `zeit.checkin_verwalten` — und zwar im
     * Mandanten der Marke. Wer daran scheitert, bekommt dieselbe Antwort wie
     * an der Wache davor, nicht eine, die den Unterschied verrät.
     */
    if ((fehler as { code?: string }).code === '42501') {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }

  const ziel = internesZiel(
    feld(daten, 'zurueck') || null,
    `/portal/${mandant}/zeiten/checkin-links`,
    anfrage,
  );
  const antwort = NextResponse.redirect(ziel, 303);
  if (marke !== null) {
    /*
     * Der Keks wird auf der ANTWORT gesetzt und nicht über `cookies()`: eine
     * Weiterleitung aus einer Route heraus trägt die Kekse des Speichers
     * nicht zuverlässig mit. Zehn Minuten, `httpOnly`, Pfad auf den
     * Portalbereich — er soll genau einen Bildschirm weit reichen.
     */
    antwort.cookies.set(MARKE_KEKS, marke, markeKeksOptionen());
  }
  return antwort;
}
