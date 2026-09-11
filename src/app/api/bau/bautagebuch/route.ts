import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { NichtVerbundenFehler, SupabaseSpeicher } from '@/server/storage/adapter';
import { legeMediumAb, MedienFehler, MEDIEN_MAX_BYTES } from '@/server/services/zeit/medien';
import {
  BautagebuchFehler, ersetzeBautag, findeOderLegeBautagAn, gegenzeichneBautag,
  hefteMannstundenAn, hefteTagesfotoAn, heftePositionAn, istHerkunft, istKalendertag,
  istPositionArt, korrigiereMannstunden, korrigierePosition, listeBautage, schliesseBautag,
} from '@/server/services/bau/bautagebuch';
import { alsAntwort } from './antwort';

/**
 * `GET/POST /api/bau/bautagebuch` — das Bautagebuch (BAU-07, API-KARTE §C.15).
 *
 * **Ein Eingang, mehrere Vorgaenge, und das ist kein Sammelsurium.** Anlegen,
 * Anfuegen, Korrigieren, Abschliessen und Gegenzeichnen brauchen dieselbe
 * Sitzung, denselben Ursprungscheck, denselben Mandantenkontext und dasselbe
 * Recht — und die Korrektur IST ein Anfuegen, nur mit einem Storno daneben.
 * Fuenf Adressen waeren fuenf Stellen, an denen die Pruefung fehlen kann; die
 * API-Karte fuehrt fuer diese Domaene genau diese eine Adresse und
 * `POST /[id]/wetter`.
 *
 * **Die Zeit kommt nicht von hier.** `abgeschlossen_am`, `gegengezeichnet_am`
 * und jedes `storniert_am` stempelt der Ausloeser in 0082 mit der Serveruhr
 * (Invariante 5). Ein mitgeschickter Zeitpunkt waere die Antwort auf „wann
 * wurde der Tag geschlossen", und die gehoert nicht dem Aufrufer.
 *
 * **Der Tag speichert auch ohne Wetter.** Diese Route holt keines: das Wetter
 * ist ein eigener Vorgang (`…/[id]/wetter`), damit ein nicht erreichbarer DWD
 * niemals eine Tageseintragung mitreisst (BAU-08).
 */
export const dynamic = 'force-dynamic';

function fehlerAntwort(code: string, meldung: string, status: number): NextResponse {
  return NextResponse.json({ fehler: code, meldung }, { status });
}

/** Der Akteur, wie `authorize` ihn erwartet — aus der SITZUNG, nie aus der Anfrage. */
type Sitzung = NonNullable<Awaited<ReturnType<typeof aktuelleSitzung>>>;
function akteur(sitzung: Sitzung) {
  return {
    benutzerId: sitzung.benutzerId,
    personId: sitzung.personId,
    aktiverMandantId: sitzung.aktiverMandantId,
    ansicht: sitzung.ansicht,
    aal: sitzung.aal,
    portal: sitzung.portal,
    sitzungId: sitzung.sitzungId,
  };
}

/**
 * `GET` — die Tage, gefiltert. Lesen, nichts sonst.
 *
 * Das eigene Recht ist `bau.lesen`; geschrieben wird hier nicht, also faellt
 * auch das Schreibtor nicht.
 */
export async function GET(anfrage: NextRequest): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const suche = anfrage.nextUrl.searchParams;
  const tag = (name: string): string | null => {
    const wert = suche.get(name);
    return wert !== null && istKalendertag(wert) ? wert : null;
  };

  try {
    const tage = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          akteur(sitzung), { recht: 'bau.lesen', schreibend: false },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return listeBautage(kontext, {
          projektId: suche.get('projekt'),
          von: tag('von'),
          bis: tag('bis'),
          nurOffene: suche.get('offen') === '1',
        });
      })));
    return NextResponse.json({ tage });
  } catch (fehler: unknown) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }
}

/**
 * `POST` — der Vorgang steht im Feld `vorgang`.
 *
 * Ohne Feld ist es `tag`: das Formular der Tagesseite legt den Tag an oder
 * findet ihn. Ein unbekannter Wert wird ABGEWIESEN und nicht auf einen
 * Vorgabewert gebogen — sonst laendet ein Tippfehler als „Tag anlegen", und
 * das ist der Vorgang, der etwas erzeugt.
 */
/*
 * Eine Verzweigung je Vorgang, und sie steht ABSICHTLICH in einer Funktion:
 * jeder Weg teilt sich Ursprungscheck, Sitzung, Mandantenkontext und
 * Autorisierung. Sie aufzuteilen verteilte genau diese vier auf acht Stellen.
 */
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
  const feld = (name: string): string => {
    const wert = formular.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const zahl = (name: string): number => {
    const roh = feld(name).replace(',', '.');
    return roh === '' ? Number.NaN : Number(roh);
  };

  const vorgang = feld('vorgang') === '' ? 'tag' : feld('vorgang');
  const ERLAUBT = [
    'tag', 'mannstunden', 'position', 'korrektur_mannstunden', 'korrektur_position',
    'abschluss', 'gegenzeichnung', 'ersatztag',
  ];
  if (!ERLAUBT.includes(vorgang)) {
    return fehlerAntwort('ungueltige_eingabe', `Unbekannter Vorgang „${vorgang}".`, 422);
  }

  /**
   * Die Aufnahmen fahren MIT — derselbe Grund wie beim Aufmass (PR 43): der
   * Zustand „Tag ohne Foto" entsteht genau dann, wenn die Bauleitung die
   * Baustelle schon verlassen hat. Erst in den Bucket, dann die Zeilen: wenn
   * die Zeilen scheitern, liegt hoechstens ein Objekt zu viel im Bucket, nie
   * eine Zeile ohne die Datei, auf die sie sich beruft.
   */
  const dateien = formular.getAll('fotos').filter((d): d is File => d instanceof File);
  const ablagen: {
    readonly medienId: string;
    readonly ablage: Awaited<ReturnType<typeof legeMediumAb>>;
  }[] = [];
  if (dateien.length > 0) {
    const speicher = new SupabaseSpeicher();
    try {
      for (const datei of dateien) {
        const medienId = randomUUID();
        ablagen.push({
          medienId,
          ablage: await legeMediumAb({
            mandantId: sitzung.aktiverMandantId,
            medienId,
            daten: new Uint8Array(await datei.arrayBuffer()),
            behaupteterTyp: datei.type === '' ? null : datei.type,
          }, speicher),
        });
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
  }

  let ergebnis: { readonly bautagId: string; readonly neu: string | null };
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /**
         * `bau.schreiben` — das Recht der Seitenkarte fuer
         * `…/bautagebuch/[datum]`. Es ist nicht `bau.aufmass_erfassen`: ein
         * Aufmass ist eine Mengenfeststellung, ein Bautagebuch die laufende
         * Beweisfuehrung der Bauleitung.
         */
        await authorize(
          akteur(sitzung), { recht: 'bau.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const bautagId = feld('bautag') !== ''
          ? feld('bautag')
          : await findeOderLegeBautagAn(kontext, feld('projekt'), feld('datum'));

        let neu: string | null = null;
        switch (vorgang) {
          case 'tag':
            break;
          case 'mannstunden':
            neu = await hefteMannstundenAn(kontext, mannstundenAus(bautagId, feld, zahl));
            break;
          case 'position':
            neu = await heftePositionAn(kontext, positionAus(bautagId, feld, zahl));
            break;
          case 'korrektur_mannstunden':
            neu = await korrigiereMannstunden(kontext, {
              zeileId: feld('zeile'),
              grund: feld('grund'),
              ersatz: mannstundenAus(bautagId, feld, zahl),
            });
            break;
          case 'korrektur_position':
            neu = await korrigierePosition(kontext, {
              zeileId: feld('zeile'),
              grund: feld('grund'),
              ersatz: positionAus(bautagId, feld, zahl),
            });
            break;
          case 'abschluss':
            await schliesseBautag(kontext, bautagId);
            break;
          case 'gegenzeichnung':
            await gegenzeichneBautag(kontext, { bautagebuchId: bautagId, name: feld('name') });
            break;
          case 'ersatztag':
            neu = await ersetzeBautag(kontext, {
              bautagebuchId: bautagId, grund: feld('grund'),
            });
            break;
          default:
            throw new BautagebuchFehler('ungueltige_eingabe', 'Unbekannter Vorgang.');
        }

        for (const { medienId, ablage } of ablagen) {
          await hefteTagesfotoAn(kontext, {
            bautagebuchId: bautagId,
            medienId,
            art: ablage.art,
            bucket: ablage.bucket,
            pfad: ablage.pfad,
            mimeTyp: ablage.mimeTyp,
            groesseBytes: ablage.groesseBytes,
            sha256: ablage.sha256,
            beschreibung: feld('foto_beschreibung') === '' ? null : feld('foto_beschreibung'),
          });
        }
        return { bautagId, neu };
      }))) as { readonly bautagId: string; readonly neu: string | null };
  } catch (fehler: unknown) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  const mandant = feld('mandant');
  const projekt = feld('projekt');
  const datum = feld('datum');
  if (mandant !== '' && projekt !== '' && datum !== '') {
    return NextResponse.redirect(internesZiel(
      feld('zurueck') === '' ? null : feld('zurueck'),
      `/portal/${mandant}/bau/projekte/${projekt}/bautagebuch/${datum}`,
      anfrage,
    ), 303);
  }
  return NextResponse.json({ id: ergebnis.bautagId, zeile: ergebnis.neu }, { status: 201 });
}

/** Die Mannstundenfelder — aus dem Formular, ohne Menge und ohne Zeitpunkt. */
function mannstundenAus(
  bautagId: string, feld: (n: string) => string, zahl: (n: string) => number,
) {
  const herkunft = feld('herkunft');
  return {
    bautagebuchId: bautagId,
    gewerkId: feld('gewerk'),
    herkunft: istHerkunft(herkunft) ? herkunft : 'eigen',
    anzahlPersonen: zahl('personen'),
    /**
     * Die Dauer kommt in MINUTEN herein. Stunden entgegenzunehmen und hier
     * mal 60 zu rechnen erzeugte aus „7,5 h" je nach Rundung 450 oder 449
     * Minuten — und die Differenz stuende danach im Abgleich.
     */
    dauerMinuten: zahl('minuten'),
    nachunternehmerFirmaId: feld('nachunternehmer_firma') === ''
      ? null : feld('nachunternehmer_firma'),
    nachunternehmerName: feld('nachunternehmer') === '' ? null : feld('nachunternehmer'),
    taetigkeit: feld('taetigkeit') === '' ? null : feld('taetigkeit'),
    bereich: feld('bereich') === '' ? null : feld('bereich'),
  };
}

/** Geraet, Lieferung, Vorkommnis. */
function positionAus(
  bautagId: string, feld: (n: string) => string, zahl: (n: string) => number,
) {
  const art = feld('art');
  const menge = zahl('menge');
  return {
    bautagebuchId: bautagId,
    art: istPositionArt(art) ? art : 'geraet',
    bezeichnung: feld('bezeichnung'),
    // Als TEXT an `numeric` — eine Gleitkommazahl waere die Stelle, an der
    // aus 3,3 t irgendwann 3,2999999999999998 t wird (§1.1).
    menge: Number.isFinite(menge) ? feld('menge').replace(',', '.') : null,
    einheit: feld('einheit') === '' ? null : feld('einheit'),
    lieferantFirmaId: feld('lieferant_firma') === '' ? null : feld('lieferant_firma'),
    lieferscheinNummer: feld('lieferschein') === '' ? null : feld('lieferschein'),
    gewerkId: feld('gewerk') === '' ? null : feld('gewerk'),
    zeitpunkt: feld('zeitpunkt') === '' ? null : feld('zeitpunkt'),
    beschreibung: feld('beschreibung') === '' ? null : feld('beschreibung'),
  };
}
