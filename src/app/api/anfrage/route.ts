import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { withEingang } from '@/server/kontext/eingang';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { formularSchluessel } from '@/lib/formular/bereiche';
import { Felder, FormularFehler } from '@/lib/formular/schema';
import { istUebermittlung } from '@/lib/formular/uebermittlung';
import { ipHash, nimmAn, pruefeRatenlimit, RatenlimitFehler, istBot }
  from '@/server/services/lead/annahme';
import { bestaetige } from '@/server/services/lead/bestaetigung';
import { pruefeUpload } from '@/server/storage/mime';
import { ladeHoch } from '@/server/services/dokument/upload';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import { API_TEXTE } from '@/lib/i18n/texte';
import { uebersetzeFeldmeldungen } from '@/lib/i18n/formular-en';
import { mitSprache, SPRACHEN, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

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

/**
 * Die Sprache, in der geantwortet wird — aus dem Formular, nicht geraten.
 *
 * Sie reist als verstecktes Feld mit, weil eine Antwort in der falschen
 * Sprache genau dort verloren geht, wo jemand etwas kaufen wollte. `Accept-
 * Language` waere die falsche Quelle: sie sagt, was der Browser eingestellt
 * hat, nicht welche Seite der Besucher gerade vor sich hatte — und wer die
 * englische Fassung bewusst geoeffnet hat, will auch die englische Antwort.
 *
 * Ein unbekannter Wert faellt auf Deutsch zurueck und nicht auf einen Fehler:
 * die Anfrage soll ankommen.
 */
function spracheAus(formData: FormData): Sprache {
  const roh = String(formData.get('sprache') ?? '');
  return (SPRACHEN as readonly string[]).includes(roh) ? (roh as Sprache) : VORGABE_SPRACHE;
}

export async function POST(anfrage: Request): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await anfrage.formData();
  } catch {
    // Hier ist die Sprache noch unbekannt — der Koerper liess sich ja nicht
    // lesen. Die Vorgabe ist die einzige ehrliche Wahl.
    return fehlerAntwort(400, API_TEXTE[VORGABE_SPRACHE].unlesbar);
  }
  const sprache = spracheAus(formData);
  const t = API_TEXTE[sprache];

  const bereich = String(formData.get('bereich') ?? '');

  /**
   * **Ein Browser bekommt eine Seite, ein Programm bekommt JSON.**
   *
   * Das Formular hat kein JavaScript und traegt deshalb `antwort=seite`. Ohne
   * diese Weiche sah ein Besucher, dessen Eingabe die Pruefung nicht bestand,
   * `{"ok":false,…}` auf weissem Grund — und zwar an genau der Stelle, an der
   * er etwas kaufen wollte. Der Grund reist als TEXT in der Adresse zurueck
   * zum Formular, wo `AnfrageFormular` ihn als `role="alert"` ausgibt.
   *
   * **Warum ein Feld und nicht der `Accept`-Header.** Der Header eines
   * Formular-POST sieht je nach Browser verschieden aus; eine Weiche, die auf
   * ihn hoert, faellt irgendwann auf die falsche Seite. Das Feld sagt es
   * ausdruecklich — ein Programm schickt es nicht mit und bekommt JSON wie
   * bisher.
   *
   * 303 und nicht 302: nach einem POST soll der Browser GET folgen, und ein
   * Neuladen darf die Anfrage nicht ein zweites Mal senden.
   */
  const alsSeite = String(formData.get('antwort') ?? '') === 'seite';
  const antworteFehler = (status: number, meldung: string,
                          felder: Readonly<Record<string, string>> = {}): NextResponse => {
    if (!alsSeite) return fehlerAntwort(status, meldung, felder);
    /*
     * Kennt die Plattform den Bereich nicht, fuehrt ein Ruecksprung auf
     * `/angebot/<unbekannt>` selbst in ein 404. Dann lieber die Auswahlseite:
     * sie zeigt die vier Bereiche, und der Besucher findet von dort zurueck.
     */
    const ziel = formularSchluessel(bereich) === undefined
      ? '/angebot' : `/angebot/${bereich}`;
    /*
     * **Die FELDmeldungen reisen mit, nicht nur der Sammelsatz.**
     *
     * Der erste Entwurf dieser Weiche haengte nur `meldung` an die Adresse.
     * Damit las ein Besucher „Bitte pruefen Sie Ihre Eingaben" und nicht, WELCHE
     * — die JSON-Antwort davor hatte die Feldmeldungen einzeln getragen. Ein
     * Formular ohne JavaScript ist kein Grund, weniger zu sagen als vorher;
     * `AnfrageFormular` hat fuer genau das eine `fehler`-Eigenschaft, die jedes
     * Feld mit `aria-invalid` markiert und die Meldung darunter setzt.
     *
     * JSON in der Adresse und nicht ein eigener Parameter je Feld: die
     * Feldnamen kommen aus `formular_definition` und sind nicht im Voraus
     * bekannt.
     */
    const parameter = new URLSearchParams({ meldung });
    if (Object.keys(felder).length > 0) {
      parameter.set('felder', JSON.stringify(felder));
    }
    return NextResponse.redirect(new URL(
      `${mitSprache(ziel, sprache)}?${parameter.toString()}`, anfrage.url,
    ), 303);
  };

  const schluessel = formularSchluessel(bereich);
  if (schluessel === undefined) {
    return antworteFehler(404, t.keinFormular);
  }

  // 1 — Honigtopf. VOR jeder Datenbankberührung: ein Bot soll nicht einmal
  // eine Abfrage kosten.
  if (istBot(formData.get('website') as string | null ?? undefined)) {
    // Dieselbe Antwort wie bei Erfolg. Wer erfährt, dass er erkannt wurde,
    // probiert das nächste Feld.
    return NextResponse.json({ ok: true, meldung: t.dank });
  }

  const [formular] = await withOeffentlichLesen(schluessel);
  if (formular === undefined) {
    return antworteFehler(404, t.keinFormular);
  }

  const felderGeprueft = Felder.safeParse(formular.felder);
  if (!felderGeprueft.success) {
    // Eine kaputte Definition ist ein Fehler DES BETREIBERS, kein Eingabefehler.
    return antworteFehler(500, t.nichtVerfuegbar);
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
    /*
     * **Diese Liste ist die Uebermittlung, nicht das Formular.** Die
     * Validierung kennt nur Felder der `formular_definition` und weist alles
     * andere als „unbekanntes Feld" ab.
     *
     * **Und genau das ist passiert.** `antwort` kam mit D-599 als verstecktes
     * Feld dazu — die Weiche „Browser bekommt eine Seite" — und fehlte hier.
     * Die Folge war nicht ein Randfall, sondern: JEDE Absendung des Formulars
     * wurde abgewiesen, mit der Meldung „Bitte pruefen Sie die markierten
     * Felder" und einem Feldnamen, den es nicht gibt. Der Kommentar darueber
     * warnte woertlich davor („das eigene versteckte Feld haette jede
     * Absendung gebrochen"), und die Zeile wurde trotzdem vergessen.
     *
     * Gefunden hat es der Browserlauf, nicht der Typpruefer: ein Feldname ist
     * eine Zeichenkette, und eine vergessene Zeichenkette in einer Liste sieht
     * aus wie nichts.
     */
    if (istUebermittlung(name) || dateiSchluessel.has(name)) continue;
    if (typeof wert === 'string') werte[name] = wert;
  }

  // 4 — die Datei. MAGIC BYTES, nie der behauptete Typ (REQ-04, SEC-A6).
  let datei: { bytes: Uint8Array; name: string; mime: string } | null = null;
  for (const f of felder) {
    if (f.typ !== 'datei') continue;
    const roh = formData.get(f.schluessel);
    if (!(roh instanceof File) || roh.size === 0) continue;
    if (roh.size > f.maxBytes) {
      return antworteFehler(413, t.dateiZuGross, { [f.schluessel]: f.fehlermeldung });
    }
    const bytes = new Uint8Array(await roh.arrayBuffer());
    try {
      const { mime } = pruefeUpload(bytes, roh.type);
      if (!f.mime.includes(mime)) {
        return antworteFehler(415, t.dateityp,
          { [f.schluessel]: f.fehlermeldung });
      }
      datei = { bytes, name: roh.name, mime };
    } catch {
      return antworteFehler(415, t.dateityp,
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
          /**
           * Das Jahr des Ablagepfades kommt aus der DATENBANK.
           *
           * `new Date().getUTCFullYear()` stand hier und las die Uhr des
           * Prozesses in UTC: eine Anfrage, die am 31.12. um 23:30 Berliner
           * Zeit eingeht, laege damit im Ordner des FOLGENDEN Jahres — und
           * eine Aufbewahrungsfrist rechnet ab dem falschen (K-11).
           */
          const [jetzt] = await kontext.abfrage<{ jahr: number }>(
            `select extract(year from app.berlin_heute())::int as jahr`);
          const jahr = jetzt?.jahr;
          if (jahr === undefined) throw new Error('Kein Berliner Kalenderjahr aus der Datenbank.');
          const hoch = await ladeHoch(
            {
              mandantId: formular.mandant_id,
              kategorie: 'angebot',
              titel: `Leistungsverzeichnis ${datei.name}`,
              dateiname: datei.name,
              daten: datei.bytes,
              behaupteterTyp: datei.mime,
            },
            waehleSpeicher(),
            jahr,
          );
          /**
           * **`dokument` traegt weder `dateiname` noch `sha256`** — beide
           * Spalten gibt es nicht (0009: der Digest lebt in
           * `dokument_version`, weil eine zweite Fassung einen zweiten Digest
           * hat und eine Spalte am Kopf ihn ueberschriebe).
           *
           * Die Anweisung hier nannte sie trotzdem. Sie scheiterte damit
           * IMMER, wenn eine Datei mitkam und der Speicher verbunden war — und
           * genau dann erst: ohne Datei laeuft der Zweig nicht, ohne Speicher
           * bricht er vorher ab. Deshalb ist es nie jemandem aufgefallen,
           * obwohl es der Weg ist, auf dem ein Leistungsverzeichnis in die
           * Angebotsanfrage kommt (REQ-04). Gefunden hat es die Sitzung zu
           * PR 44 am gleichen Fehler in ihrem eigenen Dienst.
           */
          await kontext.schreibe(
            `insert into dokument (id, mandant_id, kategorie, titel, mime_typ,
                                   mime_verifiziert, groesse_bytes, bucket,
                                   objekt_schluessel, exif_entfernt)
             values ($1, $2, 'angebot', $3, $4, true, $5, $6, $7, $8)`,
            [
              hoch.dokumentId, formular.mandant_id,
              `Leistungsverzeichnis ${datei.name}`, hoch.mimeTyp,
              hoch.groesseBytes, hoch.bucket, hoch.objektSchluessel,
              hoch.exifEntfernt,
            ],
          );
          await kontext.schreibe(
            `insert into dokument_version (mandant_id, dokument_id, version,
                                           objekt_schluessel, sha256, groesse_bytes, mime_typ)
             values ($1, $2, 1, $3, $4, $5, $6)`,
            [
              formular.mandant_id, hoch.dokumentId, hoch.objektSchluessel,
              hoch.sha256, hoch.groesseBytes, hoch.mimeTyp,
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

    /*
     * **Ein Browser bekommt eine Seite, ein Programm bekommt JSON.**
     *
     * Das Formular traegt `antwort=seite` und hat kein JavaScript. Ohne diese
     * Weiche landete der Besucher auf `{"ok":true,…}` — direkt nachdem er um
     * ein Angebot gebeten hat. Die Leadnummer reist in der Adresse mit, damit
     * die Dankseite sie nennen kann: sie ist das einzige, womit er bei einem
     * Rueckruf auf seine Anfrage zeigen kann.
     *
     * 303 und nicht 302: nach einem POST soll der Browser GET folgen, und ein
     * Neuladen der Dankseite darf die Anfrage nicht ein zweites Mal senden.
     */
    if (String(formData.get('antwort') ?? '') === 'seite') {
      /*
       * **Die Sprache steht im PFAD, nicht in einem Parameter** (D-82): die
       * englische Fassung liegt unter `/en/…`, und ein `?sprache=en` auf der
       * deutschen Adresse waere eine zweite Wahrheit ueber dieselbe Seite.
       * `mitSprache` ist dieselbe Funktion, die auch jeder Verweis benutzt.
       */
      return NextResponse.redirect(new URL(
        `${mitSprache(`/angebot/${bereich}/danke`, sprache)}`
        + `?nr=${encodeURIComponent(ergebnis.leadnummer)}`,
        anfrage.url,
      ), 303);
    }

    return NextResponse.json({
      ok: true,
      meldung: t.dank,
      leadnummer: ergebnis.leadnummer,
    });
  } catch (fehler) {
    if (fehler instanceof RatenlimitFehler) return antworteFehler(429, fehler.message);
    // Kein simulierter Erfolg: der Speicher ist nicht verbunden, und das steht
    // in der Antwort statt in einem Logfile.
    if (fehler instanceof NichtVerbundenFehler) {
      return antworteFehler(503, t.uploadNichtVerbunden);
    }
    if (fehler instanceof FormularFehler) {
      /**
       * Die Feldmeldungen kommen aus `formular_definition` und sind deutsch
       * (D-83 — die Definition bleibt die eine Quelle der Validierung). Ein
       * englisches Formular bekam deshalb englische Beschriftungen und
       * daneben deutsche Fehler. Uebersetzt wird die ANZEIGE, aus derselben
       * Auflage, die die Beschriftungen liefert — es entsteht keine zweite
       * Validierung.
       */
      const felder = sprache === 'de'
        ? fehler.felder
        : uebersetzeFeldmeldungen(schluessel, fehler.felder);
      return antworteFehler(400, fehler.message, felder);
    }
    return antworteFehler(500, t.nichtGespeichert);
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
