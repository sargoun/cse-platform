import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { cent } from '@/server/services/finanz/geld';
import {
  AbrechnungFehler, beendeKonfiguration, legeKonfigurationAn,
} from '@/server/services/finanz/abrechnungsart/index';

/**
 * `POST /api/abrechnung` — die Abrechnungsart eines Auftrags festlegen oder
 * beenden (FIN-01, O-04).
 *
 * **Das ist der Weg, auf dem O-04 eine Datenänderung wird statt einer
 * Codeänderung.** Die fünf Arten stehen im Register; ihre offenen Regeln
 * stehen als Parameter auf `vertrag_abrechnung`, und bis sie dort stehen,
 * rechnet keine Strategie. Wer sie einträgt, beantwortet die Frage für DIESEN
 * Vertrag — das ist die Stelle, an der sie beantwortbar ist, denn verhandelt
 * wird sie je Vertrag.
 *
 * Beide Handlungen tragen `abrechnung.schreiben` — dasselbe Recht, mit dem die
 * Seitenkarte die Seite bewacht. Eine bestehende Konfiguration wird NICHT
 * überschrieben, sondern beendet und durch eine neue abgelöst: die Grundlage
 * einer bereits festgeschriebenen Rechnung bleibt sonst nicht erklärbar
 * (FIN-06, K-12).
 *
 * Der Handler bleibt dünn: prüfen, den Dienst rufen, antworten.
 */
export const dynamic = 'force-dynamic';

/**
 * Zurueck auf die Abrechnungsseite — im Erfolgsfall ohne, im Fehlerfall MIT
 * Grund.
 *
 * **Warum der Fehlerfall nicht mehr JSON ist** (V-024, D-562). Diese Route
 * liest ausschliesslich `formData`, also kommt jeder Aufruf aus einem
 * Formular. Eine 409 mit `{"fehler":"keine_abrechnungsart"}` war deshalb
 * immer eine weisse Seite mit einem Datenfeld: der Satz, den ein Mensch lesen
 * soll, ohne Formular und ohne Rueckweg. Die Seite fuehrt fuer genau diese
 * Gruende eine Satztabelle.
 */
function zurueck(
  anfrage: NextRequest, auftragId: string, grund?: string,
): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const ziel = new URL(
    `/portal/${slug}/auftraege/${auftragId}/abrechnung`, erwarteterUrsprung(anfrage));
  if (grund !== undefined) ziel.searchParams.set('fehler', grund);
  return NextResponse.redirect(ziel, 303);
}

/**
 * Die Parameter kommen als `schluessel=wert`-Zeilen, eine je Zeile.
 *
 * Kein freies JSON aus dem Formular: ein `jsonb`, das ein Browser schickt,
 * könnte jede Form haben — auch einen Geldbetrag, und genau der gehört nicht
 * hinein (0086). Zahlen werden als Zahlen übernommen, `null` als `null`, eine
 * Liste als kommagetrennte Werte. Alles andere bleibt Text.
 */
function leseParameter(roh: string | null): Record<string, unknown> {
  const parameter: Record<string, unknown> = {};
  for (const zeile of (roh ?? '').split('\n')) {
    const trennung = zeile.indexOf('=');
    if (trennung < 0) continue;
    const schluessel = zeile.slice(0, trennung).trim();
    const wert = zeile.slice(trennung + 1).trim();
    if (schluessel === '') continue;
    if (wert === 'null') { parameter[schluessel] = null; continue; }
    if (/^-?\d+$/u.test(wert)) { parameter[schluessel] = Number(wert); continue; }
    if (wert.includes(',')) {
      parameter[schluessel] = wert.split(',').map((w) => w.trim()).filter((w) => w !== '');
      continue;
    }
    parameter[schluessel] = wert;
  }
  return parameter;
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
   * **Zahlen werden GEPRUEFT, nicht gecastet** — und zwar hier oben, vor der
   * Transaktion.
   *
   * Hier stand `cent(BigInt(wert))` und `Number(ziel)` mitten im
   * Schreibvorgang. `BigInt('abc')` wirft einen `SyntaxError`, den die
   * Fehlerkette darunter nicht kennt (sie faengt `AbrechnungFehler`,
   * `NichtAngemeldetFehler` und Verwandte) — aus einer Falscheingabe wurde
   * damit eine 500. `Number('1.5')` wiederum kommt durch und faellt erst am
   * `smallint` der Datenbank, also ebenfalls als 500. Beides ist dieselbe
   * Verwechslung: eine falsch ausgefuellte Zeile ist eine Abweisung, kein
   * Programmfehler.
   *
   * `SyntaxError` einfach mitzufangen waere die schlechtere Reparatur: dann
   * antwortete auch ein echter Programmfehler mit 400.
   */
  const ungueltig: string[] = [];
  const centOderNull = (name: string) => {
    const wert = text(name);
    if (wert === null) return null;
    if (!/^-?\d{1,18}$/u.test(wert)) { ungueltig.push(name); return null; }
    return cent(BigInt(wert));
  };
  const ganzzahlOderNull = (name: string, min: number, max: number) => {
    const wert = text(name);
    if (wert === null) return null;
    if (!/^\d{1,9}$/u.test(wert)) { ungueltig.push(name); return null; }
    const zahl = Number(wert);
    if (zahl < min || zahl > max) { ungueltig.push(name); return null; }
    return zahl;
  };

  const aktion = text('aktion') ?? 'anlegen';
  const auftragId = text('auftragId');
  if (auftragId === null) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  /**
   * **Die Vollstaendigkeit wird HIER entschieden, nicht im Rueckruf.**
   *
   * Beide Zweige standen mit `if (… === null) return;` INNERHALB der
   * Transaktion. Der Rueckruf kehrte dann zurueck, die Transaktion schloss
   * ohne Schreibvorgang, und der Handler antwortete mit derselben 303
   * Weiterleitung wie im Erfolgsfall. Ueber das Formular faellt das nicht auf
   * — der Browser landet auf einer Seite, die die neue Konfiguration nicht
   * zeigt —, aber ein unmittelbarer Aufrufer bekam „angelegt" gemeldet und
   * hatte nichts.
   */
  const pflicht = aktion === 'beenden'
    ? ['konfigurationId', 'gueltigBis']
    : ['abrechnungsart', 'abrechnungsintervall', 'leistungszeitraumModus', 'gueltigAb'];
  const fehlend = pflicht.filter((f) => text(f) === null);

  const pauschaleNettoCent = centOderNull('pauschaleNettoCent');
  const stundensatzCent = centOderNull('stundensatzCent');
  const festpreisNettoCent = centOderNull('festpreisNettoCent');
  // `smallint` und ein Zahlungsziel: mehr als zehn Jahre ist keine Frist.
  const zahlungszielTage = ganzzahlOderNull('zahlungszielTage', 0, 3650);

  if (fehlend.length > 0 || ungueltig.length > 0) {
    return zurueck(
      anfrage, auftragId, fehlend.length > 0 ? 'unvollstaendig' : 'ungueltig');
  }

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'abrechnung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'beenden') {
          await beendeKonfiguration(kontext, text('konfigurationId')!, text('gueltigBis')!);
          return;
        }

        // Kein Vorgabewert für Art, Rhythmus und Leistungszeitraum (0086) —
        // dass alle vier da sind, ist oben entschieden und beantwortet.
        await legeKonfigurationAn(kontext, {
          auftragId,
          auftragLeistungId: text('auftragLeistungId'),
          abrechnungsart: text('abrechnungsart')!,
          parameter: leseParameter(text('parameter')),
          pauschaleNettoCent,
          stundensatzCent,
          festpreisNettoCent,
          abrechnungsintervall: text('abrechnungsintervall')!,
          leistungszeitraumModus: text('leistungszeitraumModus')!,
          zahlungszielTage,
          gueltigAb: text('gueltigAb')!,
          gueltigBis: text('gueltigBis'),
        });
      })));

    return zurueck(anfrage, auftragId);
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
    /**
     * Ein offener Parameter oder eine unbekannte Abrechnungsart ist eine
     * Abweisung, kein Programmfehler: 409 mit dem Text, der die offene Frage
     * nennt — und nicht 500.
     */
    if (fehler instanceof AbrechnungFehler) {
      return zurueck(anfrage, auftragId, fehler.grund);
    }
    throw fehler;
  }
}
