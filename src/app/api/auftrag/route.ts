import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { vergebeNummer, NummernkreisFehler } from '@/server/services/finanz/nummernkreis';

/**
 * `POST /api/auftrag` — der Auftragsassistent (OPS-10).
 *
 * OPS-10 zaehlt auf, was ein neuer Vertrag sichtbar machen muss: Ort,
 * Personalbedarf, Stunden, Ausstattung, Startdatum, verantwortliche Leitung.
 * Genau diese Felder nimmt dieser Weg entgegen — und keines davon errät er.
 * Ein Assistent, der den Personalbedarf schaetzt, produziert eine Zahl, die
 * spaeter niemand hinterfragt.
 */
export const dynamic = 'force-dynamic';

const ARTEN = new Set(['einzelauftrag', 'rahmenvertrag', 'dauerauftrag', 'projekt']);

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };
  /**
   * Eine unlesbare Zahl ist ein FEHLER, kein fehlendes Feld.
   *
   * Vorher wurde jeder Unsinn zu `null`, und `null` heisst hier „nicht
   * angegeben“. Wer `abc` in die Wochenstunden tippt, bekam also einen
   * Auftrag ohne Wochenstunden — angelegt, gemeldet als Erfolg, und der
   * Fehler faellt erst auf, wenn jemand danach plant.
   */
  const ungueltig: string[] = [];
  const zahl = (name: string): number | null => {
    const roh = text(name);
    if (roh === null) return null;
    const n = Number(roh.replace(',', '.'));
    if (!Number.isFinite(n)) { ungueltig.push(name); return null; }
    return n;
  };

  const kundeId = text('kundeId');
  const bezeichnung = text('bezeichnung');
  const art = text('art');
  const startDatum = text('startDatum');
  const verantwortlich = text('verantwortlichBenutzerId') ?? sitzung.benutzerId;

  const stundenVorab = zahl('wochenstundenSoll');
  const personalVorab = zahl('personalbedarfAnzahl');

  /**
   * Der BEREICH gehoert hierher, nicht nur in die Datenbank.
   *
   * `auftrag_personalbedarf_bereich` (0..5000) und
   * `auftrag_wochenstunden_bereich` (0..10000) fangen jeden Ausreisser — aber
   * ERST beim Schreiben, nachdem der Handler schon eine Auftragsnummer
   * gezogen hat. Der Verstoss kommt dann als roher Datenbankfehler heraus und
   * verlaesst die Route als 500: der Aufrufer erfaehrt „Serverfehler", wo
   * „dieses Feld ist zu gross" richtig waere. Und eine gezogene Nummer ist
   * eine gezogene Nummer.
   *
   * Die Personenzahl muss zusaetzlich GANZ sein: `smallint` schneidet `2,5`
   * nicht ab, es wirft — aber wieder erst unten.
   */
  const ausserhalb: string[] = [];
  if (personalVorab !== null
      && (!Number.isInteger(personalVorab) || personalVorab < 0 || personalVorab > 5000)) {
    ausserhalb.push('personalbedarfAnzahl');
  }
  if (stundenVorab !== null && (stundenVorab < 0 || stundenVorab > 10_000)) {
    ausserhalb.push('wochenstundenSoll');
  }

  if (kundeId === null || bezeichnung === null || art === null || startDatum === null
      || !ARTEN.has(art)) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }
  if (ungueltig.length > 0) {
    return NextResponse.json({ fehler: 'keine_zahl', felder: ungueltig }, { status: 400 });
  }
  if (ausserhalb.length > 0) {
    return NextResponse.json({ fehler: 'ausserhalb_bereich', felder: ausserhalb },
      { status: 400 });
  }

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'auftrag.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const nummer = await vergebeNummer(
          { unsafe: async (s: string, w: readonly unknown[] = []) =>
              (await tx.unsafe(s, w as never[])) as readonly unknown[] },
          { kreisTyp: 'auftrag' },
        );

        const stunden = stundenVorab;
        const [neu] = await kontext.abfrage<{ id: string }>(
          `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art,
                                bezeichnung, beschreibung, verantwortlich_benutzer_id,
                                start_datum, laufzeit_bis, personalbedarf_anzahl,
                                wochenstunden_soll, ausstattung_hinweis)
           values (app.aktiver_mandant(), $1, $2, $3, $4::auftrag_art, $5, $6, $7,
                   $8::date, $9::date, $10, $11::numeric, $12)
           returning id`,
          [nummer.formatiert, kundeId, text('objektId'), art, bezeichnung,
           text('beschreibung'), verantwortlich, startDatum, text('laufzeitBis'),
           personalVorab, stunden === null ? null : stunden.toFixed(3),
           text('ausstattungHinweis')],
        );
        if (neu === undefined) return null;
        return neu.id;
      })) as Promise<string | null>);

    if (ergebnis === null) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
    return NextResponse.redirect(
      new URL(`/portal/${slug}/auftraege/${ergebnis}`, erwarteterUrsprung(anfrage)), 303);
  } catch (fehler) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    if (fehler instanceof NummernkreisFehler) {
      return NextResponse.json({ fehler: fehler.grund, text: fehler.message }, { status: 409 });
    }
    throw fehler;
  }
}
