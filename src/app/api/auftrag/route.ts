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
import { NummernkreisFehler } from '@/server/services/finanz/nummernkreis';
import { legeAuftragDirektAn, type DirektAuftragsart } from '@/server/services/auftrag/direkt';
import { maskeMitEingaben } from '@/lib/formular/maske';

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

const ARTEN: readonly DirektAuftragsart[] = [
  'einzelauftrag', 'rahmenvertrag', 'dauerauftrag', 'projekt',
];

function istArt(wert: string | null): wert is DirektAuftragsart {
  return wert !== null && (ARTEN as readonly string[]).includes(wert);
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
  /*
   * Die Anfrage, aus der dieser Auftrag direkt entsteht — ohne Angebot
   * (V-138, CRM-05, REP-03). Ein Auftrag am Telefon nach einer Web-Anfrage
   * ist ein Auftrag aus DIESEM Kanal; ohne das Feld zählte ihn der
   * Herkunftsbericht nirgends.
   */
  const leadId = text('leadId');
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

  /*
   * **Ein Formular bekommt seine Maske zurück, kein JSON** (D-599). Der
   * Assistent schickt ein Formular; eine Abweisung endete bis hierher auf
   * einer weissen Seite mit `{"fehler":"keine_zahl"}`. Jetzt führt sie auf
   * `/auftraege/neu` mit dem Schlüssel, und die Maske sagt den Satz — mit der
   * Anfrage, falls der Auftrag aus einer kam (V-138), und seit V-143 mit
   * allem, was eingegeben war: wer sich bei den Wochenstunden vertippt, fängt
   * nicht mit zehn leeren Feldern von vorn an.
   */
  const slug = (anfrage.nextUrl.searchParams.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const zurMaske = (grund: string): NextResponse => NextResponse.redirect(new URL(
    maskeMitEingaben(slug === '' ? '/portal' : `/portal/${slug}/auftraege/neu`, grund, {
      lead: leadId, kundeId, objektId: text('objektId'), bezeichnung, art,
      verantwortlichBenutzerId: text('verantwortlichBenutzerId'), startDatum,
      laufzeitBis: text('laufzeitBis'), personalbedarfAnzahl: text('personalbedarfAnzahl'),
      wochenstundenSoll: text('wochenstundenSoll'),
      ausstattungHinweis: text('ausstattungHinweis'), beschreibung: text('beschreibung'),
    }), erwarteterUrsprung(anfrage)), 303);

  if (kundeId === null || bezeichnung === null || startDatum === null || !istArt(art)) {
    return zurMaske('unvollstaendig');
  }
  if (ungueltig.length > 0) return zurMaske('keine_zahl');
  if (ausserhalb.length > 0) return zurMaske('ausserhalb_bereich');

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

        /*
         * Anfrage prüfen, Nummer ziehen, anlegen — im Dienst (V-143), damit es
         * sich gegen eine echte Datenbank prüfen lässt: eine abgewiesene
         * Anfrage verbraucht KEINE Auftragsnummer.
         */
        return legeAuftragDirektAn(
          kontext,
          { unsafe: async (s: string, w: readonly unknown[] = []) =>
              (await tx.unsafe(s, w as never[])) as readonly unknown[] },
          {
            kundeId, objektId: text('objektId'), art, bezeichnung,
            beschreibung: text('beschreibung'), verantwortlichBenutzerId: verantwortlich,
            startDatum, laufzeitBis: text('laufzeitBis'),
            personalbedarfAnzahl: personalVorab, wochenstundenSoll: stundenVorab,
            ausstattungHinweis: text('ausstattungHinweis'), leadId,
          });
      })) as ReturnType<typeof legeAuftragDirektAn>);

    /* Die Anfrage bleibt in der Adresse, damit der zweite Versuch nicht ohne sie beginnt. */
    if (ergebnis.art === 'lead') return zurMaske(ergebnis.grund);
    if (ergebnis.art === 'nicht_angelegt') return zurMaske('nicht_angelegt');
    return NextResponse.redirect(
      new URL(`/portal/${slug}/auftraege/${ergebnis.id}`, erwarteterUrsprung(anfrage)), 303);
  } catch (fehler) {
    /*
     * **Die Antworten des TORS bleiben JSON** — wie auf jeder Route dieser
     * Anwendung (`uebergang.ts`, `autorisierungsAntwort`, D-637): ohne
     * Sitzung, ohne zweiten Faktor, ohne Recht gibt es keine Maske, auf die
     * man zurückkehren könnte; die Maske selbst stünde hinter demselben Tor.
     * Zurück auf die Maske geht alles, was die EINGABE oder den Vorgang
     * betrifft.
     */
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    if (fehler instanceof NummernkreisFehler) return zurMaske(fehler.grund);
    throw fehler;
  }
}
