import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { GeldFehler, parseGeld } from '@/server/services/finanz/geld';
import {
  ZahlungFehler, bucheBauabzug, gleicheAus, legeBankkontoAn, storniereZahlung,
  verbucheZahlungsausgang, verbucheZahlungseingang, type Zahlungsart,
} from '@/server/services/finanz/zahlung/index';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { maskeMitEingaben } from '@/lib/formular/maske';
import { istUuid } from '@/lib/uuid';
import { istGueltigerKalendertag } from '@/lib/datum/kalendertag';
import { IbanFehler } from '@/server/services/finanz/zahlung/iban';

/**
 * `POST /api/finanzen/zahlungen` — einen Zahlungseingang erfassen (FIN-14,
 * ACC-04; `05-API-KARTE.md` §937).
 *
 * **Erfassen, nicht auslösen.** Es gibt keine Bankanbindung. Diese Route
 * schreibt auf, dass Geld angekommen ist; sie bewegt keines (keine erfundenen
 * Integrationen).
 *
 * Der Handler bleibt dünn: prüfen, den Dienst rufen, antworten. Die
 * Überzahlung entscheidet nicht er, sondern `verbucheZahlungseingang` — und
 * die Datenbank weist zurück, was sie nicht halten kann.
 *
 * **Warum `bar` hier nicht abgefangen wird.** Eine Barzahlung ohne Kasse
 * scheitert an `zahlung_bar_braucht_kasse` (0121), und diese Route übersetzt
 * die Abweisung. Sie ein zweites Mal in TypeScript zu prüfen hiesse, dieselbe
 * Regel an zwei Stellen zu pflegen — und die eine, die zählt, steht in der
 * Datenbank.
 */
export const dynamic = 'force-dynamic';

const MITTEL: ReadonlySet<string> = new Set(
  ['ueberweisung', 'lastschrift', 'bar', 'karte', 'verrechnung']);

/**
 * Die Wege eines Zahlungsausgangs (V-216) — ohne `bar`: eine Barzahlung
 * verlangt eine Kasse (`zahlung_bar_braucht_kasse`), und das Formular der
 * Eingangsrechnung bietet keine an. Ein Wert, der erst in der Datenbank
 * scheitert, wäre eine 500 statt eines Satzes.
 */
const MITTEL_AUSGANG: ReadonlySet<string> = new Set(
  ['ueberweisung', 'lastschrift', 'karte', 'verrechnung']);

/** Die Felder des Ausgangsformulars, die bei einer Abweisung zurückreisen (D-599). */
const AUSGANG_FELDER = ['betrag', 'zahlungsdatum', 'zahlungsmittel', 'bankkontoId', 'referenz'] as const;

/**
 * Zurück auf die Eingangsrechnung (V-216, D-599): ein Browser bekommt eine
 * Seite, mit dem Grund als Schlüssel und — bei einer Abweisung — seinen
 * Eingaben.
 */
function zurEingangsrechnung(
  anfrage: NextRequest, eingangsrechnungId: string,
  ergebnis: { readonly meldung: string } | { readonly fehler: string; readonly daten: FormData },
): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const pfad = `/portal/${slug}/finanzen/eingangsrechnungen/${eingangsrechnungId}`;
  if ('meldung' in ergebnis) {
    const url = new URL(pfad, erwarteterUrsprung(anfrage));
    url.searchParams.set('meldung', ergebnis.meldung);
    return NextResponse.redirect(url, 303);
  }
  const werte: Record<string, string | null> = {};
  for (const name of AUSGANG_FELDER) {
    const w = ergebnis.daten.get(name);
    werte[name] = typeof w === 'string' ? w : null;
  }
  return NextResponse.redirect(
    new URL(maskeMitEingaben(pfad, ergebnis.fehler, werte), erwarteterUrsprung(anfrage)), 303);
}

function zurueck(
  anfrage: NextRequest, hinweis?: string, seite = 'zahlungen',
): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(`/portal/${slug}/finanzen/${seite}`, erwarteterUrsprung(anfrage));
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

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  const aktion = text('aktion') ?? 'erfassen';
  const eingangsrechnungId = text('eingangsrechnungId');

  /*
   * **Der Zahlungsausgang an einen Lieferanten** (V-216). Die Eingaben
   * werden VOR der Transaktion geprüft: eine Abweisung führt zurück auf die
   * Eingangsrechnung, mit den Eingaben, statt eine geschweifte Klammer zu
   * zeigen (D-599).
   */
  if (aktion === 'ausgang') {
    if (!istUuid(eingangsrechnungId)) {
      return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
    }
    const mittel = text('zahlungsmittel');
    const datum = text('zahlungsdatum');
    if (text('betrag') === null || datum === null || mittel === null
        || !MITTEL_AUSGANG.has(mittel)) {
      return zurEingangsrechnung(anfrage, eingangsrechnungId, { fehler: 'unvollstaendig', daten });
    }
    /*
     * Ein Tag, den es gibt — das Muster allein liess den 31.02. durch, und
     * die Datenbank antwortete mit `22008`, also einem 500 (V-217).
     */
    if (!istGueltigerKalendertag(datum)) {
      return zurEingangsrechnung(anfrage, eingangsrechnungId, { fehler: 'datum', daten });
    }
    const konto = text('bankkontoId');
    if (konto !== null && !istUuid(konto)) {
      return zurEingangsrechnung(anfrage, eingangsrechnungId, { fehler: 'unvollstaendig', daten });
    }
  }

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'zahlung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        /*
         * **Drei Dienste, die es seit je gibt und die niemand rief** (V-007,
         * V-090, V-091). Sie stehen hier und nicht in drei eigenen Routen,
         * weil alle drei an DEMSELBEN Recht haengen — `zahlung.schreiben`,
         * das das Tor oben schon geprueft hat. Drei Tore mit demselben
         * Praedikat waeren drei Stellen, an denen es auseinanderliefe.
         */
        if (aktion === 'bankkonto') {
          const bezeichnung = text('bezeichnung');
          const iban = text('iban');
          const kontoinhaber = text('kontoinhaber');
          if (bezeichnung === null || iban === null || kontoinhaber === null) {
            return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
          }
          await legeBankkontoAn(kontext, {
            bezeichnung, iban, kontoinhaber,
            bic: text('bic'),
            istStandard: daten.get('ist_standard') === 'ja',
          });
          return zurueck(anfrage, 'bankkonto', 'bankkonten');
        }

        if (aktion === 'bauabzug') {
          /*
           * V-090, § 48 EStG. Ohne diesen Weg bliebe auf jeder Rechnung eines
           * bauabzugspflichtigen Kunden genau der Einbehalt offen — 15 % der
           * Summe, dauerhaft, in jeder Altersliste und in jedem Mahnlauf.
           * Der Kunde hat ihn ans Finanzamt abgefuehrt und schuldet ihn nicht.
           */
          const rechnungId = text('rechnungId');
          if (rechnungId === null) {
            return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
          }
          await bucheBauabzug(kontext, rechnungId);
          return zurueck(anfrage, 'bauabzug');
        }

        if (aktion === 'ausgleichen') {
          /*
           * V-091, §7.4. Ein Guthaben gegen eine Forderung — ohne dass eine
           * Zahlung erfunden wird. Der Betrag kommt als Geldbetrag herein und
           * geht durch `parseGeld`: Invariante 1, ganze Cent, nie Gleitkomma.
           */
          const sollPostenId = text('sollPostenId');
          const habenPostenId = text('habenPostenId');
          const betragRoh = text('ausgleichBetrag');
          const grund = text('grund');
          if (sollPostenId === null || habenPostenId === null
              || betragRoh === null || grund === null) {
            return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
          }
          if (sollPostenId === habenPostenId) {
            return NextResponse.json({ fehler: 'derselbe_posten' }, { status: 400 });
          }
          await gleicheAus(kontext, {
            sollPostenId, habenPostenId,
            betragCent: parseGeld(betragRoh),
            grund,
          });
          return zurueck(anfrage, 'ausgeglichen');
        }

        if (aktion === 'ausgang' && eingangsrechnungId !== null) {
          const ergebnis = await verbucheZahlungsausgang(kontext, {
            eingangsrechnungId,
            betragCent: parseGeld(text('betrag') ?? ''),
            zahlungsdatum: text('zahlungsdatum') ?? '',
            zahlungsmittel: (text('zahlungsmittel') ?? '') as Zahlungsart,
            bankkontoId: text('bankkontoId'),
            referenz: text('referenz'),
          });
          /* Die Überzahlung wird BENANNT: ein Guthaben beim Lieferanten. */
          return zurEingangsrechnung(anfrage, eingangsrechnungId, {
            meldung: ergebnis.ueberzahlungCent > 0n ? 'ausgang_guthaben' : 'ausgang_erfasst',
          });
        }

        if (aktion === 'stornieren') {
          const zahlungId = text('zahlungId');
          const grund = text('grund');
          if (zahlungId === null || grund === null) {
            return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
          }
          await storniereZahlung(kontext, zahlungId, grund);
          return zurueck(anfrage, 'storniert');
        }

        const rechnungId = text('rechnungId');
        const betragRoh = text('betrag');
        const zahlungsdatum = text('zahlungsdatum');
        const mittel = text('zahlungsmittel');
        if (rechnungId === null || betragRoh === null || zahlungsdatum === null
            || mittel === null || !MITTEL.has(mittel)) {
          return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
        }
        /*
         * `YYYY-MM-DD`, wie ein `<input type="date">` es sendet. Ohne diese
         * Schranke landete jede Zeichenkette im `::date`-Cast und ergaebe
         * einen rohen Postgres-Syntaxfehler statt einer Abweisung.
         */
        if (!istGueltigerKalendertag(zahlungsdatum)) {
          return NextResponse.json({ fehler: 'ungueltig', felder: ['zahlungsdatum'] },
            { status: 400 });
        }
        /* Wie beim Ausgang (V-217): ein Wort statt einer Kennung wäre `22P02`, also 500. */
        const kontoEingang = text('bankkontoId');
        if (kontoEingang !== null && !istUuid(kontoEingang)) {
          return NextResponse.json({ fehler: 'ungueltig', felder: ['bankkontoId'] },
            { status: 400 });
        }

        const ergebnis = await verbucheZahlungseingang(kontext, {
          rechnungId,
          betragCent: parseGeld(betragRoh),
          zahlungsdatum,
          zahlungsmittel: mittel as Zahlungsart,
          bankkontoId: text('bankkontoId'),
          referenz: text('referenz'),
        });

        /*
         * Die Überzahlung wird BENANNT und nicht verschluckt: die Seite zeigt
         * danach den Guthabenposten, und der Hinweis sagt, dass einer
         * entstanden ist.
         */
        return zurueck(anfrage,
          ergebnis.ueberzahlungCent > 0n ? 'guthaben' : 'erfasst');
      }))) as NextResponse;
  } catch (fehler) {
    /*
     * Der Ausgang (V-216): eine fachliche Abweisung führt zurück auf die
     * Maske — mit dem Grund als Schlüssel und den Eingaben.
     */
    if (aktion === 'ausgang' && eingangsrechnungId !== null) {
      if (fehler instanceof GeldFehler) {
        return zurEingangsrechnung(anfrage, eingangsrechnungId, { fehler: 'betrag', daten });
      }
      if (fehler instanceof ZahlungFehler) {
        return zurEingangsrechnung(anfrage, eingangsrechnungId, { fehler: fehler.grund, daten });
      }
    }
    const auth = autorisierungsAntwort(fehler);
    if (auth !== null) return auth;
    if (fehler instanceof GeldFehler) {
      return NextResponse.json({ fehler: 'ungueltig', felder: ['betrag'] }, { status: 400 });
    }
    /*
     * `ibanGeprueft` wirft einen `IbanFehler` — eine falsche Pruefziffer ist
     * die haeufigste Eingabe beim Anlegen eines Bankkontos und kein
     * Serverfehler.
     */
    if (fehler instanceof IbanFehler) {
      return NextResponse.json(
        { fehler: `iban_${fehler.grund}`, meldung: fehler.message }, { status: 400 });
    }
    if (fehler instanceof ZahlungFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        {
          status: fehler.grund === 'nicht_gefunden' ? 404
            /* Eine falsche Eingabe ist kein Konflikt mit dem Bestand (V-217). */
            : fehler.grund === 'betrag_nicht_positiv' || fehler.grund === 'bankkonto_fremd'
              ? 400 : 409,
        });
    }
    throw fehler;
  }
}
