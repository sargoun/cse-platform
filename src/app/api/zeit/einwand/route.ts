import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { datenbankGrund, zurMaske } from '@/app/api/mein/formular';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import { berlinFormularZeitpunkt } from '@/lib/datum/formularzeit';
import {
  EinwandOhneBezugFehler, KeineAnstellungFehler, mandantDerAnstellung, reicheEinwandEin,
  type EinwandArt,
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
 * **Ein Formular bekommt eine Seite zurueck, kein JSON** (V-189, D-599). Die
 * beiden Formulare — der Einwand zu einem Eintrag und „Eine Zeit fehlt" ohne
 * Eintrag — schicken `maske` (ihr eigener Pfad) und `zurueck` (wohin nach
 * dem Absenden). Mit ihnen fuehrt eine Abweisung als Grund auf die Maske
 * zurueck und ein Erfolg mit `?gemeldet=1` auf die Seite, die die Meldung
 * zeigt. Vorher endete das Absenden auf einer weissen Seite mit
 * `{"einwand": "…"}`, und ein Ende vor dem Beginn (`ze_fenster`) als 500.
 * Ohne die beiden Felder antwortet die Route wie bisher mit JSON — fuer
 * einen JSON-Aufrufer ist das die richtige Antwort.
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
  const maskePfad = textOder(daten, 'maske');
  const zurueck = textOder(daten, 'zurueck');

  /**
   * Die Abweisung: auf die Maske, wenn ein Formular fragt, sonst JSON.
   *
   * Was zurueckreist, sind Beschaeftigung, Tag, Uhrzeiten und Pause — die
   * Begruendung NICHT: sie ist Freitext ueber einen Lohnstreit, und eine
   * Adresse landet in Verlauf und Protokollen. Die Maske bittet darum, sie
   * noch einmal einzugeben.
   */
  const abweisen = (grund: string, status = 400): NextResponse => (maskePfad === null
    ? NextResponse.json({ fehler: grund }, { status })
    : zurMaske(anfrage, maskePfad, grund, {
      anstellung: anstellungId, datum: betrifftDatum,
      beginn: textOder(daten, 'beginn'), ende: textOder(daten, 'ende'), pause: pauseRoh,
      begruendung_neu: begruendung === null ? null : 'ja',
    }));

  if (anstellungId === null) return abweisen('keine_anstellung');
  if (art === null || !ARTEN.includes(art as EinwandArt)) return abweisen('unbekannte_art');
  if (betrifftDatum === null || !DATUM.test(betrifftDatum)) return abweisen('kein_datum');
  if (begruendung === null) {
    // Ohne Begruendung ist es keine Meldung, sondern ein Klick — und die
    // Planung haette nichts, worueber sie entscheiden koennte.
    return abweisen('keine_begruendung');
  }

  const pause = pauseRoh === null ? null : Number(pauseRoh);
  if (pause !== null && (!Number.isInteger(pause) || pause < 0)) {
    return abweisen('pause_ungueltig');
  }
  const behauptetBeginn = zeitpunktOder(daten, 'beginn');
  const behauptetEnde = zeitpunktOder(daten, 'ende');
  // Dieselbe Bedingung wie `ze_fenster` (0052) — vorher prueft, damit sie als
  // Satz ankommt und nicht als `check_violation` durch die Route faellt.
  if (behauptetBeginn !== null && behauptetEnde !== null
      && behauptetEnde.getTime() <= behauptetBeginn.getTime()) {
    return abweisen('fenster_verkehrt');
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
    if (zurueck === null) return NextResponse.json({ einwand: id }, { status: 201 });
    const ziel = new URL(internesZiel(zurueck, '/portal/mein/zeiten', anfrage));
    ziel.searchParams.set('gemeldet', '1');
    return NextResponse.redirect(ziel, 303);
  } catch (fehler) {
    // Eine fremde Beschaeftigung bietet kein Formular an (AUT-06).
    if (fehler instanceof KeineAnstellungFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    const auth = autorisierungsAntwort(fehler);
    if (auth !== null) return auth;
    if (fehler instanceof EinwandOhneBezugFehler) return abweisen('kein_zeiteintrag');
    // Die zweite Linie: Pruefbedingung, Fremdschluessel (ein Eintrag einer
    // anderen Beschaeftigung), ein Tag, den es nicht gibt.
    const ausDatenbank = datenbankGrund(fehler);
    if (ausDatenbank !== null) {
      return abweisen(ausDatenbank === 'ueberlappt' ? 'ungueltige_eingabe' : ausDatenbank);
    }
    throw fehler;
  }
}
