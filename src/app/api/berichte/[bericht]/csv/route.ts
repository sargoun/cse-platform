import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant, type LeseKontext } from '@/server/kontext/index';
import {
  abschnitte, ganzesJahr, jahrAus, type Granularitaet,
} from '@/server/services/bericht/zeitraum';
import {
  alsCsv, dateiname, geldText, prozent, stunden, type Spalte,
} from '@/server/services/bericht/ausgabe';
import {
  attribution, auftragsReihe, mitarbeiterReihe, pipeline, projektReihe, umsatzReihe,
  type AttributionsZeile, type AuftragsZeile, type MitarbeiterZeile, type PipelineStufe,
  type ProjektZeile, type UmsatzZeile,
} from '@/server/services/bericht/kennzahlen';

/**
 * `GET /api/berichte/[bericht]/csv` — ein Bericht als Datei (REP-07).
 *
 * **Ein eigenes Recht: `bericht.exportieren`.** Wer eine Zahl ansehen darf,
 * darf sie nicht schon aus dem Haus tragen. Eine CSV-Datei verlässt das
 * Portal und damit jede Zugriffskontrolle darin — sie liegt danach in einem
 * Downloads-Ordner, in einem Mailanhang, in einem geteilten Laufwerk. Das
 * Recht ist an `admin` gebunden und an `leitung` bindbar (Katalog).
 *
 * **GET, weil nichts entsteht.** Der Bericht liest; ein POST wäre die
 * Behauptung, hier werde etwas geändert. Der Schnappschuss
 * (`SCHNAPPSCHUSS`) sorgt dafür, dass alle Spalten denselben Stand sehen.
 *
 * **Der Mandant kommt aus der SITZUNG, nicht aus der Abfrage** (Invariante 3).
 * `?mandant=` steht nur in der Adresse, damit der Browser eine sprechende
 * Datei bekommt; verglichen wird gegen den aktiven Bereich, und wer einen
 * fremden einträgt, bekommt 404 wie bei jeder fremden Zeile (AUT-06).
 */
export const dynamic = 'force-dynamic';

type BerichtName =
  'umsatz' | 'auftraege' | 'attribution' | 'mitarbeiter' | 'projekte' | 'pipeline';

const NAMEN: Readonly<Record<BerichtName, string>> = {
  umsatz: 'Umsatz', auftraege: 'Auftraege', attribution: 'Herkunft',
  mitarbeiter: 'Stunden', projekte: 'Projekte', pipeline: 'Vergabepipeline',
};

function istBericht(wert: string): wert is BerichtName {
  return Object.hasOwn(NAMEN, wert);
}

function koernungAus(roh: string | null): Granularitaet {
  return roh === 'quartal' || roh === 'jahr' ? roh : 'monat';
}

/**
 * Die Spalten je Bericht — dieselbe Reihenfolge wie auf dem Bildschirm.
 *
 * **Eine andere Reihenfolge wäre ein zweiter Bericht.** Wer die Datei neben
 * die Seite legt und die Spalten nicht wiedererkennt, prüft nicht nach,
 * sondern rechnet neu.
 */
async function zeilenUndSpalten(
  bericht: BerichtName, kontext: LeseKontext, jahr: number, koernung: Granularitaet,
): Promise<{ zeilen: readonly unknown[]; spalten: readonly Spalte<never>[]; zeitraum: string }> {
  const jahresZeitraum = ganzesJahr(jahr);
  const stuecke = abschnitte(jahr, koernung);
  const s = <Z,>(spalten: readonly Spalte<Z>[]): readonly Spalte<never>[] =>
    spalten as unknown as readonly Spalte<never>[];

  switch (bericht) {
    case 'umsatz':
      return {
        zeitraum: String(jahr),
        zeilen: await umsatzReihe(kontext, stuecke),
        spalten: s<UmsatzZeile>([
          { kopf: 'Zeitraum', wert: (z) => z.zeitraum.bezeichnung },
          { kopf: 'Von', wert: (z) => z.zeitraum.von },
          { kopf: 'Bis', wert: (z) => z.zeitraum.bis },
          { kopf: 'Erlöse', wert: (z) => geldText(z.erloeseCent), cent: (z) => z.erloeseCent },
          { kopf: 'Rechnungen', wert: (z) => z.rechnungen },
          { kopf: 'Aufwand', wert: (z) => geldText(z.aufwandCent), cent: (z) => z.aufwandCent },
          { kopf: 'Eingangsrechnungen', wert: (z) => z.eingangsrechnungen },
          { kopf: 'Ergebnis', wert: (z) => geldText(z.ergebnisCent), cent: (z) => z.ergebnisCent },
        ]),
      };
    case 'auftraege':
      return {
        zeitraum: String(jahr),
        zeilen: await auftragsReihe(kontext, stuecke),
        spalten: s<AuftragsZeile>([
          { kopf: 'Zeitraum', wert: (z) => z.zeitraum.bezeichnung },
          { kopf: 'Von', wert: (z) => z.zeitraum.von },
          { kopf: 'Bis', wert: (z) => z.zeitraum.bis },
          { kopf: 'Anfragen', wert: (z) => z.leads },
          { kopf: 'Gewonnen', wert: (z) => z.leadsGewonnen },
          { kopf: 'Quote', wert: (z) => prozent(z.quoteBp) },
          { kopf: 'Aufträge', wert: (z) => z.auftraege },
          { kopf: 'Auftragswert netto', wert: (z) => geldText(z.auftragswertCent),
            cent: (z) => z.auftragswertCent },
        ]),
      };
    case 'attribution':
      return {
        zeitraum: String(jahr),
        zeilen: await attribution(kontext, jahresZeitraum),
        spalten: s<AttributionsZeile>([
          { kopf: 'Kanal', wert: (z) => z.kanal },
          { kopf: 'Medium', wert: (z) => z.medium },
          { kopf: 'Kampagne', wert: (z) => z.kampagne },
          { kopf: 'Anfragen', wert: (z) => z.leads },
          { kopf: 'Aufträge', wert: (z) => z.auftraege },
          { kopf: 'Quote', wert: (z) => prozent(z.quoteBp) },
          { kopf: 'Auftragswert netto', wert: (z) => geldText(z.auftragswertCent),
            cent: (z) => z.auftragswertCent },
        ]),
      };
    case 'mitarbeiter':
      return {
        zeitraum: String(jahr),
        zeilen: await mitarbeiterReihe(kontext, jahresZeitraum),
        spalten: s<MitarbeiterZeile>([
          { kopf: 'Name', wert: (z) => z.name },
          { kopf: 'Personalnummer', wert: (z) => z.personalnummer },
          { kopf: 'Wochenstunden Soll', wert: (z) => z.wochenstundenSoll },
          { kopf: 'Ist', wert: (z) => stunden(z.istMinuten) },
          { kopf: 'Ist (Minuten)', wert: (z) => z.istMinuten },
          { kopf: 'Soll', wert: (z) => stunden(z.sollMinuten) },
          { kopf: 'Soll (Minuten)', wert: (z) => z.sollMinuten },
          { kopf: 'Auslastung', wert: (z) => prozent(z.auslastungBp) },
          { kopf: 'Ist minus Soll (Minuten)', wert: (z) => z.mehrarbeitMinuten },
        ]),
      };
    case 'projekte':
      return {
        zeitraum: String(jahr),
        zeilen: await projektReihe(kontext, jahresZeitraum),
        spalten: s<ProjektZeile>([
          { kopf: 'Nummer', wert: (z) => z.nummer },
          { kopf: 'Projekt', wert: (z) => z.bezeichnung },
          { kopf: 'Status', wert: (z) => z.status },
          { kopf: 'Soll-Ende', wert: (z) => z.sollEnde },
          { kopf: 'Ist-Ende', wert: (z) => z.istEnde },
          { kopf: 'Verzug (Tage)', wert: (z) => z.verzugTage },
          { kopf: 'Auftragssumme', wert: (z) => geldText(z.auftragssummeCent),
            cent: (z) => z.auftragssummeCent },
          { kopf: 'Berechnet', wert: (z) => geldText(z.berechnetCent),
            cent: (z) => z.berechnetCent },
          { kopf: 'Kosten (Näherung)', wert: (z) => geldText(z.kostenCent),
            cent: (z) => z.kostenCent },
          { kopf: 'Marge', wert: (z) => prozent(z.margeBp) },
        ]),
      };
    default:
      return {
        zeitraum: String(jahr),
        zeilen: await pipeline(kontext, jahresZeitraum),
        spalten: s<PipelineStufe>([
          { kopf: 'Stufe', wert: (z) => z.bezeichnung },
          { kopf: 'Status', wert: (z) => z.status },
          { kopf: 'Vorgänge', wert: (z) => z.anzahl },
          { kopf: 'Zuschlagswert', wert: (z) => geldText(z.zuschlagswertCent),
            cent: (z) => z.zuschlagswertCent },
        ]),
      };
  }
}

export async function GET(
  anfrage: NextRequest, { params }: { params: Promise<{ bericht: string }> },
): Promise<NextResponse> {
  const { bericht } = await params;
  if (!istBericht(bericht)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return NextResponse.json({ fehler: 'nicht_angemeldet' }, { status: 401 });
  // Invariante 10: ohne genau einen aktiven Bereich gibt es diesen Bericht nicht.
  if (sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const suche = anfrage.nextUrl.searchParams;

  try {
    const { csv, name } = await (db().begin(SCHNAPPSCHUSS,
      async (tx: postgres.TransactionSql) =>
        /*
         * **Die Rechtefrage steht INNERHALB von `withTenant`** — und das ist
         * keine Stilfrage. `app.hat_recht` fragt `app.aktueller_benutzer()`,
         * und den setzt erst die Bindung. Auf einer ungebundenen Transaktion
         * antwortet jedes Recht `false`: die Route gab 404 „nicht gefunden",
         * obwohl die Seite daneben den Knopf zeigte, weil SIE gebunden
         * geprüft hatte. Ein Fehlschlag, der wie ein fehlender Bericht
         * aussieht und eine fehlende Bindung ist.
         */
        withTenant(tx, sitzung, async (kontext) => {
          await authorize(
            sitzung,
            { recht: 'bericht.exportieren', mandantId: sitzung.aktiverMandantId },
            rechtepruefer(kontext.abfrage.bind(kontext)),
          );
          const [uhr] = await kontext.abfrage<{ heute: string; name: string; slug: string }>(
            `select app.berlin_heute()::text as heute,
                    (select m.name from mandant m where m.id = app.aktiver_mandant()) as name,
                    (select m.slug from mandant m where m.id = app.aktiver_mandant()) as slug`);
          /*
           * `?mandant=` formt nur den Dateinamen — gelesen wird der Bereich
           * aus der SITZUNG (Invariante 3). Stimmt der Hinweis in der Adresse
           * nicht mit ihr überein, ist die Adresse aus einer anderen Sitzung
           * kopiert; dann kommt 404 wie bei jeder fremden Zeile (AUT-06),
           * statt einer Datei mit dem falschen Namen im Downloads-Ordner.
           */
          const gewuenscht = suche.get('mandant');
          if (gewuenscht !== null && gewuenscht !== uhr!.slug) {
            throw new NichtGefundenFehler(`Fremder Bereich ${gewuenscht}`);
          }
          const jahr = jahrAus(suche.get('jahr'), uhr!.heute);
          const { zeilen, spalten, zeitraum } = await zeilenUndSpalten(
            bericht, kontext, jahr, koernungAus(suche.get('koernung')),
          );
          return {
            csv: alsCsv(spalten, zeilen as readonly never[]),
            name: dateiname(NAMEN[bericht], uhr!.name ?? 'Bereich', zeitraum),
          };
        }))) as { csv: string; name: string };

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        // Eine Auswertung ist kein Dokument, das ein Zwischenspeicher halten
        // soll: sie ist morgen anders, und sie enthält Zahlen.
        'cache-control': 'no-store',
      },
    });
  } catch (fehler) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'nicht_angemeldet' }, { status: 401 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }
}
