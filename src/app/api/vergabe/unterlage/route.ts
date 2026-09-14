import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { NichtVerbundenFehler, SupabaseSpeicher, type Bucket } from '@/server/storage/adapter';
import { ladeHoch } from '@/server/services/dokument/upload';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/vergabe/unterlage` — eine geforderte Unterlage beilegen
 * (RAD-07, DOC-01, DOC-03).
 *
 * **Die Reihenfolge ist die Sicherheit** und steht in `services/dokument/upload`:
 * Grösse, dann Typ aus den Magic Bytes, dann Metadaten entfernen, dann
 * speichern. Ein Angebotsschreiben als PDF trägt Autor und Pfad des Rechners,
 * auf dem es entstand; das gehört nicht in einen Bucket, aus dem irgendwann
 * jemand ein Prüfbündel zieht.
 *
 * **Beigelegt ist nicht geprüft** (D-492). Diese Route setzt `vorhanden` —
 * die Zusage „das ist das richtige Formblatt" ist ein zweiter, menschlicher
 * Schritt und zählt erst dann als erledigt.
 *
 * **Ohne Speicher passiert nichts, und die Antwort sagt es.** Kein Objekt im
 * Bucket, keine halbe Zeile in der Datenbank, keine erfundene Bestätigung.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

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
  const ausschreibung = text(daten, 'ausschreibung') ?? '';
  const position = text(daten, 'position') ?? '';
  const datei = daten.get('datei');
  if (!UUID.test(ausschreibung) || !UUID.test(position)) {
    return NextResponse.json({ fehler: 'unbekannte_position' }, { status: 400 });
  }
  const seite = `/portal/${mandant}/radar/${ausschreibung}/mappe`;
  const zurueck = (schluessel: string): NextResponse => NextResponse.redirect(
    internesZiel(`${seite}?fehler=${schluessel}`, seite, anfrage), 303);

  if (!(datei instanceof File) || datei.size === 0) {
    return zurueck('keine_datei');
  }

  /**
   * Scheitert nach dem Hochladen irgendetwas, wird das Objekt wieder entfernt
   * — eine Datei im Bucket, auf die keine Zeile zeigt, findet niemand wieder
   * und löscht niemand je (dasselbe Muster wie beim Belegupload).
   */
  const waise: { wert: { bucket: Bucket; pfad: string } | null } = { wert: null };

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung, { recht: 'vergabe.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        /**
         * **Die Ausschreibung aus der Anfrage wird GEPRUEFT, nicht nur
         * weitergereicht.**
         *
         * Vorher stand sie nur im Rueckweg: wer die Adresse von Ausschreibung
         * A oeffnete und eine gueltige Positionskennung aus Ausschreibung B
         * derselben Gesellschaft mitschickte, haengte das Dokument an B und
         * landete auf A. Beides war „erlaubt" — und zusammen falsch. Der Join
         * ueber `ausschreibung_vorgang` macht die beiden Angaben zu EINER
         * Bedingung.
         */
        const [p] = await kontext.abfrage<{ id: string; bezeichnung: string; stand: string }>(
          `select p.id, p.bezeichnung, m.status::text as stand
             from vergabemappe_position p
             join vergabemappe m on m.id = p.vergabemappe_id
             join ausschreibung_vorgang v on v.id = m.ausschreibung_vorgang_id
                                         and v.mandant_id = m.mandant_id
            where p.id = $1::uuid and p.mandant_id = $2::uuid
              and v.ausschreibung_id = $3::uuid
              and m.geloescht_am is null and v.geloescht_am is null`,
          [position, kontext.aktiverMandantId, ausschreibung]);
        if (p === undefined) throw new Error('unbekannte_position');
        if (p.stand === 'eingereicht' || p.stand === 'verworfen') throw new Error('gesperrt');

        const jetzt = await kontext.abfrage<{ jahr: number }>(
          /* Das Entstehungsjahr aus der DATENBANK, nie aus der Uhr des Prozesses
             (Invariante 5) — es entscheidet die Aufbewahrungsfrist. */
          `select extract(year from (now() at time zone 'Europe/Berlin'))::int as jahr`);

        const hoch = await ladeHoch({
          mandantId: kontext.aktiverMandantId,
          kategorie: 'vertrag',
          titel: p.bezeichnung,
          dateiname: datei.name,
          daten: new Uint8Array(await datei.arrayBuffer()),
          ...(datei.type === '' ? {} : { behaupteterTyp: datei.type }),
        }, new SupabaseSpeicher(), jetzt[0]?.jahr ?? new Date().getUTCFullYear());
        waise.wert = { bucket: hoch.bucket, pfad: hoch.objektSchluessel };

        await kontext.schreibe(
          `insert into dokument (id, mandant_id, kategorie, titel, mime_typ, mime_verifiziert,
                                 groesse_bytes, bucket, objekt_schluessel, exif_entfernt,
                                 aufbewahrung_bis, loeschsperre, entstanden_am, erstellt_von)
           values ($1, $2, 'vertrag', $3, $4, true, $5, $6, $7, $8, $9::date, $10,
                   (now() at time zone 'Europe/Berlin')::date, app.aktueller_benutzer())`,
          [hoch.dokumentId, kontext.aktiverMandantId, p.bezeichnung, hoch.mimeTyp,
            hoch.groesseBytes, hoch.bucket, hoch.objektSchluessel, hoch.exifEntfernt,
            hoch.aufbewahrungBis, hoch.loeschsperre]);
        await kontext.schreibe(
          `insert into dokument_version (id, mandant_id, dokument_id, version, objekt_schluessel,
                                         sha256, groesse_bytes, mime_typ, erstellt_von)
           values ($1, $2, $3, 1, $4, $5, $6, $7, app.aktueller_benutzer())`,
          [randomUUID(), kontext.aktiverMandantId, hoch.dokumentId, hoch.objektSchluessel,
            hoch.sha256, hoch.groesseBytes, hoch.mimeTyp]);

        /* `vorhanden`, nicht `geprueft`: die Datei liegt bei, mehr sagt sie nicht. */
        await kontext.schreibe(
          `update vergabemappe_position
              set dokument_id = $3::uuid, status = 'vorhanden',
                  geprueft_von = null, geprueft_am = null,
                  geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
            where id = $1::uuid and mandant_id = $2::uuid`,
          [position, kontext.aktiverMandantId, hoch.dokumentId]);

        waise.wert = null;   // Ab hier trägt die Datenbank das Objekt.
      }));
  } catch (fehler) {
    if (waise.wert !== null) {
      try {
        await new SupabaseSpeicher().entferne(waise.wert.bucket, waise.wert.pfad);
      } catch { /* Bleibt eine Waise — der Waisenlauf findet sie; der erste Fehler zählt. */ }
    }
    if (fehler instanceof NichtVerbundenFehler) return zurueck('speicher');
    if (fehler instanceof Error && fehler.message === 'unbekannte_position') {
      return zurueck('unbekannte_position');
    }
    if (fehler instanceof Error && fehler.message === 'gesperrt') return zurueck('eingereicht');
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    /* Ein abgewiesener Dateityp oder eine zu grosse Datei ist eine Auskunft, kein Absturz. */
    if (fehler instanceof Error) return zurueck('datei_abgewiesen');
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(`${seite}?vermerkt=beigelegt`, seite, anfrage), 303);
}
