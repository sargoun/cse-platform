import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { withEingang } from '@/server/kontext/eingang';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { Felder, FormularFehler } from '@/lib/formular/schema';
import { ipHash, nimmAn, pruefeRatenlimit, RatenlimitFehler, istBot }
  from '@/server/services/lead/annahme';
import { bestaetige } from '@/server/services/lead/bestaetigung';
import { pruefeUpload } from '@/server/storage/mime';
import { ladeHoch } from '@/server/services/dokument/upload';
import { NichtVerbundenFehler, SupabaseSpeicher } from '@/server/storage/adapter';

/**
 * `POST /api/anfrage` — die oeffentliche Angebotsanfrage (REQ-01 … REQ-07).
 *
 * Bewusst offen (siehe `route-manifest.ts`): sie ist der Weg, auf dem jemand
 * ohne Konto anfragt. Was sie schuetzt, sind nicht Rechte des Aufrufers,
 * sondern Honigtopf, Ratenlimit, Validierung gegen die Formularversion und
 * ein Prinzipal, der schreiben und nicht lesen kann.
 *
 * **Die Route rechnet nichts und liest keine Tabelle selbst** (K-08): sie
 * ordnet zu — Kontext auf, Dienst rufen, Antwort bauen.
 */
export const dynamic = 'force-dynamic';

/** Formularschluessel je Bereich. Der Besucher waehlt den Bereich, nicht die Tabelle. */
const SCHLUESSEL: Readonly<Record<string, string>> = {
  reinigung: 'angebot_reinigung',
  security: 'angebot_security',
  bau: 'angebot_bau',
};

interface FormularZeile {
  id: string;
  mandant_id: string;
  schluessel: string;
  felder: unknown;
  datenschutz_hinweis_version: string;
}

function fehlerAntwort(status: number, meldung: string,
                       felder: Readonly<Record<string, string>> = {}): NextResponse {
  return NextResponse.json({ ok: false, meldung, felder }, { status });
}

export async function POST(anfrage: Request): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await anfrage.formData();
  } catch {
    return fehlerAntwort(400, 'Die Anfrage konnte nicht gelesen werden.');
  }

  const bereich = String(formData.get('bereich') ?? '');
  const schluessel = SCHLUESSEL[bereich];
  if (schluessel === undefined) {
    return fehlerAntwort(404, 'Für diesen Bereich gibt es kein Anfrageformular.');
  }

  // 1 — Honigtopf. VOR jeder Datenbankberührung: ein Bot soll nicht einmal
  // eine Abfrage kosten.
  if (istBot(formData.get('website') as string | null ?? undefined)) {
    // Dieselbe Antwort wie bei Erfolg. Wer erfährt, dass er erkannt wurde,
    // probiert das nächste Feld.
    return NextResponse.json({ ok: true, meldung: 'Vielen Dank für Ihre Anfrage.' });
  }

  const [formular] = await withOeffentlichLesen(schluessel);
  if (formular === undefined) {
    return fehlerAntwort(404, 'Für diesen Bereich gibt es kein Anfrageformular.');
  }

  const felderGeprueft = Felder.safeParse(formular.felder);
  if (!felderGeprueft.success) {
    // Eine kaputte Definition ist ein Fehler DES BETREIBERS, kein Eingabefehler.
    return fehlerAntwort(500, 'Das Formular ist derzeit nicht verfügbar.');
  }
  const felder = felderGeprueft.data;

  // 2 — die Attribution (REQ-07), aus dem Formular und dem Referer-Kopf.
  const s = (name: string): string | undefined => {
    const w = formData.get(name);
    return typeof w === 'string' && w !== '' ? w : undefined;
  };
  const attribution = {
    utmQuelle: s('utm_source'), utmMedium: s('utm_medium'),
    utmKampagne: s('utm_campaign'), utmBegriff: s('utm_term'),
    utmInhalt: s('utm_content'),
    referrer: anfrage.headers.get('referer') ?? undefined,
    landingPage: s('landing_page'),
  };

  // 3 — die Werte. Dateifelder gehören nicht in `daten`.
  const dateiSchluessel = new Set(felder.filter((f) => f.typ === 'datei').map((f) => f.schluessel));
  const werte: Record<string, unknown> = {};
  for (const [name, wert] of formData.entries()) {
    if (name === 'bereich' || name === 'website' || name.startsWith('utm_')
        || name === 'landing_page' || dateiSchluessel.has(name)) continue;
    if (typeof wert === 'string') werte[name] = wert;
  }

  // 4 — die Datei. MAGIC BYTES, nie der behauptete Typ (REQ-04, SEC-A6).
  let datei: { bytes: Uint8Array; name: string; mime: string } | null = null;
  for (const f of felder) {
    if (f.typ !== 'datei') continue;
    const roh = formData.get(f.schluessel);
    if (!(roh instanceof File) || roh.size === 0) continue;
    if (roh.size > f.maxBytes) {
      return fehlerAntwort(413, 'Die Datei ist zu gross.', { [f.schluessel]: f.fehlermeldung });
    }
    const bytes = new Uint8Array(await roh.arrayBuffer());
    try {
      const { mime } = pruefeUpload(bytes, roh.type);
      if (!f.mime.includes(mime)) {
        return fehlerAntwort(415, 'Dieser Dateityp ist nicht zugelassen.',
          { [f.schluessel]: f.fehlermeldung });
      }
      datei = { bytes, name: roh.name, mime };
    } catch {
      return fehlerAntwort(415, 'Dieser Dateityp ist nicht zugelassen.',
        { [f.schluessel]: f.fehlermeldung });
    }
  }

  const pfeffer = process.env['CSE_IP_PFEFFER'] ?? '';
  const rohIp = anfrage.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const hash = rohIp === '' || pfeffer === '' ? undefined : ipHash(rohIp, pfeffer);

  try {
    const ergebnis = await db().begin(async (tx: postgres.TransactionSql) =>
      withEingang(tx, formular.mandant_id, async (kontext) => {
        const abfrage = { unsafe: (q: string, w?: readonly unknown[]) => kontext.schreibe(q, w) };

        // 5 — Ratenlimit, in DERSELBEN Transaktion wie das Schreiben: getrennt
        // liesse ein Ansturm beliebig viele Anfragen zwischen Zählung und
        // INSERT durch.
        if (hash !== undefined) await pruefeRatenlimit(abfrage, hash, new Date());

        /**
         * Über `app.formular_zustaendigkeit` und nicht über die Tabelle.
         *
         * Der Eingangsprinzipal hält kein `formular.lesen` — sonst könnte er
         * auch fremde Einsendungen zurückholen. Die Definer-Funktion gibt genau
         * die zwei Felder heraus, die für den Lead nötig sind.
         */
        const [zust] = await kontext.abfrage<{ sla_stunden: number | null; besitzer: string }>(
          `select sla_stunden, besitzer from app.formular_zustaendigkeit($1)`,
          [formular.id],
        );

        /**
         * Das Leistungsverzeichnis (REQ-04) — in DERSELBEN Transaktion.
         *
         * `ladeHoch()` prueft Groesse und Magic Bytes noch einmal, entfernt
         * Metadaten und legt die Datei in einen PRIVATEN Bucket; einen
         * oeffentlichen gibt es nicht (DOC-03), und heraus kommt sie nur ueber
         * eine 15-Minuten-Signatur.
         *
         * Ist der Speicher nicht verbunden, wird die Anfrage ABGEWIESEN und
         * nicht ohne Datei gespeichert. Eine Anfrage, die ein
         * Leistungsverzeichnis erwaehnt und keines hat, kostet den Bauleiter
         * eine Rueckfrage und den Anfragenden das Vertrauen — und niemand
         * merkt, dass die Datei nie ankam.
         */
        let dokumentId: string | null = null;
        if (datei !== null) {
          const hoch = await ladeHoch(
            {
              mandantId: formular.mandant_id,
              kategorie: 'angebot',
              titel: `Leistungsverzeichnis ${datei.name}`,
              dateiname: datei.name,
              daten: datei.bytes,
              behaupteterTyp: datei.mime,
            },
            new SupabaseSpeicher(),
            new Date().getUTCFullYear(),
          );
          await kontext.schreibe(
            `insert into dokument (id, mandant_id, kategorie, titel, dateiname, mime_typ,
                                   mime_verifiziert, groesse_bytes, sha256, bucket,
                                   objekt_schluessel, exif_entfernt)
             values ($1, $2, 'angebot', $3, $4, $5, true, $6, $7, $8, $9, $10)`,
            [
              hoch.dokumentId, formular.mandant_id,
              `Leistungsverzeichnis ${datei.name}`, datei.name, hoch.mimeTyp,
              hoch.groesseBytes, hoch.sha256, hoch.bucket, hoch.objektSchluessel,
              hoch.exifEntfernt,
            ],
          );
          dokumentId = hoch.dokumentId;
        }

        const angenommen = await nimmAn(
          abfrage,
          {
            id: formular.id,
            mandantId: formular.mandant_id,
            schluessel: formular.schluessel,
            felder,
            datenschutzHinweisVersion: formular.datenschutz_hinweis_version,
            slaStunden: zust?.sla_stunden ?? null,
            standardBesitzerBenutzerId: zust!.besitzer,
          },
          {
            werte, attribution,
            ...(hash === undefined ? {} : { ip: hash }),
            userAgent: anfrage.headers.get('user-agent') ?? undefined,
            ...(datei === null || dokumentId === null
              ? {}
              : { datei: { dokumentId, dateiname: datei.name } }),
          },
        );

        /**
         * Die Bestaetigung geht durch `gate()` — hier ohne Freigabe und ohne
         * Richtlinie. Das Tor ist fail-closed, also wird sie NICHT gesendet,
         * sondern als verweigerter Versand protokolliert. Genau so soll es
         * sein, bis jemand eine Richtlinie fuer `email_senden` pflegt: lieber
         * keine Bestaetigung als eine automatische Mail, die niemand vorsah.
         */
        const empfaenger = typeof werte['email'] === 'string' ? werte['email'] : '';
        if (empfaenger !== '') {
          await bestaetige(abfrage, {
            mandantId: formular.mandant_id,
            empfaenger,
            firma: bereich,
            leadnummer: angenommen.leadnummer,
            slaFristAm: angenommen.slaFristAm,
          }, null, null);
        }

        return angenommen;
      })) as Awaited<ReturnType<typeof nimmAn>>;

    return NextResponse.json({
      ok: true,
      meldung: 'Vielen Dank für Ihre Anfrage.',
      leadnummer: ergebnis.leadnummer,
    });
  } catch (fehler) {
    if (fehler instanceof RatenlimitFehler) return fehlerAntwort(429, fehler.message);
    // Kein simulierter Erfolg: der Speicher ist nicht verbunden, und das steht
    // in der Antwort statt in einem Logfile.
    if (fehler instanceof NichtVerbundenFehler) {
      return fehlerAntwort(
        503,
        'Der Datei-Upload ist derzeit nicht verfügbar. Bitte senden Sie die Anfrage '
        + 'ohne Leistungsverzeichnis — wir melden uns und holen die Datei nach.',
      );
    }
    if (fehler instanceof FormularFehler) {
      return fehlerAntwort(400, fehler.message, fehler.felder);
    }
    return fehlerAntwort(500, 'Die Anfrage konnte nicht gespeichert werden.');
  }
}

/** Die veroeffentlichte Formularversion — als Renderer, also nur lesend. */
async function withOeffentlichLesen(schluessel: string): Promise<readonly FormularZeile[]> {
  return db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, async (kontext) =>
      kontext.abfrage<FormularZeile>(
        `select id, mandant_id, schluessel, felder, datenschutz_hinweis_version
           from formular_definition
          where schluessel = $1
            and veroeffentlicht_am is not null and zurueckgezogen_am is null`,
        [schluessel],
      ))) as Promise<readonly FormularZeile[]>;
}
