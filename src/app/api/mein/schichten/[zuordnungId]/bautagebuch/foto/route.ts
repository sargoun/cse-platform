import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import {
  legeMediumAb, MedienFehler, MEDIEN_MAX_BYTES, pruefeMedienGroesse, verzoegerterSpeicher,
} from '@/server/services/zeit/medien';
import { findeOderLegeBautagAn, hefteTagesfotoAn } from '@/server/services/bau/bautagebuch';
import { aufDerSchicht, dienstFehlerAntwort, zurueckZu } from '../../../bruecke';
import { grundAufsFormularweg } from '@/app/api/formular-antwort';
import { internesZiel } from '@/server/auth/ursprung';

/**
 * `POST /api/mein/schichten/[zuordnungId]/bautagebuch/foto` — ein Tagesfoto
 * an den Bautag der eigenen Schicht (V-063, BAU-07, TIM-10).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: die Datenbank erlaubte es, und kein Weg führte hin.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das Arbeiterportal LISTETE die Tagesfotos seit je — und sie konnten dort nie
 * entstehen. `0303` legte eigens `t_selbst_schichtmedien` an und nennt darin
 * ausdrücklich `bezug_tabelle = 'bautagebuch'`; `hefteTagesfotoAn` stand im
 * Dienst. Die Kraft auf der Baustelle, die den Zustand am besten kennt und
 * das Telefon in der Hand hat, war die einzige, die kein Foto anhängen konnte.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Erst die Zeile, dann der Speicher — nie umgekehrt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dasselbe Muster wie `fotos/route.ts`: `verzoegerterSpeicher` puffert die
 * Datei, die Zeile entsteht in der Transaktion, und erst DANN wird
 * geschrieben — noch in der Transaktion. Wirft der Speicher (nicht verbunden,
 * Netz weg), nimmt die Transaktion die Zeile mit. Es gibt damit nie eine
 * Zeile ohne die Datei, auf die sie sich beruft.
 *
 * **Nicht verbunden heisst: NICHTS gespeichert, und das steht so da.** Ein
 * stiller Erfolg ohne Datei wäre der Fall, den niemand bemerkt, bis jemand im
 * Streit das Foto sucht.
 *
 * **Der Tag kommt aus der SCHICHT**, nicht aus dem Formular (K-02): Projekt
 * und Datum liefert `aufDerSchicht`. Ein Tag aus der Anfrage wäre die
 * Gelegenheit, ein Foto an einen fremden Bautag zu hängen.
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

  /* Die Grösse VOR dem Lesen — sonst liegt die ganze Datei schon im Speicher. */
  const angekuendigt = Number(anfrage.headers.get('content-length') ?? '0');
  if (Number.isFinite(angekuendigt) && angekuendigt > MEDIEN_MAX_BYTES) {
    /*
     * Ein Formular des Portals (V-198) bekommt seine Seite zurück — erkannt am
     * Rumpf `multipart/form-data`, denn gelesen wird der Rumpf gerade NICHT:
     * die Grösse wird geprüft, bevor die Datei im Speicher liegt.
     */
    if ((anfrage.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const ziel = internesZiel(
        `/portal/mein/schichten/${zuordnungId}/bautagebuch`, '/portal/mein', anfrage);
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

  const speicher = verzoegerterSpeicher(waehleSpeicher());
  const medienId = randomUUID();
  const roh = daten.get('beschreibung');
  const beschreibung = typeof roh === 'string' && roh.trim() !== '' ? roh.trim() : null;

  try {
    const ergebnis = await aufDerSchicht(anfrage, zuordnungId, async (k, bezug) => {
      /* Eine Schicht ohne Bauprojekt hat kein Bautagebuch. */
      if (bezug.projektId === null) return null;
      const bytes = new Uint8Array(await datei.arrayBuffer());
      pruefeMedienGroesse(bytes.length);

      /*
       * Der Mandant führt den Objektschlüssel an, und er kommt aus der
       * SCHICHT — nie aus der Anfrage (K-02).
       */
      const ablage = await legeMediumAb({
        mandantId: bezug.mandantId,
        medienId,
        daten: bytes,
        behaupteterTyp: datei.type === '' ? null : datei.type,
        aufgenommenAmGeraet: null,
        beschreibung,
      }, speicher);

      const tagId = await findeOderLegeBautagAn(k, bezug.projektId, bezug.vonDatum);
      await hefteTagesfotoAn(k, {
        bautagebuchId: tagId,
        medienId,
        art: ablage.art,
        bucket: ablage.bucket,
        pfad: ablage.pfad,
        mimeTyp: ablage.mimeTyp,
        groesseBytes: ablage.groesseBytes,
        sha256: ablage.sha256,
        beschreibung,
      });
      /* Jetzt, und noch in der Transaktion: wirft es, gibt es auch die Zeile nicht. */
      await speicher.schreibeJetzt();
      return medienId;
    });
    if (ergebnis.art === 'antwort') return ergebnis.antwort;
    if (ergebnis.wert === null) {
      return grundAufsFormularweg(anfrage, daten, 'kein_projekt', 422);
    }
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

  return zurueckZu(daten, `/portal/mein/schichten/${zuordnungId}/bautagebuch`, anfrage);
}
