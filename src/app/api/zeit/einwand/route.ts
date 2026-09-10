import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
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

function zeitpunktOder(daten: FormData, feld: string): Date | null {
  const roh = textOder(daten, feld);
  if (roh === null) return null;
  const d = new Date(roh);
  return Number.isNaN(d.getTime()) ? null : d;
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

  if (anstellungId === null) {
    return NextResponse.json({ fehler: 'keine_anstellung' }, { status: 400 });
  }
  if (art === null || !ARTEN.includes(art as EinwandArt)) {
    return NextResponse.json({ fehler: 'unbekannte_art' }, { status: 400 });
  }
  if (betrifftDatum === null || !DATUM.test(betrifftDatum)) {
    return NextResponse.json({ fehler: 'kein_datum' }, { status: 400 });
  }
  if (begruendung === null) {
    // Ohne Begruendung ist es keine Meldung, sondern ein Klick — und die
    // Planung haette nichts, worueber sie entscheiden koennte.
    return NextResponse.json({ fehler: 'keine_begruendung' }, { status: 400 });
  }

  const pauseRoh = textOder(daten, 'pause');
  const pause = pauseRoh === null ? null : Number(pauseRoh);
  if (pause !== null && (!Number.isInteger(pause) || pause < 0)) {
    return NextResponse.json({ fehler: 'pause_ungueltig' }, { status: 400 });
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
        behauptetBeginn: zeitpunktOder(daten, 'beginn'),
        behauptetEnde: zeitpunktOder(daten, 'ende'),
        behauptetPauseMinuten: pause,
        begruendung,
        eingereichtVonBenutzerId: sitzung.benutzerId,
      }));
    });
    return NextResponse.json({ einwand: id }, { status: 201 });
  } catch (fehler) {
    if (fehler instanceof KeineAnstellungFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof EinwandOhneBezugFehler) {
      return NextResponse.json({ fehler: 'kein_zeiteintrag' }, { status: 400 });
    }
    throw fehler;
  }
}
