import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import {
  legeMediumAb, legeSchichtMediumAb, MedienFehler, MEDIEN_MAX_BYTES,
  pruefeMedienGroesse, verzoegerterSpeicher,
} from '@/server/services/zeit/medien';
import { aufDerSchicht, dienstFehlerAntwort, zurueckZu } from '../../bruecke';
import { grundAufsFormularweg } from '@/app/api/formular-antwort';
import { internesZiel } from '@/server/auth/ursprung';

/**
 * `POST /api/mein/schichten/[zuordnungId]/fotos` — eine Aufnahme von der
 * eigenen Schicht (TIM-10, DOC-03, DOC-06, LEG-10).
 *
 * **Die Reihenfolge IST die Sicherheit:**
 *
 *   1. Sitzung und Schicht — bevor ein Byte des Rumpfes verarbeitet wird.
 *   2. `content-length` — erspart, 400 MB entgegenzunehmen, um sie
 *      wegzuwerfen. Es kommt vom Absender und ist keine Zusage.
 *   3. Groesse auf den GELESENEN Bytes. Das ist die Zusage.
 *   4. Typ aus MAGIC BYTES, nie aus Name oder Content-Type.
 *   5. Metadaten entfernen — auf den Bytes, die gespeichert werden (LEG-10).
 *   6. ZEILE.
 *   7. Bucket, und zwar NOCH IN DER TRANSAKTION.
 *
 * Schritt 1 steht vorn und nicht hinten. Im Check-in-Weg stand die Pruefung
 * einmal am Ende — ein Fremder konnte damit 100 MiB je Anfrage in den privaten
 * Bucket legen (0095). Hier loest `aufDerSchicht` zuerst auf; eine fremde
 * Zuordnung antwortet 404, bevor irgendetwas geschrieben wird.
 *
 * **6 vor 7, anders als im Check-in-Weg**, und der Grund ist die Transaktion:
 * die angemeldete Sitzung hat eine, die Marke nicht (K-08). Scheitert das
 * Bucket, rollt alles zurueck — keine Zeile, kein Objekt, nichts aufzuraeumen.
 * `verzoegerterSpeicher` haelt die Bytes bis dahin zurueck; geschrieben wird
 * durch denselben echten Adapter, nur eine Anweisung spaeter.
 *
 * **Ist der Speicher nicht verbunden, entsteht KEINE Zeile** und die Antwort
 * sagt es (CLAUDE.md: keine Schein-Integrationen).
 *
 * **Der Bezug ist der `einsatz` dieser Schicht** — nicht der Zeiteintrag
 * (0303). `kunde_id` leitet der Ausloeser `kern.einsatz_medien_bezug_pruefen`
 * als Definer aus dem Elternteil ab; diese Route schickt sie nicht mit.
 *
 * **Offen, und deshalb hier nicht erfunden:**
 * // TODO(client, O-133): Wie viele Aufnahmen sind je Beweisart verpflichtend, und ab wann gilt ein Beweis als unvollstaendig?
 * // TODO(client, O-346): Wird HEIC vom Telefon angenommen oder vorher umgewandelt — heute laesst die me_mime-Bedingung es zu, der Browser zeigt es aber nicht ueberall an?
 */
export const dynamic = 'force-dynamic';

function fehlerAntwort(code: string, meldung: string, status: number): NextResponse {
  return NextResponse.json({ fehler: code, meldung }, { status });
}

export async function POST(
  anfrage: NextRequest,
  kontext: { params: Promise<{ zuordnungId: string }> },
): Promise<NextResponse> {
  const { zuordnungId } = await kontext.params;

  const angekuendigt = Number(anfrage.headers.get('content-length') ?? '0');
  if (Number.isFinite(angekuendigt) && angekuendigt > MEDIEN_MAX_BYTES) {
    /*
     * Ein Formular des Portals (V-198) bekommt seine Seite zurück — erkannt am
     * Rumpf `multipart/form-data`, denn gelesen wird der Rumpf gerade NICHT:
     * die Grösse wird geprüft, bevor die Datei im Speicher liegt.
     */
    if ((anfrage.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const ziel = internesZiel(
        `/portal/mein/schichten/${zuordnungId}/fotos`, '/portal/mein', anfrage);
      ziel.searchParams.set('fehler', 'zu_gross');
      return NextResponse.redirect(ziel, 303);
    }
    return fehlerAntwort('zu_gross',
      `Die Datei überschreitet ${String(MEDIEN_MAX_BYTES / 1_048_576)} MB.`, 413);
  }

  let daten: FormData;
  try {
    daten = await anfrage.formData();
  } catch {
    return fehlerAntwort('ungueltige_eingabe', 'Es wurde keine Datei übertragen.', 422);
  }
  const datei = daten.get('datei');
  if (!(datei instanceof File)) {
    return grundAufsFormularweg(anfrage, daten, 'keine_datei', 422);
  }

  /*
   * Der echte Adapter, hinter einem Puffer. Er schreibt erst, wenn die Zeile
   * steht — und wenn er dann wirft (nicht verbunden, Netz weg), nimmt die
   * Transaktion die Zeile wieder mit.
   */
  const speicher = verzoegerterSpeicher(waehleSpeicher());
  const medienId = randomUUID();
  const beschreibung = typeof daten.get('beschreibung') === 'string'
    ? (daten.get('beschreibung') as string).trim() : '';

  try {
    const ergebnis = await aufDerSchicht(anfrage, zuordnungId, async (k, bezug) => {
      const bytes = new Uint8Array(await datei.arrayBuffer());
      pruefeMedienGroesse(bytes.length);
      /*
       * Der Mandant fuehrt den Objektschluessel an, und er kommt aus der
       * SCHICHT — nie aus der Anfrage (K-02). Der Pfad bleibt eine reine
       * UUID-Folge (`me_pfad_uuid`) und verraet nichts ueber seinen Inhalt.
       *
       * `legeMediumAb` prueft, bereinigt und „legt ab" — in den Puffer.
       */
      const ablage = await legeMediumAb({
        mandantId: bezug.mandantId,
        medienId,
        daten: bytes,
        behaupteterTyp: datei.type === '' ? null : datei.type,
        aufgenommenAmGeraet: null,
        beschreibung: beschreibung === '' ? null : beschreibung,
      }, speicher);

      const id = await legeSchichtMediumAb(k, {
        einsatzId: bezug.einsatzId, medienId, ablage,
      });
      // Jetzt, und noch in der Transaktion: wirft es hier, gibt es auch die
      // Zeile gleich nicht mehr.
      await speicher.schreibeJetzt();
      return id;
    });
    if (ergebnis.art === 'antwort') return ergebnis.antwort;
  } catch (fehler: unknown) {
    if (fehler instanceof NichtVerbundenFehler) {
      return grundAufsFormularweg(anfrage, daten, 'nicht_verbunden', fehler.status);
    }
    if (fehler instanceof MedienFehler) {
      return grundAufsFormularweg(anfrage, daten, fehler.grund,
        fehler.grund === 'zu_gross' ? 413 : fehler.status);
    }
    const antwort = dienstFehlerAntwort(fehler, { anfrage, daten });
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return zurueckZu(daten, `/portal/mein/schichten/${zuordnungId}/fotos`, anfrage);
}
