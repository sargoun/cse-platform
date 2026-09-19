import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { ladeZuordnung } from '@/server/services/datenschutz/anfrage';
import {
  alsMarkdown, erstelleAuskunft, halteFest, type Auskunft,
} from '@/server/services/datenschutz/auskunft';

/**
 * `GET /api/datenschutz/auskunft?anfrage=&format=md|json` — die Art.-15-Auskunft
 * zum Aushändigen (LEG-09, Phase 7).
 *
 * Dieselbe Bauart wie `/api/datenschutz/verarbeitungsverzeichnis`: derselbe
 * Schnappschuss wie die Seite, Markdown für den Menschen und JSON für eine
 * Prüfung, jeder Abruf protokolliert und mit seinem SHA-256 im Kopf.
 *
 * **Und ein Unterschied, der alles ist: eine UNVOLLSTÄNDIGE Auskunft wird
 * nicht ausgeliefert.** `datenschutz.auskunft_erstellen` ist im Katalog
 * einzeln bindbar; ein Träger dieses einen Rechts sieht `zeiteintrag`,
 * `abwesenheit`, `nachweis`, `bewerbung` und `ansprechpartner` nicht, und die
 * Datenbank antwortet darauf korrekt mit null Zeilen. Eine Datei, die daraus
 * „keine Zeiteinträge vorhanden" macht, ist eine falsche Auskunft, die aussieht
 * wie eine richtige — und sie geht an die betroffene Person, nicht in ein
 * Protokoll.
 *
 * Deshalb: 409 mit der Liste der fehlenden Rechte. Der Vorgang bleibt offen,
 * ein Mensch mit den Rechten übernimmt, und die Frist des Art. 12 Abs. 3 läuft
 * sichtbar weiter — statt abgelaufen zu sein, weil jemand eine halbe Datei
 * verschickt hat.
 *
 * **Ausgeliefert wird nur, was auf dem Bildschirm stand** (Invariante 7). Die
 * Seite zeigt die Auskunft vollständig, dieser Abruf ist der Knopf darunter,
 * und die Aushändigung selbst bleibt der Mail- oder Downloadweg des Menschen:
 * die Route verschickt nichts von allein.
 */
export const dynamic = 'force-dynamic';

const FORMATE = ['md', 'json'] as const;
type Format = (typeof FORMATE)[number];

const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * **Die offene Aufbewahrungsfrist hält den Abruf auf, bis ein Mensch sie
 * bestätigt.**
 *
 * `fristText` gibt für 12 der 15 Abschnitte „Noch nicht entschieden — O-514"
 * zurück, und die Datei ging damit als `vollstaendig` hinaus: mit Prüfsumme,
 * mit dem Wort „Vollständig" und ohne die Pflichtangabe des Art. 15 Abs. 1
 * lit. d. Dieselbe Route verweigert die Auslieferung, wenn ein LESERECHT
 * fehlt, mit der Begründung, eine halbe Auskunft sehe aus wie eine Antwort —
 * das gilt hier genauso.
 *
 * **Warum eine Bestätigung und kein `vollstaendig = false`.** Das fehlende
 * Recht ist ein Mangel, den die Plattform beheben kann (das Recht erteilen);
 * die offene Frist ist eine Entscheidung, die dem Auftraggeber gehört und auf
 * die eine laufende Monatsfrist nicht warten kann. Art. 12 Abs. 3 läuft
 * weiter. Also: nicht sperren, sondern benennen — im Markdown als Warnblock
 * über allen Abschnitten, und hier als ausdrückliche Bestätigung, damit
 * niemand sie versehentlich hinausschickt.
 */
const FRISTEN_BESTAETIGT = 'bestaetigt';

export async function GET(anfrage: NextRequest): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const p = anfrage.nextUrl.searchParams;
  const anfrageId = p.get('anfrage') ?? '';
  const formatRoh = p.get('format') ?? 'md';
  if (!KENNUNG.test(anfrageId)
      || !(FORMATE as readonly string[]).includes(formatRoh)) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }
  const format = formatRoh as Format;

  try {
    /*
     * **Derselbe Schnappschuss wie die Seite.** Die Auskunft liest zwei Dutzend
     * Tabellen nacheinander; unter `read committed` saehe jede den Stand ihres
     * eigenen Augenblicks, und die Pruefsumme darunter bezeugte ZWEI Staende
     * als einen (D-589). `repeatable read` friert die Lesesicht ein und
     * erlaubt die Protokollzeile weiterhin.
     */
    const a = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
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
          { recht: 'datenschutz.auskunft_erstellen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const zuordnung = await ladeZuordnung(kontext, null, anfrageId);
        const auskunft = await erstelleAuskunft(
          kontext, anfrageId, zuordnung, new Date());

        /*
         * Festgehalten wird nur, was auch hinausgeht. Ein Artefakt fuer eine
         * Datei, die niemand bekommt, waere ein Nachweis ueber eine
         * Aushaendigung, die es nicht gab — und diese Tabelle ist genau der
         * Nachweis (SEC-A9).
         */
        const fristenBestaetigt =
          auskunft.offeneFristen.length === 0
          || p.get('fristen') === FRISTEN_BESTAETIGT;
        if (auskunft.vollstaendig && fristenBestaetigt) {
          await halteFest(kontext, auskunft, format);
          await kontext.schreibe(
            `select app.protokolliere('datenschutz.auskunft_abgerufen',
                                      'betroffenenanfrage', $1, null, $2::jsonb,
                                      app.aktiver_mandant())`,
            [anfrageId, {
              format, sha256: auskunft.sha256,
              abschnitte: auskunft.abschnitte.length, zeilen: auskunft.zeilen,
              /*
               * Dass jemand die offenen Fristen BESTAETIGT hat, gehoert ins
               * Protokoll und nicht nur in die Datei: es ist eine
               * Entscheidung eines Menschen ueber eine Pflichtangabe.
               */
              offeneFristen: auskunft.offeneFristen.length,
            }]);
        }
        return auskunft;
      }))) as Auskunft;

    if (a.betroffener.art === 'keine') {
      return NextResponse.json({
        fehler: 'ohne_zuordnung',
        meldung: 'Diese Anfrage ist keinem Datensatz zugeordnet. Ohne Zuordnung '
          + 'weiss niemand, wessen Daten auszugeben sind — und die naheliegende '
          + 'Abkürzung über die E-Mail-Adresse ist der Fehler, den Art. 12 '
          + 'Abs. 6 verhindern soll.',
      }, { status: 409 });
    }
    if (!a.vollstaendig) {
      return NextResponse.json({
        fehler: 'unvollstaendig',
        fehlendeRechte: a.fehlendeRechte,
        meldung: 'Diese Auskunft wäre unvollständig: für mindestens einen '
          + 'Abschnitt fehlen die Leserechte. Ausgeliefert wird sie nicht — eine '
          + 'halbe Art.-15-Auskunft sieht aus wie eine Antwort. Fehlende '
          + `Rechte: ${a.fehlendeRechte.join(', ')}.`,
      }, { status: 409 });
    }
    if (a.offeneFristen.length > 0
        && p.get('fristen') !== FRISTEN_BESTAETIGT) {
      return NextResponse.json({
        fehler: 'frist_offen',
        offeneFristen: a.offeneFristen,
        meldung: `Für ${String(a.offeneFristen.length)} von `
          + `${String(a.abschnitte.length)} Abschnitten ist die `
          + 'Aufbewahrungsfrist noch nicht entschieden (O-514). Art. 15 Abs. 1 '
          + 'lit. d verlangt die geplante Speicherdauer oder wenigstens die '
          + 'Kriterien. Die Auskunft nennt das jetzt sichtbar über allen '
          + 'Abschnitten; bestätigen Sie den Abruf mit '
          + '`fristen=bestaetigt`, wenn sie in dieser Form hinausgehen soll. '
          + `Betroffen: ${a.offeneFristen.join(', ')}.`,
      }, { status: 409 });
    }

    const datei = `auskunft-art15-${anfrageId}`;
    if (format === 'json') {
      return NextResponse.json({
        anfrageId: a.anfrageId,
        art: a.art,
        firma: a.firma,
        betroffener: { art: a.betroffener.art, name: a.betroffener.name },
        abschnitte: a.abschnitte,
        offeneFristen: a.offeneFristen,
        vollstaendig: a.vollstaendig,
        zeilen: a.zeilen,
        sha256: a.sha256,
        erstelltAm: a.erstelltAm,
      }, {
        status: 200,
        headers: {
          'content-disposition': `attachment; filename="${datei}.json"`,
          'x-cse-dokument-sha256': a.sha256,
          'cache-control': 'no-store',
        },
      });
    }
    return new NextResponse(alsMarkdown(a), {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${datei}.md"`,
        'x-cse-dokument-sha256': a.sha256,
        'cache-control': 'no-store',
      },
    });
  } catch (fehler: unknown) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }
}
