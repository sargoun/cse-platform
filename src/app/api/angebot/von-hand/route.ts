import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  HandAngebotFehler, legeAngebotVonHandAn, type HandPosition,
} from '@/server/services/angebot/von-hand';

/**
 * `POST /api/angebot/von-hand` — ein Angebot ohne Raumbuch (V-005, SEC-01,
 * BAU-01).
 *
 * **Eine eigene Adresse und nicht ein viertes `aktion=` auf `api/angebot`.**
 * Das Manifest führt EIN Recht je Pfad; `api/angebot` trägt
 * `angebot.versenden`, weil dort der Übergang liegt, der etwas aus dem Haus
 * lässt (Invariante 7). Dieser Weg lässt nichts aus dem Haus — er schreibt
 * einen Entwurf — und trägt deshalb `angebot.schreiben`. Stünde er unter
 * derselben Adresse, sähe die Aufzählungsprobe von aussen nur noch ein Recht
 * für zwei verschieden schwere Handlungen; dieselbe Begründung steht schon
 * über `api/angebot/freigabe`.
 *
 * Der Handler bleibt dünn: prüfen, den Dienst rufen, antworten. Gerechnet
 * wird in `services/angebot/von-hand.ts`, geprüft in der Datenbank.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'angebot.schreiben';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Wie viele Zeilen das Formular geschickt hat.
 *
 * Die Obergrenze steht hier und nicht nur in der Seite: ein Formular ist
 * das, was ankommt, nicht das, was ausgeliefert wurde. Ohne Schranke wäre
 * `zeilen=100000` eine Schleife, die niemand bestellt hat.
 */
const MAX_ZEILEN = 60;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const mandant = feld('mandant').replace(/[^a-z0-9-]/gu, '');
  const zurueckWeg = feld('zurueck');

  const anzahlRoh = Number(feld('zeilen'));
  const anzahl = Number.isInteger(anzahlRoh) && anzahlRoh > 0
    ? Math.min(anzahlRoh, MAX_ZEILEN) : 0;

  /*
   * Der Steuersatz der Kopfzeile gilt für jede Position, die keinen eigenen
   * trägt. Das ist eine Bequemlichkeit der Oberfläche und KEINE Regel: der
   * Satz kommt in beiden Fällen aus `steuersatz_gruppe`, und welcher für
   * welche Leistung gilt, entscheidet niemand hier (O-60).
   */
  const satzOben = feld('steuersatz');
  const positionen: HandPosition[] = [];
  for (let i = 0; i < anzahl; i += 1) {
    const eigen = feld(`p${String(i)}_steuer`);
    positionen.push({
      kurztext: feld(`p${String(i)}_kurztext`),
      langtext: feld(`p${String(i)}_langtext`),
      menge: feld(`p${String(i)}_menge`),
      einheit: feld(`p${String(i)}_einheit`),
      einzelpreisEuro: feld(`p${String(i)}_preis`),
      steuersatzSchluessel: eigen === '' ? satzOben : eigen,
    });
  }

  const kunde = feld('kunde');
  const objekt = feld('objekt');
  const kontakt = feld('kontakt');
  /* Die Anfrage, auf die das Angebot antwortet (V-138) — geprüft im Dienst. */
  const lead = feld('lead');

  let angebotId: string;
  try {
    if (!UUID.test(kunde)) {
      throw new HandAngebotFehler('Ohne Kunden kein Angebot.', 'kein_kunde');
    }
    angebotId = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /*
         * Linie 1 — IN der gebundenen Transaktion. `app.hat_recht` liest die
         * Sitzungsbindung; davor antwortete es auf alles `false`. Linie 2 ist
         * `t_mandant` auf `angebot` und `angebotsposition`, das denselben
         * Schlüssel ein zweites Mal verlangt (AUT-05).
         */
        await authorize(
          sitzung, { recht: RECHT, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [heute] = await kontext.abfrage<{ tag: string }>(
          `select app.berlin_heute()::text as tag`);
        const ergebnis = await legeAngebotVonHandAn(kontext, {
          kundeId: kunde,
          titel: feld('titel'),
          objektId: UUID.test(objekt) ? objekt : null,
          ansprechpartnerId: UUID.test(kontakt) ? kontakt : null,
          leadId: lead === '' ? null : lead,
          gueltigBis: feld('gueltigBis'),
          einleitungstext: feld('einleitung'),
          /*
           * Der Stichtag ist der BERLINER Heute-Tag aus der Datenbank, nicht
           * `new Date()` im Knoten: um 00:30 Berliner Zeit im Sommer ist der
           * UTC-Tag noch der gestrige, und ein Steuersatz, der zum Monatsende
           * ausläuft, wäre dann der falsche (Invariante 2).
           */
          stichtag: heute?.tag ?? '',
          positionen,
        });
        return ergebnis.angebotId;
      }))) as string;
  } catch (fehler) {
    if (fehler instanceof HandAngebotFehler) {
      const ziel = new URL(internesZiel(
        zurueckWeg === '' ? '/portal' : zurueckWeg, '/portal', anfrage));
      ziel.searchParams.set('fehler', fehler.grund);
      return NextResponse.redirect(ziel, 303);
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  /*
   * Nach dem Anlegen auf das Angebot — dort steht die Summe, die Freigabe und
   * der Versand. Ein Rücksprung auf das leere Formular liesse den Menschen
   * raten, ob etwas entstanden ist.
   */
  const ziel = mandant === ''
    ? '/portal' : `/portal/${mandant}/angebote/${angebotId}`;
  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
