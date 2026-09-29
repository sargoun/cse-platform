import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { grundAufsFormularweg, type FormularRueckweg } from '@/app/api/formular-antwort';
import { datenbankGrund, datenbankStatus } from '@/app/api/mein/formular';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import { berlinFormularZeitpunkt } from '@/lib/datum/formularzeit';
import {
  EinwandOhneBezugFehler, EinwandZeitFehler, KeineAnstellungFehler, mandantDerAnstellung,
  reicheEinwandEin, type EinwandArt,
} from '@/server/services/zeit/einwand';

/**
 * `POST /api/zeit/einwand` — der Mitarbeitende meldet eine Abweichung
 * (EMP-07).
 *
 * **Das ist der einzige Schreibweg, den ein Mitarbeitender in der Zeitdomaene
 * hat, und er aendert nichts.** Er legt einen Vorgang an. Der Zeiteintrag
 * bleibt, wie er ist — inklusive der Zeit, die die Person fuer falsch haelt —
 * bis die Planung entschieden und `korrigiereZeiteintrag` eine neue Fassung
 * gepraegt hat. Genau das ist der Grund, warum der Datensatz im Lohnstreit
 * etwas wert ist.
 *
 * **Kein Rechteschluessel, und das ist kein Loch.** EMP-07 fuehrt das
 * Einreichen als Selbstzugriff (`S`), nicht als Modulrecht; es gibt im
 * Katalog keinen Schluessel dafuer, und einen zu erfinden hiesse, ihn jeder
 * Mitarbeiterrolle zu binden — also nichts zu pruefen und dabei zu behaupten,
 * man pruefe. Bewacht wird der Weg dreifach: durch die Sitzung, durch den
 * serverseitig aufgeloesten Mandanten (nie ein Feld der Anfrage, K-02) und
 * durch die Policy `t_selbst_einreichen`, die nur Zeilen zulaesst, deren
 * Anstellung dem angemeldeten Menschen gehoert.
 *
 * **Der Mandant kommt aus der Anstellung.** Im Personen-Scope ist
 * `app.aktiver_mandant()` NULL, und keine Schreibpolicy trifft zu (K-18).
 * Also: im Personen-Scope die Anstellung aufloesen — dort greift die
 * Personen-RLS, eine fremde id liefert null Zeilen —, dann `withTenant` mit
 * genau diesem Mandanten neu betreten.
 *
 * **Ein Formular bekommt eine Seite zurueck, kein JSON** (V-189, V-198,
 * D-599, D-692). Die beiden Formulare — der Einwand zu einem Eintrag und
 * „Eine Zeit fehlt" ohne Eintrag — schicken `fehlerweg` (ihr eigener Pfad)
 * und `zurueck` (wohin nach dem Absenden, mit `?gesendet=1`, das die Seite
 * als Bestaetigung liest). Mit ihnen fuehrt eine Abweisung als Grund auf die
 * Maske zurueck (`grundAufsFormularweg`, samt Tag, Uhrzeiten und Pause) und
 * ein Erfolg auf die Seite, die die Meldung zeigt. Vorher endete das Absenden
 * auf einer weissen Seite mit `{"einwand": "…"}`, und ein Ende vor dem
 * Beginn (`ze_fenster`) als 500. Ohne die beiden Felder antwortet die Route
 * wie bisher mit JSON — fuer einen JSON-Aufrufer ist das die richtige
 * Antwort.
 */
export const dynamic = 'force-dynamic';

const ARTEN: readonly EinwandArt[] = [
  'eintrag_fehlt', 'zeit_falsch', 'pause_falsch', 'zuordnung_falsch', 'sonstiges',
];

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

function textOder(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

/**
 * `datetime-local` schickt WANDUHRZEIT ohne Zone, und die ist berlinerisch.
 *
 * `new Date('2026-07-01T06:00')` las sie als Ortszeit des Prozesses — auf
 * Vercel UTC. Aus „06:00" wurde damit 08:00 Berliner Zeit: kein Fehler, keine
 * Meldung, nur ein Einwand, der eine andere Zeit behauptet als der Mensch
 * eingetragen hat. `berlinFormularZeit` loest sie ueber dieselbe getestete
 * Funktion auf, mit der der Generator seine Schichten legt (§7.2).
 */
function zeitpunktOder(daten: FormData, feld: string): Date | null {
  return berlinFormularZeitpunkt(textOder(daten, feld));
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (sitzung.personId === null || sitzung.personId === '') {
    // Ein Konto ohne Person hat keine Beschaeftigung, also auch keine Zeit,
    // gegen die sich ein Einwand richten koennte.
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const anstellungId = textOder(daten, 'anstellung');
  const art = textOder(daten, 'art');
  const betrifftDatum = textOder(daten, 'datum');
  const begruendung = textOder(daten, 'begruendung');
  const pauseRoh = textOder(daten, 'pause');

  /**
   * Die Abweisung: auf die Maske, wenn ein Formular fragt, sonst JSON
   * (`grundAufsFormularweg`: `fehlerweg` vor `zurueck`, ohne beide JSON).
   *
   * Was zurueckreist, sind Beschaeftigung, Tag, Uhrzeiten und Pause — die
   * Begruendung NICHT: sie ist Freitext ueber einen Lohnstreit, und eine
   * Adresse landet in Verlauf und Protokollen. Die Maske bittet darum, sie
   * noch einmal einzugeben.
   */
  const rueckweg: FormularRueckweg = {
    werte: {
      anstellung: anstellungId, datum: betrifftDatum,
      beginn: textOder(daten, 'beginn'), ende: textOder(daten, 'ende'), pause: pauseRoh,
      begruendung_neu: begruendung === null ? null : 'ja',
    },
  };

  if (anstellungId === null) {
    return grundAufsFormularweg(anfrage, daten, 'keine_anstellung', 400, rueckweg);
  }
  if (art === null || !ARTEN.includes(art as EinwandArt)) {
    return grundAufsFormularweg(anfrage, daten, 'unbekannte_art', 400, rueckweg);
  }
  if (betrifftDatum === null || !DATUM.test(betrifftDatum)) {
    return grundAufsFormularweg(anfrage, daten, 'kein_datum', 400, rueckweg);
  }
  if (begruendung === null) {
    // Ohne Begruendung ist es keine Meldung, sondern ein Klick — und die
    // Planung haette nichts, worueber sie entscheiden koennte.
    return grundAufsFormularweg(anfrage, daten, 'keine_begruendung', 400, rueckweg);
  }

  const pause = pauseRoh === null ? null : Number(pauseRoh);
  if (pause !== null && (!Number.isInteger(pause) || pause < 0)) {
    return grundAufsFormularweg(anfrage, daten, 'pause_ungueltig', 400, rueckweg);
  }
  const behauptetBeginn = zeitpunktOder(daten, 'beginn');
  const behauptetEnde = zeitpunktOder(daten, 'ende');
  // Dieselbe Bedingung wie `ze_fenster` (0052) — vorher prueft, damit sie als
  // Satz ankommt und nicht als `check_violation` durch die Route faellt.
  if (behauptetBeginn !== null && behauptetEnde !== null
      && behauptetEnde.getTime() <= behauptetBeginn.getTime()) {
    return grundAufsFormularweg(anfrage, daten, 'fenster_verkehrt', 400, rueckweg);
  }

  try {
    const id = await db().begin(async (tx: postgres.TransactionSql) => {
      const mandantId = await withPersonScope(tx, sitzung, async (kontext) =>
        mandantDerAnstellung(kontext, anstellungId));

      /**
       * Dieselbe Sitzung, ein aufgeloester Mandant — und `portal` bleibt
       * `mitarbeiter`, damit die K-04-Decke weiter gilt. Wer hier `intern`
       * setzte, um „es einfacher zu machen", hoebe jede Mitarbeiterdecke
       * dieser Anfrage auf.
       */
      const imMandanten: Sitzung = {
        ...sitzung, ansicht: 'mandant', aktiverMandantId: mandantId, portal: 'mitarbeiter',
      };
      return withTenant(tx, imMandanten, async (kontext) => reicheEinwandEin(kontext, {
        anstellungId,
        zeiteintragId: textOder(daten, 'zeiteintrag'),
        art: art as EinwandArt,
        betrifftDatum,
        behauptetBeginn,
        behauptetEnde,
        behauptetPauseMinuten: pause,
        begruendung,
        eingereichtVonBenutzerId: sitzung.benutzerId,
      }));
    });
    /*
     * **Ein Browser bekommt eine Seite** (V-189, V-198, D-599). Hier stand auch
     * im ERFOLGSfall `{"einwand":"<uuid>"}` mit 201 — der einzige Aufrufer ist
     * ein gewöhnliches Formular, und der Mensch sah nach dem Absenden eine
     * weisse Seite mit einer Kennung. Das Formular schickt `zurueck` — die
     * Seite, die die Meldung zeigt, samt `?gesendet=1` für die Bestätigung;
     * die Route folgt ihm, wie es ist (ohne eigenes Anhängsel). Ohne das Feld
     * ist der Aufrufer ein Programm und bekommt weiter JSON.
     */
    const zurueck = daten.get('zurueck');
    if (typeof zurueck === 'string' && zurueck !== '') {
      return NextResponse.redirect(internesZiel(zurueck, '/portal/mein/zeiten', anfrage), 303);
    }
    return NextResponse.json({ einwand: id }, { status: 201 });
  } catch (fehler) {
    if (fehler instanceof KeineAnstellungFehler) {
      /* Eine fremde Beschäftigung ist für diese Anmeldung nicht vorhanden (AUT-06). */
      return grundAufsFormularweg(anfrage, daten, 'nicht_gefunden', 404, rueckweg);
    }
    const auth = autorisierungsAntwort(fehler);
    if (auth !== null) return auth;
    if (fehler instanceof EinwandOhneBezugFehler) {
      return grundAufsFormularweg(anfrage, daten, 'kein_zeiteintrag', 400, rueckweg);
    }
    // Tag und behauptete Zeit gegen die Uhr der Datenbank (V-193, Invariante 5).
    if (fehler instanceof EinwandZeitFehler) {
      return grundAufsFormularweg(anfrage, daten, fehler.grund, fehler.status, rueckweg);
    }
    // Die zweite Linie: Pruefbedingung, Fremdschluessel (ein Eintrag einer
    // anderen Beschaeftigung), ein Tag, den es nicht gibt.
    const ausDatenbank = datenbankGrund(fehler);
    if (ausDatenbank !== null) {
      const grund = ausDatenbank === 'ueberlappt' ? 'ungueltige_eingabe' : ausDatenbank;
      return grundAufsFormularweg(anfrage, daten, grund, datenbankStatus(grund), rueckweg);
    }
    throw fehler;
  }
}
