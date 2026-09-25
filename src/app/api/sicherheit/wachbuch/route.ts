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
 */
export const dynamic = 'force-dynamic';

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

/** Der Grund einer Abweisung, als Schlüssel für `?fehler=`. */
function grundVon(fehler: unknown): string | null {
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

  const daten = await anfrage.formData();
  const betreff = text(daten, 'betreff');
  const eintragstext = text(daten, 'eintragstext');
  const korrigiert = text(daten, 'korrigiert');
  const mandant = String(daten.get('mandant') ?? '');
  const fehlerZiel = text(daten, 'zurueck_fehler');

  /** D-599: ein Formular geht mit dem Grund zurück auf seine Seite. */
  const abgewiesen = (grund: string, antwort: () => NextResponse): NextResponse => {
    if (fehlerZiel === null) return antwort();
    const trenner = fehlerZiel.includes('?') ? '&' : '?';
    return NextResponse.redirect(internesZiel(
      `${fehlerZiel}${trenner}fehler=${encodeURIComponent(grund)}`,
      `/portal/${mandant}/security/wachbuch`, anfrage), 303);
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

        if (korrigiert !== null) {
          const grund = text(daten, 'grund');
          if (grund === null) {
            // Kein Grund, kein Vorgang — dieselbe Regel wie beim Quittieren
            // eines Konflikts.
            throw new WachbuchEingabeFehlt('Eine Korrektur braucht einen Grund.', 'grund_fehlt');
          }
          return korrigiereEintrag(kontext, {
            eintragId: korrigiert, grund, betreff, eintragstext,
          });
        }

        const objektId = text(daten, 'objekt');
        const art = daten.get('art');
        if (objektId === null || !istWachbuchArt(art)) {
          throw Object.assign(new Error('Objekt und Art gehören zu jedem Eintrag.'), {
            code: 'pflichtfeld_fehlt', status: 400,
          });
        }
        return schreibeEintrag(kontext, {
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
        });
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
