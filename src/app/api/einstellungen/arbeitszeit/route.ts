import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import {
  ArbeitszeitFehler, GEWERKE, UEBERTRAG_ARTEN, alsMengeText, istUebertragArt,
  setzeArbeitszeitmodell, setzeTarifvereinbarung, type Gewerk,
} from '@/server/services/zeit/arbeitszeitmodell';

/**
 * `POST /api/einstellungen/arbeitszeit?was=modell|tarif` — ein
 * Arbeitszeitmodell oder eine Tarifregel hinterlegen (EMP-04, TIM-06,
 * TIM-14, O-18, O-50).
 *
 * Der Handler bleibt duenn: pruefen, den Dienst rufen, antworten. Ob ein
 * Pausenwert zulaessig ist, entscheidet nicht er, sondern `pruefeTarifRegel`
 * — und die Datenbank noch einmal (`tv_mindestens_gesetz`). Die gesetzlichen
 * ArbZG-Grenzen sind keine Einstellung; ein Wert darunter wird abgewiesen.
 *
 * `stammdaten.verwalten` ist das Recht der Seite UND das der beiden Tabellen
 * (0201) — hier gibt es keinen Rechtebruch zu ueberbruecken.
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(
    `/portal/${slug}/einstellungen/arbeitszeit`, erwarteterUrsprung(anfrage));
  if (hinweis !== undefined) url.searchParams.set('hinweis', hinweis);
  return NextResponse.redirect(url, 303);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const was = anfrage.nextUrl.searchParams.get('was') ?? '';
  if (was !== 'modell' && was !== 'tarif') {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };
  /**
   * Eine ganze Minutenzahl — oder `null`, wenn das Feld LEER ist.
   *
   * Der Unterschied traegt hier Gewicht: `null` heisst auf dieser Seite
   * ausdruecklich „der Tarif sagt dazu nichts", und dann gilt das Gesetz.
   * Ein unlesbarer Wert („dreissig", „30 min", „-5") darf deshalb nicht als
   * `null` durchrutschen — die Zeile wuerde gespeichert, die Route meldete
   * Erfolg, und die strengere Pausenregel, die jemand eingetragen hat, waere
   * lautlos verschwunden. Sie wird abgewiesen, mit dem Namen des Feldes.
   */
  const ganz = (name: string, beschriftung: string): number | null => {
    const roh = text(name);
    if (roh === null) return null;
    if (!/^\d+$/u.test(roh)) {
      throw new ArbeitszeitFehler('ungueltig',
        `„${roh}" ist keine Zahl für das Feld „${beschriftung}". Erlaubt ist eine `
        + 'ganze Zahl ab 0; ein leeres Feld heisst „nicht hinterlegt".');
    }
    const zahl = Number.parseInt(roh, 10);
    if (!Number.isSafeInteger(zahl)) {
      throw new ArbeitszeitFehler('ungueltig',
        `„${roh}" ist zu groß für das Feld „${beschriftung}".`);
    }
    return zahl;
  };

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'stammdaten.verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (was === 'modell') {
          const schluessel = text('schluessel');
          const bezeichnung = text('bezeichnung');
          const gueltigAb = text('gueltigAb');
          if (schluessel === null || bezeichnung === null || gueltigAb === null) {
            throw new ArbeitszeitFehler('ungueltig',
              'Schlüssel, Bezeichnung und Gültigkeitsbeginn sind Pflicht.');
          }
          const wochenstunden = text('wochenstunden');
          const arbeitstage = text('arbeitstage');
          const uebertragArt = text('uebertragArt') ?? 'offen';
          if (!istUebertragArt(uebertragArt)) {
            throw new ArbeitszeitFehler('ungueltig',
              `„${uebertragArt}" ist keine Übertragsregel. Erlaubt ist derzeit nur `
              + `„${UEBERTRAG_ARTEN.join('", „')}" (O-18).`);
          }
          await setzeArbeitszeitmodell(kontext, {
            schluessel,
            bezeichnung,
            wochenstunden: wochenstunden === null ? null : alsMengeText(wochenstunden),
            arbeitstageWoche: arbeitstage === null ? null : alsMengeText(arbeitstage),
            uebertragArt,
            uebertragGrenzeMinuten: ganz('uebertragGrenze', 'Kappung des Übertrags'),
            verfallMonate: ganz('verfallMonate', 'Verfall nach Monaten'),
            gueltigAb,
            bestaetigt: text('bestaetigt') === 'ja',
          });
          return zurueck(anfrage,
            `Das Modell „${schluessel}" gilt ab ${gueltigAb}. Solange die `
            + 'Sollzeitregel offen ist, führt das Stundenkonto soll_minuten = 0 — und '
            + 'das heisst „nicht hinterlegt", nicht „nichts geschuldet" (O-18).');
        }

        const gewerk = text('gewerk');
        const bezeichnung = text('bezeichnung');
        const giltAb = text('giltAb');
        if (gewerk === null || !(GEWERKE as readonly string[]).includes(gewerk)
            || bezeichnung === null || giltAb === null) {
          throw new ArbeitszeitFehler('ungueltig',
            'Gewerk, Tarifvertrag und Geltungsbeginn sind Pflicht.');
        }
        await setzeTarifvereinbarung(kontext, {
          gewerk: gewerk as Gewerk,
          bezeichnung,
          fundstelle: text('fundstelle'),
          pauseAb6hMinuten: ganz('pause6', 'Pause ab 6 Stunden'),
          pauseAb9hMinuten: ganz('pause9', 'Pause ab 9 Stunden'),
          ruhezeitMinuten: ganz('ruhezeit', 'Ruhezeit'),
          giltAb,
          bestaetigt: text('bestaetigt') === 'ja',
        });
        return zurueck(anfrage,
          `Die Tarifregel für ${gewerk} gilt ab ${giltAb}. Die Prüfung nach § 4 und `
          + '§ 5 ArbZG nimmt ab dann den strengeren der beiden Werte.');
      }))) as NextResponse;
  } catch (fehler: unknown) {
    /* Der Aufrufer ist ein Formular, also bekommt er eine SEITE mit dem Satz. */
    if (fehler instanceof ArbeitszeitFehler) return zurueck(anfrage, fehler.message);
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    throw fehler;
  }
}
