import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { NichtVerbundenFehler, SupabaseSpeicher } from '@/server/storage/adapter';
import { legeMediumAb, MedienFehler, MEDIEN_MAX_BYTES } from '@/server/services/zeit/medien';
import {
  AufmassFehler, ZeilenFehler, erfasseAufmass, hefteFotoAn,
  type ZeileEingabe,
} from '@/server/services/bau/aufmass';

/**
 * `POST /api/bau/aufmasse` — ein Aufmassblatt aufnehmen (BAU-02, BAU-03).
 *
 * **Der Browser schickt die FORMEL, nie die Menge** (API-KARTE §C.15, Review
 * B18). Eine mitgelieferte Menge waere eine erfundene Zahl auf dem Weg in eine
 * Einheitspreisrechnung — genau der Ausfall, den Invariante 6 benennt. Der
 * Dienst ruft den Parser und speichert Formel UND Ergebnis.
 *
 * **Die Messfotos fahren mit.** BAU-03 verlangt sie, bevor ein Blatt vorgelegt
 * wird; sie hier anzunehmen statt in einem zweiten Schritt erspart den
 * Zustand „Blatt ohne Foto", in dem die Kraft die Baustelle schon verlassen
 * hat. Der Speicherweg ist der vorhandene: `legeMediumAb` prueft die Groesse,
 * erkennt den Typ aus den Magic Bytes, entfernt die Metadaten und legt in den
 * privaten Bucket (TIM-10, DOC-06) — nachgebaut wird nichts.
 *
 * **Ist der Speicher nicht verbunden, entsteht KEIN Blatt.** Kein
 * vorgetaeuschter Erfolg, keine Zeile ohne die Datei, auf die sie sich beruft
 * (CLAUDE.md: keine Schein-Integrationen).
 */
export const dynamic = 'force-dynamic';

function fehlerAntwort(code: string, meldung: string, status: number): NextResponse {
  return NextResponse.json({ fehler: code, meldung }, { status });
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const angekuendigt = Number(anfrage.headers.get('content-length') ?? '0');
  if (Number.isFinite(angekuendigt) && angekuendigt > MEDIEN_MAX_BYTES) {
    return fehlerAntwort('zu_gross',
      `Die Aufnahme überschreitet ${String(MEDIEN_MAX_BYTES / 1_048_576)} MB.`, 413);
  }

  let formular: FormData;
  try {
    formular = await anfrage.formData();
  } catch {
    return fehlerAntwort('ungueltige_eingabe', 'Es wurden keine Daten übertragen.', 422);
  }

  const text = (name: string): string => {
    const wert = formular.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };

  const projektId = text('projekt');
  const bezeichnung = text('bezeichnung');
  const messdatum = text('messdatum');
  const erhebungsart = text('erhebungsart') === 'einseitig' ? 'einseitig' : 'gemeinsam';
  if (projektId === '' || bezeichnung === '' || !/^\d{4}-\d{2}-\d{2}$/u.test(messdatum)) {
    return fehlerAntwort('ungueltige_eingabe',
      'Projekt, Bezeichnung und Messdatum sind Pflicht.', 422);
  }

  /**
   * Die Zeilen kommen auf ZWEI Wegen herein, und beide muendeten in dieselbe
   * Pruefung:
   *
   *  - **flach** (`zeile_rechenansatz_0` …) aus dem Formular des Portals, das
   *    ohne JavaScript auskommt — es wird auf einem Telefon im Rohbau benutzt,
   *    und eine Seite, die erst nach einem Skriptdownload absendet, sendet
   *    dort gar nicht ab;
   *  - **als JSON** in `zeilen`, fuer Aufrufer mit mehr als drei Zeilen.
   *
   * Die MENGE ist in keiner der beiden Formen vorgesehen: ein Feld dieses
   * Namens wird ignoriert, nie uebernommen (Invariante 6, Review B18).
   */
  const zeilen: ZeileEingabe[] = [];
  if (text('zeilen') !== '') {
    try {
      const roh = JSON.parse(text('zeilen')) as unknown;
      if (!Array.isArray(roh)) throw new Error('keine Liste');
      for (const z of roh) {
        const zeile = z as Record<string, unknown>;
        zeilen.push({
          bezeichnung: typeof zeile['bezeichnung'] === 'string' ? zeile['bezeichnung'] : '',
          rechenansatz: typeof zeile['rechenansatz'] === 'string' ? zeile['rechenansatz'] : '',
          einheit: typeof zeile['einheit'] === 'string' ? zeile['einheit'] : '',
          lvPositionId:
            typeof zeile['lv_position_id'] === 'string' && zeile['lv_position_id'] !== ''
              ? zeile['lv_position_id'] : null,
          ausserhalbLv: zeile['ausserhalb_lv'] === true
            || typeof zeile['lv_position_id'] !== 'string' || zeile['lv_position_id'] === '',
          uebermessungHinweis:
            typeof zeile['uebermessung_hinweis'] === 'string'
              ? zeile['uebermessung_hinweis'] : null,
          bemerkung: typeof zeile['bemerkung'] === 'string' ? zeile['bemerkung'] : null,
        });
      }
    } catch {
      return fehlerAntwort('ungueltige_eingabe', 'Die Zeilen liessen sich nicht lesen.', 422);
    }
  } else {
    for (let n = 0; n < 50; n += 1) {
      const rechenansatz = text(`zeile_rechenansatz_${String(n)}`);
      // Eine leere Zeile ist eine nicht benutzte Zeile des Formulars, kein
      // Fehler — das Formular bringt drei mit, und selten sind alle drei voll.
      if (rechenansatz === '') continue;
      const lv = text(`zeile_lv_${String(n)}`);
      zeilen.push({
        bezeichnung: text(`zeile_bezeichnung_${String(n)}`),
        rechenansatz,
        einheit: text(`zeile_einheit_${String(n)}`),
        lvPositionId: lv === '' ? null : lv,
        ausserhalbLv: lv === '',
        uebermessungHinweis: null,
        bemerkung: null,
      });
    }
  }

  // Erst die Dateien in den Bucket, dann die Zeilen — und wenn die Zeilen
  // scheitern, liegt hoechstens ein Objekt zu viel im Bucket, nie eine Zeile
  // ohne Datei.
  const dateien = formular.getAll('fotos').filter((d): d is File => d instanceof File);
  const speicher = new SupabaseSpeicher();
  const ablagen: {
    readonly medienId: string;
    readonly ablage: Awaited<ReturnType<typeof legeMediumAb>>;
  }[] = [];

  try {
    for (const datei of dateien) {
      const medienId = randomUUID();
      const ablage = await legeMediumAb({
        mandantId: sitzung.aktiverMandantId,
        medienId,
        daten: new Uint8Array(await datei.arrayBuffer()),
        behaupteterTyp: datei.type === '' ? null : datei.type,
      }, speicher);
      ablagen.push({ medienId, ablage });
    }
  } catch (fehler: unknown) {
    if (fehler instanceof NichtVerbundenFehler) {
      return fehlerAntwort(fehler.code,
        'Der Medienspeicher ist nicht verbunden. Es wurde NICHTS gespeichert.', fehler.status);
    }
    if (fehler instanceof MedienFehler) {
      return fehlerAntwort(fehler.grund, fehler.message,
        fehler.grund === 'zu_gross' ? 413 : fehler.status);
    }
    throw fehler;
  }

  let angelegt: { readonly id: string; readonly nummer: string };
  try {
    angelegt = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /**
         * `bau.aufmass_erfassen` — das Recht der Kraft vor Ort (§1.7), nicht
         * `bau.schreiben`. Wer ein Aufmass aufnimmt, pflegt damit noch kein
         * Leistungsverzeichnis.
         */
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
          { recht: 'bau.aufmass_erfassen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const kopf = await erfasseAufmass(kontext, {
          projektId,
          bezeichnung,
          bereich: text('bereich') === '' ? null : text('bereich'),
          messdatum,
          erhebungsart,
          ankuendigungAm: /^\d{4}-\d{2}-\d{2}$/u.test(text('ankuendigung_am'))
            ? text('ankuendigung_am') : null,
          zeilen,
        });

        for (const { medienId, ablage } of ablagen) {
          await kontext.schreibe(
            `insert into einsatz_medien (id, mandant_id, bezug_tabelle, bezug_id, art, bucket,
                                         pfad, mime_typ, groesse_bytes, sha256,
                                         erstellt_von, erstellt_von_person_id)
             values ($1, $2, 'aufmass', $3, $4::medien_art, $5, $6, $7, $8, $9,
                     app.aktueller_benutzer(), app.aktuelle_person())`,
            [
              medienId, kontext.aktiverMandantId, kopf.id, ablage.art, ablage.bucket,
              ablage.pfad, ablage.mimeTyp, ablage.groesseBytes, ablage.sha256,
            ],
          );
          await hefteFotoAn(kontext, { aufmassId: kopf.id, medienId, zweck: 'nachweis' });
        }
        return kopf;
      }))) as { readonly id: string; readonly nummer: string };
  } catch (fehler: unknown) {
    if (fehler instanceof ZeilenFehler) {
      return NextResponse.json({
        fehler: 'rechenansatz', zeile: fehler.reihenfolge, grund: fehler.grund,
        offset: fehler.offset, meldung: fehler.message,
      }, { status: 422 });
    }
    if (fehler instanceof AufmassFehler) {
      return fehlerAntwort(fehler.grund, fehler.message,
        fehler.grund === 'nicht_gefunden' ? 404 : fehler.status);
    }
    if (fehler instanceof NichtGefundenFehler) {
      return fehlerAntwort('nicht_gefunden', 'Nicht gefunden.', 404);
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return fehlerAntwort('keine_sitzung', 'Keine Sitzung.', 401);
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return fehlerAntwort('zweiter_faktor', 'Zweiter Faktor nötig.', 403);
    }
    throw fehler;
  }

  const mandant = text('mandant');
  if (mandant !== '') {
    return NextResponse.redirect(internesZiel(
      text('zurueck') === '' ? null : text('zurueck'),
      `/portal/${mandant}/bau/projekte/${projektId}/aufmass/${angelegt.id}`,
      anfrage,
    ), 303);
  }
  return NextResponse.json({ id: angelegt.id, nummer: angelegt.nummer }, { status: 201 });
}
