import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  legePlanungsserieAn, legeTurnusSerieAn, type SerienErgebnis,
} from '@/server/services/dienstplan/serie';
import { alsAntwort } from '../../sicherheit/antwort';
import { LeistungsankerFehler } from '@/server/services/dienstplan/leistungsanker';
import { maskeMitEingaben } from '@/lib/formular/maske';

/**
 * `POST /api/dienstplan/serien` — eine Serie anlegen und sofort planen
 * (TIM-01, TIM-02, D-487).
 *
 * `art=turnus`: Revier, Leistung, Wochentage, Beginn, Dauer, Geltung,
 * Feiertagsregel → Turnus + Serie + Schichten. `art=posten`: die Serie zu
 * einem Posten mit Dienstzeiten. Formular-POST vom eigenen Ursprung; zurueck
 * geht es auf die Serienliste mit der Zahl der erzeugten Schichten.
 *
 * **Ein abgewiesener Anker kommt auf die Maske zurueck** (V-192, D-599): mit
 * dem Grund als Schluessel und den Eingaben — vorher als JSON-422 im Browser.
 * Die uebrigen Abweisungen dieses Wegs antworten weiter mit JSON; das ist die
 * Altlast aus D-599, nicht ein Fall, den das Anker-Feld neu erzeugt.
 */
export const dynamic = 'force-dynamic';

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
  const mandant = (text(daten, 'mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const art = text(daten, 'art');
  if (art !== 'turnus' && art !== 'posten') {
    return NextResponse.json({ fehler: 'art_unbekannt' }, { status: 400 });
  }
  const liste = `/portal/${mandant}/dienstplan/serien`;

  let ergebnis: SerienErgebnis;
  try {
    const aus = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'dienstplan.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        if (art === 'posten') {
          const postenId = text(daten, 'posten');
          if (postenId === null) return NextResponse.json({ fehler: 'pflichtfeld_fehlt' }, { status: 400 });
          return legePlanungsserieAn(kontext, {
            quelle: 'posten', traegerId: postenId, feiertageUeberspringen: daten.get('feiertage') === 'ausfall',
          });
        }
        const revierId = text(daten, 'revier');
        const leistungId = text(daten, 'leistung');
        const bezeichnung = text(daten, 'bezeichnung');
        const beginn = text(daten, 'beginn');
        const gueltigAb = text(daten, 'gueltig_ab');
        if (revierId === null || leistungId === null || bezeichnung === null || beginn === null || gueltigAb === null) {
          return NextResponse.json({ fehler: 'pflichtfeld_fehlt' }, { status: 400 });
        }
        const dauer = Number(text(daten, 'dauer') ?? '');
        return legeTurnusSerieAn(kontext, {
          revierId, leistungskatalogPositionId: leistungId, bezeichnung,
          wochentage: daten.getAll('wochentag').map((w) => String(w)),
          beginnLokal: beginn, dauerMinuten: Number.isFinite(dauer) ? Math.trunc(dauer) : 0,
          gueltigAb, gueltigBis: text(daten, 'gueltig_bis'),
          feiertagsregel: daten.get('feiertage') === 'unveraendert' ? 'unveraendert' : 'ausfall',
          // Der Abrechnungsanker (V-191, TIM-12) — freiwillig, geprueft im Dienst.
          auftragLeistungId: text(daten, 'auftrag_leistung'),
        });
      })) as Promise<SerienErgebnis | NextResponse>);
    if (aus instanceof NextResponse) return aus;
    ergebnis = aus;
  } catch (fehler) {
    if (fehler instanceof LeistungsankerFehler) {
      const maske = maskeMitEingaben(`${liste}/neu`, fehler.grund, {
        revier: text(daten, 'revier'), leistung: text(daten, 'leistung'),
        bezeichnung: text(daten, 'bezeichnung'), beginn: text(daten, 'beginn'),
        dauer: text(daten, 'dauer'), gueltig_ab: text(daten, 'gueltig_ab'),
        gueltig_bis: text(daten, 'gueltig_bis'), feiertage: text(daten, 'feiertage'),
        wochentage: daten.getAll('wochentag').map((w) => String(w)).join(','),
        auftrag_leistung: text(daten, 'auftrag_leistung'),
      });
      return NextResponse.redirect(internesZiel(maske, liste, anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  const ziel = `${liste}?angelegt=${ergebnis.planungsserieId}&erzeugt=${String(ergebnis.erzeugt)}`
    + `${ergebnis.bestandSchon ? '&bestand=1' : ''}`
    + `${ergebnis.uebersprungen.length > 0 ? `&uebersprungen=${encodeURIComponent(ergebnis.uebersprungen[0]?.grund ?? '')}` : ''}`;
  return NextResponse.redirect(internesZiel(ziel, liste, anfrage), 303);
}
