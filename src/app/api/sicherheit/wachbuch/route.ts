import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  BezugPasstNichtZumObjekt, istWachbuchArt, korrigiereEintrag, schreibeEintrag,
  WachbuchEingabeFehlt,
} from '@/server/services/security/wachbuch';
import {
  legeWachbuchFotosAb, MedienFehler, MEDIEN_MAX_BYTES, type FormularDatei,
} from '@/server/services/zeit/medien';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import { alsAntwort } from '../antwort';

/**
 * `POST /api/sicherheit/wachbuch` — eine Wachbuchseite schreiben oder
 * richtigstellen (SEC-05, SEC-07, TIM-08, TIM-10).
 *
 * **Zwei Vorgänge, eine Adresse, und das ist kein Sammelsurium.** Anlegen und
 * Korrigieren brauchen dieselbe Sitzung, denselben Ursprungscheck, denselben
 * Mandantenkontext und dasselbe Recht — und die Korrektur IST ein Anlegen,
 * nur mit einem Storno daneben. Zwei Adressen wären zwei Stellen, an denen die
 * Prüfung fehlen kann.
 *
 * **Die Zeit kommt nicht von hier.** Der Server stempelt `erfasst_am` im
 * Auslöser (0070); was das Formular mitschickt, ist höchstens
 * `geraete_zeit` — eine Behauptung, die daneben gespeichert wird und nie an
 * die Stelle der Serverzeit tritt (Invariante 5, TIM-08).
 *
 * **Der Schlüssel reist mit** (V-180): bei der Art `schluessel` ist er
 * Pflicht, und der Dienst hält ihn gegen das Objekt der Seite.
 *
 * **Ein Browser bekommt eine Seite, kein JSON** (D-599). Schickt das Formular
 * `zurueck_fehler` mit, führt eine Abweisung dorthin zurück, mit dem Grund als
 * Schlüssel (`?fehler=`), den die Seite als eigenen Eintrag nachschlägt
 * (D-728). Ohne das Feld — ein Programm — antwortet die Route wie bisher mit
 * JSON und Statuscode.
 *
 * **Fotos kommen MIT der Seite** (V-181, SEC-05 „with photos"): jedes Feld
 * `foto` eines `multipart/form-data`-Formulars ist eine Aufnahme. Geprüft,
 * bereinigt und abgelegt wird in DERSELBEN Transaktion wie die Seite
 * (`legeWachbuchFotosAb`); scheitert eine, steht auch die Seite nicht da. Die
 * Grösse prüft die Route VOR dem Lesen des Rumpfes; das Ziel der Abweisung
 * steht dafür auch in der Adresse des Formulars (`?zurueck_fehler=`).
 */
export const dynamic = 'force-dynamic';

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

/** Die Aufnahmen des Formulars — ein leeres Dateifeld ist keine. */
function fotosAus(daten: FormData): readonly File[] {
  return daten.getAll('foto').filter((f): f is File => f instanceof File && f.size > 0);
}

/** Der Grund einer Abweisung, als Schlüssel für `?fehler=`. */
function grundVon(fehler: unknown): string | null {
  if (fehler instanceof MedienFehler) return `foto_${fehler.grund}`;
  if (fehler instanceof NichtVerbundenFehler) return 'speicher_nicht_verbunden';
  if (fehler instanceof WachbuchEingabeFehlt) return fehler.grund;
  /* Welcher Bezug nicht zum Objekt passt, sagt die Tabelle — „irgendetwas
     passt nicht" hilft niemandem, der die Eingabe korrigieren soll. */
  if (fehler instanceof BezugPasstNichtZumObjekt) return `fremder_${fehler.tabelle}`;
  const f = fehler as { status?: unknown; code?: unknown };
  return typeof f.status === 'number' && typeof f.code === 'string' ? f.code : null;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  /**
   * D-599: ein Formular geht mit dem Grund zurück auf seine Seite. Das Ziel
   * steht im Formular (`zurueck_fehler`) — und für die Grössenprüfung, die
   * VOR dem Lesen des Rumpfes fällt, auch in dessen Adresse. `internesZiel`
   * lässt nur eine Adresse dieses Hauses durch.
   */
  const zurueckAus = (ziel: string | null, grund: string, ersatz: string): NextResponse => {
    const basis = ziel ?? ersatz;
    const trenner = basis.includes('?') ? '&' : '?';
    return NextResponse.redirect(internesZiel(
      `${basis}${trenner}fehler=${encodeURIComponent(grund)}`, ersatz, anfrage), 303);
  };
  const zielInAdresse = anfrage.nextUrl.searchParams.get('zurueck_fehler');
  const angekuendigt = Number(anfrage.headers.get('content-length') ?? '0');
  if (Number.isFinite(angekuendigt) && angekuendigt > MEDIEN_MAX_BYTES) {
    if (zielInAdresse === null || zielInAdresse.trim() === '') {
      return NextResponse.json({ fehler: 'foto_zu_gross' }, { status: 413 });
    }
    return zurueckAus(zielInAdresse, 'foto_zu_gross', '/portal');
  }

  const daten = await anfrage.formData();
  const betreff = text(daten, 'betreff');
  const eintragstext = text(daten, 'eintragstext');
  const korrigiert = text(daten, 'korrigiert');
  const mandant = String(daten.get('mandant') ?? '');
  const fehlerZiel = text(daten, 'zurueck_fehler') ?? zielInAdresse;
  const fotos = fotosAus(daten);

  const abgewiesen = (grund: string, antwort: () => NextResponse): NextResponse => {
    if (fehlerZiel === null) return antwort();
    return zurueckAus(fehlerZiel, grund, `/portal/${mandant}/security/wachbuch`);
  };

  if (betreff === null || eintragstext === null) {
    return abgewiesen('pflichtfeld_fehlt', () =>
      NextResponse.json({ fehler: 'pflichtfeld_fehlt' }, { status: 400 }));
  }

  let neu: string;
  try {
    neu = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'wachbuch.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        /*
         * Die Fotos gehen an die Seite, die DIESE Transaktion schreibt — an
         * die neue, auch bei einer Richtigstellung. Die Datenbank nimmt sie
         * an keiner anderen an (`t_wachbuch_medien`, 0467). Die Bytes werden
         * erst nach der Rechtepruefung gelesen.
         */
        const mitFotos = async (eintragId: string): Promise<string> => {
          const dateien: FormularDatei[] = [];
          for (const foto of fotos) {
            dateien.push({
              daten: new Uint8Array(await foto.arrayBuffer()),
              behaupteterTyp: foto.type === '' ? null : foto.type,
            });
          }
          await legeWachbuchFotosAb(kontext, { eintragId, dateien }, waehleSpeicher());
          return eintragId;
        };

        if (korrigiert !== null) {
          const grund = text(daten, 'grund');
          if (grund === null) {
            // Kein Grund, kein Vorgang — dieselbe Regel wie beim Quittieren
            // eines Konflikts.
            throw new WachbuchEingabeFehlt('Eine Korrektur braucht einen Grund.', 'grund_fehlt');
          }
          return mitFotos(await korrigiereEintrag(kontext, {
            eintragId: korrigiert, grund, betreff, eintragstext,
          }));
        }

        const objektId = text(daten, 'objekt');
        const art = daten.get('art');
        if (objektId === null || !istWachbuchArt(art)) {
          throw Object.assign(new Error('Objekt und Art gehören zu jedem Eintrag.'), {
            code: 'pflichtfeld_fehlt', status: 400,
          });
        }
        return mitFotos(await schreibeEintrag(kontext, {
          objektId,
          art,
          betreff,
          eintragstext,
          einsatzId: text(daten, 'einsatz'),
          postenId: text(daten, 'posten'),
          veranstaltungId: text(daten, 'veranstaltung'),
          kontrollpunktId: text(daten, 'kontrollpunkt'),
          schluesselId: text(daten, 'schluessel'),
          praesenzBestaetigt: daten.get('praesenz') === '1',
          polizeiInformiert: daten.get('polizei') === '1',
          /**
           * Die Geräteuhr wird MITGESCHICKT, wenn die Oberfläche sie kennt —
           * und sofort als Abweichung verrechnet (TIM-08). Sie zu verschweigen
           * wäre bequemer und nähme der Auswertung genau die Tatsache, für die
           * invariant 5 die Spalte verlangt.
           */
          geraeteZeit: text(daten, 'geraete_zeit'),
          nachgetragen: daten.get('nachgetragen') === '1',
        }));
      })) as Promise<string>);
  } catch (fehler) {
    const grund = grundVon(fehler);
    if (grund !== null) {
      return abgewiesen(grund, () => alsAntwort(fehler) ?? NextResponse.json(
        { fehler: grund }, { status: 400 }));
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/security/wachbuch/${neu}`,
      anfrage,
    ),
    303,
  );
}
