import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { withTenant } from '@/server/kontext/index';
import { waehleSpeicher } from '@/server/storage/waehle';
import { ExportFehler, erzeugeDatevExport }
  from '@/server/services/buchhaltung/datev/export';

/**
 * `POST /api/buchhaltung/datev` — einen EXTF-Buchungsstapel erzeugen
 * (ACC-02, PR 60).
 *
 * **Die Route erzeugt, sie sendet nicht.** Es gibt keinen DATEV-Endpunkt und
 * keine Zugangsdaten; wer die Datei dem Steuerbüro gibt, ist ein Mensch.
 *
 * **Sie verweigert laut.** Fehlen die O-05-Stammdaten oder steht eine
 * Buchungszeile ohne Beleg im Zeitraum, kommt 422 mit dem deutschen Satz aus
 * der Datenbank — nie eine Datei, die zur Hälfte stimmt. Der Knopf im Portal
 * ist in diesen Fällen ohnehin aus; diese Prüfung ist die zweite Linie, weil
 * ein ausgegrauter Knopf eine Bitte ist und kein Riegel.
 *
 * **`erzeugtAm` kommt aus der SERVERUHR, hier und nirgends sonst**
 * (Invariante 5). Der Schreiber selbst liest keine Uhr — sonst liessen sich
 * zwei Läufe nicht vergleichen (Abnahme 3).
 */
export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const slugRoh = daten.get('mandant');
  const slug = typeof slugRoh === 'string' ? slugRoh.replace(/[^a-z0-9-]/gu, '') : '';
  const text = (feld: string): string | null => {
    const w = daten.get(feld);
    return typeof w === 'string' && w.trim() !== '' ? w.trim() : null;
  };
  const von = text('von');
  const bis = text('bis');

  /*
   * **Ein Browser bekommt eine Seite, ein Programm bekommt JSON (D-599,
   * V-212).** Das Formular der Seite schickt `mandant` mit; eine Abweisung
   * führt dann zurück auf die Vorschau, mit dem Zeitraum und dem Grund als
   * Schlüssel (`?fehler=`), den die Seite über `eigenerEintrag()` in einen
   * Satz übersetzt. Vorher sah, wer einen Stapel über die Jahresgrenze
   * erzeugen wollte, eine weisse Seite mit einer geschweiften Klammer.
   */
  const abweisen = (grund: string, text: string, status: number): NextResponse => {
    if (slug === '') return NextResponse.json({ fehler: grund, text }, { status });
    const ziel = new URL(`/portal/${slug}/buchhaltung/datev/neu`, erwarteterUrsprung(anfrage));
    if (von !== null && ISO.test(von)) ziel.searchParams.set('von', von);
    if (bis !== null && ISO.test(bis)) ziel.searchParams.set('bis', bis);
    ziel.searchParams.set('fehler', grund);
    return NextResponse.redirect(ziel, 303);
  };

  if (von === null || bis === null || !ISO.test(von) || !ISO.test(bis)) {
    return abweisen('zeitraum', 'Von und Bis sind Pflicht, als JJJJ-MM-TT.', 400);
  }
  if (bis < von) {
    return abweisen('zeitraum', 'Das Ende liegt vor dem Anfang.', 400);
  }

  try {
    const ergebnis = await db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'buchhaltung.exportieren', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        return erzeugeDatevExport(
          kontext, waehleSpeicher(), von, bis,
          new Date(), sitzung.benutzerId);
      }));

    /*
     * **Ohne verbundenen Speicher kommt die DATEI zurueck, nicht ihre
     * Beschreibung.** `erzeugeDatevExport` gibt die Bytes gerade fuer
     * diesen Fall mit; die erste Fassung dieser Route liess sie fallen, und
     * der Stapel war erzeugt, gestempelt — und fuer niemanden abrufbar
     * (Copilot-Befund PR 12). Windows-1252 mit Komma, so liest DATEV sie.
     */
    if (ergebnis.dokumentId === null) {
      return new NextResponse(Buffer.from(ergebnis.bytes), {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=windows-1252',
          'content-disposition': `attachment; filename="${ergebnis.dateiname}"`,
          'x-cse-export-id': ergebnis.exportId,
          'x-cse-sha256': ergebnis.sha256,
          'cache-control': 'no-store',
        },
      });
    }
    /* Aus dem Formular der Seite (`mandant` gesetzt): auf den Stapel, nicht auf JSON. */
    if (slug !== '') {
      return NextResponse.redirect(
        new URL(`/portal/${slug}/buchhaltung/datev/${ergebnis.exportId}`, erwarteterUrsprung(anfrage)),
        303);
    }
    return NextResponse.json({
      exportId: ergebnis.exportId,
      zeilen: ergebnis.zeilen,
      sha256: ergebnis.sha256,
      dateiname: ergebnis.dateiname,
      formatUngeprueft: ergebnis.formatUngeprueft,
      archiviert: ergebnis.dokumentId !== null,
    });
  } catch (fehler) {
    const auth = autorisierungsAntwort(fehler);
    if (auth !== null) return auth;
    if (fehler instanceof ExportFehler) {
      /* Ein Zeitraum über zwei Wirtschaftsjahre ist eine falsche EINGABE (V-212). */
      return abweisen(fehler.grund, fehler.message,
        fehler.grund === 'wirtschaftsjahr' ? 400 : 422);
    }
    /*
     * Die fachlichen Riegel dieser Kette sind `raise exception` in der
     * Datenbank — unvollstaendige Stammdaten, eine Zeile ohne Beleg, ein
     * fehlendes Recht. Ihr Text ist auf Deutsch und fuer die pruefende Person
     * geschrieben; ihn durch ein generisches „Fehler" zu ersetzen hiesse, die
     * Arbeit der Riegel wegzuwerfen.
     */
    const meldung = fehler instanceof Error ? fehler.message : '';
    if (/Stammdaten|ohne Beleg oder ohne Konto|PLATZHALTER/u.test(meldung)) {
      return abweisen('nicht_bereit', meldung, 422);
    }
    throw fehler;
  }
}
