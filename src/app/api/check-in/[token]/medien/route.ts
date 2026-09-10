import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { NichtVerbundenFehler, SupabaseSpeicher } from '@/server/storage/adapter';
import {
  legeMediumAb, MedienFehler, MEDIEN_MAX_BYTES, pruefeMedienGroesse,
} from '@/server/services/zeit/medien';
import { KeinBenutzerkontoFuerMediumFehler, nimmClaimAn } from '@/server/services/zeit/offline';

/**
 * `POST /api/check-in/[token]/medien` — ein Foto oder Video von der Schicht
 * (TIM-10, DOC-06).
 *
 * **Warum diese Route auf der VORHANDENEN K-08-Zeile faehrt und keine sechste
 * mintet.** `05-API-KARTE.md` §C.3 nennt sie mit Prinzipal `cse_checkin`, und
 * K-08 fuehrt fuer diese Rolle genau zwei Funktionen: `checkin_verbrauchen`
 * und `offline_ereignis_annehmen`. Das Register ist GESCHLOSSEN, und es in
 * einem PR zu erweitern, der es nicht muss, ist der Anfang davon, dass es
 * keins mehr ist (D-135). Also faehrt die Aufnahme als das, was sie ohnehin
 * ist: ein Ereignis der Warteschlange, `art = 'foto'` — ein Wert, den
 * `offline_ereignis_art` von Anfang an fuehrt. Die Funktion loest Mandant,
 * Beschaeftigung und Mensch aus der Marke auf und schreibt in derselben
 * Transaktion die `einsatz_medien`-Zeile.
 *
 * **Die Reihenfolge ist die Sicherheit:** Groesse → Typ aus Magic Bytes →
 * Metadaten entfernen → Bucket → Zeile. Und wenn die Zeile scheitert, wird das
 * Objekt WIEDER ENTFERNT: eine Datei ohne Zeile ist eine, die niemand
 * erreichen und niemand verantworten kann — ein Leck, kein geretteter Upload.
 *
 * **Ist der Speicher nicht verbunden, sagt die Antwort das.** Es wird kein
 * Erfolg vorgetaeuscht und keine Zeile geschrieben (CLAUDE.md: keine
 * Schein-Integrationen).
 */
export const dynamic = 'force-dynamic';

function ipAus(anfrage: NextRequest): string | null {
  const kopf = anfrage.headers.get('x-forwarded-for');
  const erste = kopf?.split(',')[0]?.trim();
  return erste === undefined || erste === '' ? null : erste;
}

function fehlerAntwort(code: string, meldung: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message: meldung } }, { status });
}

export async function POST(
  anfrage: NextRequest,
  kontext: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await kontext.params;
  if (token === '' || token.length > 512) {
    return fehlerAntwort('ungueltiger_zustand', 'Dieser Link ist nicht gültig.', 409);
  }

  /**
   * `content-length` ZUERST — es kommt vom Absender und ist deshalb keine
   * Zusage, erspart aber, 400 MB entgegenzunehmen, nur um sie wegzuwerfen. Die
   * Zusage ist die zweite Pruefung auf den tatsaechlich gelesenen Bytes.
   */
  const angekuendigt = Number(anfrage.headers.get('content-length') ?? '0');
  if (Number.isFinite(angekuendigt) && angekuendigt > MEDIEN_MAX_BYTES) {
    return fehlerAntwort('zu_gross',
      `Die Datei überschreitet ${String(MEDIEN_MAX_BYTES / 1_048_576)} MB.`, 413);
  }

  let formular: FormData;
  try {
    formular = await anfrage.formData();
  } catch {
    return fehlerAntwort('ungueltige_eingabe', 'Es wurde keine Datei übertragen.', 422);
  }

  const datei = formular.get('datei');
  if (!(datei instanceof File)) {
    return fehlerAntwort('ungueltige_eingabe', 'Es wurde keine Datei übertragen.', 422);
  }

  const daten = new Uint8Array(await datei.arrayBuffer());
  const speicher = new SupabaseSpeicher();
  const medienId = randomUUID();
  const clientEreignisId = (() => {
    const roh = formular.get('client_ereignis_id');
    return typeof roh === 'string' && roh !== '' ? roh : randomUUID();
  })();

  let ablage: Awaited<ReturnType<typeof legeMediumAb>>;
  try {
    pruefeMedienGroesse(daten.length);
    ablage = await legeMediumAb({
      /**
       * Der Mandant fuehrt den Objektschluessel an — und er ist hier eine
       * PLATZHALTER-UUID, weil die Route ihn nicht kennen darf: er kommt aus
       * der Marke, und die loest erst die Datenbank auf (K-08). Die Zeile
       * traegt den echten; der Pfad bleibt eine reine UUID-Folge und verraet
       * ohnehin nichts.
       */
      mandantId: medienId,
      medienId,
      daten,
      behaupteterTyp: datei.type === '' ? null : datei.type,
      aufgenommenAmGeraet: (() => {
        const roh = formular.get('aufgenommen_am');
        if (typeof roh !== 'string') return null;
        const d = new Date(roh);
        return Number.isNaN(d.getTime()) ? null : d;
      })(),
      beschreibung: typeof formular.get('beschreibung') === 'string'
        ? (formular.get('beschreibung') as string) : null,
    }, speicher);
  } catch (fehler: unknown) {
    if (fehler instanceof NichtVerbundenFehler) {
      return fehlerAntwort(fehler.code,
        'Der Medienspeicher ist nicht verbunden. Die Aufnahme wurde NICHT gespeichert.',
        fehler.status);
    }
    if (fehler instanceof MedienFehler) {
      return fehlerAntwort(fehler.grund, fehler.message,
        fehler.grund === 'zu_gross' ? 413 : fehler.status);
    }
    throw fehler;
  }

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      nimmClaimAn(tx as never, {
        token,
        ereignisse: [{
          clientEreignisId,
          art: 'foto',
          behaupteteZeit: new Date(),
          medium: {
            art: ablage.art,
            bucket: ablage.bucket,
            pfad: ablage.pfad,
            mimeTyp: ablage.mimeTyp,
            groesseBytes: ablage.groesseBytes,
            sha256: ablage.sha256,
            aufgenommenAmGeraet: ablage.aufgenommenAmGeraet,
            beschreibung: ablage.beschreibung,
          },
        }],
        ip: ipAus(anfrage),
        userAgent: anfrage.headers.get('user-agent'),
      })) as Promise<Awaited<ReturnType<typeof nimmClaimAn>>>);

    return NextResponse.json({
      vorgang_id: ergebnis[0]?.vorgangId ?? null,
      mime_typ: ablage.mimeTyp,
      groesse_bytes: ablage.groesseBytes,
      // Die Zusage, die TIM-10 verlangt — und sie steht hier, weil die
      // Oberflaeche sie anzeigen soll: das Bild ist ohne Ortsdaten abgelegt.
      exif_entfernt: true,
    }, { status: 202 });
  } catch (fehler: unknown) {
    /**
     * Die Zeile ist nicht entstanden. Das Objekt liegt aber schon im Bucket —
     * also weg damit. Ein Objekt ohne Zeile ist unerreichbar, unauffindbar und
     * unverantwortbar; es „sicherheitshalber" liegen zu lassen sammelt genau
     * die personenbezogenen Bilder an, die niemand mehr loeschen kann.
     */
    try {
      await speicher.entferne(ablage.bucket, ablage.pfad);
    } catch {
      // Auch das kann scheitern. Dann bleibt ein verwaistes Objekt, und
      // `job:medien_waisen` ist die Stelle, die es meldet — verschwiegen wird
      // es nicht.
    }
    if (fehler instanceof KeinBenutzerkontoFuerMediumFehler) {
      return fehlerAntwort(fehler.code, fehler.message, fehler.status);
    }
    throw fehler;
  }
}
