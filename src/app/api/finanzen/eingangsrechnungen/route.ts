import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { anmeldungsAntwort, istBrowserFormular, ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { MimeFehler } from '@/server/storage/mime';
import { ExifFehler } from '@/server/storage/exif';
import { waehleSpeicher } from '@/server/storage/waehle';
import { ladeHoch } from '@/server/services/dokument/upload';
import { GeldFehler, cent, parseGeld } from '@/server/services/finanz/geld';
import { FreigabeFehler, erteileFreigabe } from '@/server/services/freigabe/erteilen';
import type { Bucket } from '@/server/storage/adapter';
import {
  EingangsrechnungFehler, buche, erfasseEingangsrechnung, freigebe, inPruefung,
  legeBelegAn, lehneAb, pruefeDublette, setzeSteuerzeile,
} from '@/server/services/finanz/eingangsrechnung';
import { ERechnungFehler, extrahiereERechnung }
  from '@/server/services/finanz/eingang/erechnung';
import { eingebetteteERechnung } from '@/server/services/finanz/eingang/pdf-anhang';
import { legeERechnungAb } from '@/server/services/finanz/eingang/ablage';
import { VorschlagFehler }
  from '@/server/services/finanz/eingang/vorschlag';
import type { ErfassenFehlerGrund } from '@/lib/i18n/verwaltung/finanzen/eingangsrechnungen';

/**
 * `POST /api/finanzen/eingangsrechnungen` — erfassen und weiterschieben
 * (FIN-14, ACC-03, ACC-05).
 *
 * **Die Reihenfolge ist die Sicherheit.** Erst die Dublettenprüfung, dann der
 * Speicher, dann die Zeilen: eine Rechnung, die es schon gibt, soll gar nicht
 * erst ein Objekt im Bucket hinterlassen. Und wenn der Belegspeicher nicht
 * verbunden ist, wird NICHTS geschrieben — eine Eingangsrechnung ohne ihr
 * Dokument wäre nach ACC-03 kein Beleg, sondern eine Behauptung.
 *
 * **Es gibt kein „trotzdem erfassen".** Eine Dublette ist genau der Weg zur
 * doppelten Zahlung; der eindeutige Index würde sie ohnehin abweisen. Die
 * Route sagt, dass die Rechnung schon da ist, statt es den Menschen im
 * Datenbankfehler suchen zu lassen.
 *
 * **Zurück auf `/neu` reist nur ein Grund** (`?fehler=<grund>`, D-769,
 * D-774). Bis dahin reiste an neun Stellen ein Satz als `?meldung=` mit —
 * feste Sätze, der Satz von `ERechnungFehler` (mit der Wurzel der
 * hochgeladenen Datei darin) und von `VorschlagFehler`, und die Warnung der
 * Dublettenprüfung mit der Rechnungsnummer, wie sie getippt war —, und die
 * Seite zeigte ihn roh, auch in einer englischen Sitzung deutsch. Den Satz hat
 * die Seite, in der Sprache der Sitzung.
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, pfad: string, such?: { readonly fehler: ErfassenFehlerGrund }):
NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(
    `/portal/${slug}/finanzen/eingangsrechnungen${pfad}`, erwarteterUrsprung(anfrage));
  for (const [k, v] of Object.entries(such ?? {})) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  const aktion = text('aktion') ?? 'erfassen';

  /**
   * **Was hochgeladen wurde, bevor die Transaktion stand.**
   *
   * `ladeHoch` schreibt in den Bucket, und der Bucket kennt kein Rollback.
   * Scheitert danach irgendetwas — die Dokumentzeile, die Erfassung, die
   * Steuerzeile —, rollt die Transaktion zurück und das Objekt bleibt: eine
   * Datei mit Rechnungsdaten, auf die keine Zeile zeigt, die niemand findet
   * und die deshalb auch niemand löscht.
   *
   * Deshalb wird der Schlüssel hier gemerkt und im `catch` entfernt. Dieselbe
   * Vorrichtung wie beim Schichtfoto (`api/check-in/[token]/medien`), und aus
   * demselben Grund.
   */
  /*
   * Ein HALTER und keine einfache Bindung: TypeScript verengt eine `let`-
   * Bindung, die nur innerhalb eines Rueckrufs zugewiesen wird, im `catch`
   * auf `null` — die Aufraeumung waere dann als toter Code weggeprueft.
   */
  const waise: { wert: { bucket: Bucket; pfad: string } | null } = { wert: null };

  try {
    if (aktion === 'erechnung') {
      return await liesERechnung(anfrage, sitzung, daten, waise);
    }
    if (aktion !== 'erfassen') {
      return await schiebeWeiter(anfrage, sitzung, aktion, text);
    }

    const lieferantId = text('lieferantId');
    const rechnungsnummer = text('rechnungsnummer');
    const rechnungsdatum = text('rechnungsdatum');
    const nettoRoh = text('netto');
    const steuerRoh = text('steuer');
    const steuergruppe = text('steuergruppe');
    if (lieferantId === null || rechnungsnummer === null || rechnungsdatum === null
        || nettoRoh === null || steuerRoh === null || steuergruppe === null) {
      return zurueck(anfrage, '/neu', { fehler: 'unvollstaendig' });
    }
    const netto = parseGeld(nettoRoh);
    const steuer = parseGeld(steuerRoh);

    const datei = daten.get('datei');
    const vorhandenerBeleg = text('belegId');
    const hatDatei = datei instanceof File && datei.size > 0;
    if (!hatDatei && vorhandenerBeleg === null) {
      return zurueck(anfrage, '/neu', { fehler: 'ohne_beleg' });
    }

    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'eingang.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        /* Erst prüfen, dann speichern — kein Objekt im Bucket für eine Zeile,
           die es gar nicht geben darf. */
        const dublette = await pruefeDublette(kontext, {
          lieferantId, rechnungsnummerLieferant: rechnungsnummer, rechnungsdatum,
        });
        /* Ohne die Warnung des Dienstes: sie wiederholte die getippte Rechnungsnummer (D-774). */
        if (dublette.istDublette) return zurueck(anfrage, '/neu', { fehler: 'dublette' });

        let belegId = vorhandenerBeleg;
        if (belegId === null && datei instanceof File) {
          const hoch = await ladeHoch({
            mandantId: kontext.aktiverMandantId,
            kategorie: 'buchhaltung',
            titel: `Eingangsrechnung ${rechnungsnummer}`,
            dateiname: datei.name,
            daten: new Uint8Array(await datei.arrayBuffer()),
            /* `exactOptionalPropertyTypes`: die Eigenschaft fehlt, statt
               `undefined` zu tragen — der Typ sagt „nicht behauptet", nicht
               „als undefiniert behauptet". */
            ...(datei.type === '' ? {} : { behaupteterTyp: datei.type }),
          }, waehleSpeicher(), Number(rechnungsdatum.slice(0, 4)));
          waise.wert = { bucket: hoch.bucket, pfad: hoch.objektSchluessel };

          await kontext.schreibe(
            `insert into dokument (id, mandant_id, kategorie, titel, mime_typ,
                                   mime_verifiziert, groesse_bytes, bucket,
                                   objekt_schluessel, exif_entfernt, aufbewahrung_bis,
                                   loeschsperre, entstanden_am, erstellt_von)
             values ($1, $2, 'buchhaltung', $3, $4, true, $5, $6, $7, $8, $9::date, $10,
                     $11::date, app.aktueller_benutzer())`,
            [hoch.dokumentId, kontext.aktiverMandantId,
             `Eingangsrechnung ${rechnungsnummer}`, hoch.mimeTyp, hoch.groesseBytes,
             hoch.bucket, hoch.objektSchluessel, hoch.exifEntfernt,
             hoch.aufbewahrungBis, hoch.loeschsperre, rechnungsdatum]);
          const versionId = randomUUID();
          await kontext.schreibe(
            `insert into dokument_version (id, mandant_id, dokument_id, version,
                                           objekt_schluessel, sha256, groesse_bytes,
                                           mime_typ, erstellt_von)
             values ($1, $2, $3, 1, $4, $5, $6, $7, app.aktueller_benutzer())`,
            [versionId, kontext.aktiverMandantId, hoch.dokumentId, hoch.objektSchluessel,
             hoch.sha256, hoch.groesseBytes, hoch.mimeTyp]);

          belegId = await legeBelegAn(kontext, {
            typ: 'eingangsrechnung', quelle: 'upload',
            dokumentId: hoch.dokumentId, dokumentVersionId: versionId,
            dateiSha256: hoch.sha256, belegdatum: rechnungsdatum,
            betragBruttoCent: cent(netto + steuer),
          });
        }

        const id = await erfasseEingangsrechnung(kontext, {
          belegId: belegId!,
          lieferantId,
          rechnungsnummerLieferant: rechnungsnummer,
          rechnungsdatum,
          leistungsdatum: text('leistungsdatum'),
          nettoCent: netto,
          steuerCent: steuer,
          bruttoCent: cent(netto + steuer),
          faelligAm: text('faelligAm'),
        });
        await setzeSteuerzeile(kontext, {
          eingangsrechnungId: id, steuergruppe, nettoCent: netto, steuerCent: steuer,
        });

        waise.wert = null;   // Ab hier trägt die Datenbank das Objekt.
        return zurueck(anfrage, `/${id}`);
      }))) as NextResponse;
  } catch (fehler) {
    if (waise.wert !== null) {
      try {
        await waehleSpeicher().entferne(waise.wert.bucket, waise.wert.pfad);
      } catch {
        /*
         * Auch das Aufräumen kann scheitern — dann bleibt ein verwaistes
         * Objekt. Verschwiegen wird es nicht: es steht in keiner Zeile, und
         * genau danach sucht der Waisenlauf. Den ursprünglichen Fehler
         * verdeckt es hier auf keinen Fall.
         */
      }
    }
    return uebersetze(fehler, anfrage, {
      /* Eines der zwei Formulare auf `/neu` — Erfassung oder E-Rechnung —, von einem Browser geschickt. */
      neuFormular: (aktion === 'erfassen' || aktion === 'erechnung')
        && istBrowserFormular(anfrage, daten),
    });
  }
}

/**
 * **Der E-Rechnungs-Weg** (ACC-05, PR 63): XML (XRechnung als UBL oder CII)
 * oder ein PDF mit eingebetteter `factur-x.xml` (ZUGFeRD). Die Datei wird
 * abgelegt wie jeder Beleg — Dokument, Version, Beleg —, und daraus entsteht
 * KEINE Eingangsrechnung, sondern ein Vorschlag im Freigabe-Posteingang, mit
 * jedem Feld, seiner Quelle und seiner Konfidenz. Erst die Genehmigung
 * schreibt die Rechnung (Invariante 7).
 *
 * **Kein OCR.** Ein PDF ohne eingebettete XML wird nicht gespeichert und
 * nicht geraten; die Antwort sagt, dass die Belegerkennung fuer Scans keinen
 * Anbieter hat (O-135) und die Rechnung von Hand zu erfassen ist.
 */
async function liesERechnung(
  anfrage: NextRequest,
  sitzung: NonNullable<Awaited<ReturnType<typeof aktuelleSitzung>>>,
  daten: FormData,
  waise: { wert: { bucket: Bucket; pfad: string } | null },
): Promise<NextResponse> {
  const datei = daten.get('datei');
  if (!(datei instanceof File) || datei.size === 0) {
    return zurueck(anfrage, '/neu', { fehler: 'erechnung_fehlt' });
  }
  const bytes = new Uint8Array(await datei.arrayBuffer());
  const istPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

  let xml: string;
  let dateiname = datei.name;
  if (istPdf) {
    const anhang = await eingebetteteERechnung(bytes);
    if (anhang === null) {
      return zurueck(anfrage, '/neu', { fehler: 'keine_erechnung' });
    }
    xml = anhang.xml;
    dateiname = `${datei.name} › ${anhang.dateiname}`;
  } else {
    xml = new TextDecoder('utf-8').decode(bytes);
  }

  /* Erst lesen, dann speichern: was keine E-Rechnung ist, hinterlaesst kein Objekt. */
  let extrakt;
  try {
    extrakt = extrahiereERechnung(xml);
  } catch (fehler: unknown) {
    if (fehler instanceof ERechnungFehler) {
      return zurueck(anfrage, '/neu', { fehler: `erechnung_${fehler.grund}` });
    }
    throw fehler;
  }
  return await (db().begin(async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
      await authorize(
        sitzung, { recht: 'eingang.schreiben', schreibend: true },
        rechtepruefer(kontext.abfrage.bind(kontext)),
      );
      const abgelegt = await legeERechnungAb(kontext, waehleSpeicher(), {
        dateiname: datei.name,
        bytes,
        ...(datei.type === '' || datei.type === 'text/xml' ? {} : { behaupteterTyp: datei.type }),
        xml,
        quelleAnzeige: dateiname,
        extrakt,
        entstehungsJahr:
          Number((extrakt.nutzlast.rechnungsdatum ?? '').slice(0, 4)) || new Date().getUTCFullYear(),
        nachAblage: (ort) => { waise.wert = { bucket: ort.bucket, pfad: ort.pfad }; },
      });
      const vorschlag = abgelegt.vorschlag;
      waise.wert = null;

      const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
      const ziel = new URL(`/portal/${slug}/freigaben/${vorschlag.freigabeId}`, erwarteterUrsprung(anfrage));
      ziel.searchParams.set('vorschlag', vorschlag.neu ? 'neu' : 'vorhanden');
      return NextResponse.redirect(ziel, 303);
    }))) as NextResponse;
}

/** Die vier Zustandswechsel. Welcher erlaubt ist, entscheidet die Datenbank. */
async function schiebeWeiter(
  anfrage: NextRequest,
  sitzung: NonNullable<Awaited<ReturnType<typeof aktuelleSitzung>>>,
  aktion: string,
  text: (name: string) => string | null,
): Promise<NextResponse> {
  const id = text('id');
  if (id === null) return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });

  return await (db().begin(async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
      /*
       * Freigeben und Buchen tragen `eingang.freigeben`, das Übrige
       * `eingang.schreiben`: wer erfasst, gibt nicht schon deswegen frei
       * (Invariante 7).
       */
      const recht = aktion === 'freigeben' || aktion === 'buchen'
        ? 'eingang.freigeben' : 'eingang.schreiben';
      await authorize(
        sitzung, { recht, schreibend: true },
        rechtepruefer(kontext.abfrage.bind(kontext)),
      );
      /*
       * Die Freigabe verlangt BEIDES: die Entscheidung ueber die Rechnung
       * (`eingang.freigeben`) und das Recht, einen Freigabesatz in die K-13-
       * Kette zu schreiben (`freigabe.entscheiden`). Zwei Rechte, weil es
       * zwei Handlungen sind — und weil eine Kette, in die jeder schreiben
       * darf, nichts bezeugt.
       */
      if (aktion === 'freigeben') {
        await authorize(
          sitzung, { recht: 'freigabe.entscheiden', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
      }

      if (aktion === 'pruefen') await inPruefung(kontext, id);
      else if (aktion === 'ablehnen') await lehneAb(kontext, id, text('grund') ?? '');
      else if (aktion === 'freigeben') {
        /**
         * **Die Freigabe wird HIER erteilt, nicht mitgeschickt.**
         *
         * Eine `freigabeId` aus dem Formular wäre eine Kennung, die der
         * Aufrufer wählt — und damit eine Freigabe, die zu etwas anderem
         * gehören könnte. `erteileFreigabe` legt sie an, zieht die
         * Kettennummer und friert die Nutzlast ein, über die entschieden
         * wurde: Lieferant, Nummer, Datum und Betrag. Wer die Rechnung danach
         * umschreibt, hat für das, was er bucht, keine Freigabe mehr (K-13).
         */
        const [kopf] = await kontext.abfrage<{
          lieferant: string | null; nummer: string | null;
          datum: string | null; brutto: string | null;
        }>(
          `select l.name as lieferant, er.rechnungsnummer_lieferant as nummer,
                  er.rechnungsdatum::text as datum, er.brutto_cent::text as brutto
             from eingangsrechnung er
             left join lieferant l on l.id = er.lieferant_id and l.mandant_id = er.mandant_id
            where er.id = $1::uuid`, [id]);
        if (kopf === undefined) {
          return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
        }
        const freigabeId = await erteileFreigabe(kontext, {
          aktion: 'eingangsrechnung_buchen',
          inhalt: {
            eingangsrechnung_id: id,
            lieferant: kopf.lieferant,
            rechnungsnummer: kopf.nummer,
            rechnungsdatum: kopf.datum,
            brutto_cent: kopf.brutto,
          },
          begruendung: text('begruendung')
            ?? 'Sachlich und rechnerisch geprüft; zur Buchung freigegeben.',
        });
        await freigebe(kontext, id, freigabeId);
      } else if (aktion === 'buchen') await buche(kontext, id);
      else return NextResponse.json({ fehler: 'unbekannte_aktion' }, { status: 400 });

      return zurueck(anfrage, `/${id}`);
    }))) as NextResponse;
}

/**
 * Welcher Grund einer Abweisung des Dienstes auf `/neu` zurückreist, wenn ein
 * Formular der Seite sie auslöste (D-774 Nachrunde).
 *
 * Beim Erfassen wirft `EingangsrechnungFehler` genau zwei: `abgewiesen`
 * (`legeBelegAn`, auch unter `legeERechnungAb`, und `erfasseEingangsrechnung`)
 * und `unvollstaendig` (`setzeSteuerzeile` — eine Steuersatzgruppe, die es
 * nicht gibt). Die übrigen drei wirft nur ein Zustandswechsel des Blatts; sie
 * bleiben JSON wie bisher. Ein neuer Grund des Dienstes bricht hier die
 * Übersetzung, bis jemand entschieden hat, ob `/neu` einen Satz dafür braucht.
 */
const ERFASSEN_ABWEISUNG: Readonly<Record<EingangsrechnungFehler['grund'], ErfassenFehlerGrund | null>> = {
  abgewiesen: 'rechnung_abgewiesen',
  unvollstaendig: 'rechnung_unvollstaendig',
  nicht_gefunden: null,
  dublette: null,
  vier_augen: null,
};

function uebersetze(
  fehler: unknown, anfrage: NextRequest, herkunft: { readonly neuFormular: boolean },
): NextResponse {
  const anmeldung = anmeldungsAntwort(fehler, anfrage);
  if (anmeldung !== null) return anmeldung;
  if (fehler instanceof NichtGefundenFehler) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  if (fehler instanceof NichtVerbundenFehler) {
    return zurueck(anfrage, '/neu', { fehler: 'speicher_nicht_verbunden' });
  }
  /*
   * Die Prüfkette der Datei (`ladeHoch`, auf beiden Wegen: der Beleg der
   * Erfassung und die E-Rechnung unter `legeERechnungAb`) — wie bei der
   * Ablage: `MimeFehler` als `datei_<grund>`, `ExifFehler` als
   * `datei_metadaten`. Keiner von beiden trägt einen Status; bis dahin fielen
   * sie hier durch und endeten als 500 — beim verschlüsselten PDF eines
   * Lieferanten ebenso wie bei einer Datei, deren Inhalt nicht zum
   * angegebenen Typ passt (D-774 Nachrunde). Geschrieben ist in beiden Fällen
   * nichts: die Kette prüft, bevor der Speicher etwas bekommt.
   */
  if (fehler instanceof MimeFehler) return zurueck(anfrage, '/neu', { fehler: `datei_${fehler.grund}` });
  if (fehler instanceof ExifFehler) return zurueck(anfrage, '/neu', { fehler: 'datei_metadaten' });
  if (fehler instanceof GeldFehler) return zurueck(anfrage, '/neu', { fehler: 'betrag' });
  if (fehler instanceof FreigabeFehler) {
    return NextResponse.json({ fehler: 'freigabe', meldung: fehler.message }, { status: 409 });
  }
  if (fehler instanceof VorschlagFehler) {
    return zurueck(anfrage, '/neu', { fehler: `vorschlag_${fehler.grund}` });
  }
  if (fehler instanceof EingangsrechnungFehler) {
    /*
     * Ein Formular auf `/neu` endete hier auf einer weissen Seite mit
     * `{"fehler":…,"meldung":…}` und Status 409 — die Eingabe weg, der Rückweg
     * der Zurück-Knopf. Jetzt bekommt es seinen Grund; ein Programm bekommt
     * weiter JSON (D-599: „ein Browser bekommt eine Seite, ein Programm JSON").
     */
    const grund = herkunft.neuFormular ? ERFASSEN_ABWEISUNG[fehler.grund] : null;
    if (grund !== null) return zurueck(anfrage, '/neu', { fehler: grund });
    return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
      { status: fehler.grund === 'nicht_gefunden' ? 404 : 409 });
  }
  throw fehler;
}
