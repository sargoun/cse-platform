import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { legePostenAn, setzePostenLeistung } from '@/server/services/security/posten';
import { legePlanungsserieAn } from '@/server/services/dienstplan/serie';
import { alsAntwort } from '../antwort';
import { LeistungsankerFehler } from '@/server/services/dienstplan/leistungsanker';

/**
 * `POST /api/sicherheit/posten` — einen Wachposten anlegen (SEC-01).
 *
 * **Die Prüfungen stehen im DIENST, nicht hier.** Diese Datei autorisiert,
 * ruft und übersetzt Fehler in Antworten. Ein Handler, der selbst prüft, ist
 * ein Handler, an dem man vorbeikommt, indem man einen anderen aufruft.
 *
 * `security.schreiben` — dasselbe Recht, das `05-API-KARTE.md` für diese
 * Adresse nennt, und dasselbe, das die `WITH CHECK`-Hälfte der Zeilenpolitik
 * von `posten` verlangt (K-03). Zwei Linien für dieselbe Frage, und das ist
 * Absicht: die Route ist die erste, die Datenbank die zweite.
 *
 * **Die Leistungszeile** (V-191, TIM-12): beim Anlegen als `auftrag_leistung`,
 * und an einem bestehenden Posten mit `aktion=leistung` — der Generator
 * schreibt sie danach auf die künftigen Schichten ohne erfasste Zeit. Ein
 * leeres Feld löst den Anker. Abgewiesen wird zurück auf das Postenblatt, mit
 * dem Grund als Schlüssel.
 */
export const dynamic = 'force-dynamic';

function zahl(wert: FormDataEntryValue | null, vorgabe: number): number {
  const n = Number(typeof wert === 'string' ? wert : '');
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : vorgabe;
}

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
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
  const mandant = String(daten.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');

  if (daten.get('aktion') === 'leistung') {
    const postenId = text(daten, 'posten') ?? '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(postenId)) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    const blatt = `/portal/${mandant}/security/posten/${postenId}`;
    const zurueckMit = (schluessel: string, wert: string): NextResponse => {
      const ziel = new URL(internesZiel(blatt, `/portal/${mandant}/security/posten`, anfrage));
      ziel.searchParams.set(schluessel, wert);
      return NextResponse.redirect(ziel, 303);
    };
    try {
      await (db().begin(async (tx: postgres.TransactionSql) =>
        withTenant(tx, sitzung, async (kontext) => {
          await authorize(
            sitzung,
            { recht: 'security.schreiben', schreibend: true },
            rechtepruefer(kontext.abfrage.bind(kontext)),
          );
          /*
           * Leer heisst „ohne" (lösen). Ein Wert, der keine Kennung ist, wird
           * abgewiesen — vorher wurde er still zu `null` und LÖSTE den Anker
           * (V-192). Welche Zeile es gibt, prüft der Dienst.
           */
          const anker = text(daten, 'auftrag_leistung');
          if (anker !== null
            && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(anker)) {
            throw new LeistungsankerFehler('leistung_unbekannt');
          }
          await setzePostenLeistung(kontext, postenId, anker);
        })));
    } catch (fehler) {
      const grund = (fehler as { grund?: unknown }).grund;
      if (fehler instanceof LeistungsankerFehler && typeof grund === 'string') {
        return zurueckMit('fehler', grund);
      }
      const antwort = alsAntwort(fehler);
      if (antwort !== null) return antwort;
      throw fehler;
    }
    return zurueckMit('leistung', 'gesetzt');
  }

  const objektId = text(daten, 'objekt');
  const bezeichnung = text(daten, 'bezeichnung');
  const gueltigAb = text(daten, 'gueltig_ab');
  if (objektId === null || bezeichnung === null || gueltigAb === null) {
    return NextResponse.json({ fehler: 'pflichtfeld_fehlt' }, { status: 400 });
  }

  let neu: string;
  try {
    neu = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'security.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const postenId = await legePostenAn(kontext, {
          objektId,
          bezeichnung,
          kurzzeichen: text(daten, 'kurzzeichen'),
          postenartId: text(daten, 'postenart'),
          minBesetzung: zahl(daten.get('min_besetzung'), 1),
          sollBesetzung: zahl(daten.get('soll_besetzung'), 1),
          abdeckungRrule: text(daten, 'rrule'),
          dtstartLokal: text(daten, 'dtstart'),
          dauerMinuten: text(daten, 'dauer') === null
            ? null : zahl(daten.get('dauer'), 480),
          gueltigAb,
          gueltigBis: text(daten, 'gueltig_bis'),
          // Der Abrechnungsanker (V-191, TIM-12) — freiwillig, geprueft im Dienst.
          auftragLeistungId: text(daten, 'auftrag_leistung'),
        });
        /*
         * Ein Posten mit Dienstzeiten ist ein Bedarf; ohne Serie plant ihn
         * niemand (D-487). Die Serie entsteht hier, die Schichten sofort —
         * unter demselben Schreibrecht, in derselben Transaktion.
         */
        if (text(daten, 'rrule') !== null) {
          await legePlanungsserieAn(kontext, {
            quelle: 'posten', traegerId: postenId, feiertageUeberspringen: false,
          });
        }
        return postenId;
      })) as Promise<string>);
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/security/posten/${neu}`,
      anfrage,
    ),
    303,
  );
}
