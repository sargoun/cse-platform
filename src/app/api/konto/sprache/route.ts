import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { bindePersoenlich } from '@/server/kontext/index';
import {
  setzeEigeneSprache, SpracheNichtGesetztFehler, UnbekannteSpracheFehler,
} from '@/server/konto/sprache';

/**
 * `POST /api/konto/sprache` — die eigene Portalsprache (EMP-12).
 *
 * **Kein Rechteschlüssel, und das ist kein Loch.** §12.4 markiert den Zugriff
 * auf das eigene Konto als Selbstzugriff (`S`); einen Schlüssel dafür zu
 * erfinden, den man anschliessend jeder Rolle bindet, prüfte nichts und
 * behauptete zu prüfen (K-19) — dieselbe Begründung wie bei
 * `api/zeit/einwand`. Bewacht wird der Weg dreifach:
 *
 *  1. durch die Sitzung und den Ursprungsvergleich,
 *  2. durch `t_person_selbstpflege` bzw. `t_benutzer_selbstpflege`, die
 *     ausschliesslich die eigene Zeile zulassen — die Kennung kommt aus
 *     `app.aktuelle_person()` bzw. `app.aktueller_benutzer()` und **nie** aus
 *     einem Feld der Anfrage (K-02, Invariante 3),
 *  3. durch das SPALTENRECHT: geändert werden darf `sprache`, sonst nichts.
 *     `person.telefon` daneben ist der Anmeldeweg (EMP-01) — ein
 *     tabellenweites Schreibrecht machte aus dieser Route eine
 *     Kontoübernahme.
 *
 * **`readonly = false` ist hier Pflicht.** Jede Portalseite rendert mit
 * `app.readonly = 'on'`; die `with check` der Policy verlangt das Gegenteil.
 * Ohne diese Bindung schriebe die Route null Zeilen — und der Dienst wirft
 * dann, statt „gespeichert" zu melden.
 *
 * **303 und kein JSON.** Das Formular ist ein gewöhnliches
 * `<form method="post">`, damit die Auswahl auf einem alten Diensttelefon ohne
 * JavaScript funktioniert.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const wert = daten.get('sprache');

  try {
    await db().begin(async (tx: postgres.TransactionSql) => {
      /*
       * Die Sprache hängt an KEINEM Mandanten — sie ist eine Eigenschaft des
       * Menschen, nicht der Gesellschaft (D-09). Deshalb `bindeAnfrage` mit
       * der Sitzung, wie sie ist, und nicht `withTenant`: eine
       * Mitarbeitersitzung hat per Konstruktion keinen aktiven Mandanten, und
       * einen zu erfinden wäre eine Zuordnung, die es nicht gibt.
       *
       * `bindePersoenlich` gibt es genau dafür schon — es ist dieselbe Bindung
       * wie `bindeAnfrage`, nur mit `app.readonly = 'off'`. Der Posteingang
       * und die Benachrichtigungseinstellung nehmen denselben Weg; die Sprache
       * gehört in dieselbe Familie: sie ist eine Eigenschaft des Kontos, und
       * eingegrenzt wird sie nicht über einen Mandanten, sondern über die
       * Selbstpflege-Policy.
       */
      await bindePersoenlich(tx, sitzung);
      await setzeEigeneSprache(
        {
          schreibe: async <T,>(sql: string, werte: readonly unknown[] = []) =>
            (await tx.unsafe(sql, werte as never[])) as readonly T[],
          personId: sitzung.personId,
        },
        typeof wert === 'string' ? wert : '',
      );
    });
  } catch (fehler) {
    if (fehler instanceof UnbekannteSpracheFehler) {
      return NextResponse.json({ fehler: 'unbekannte_sprache' }, { status: 400 });
    }
    if (fehler instanceof SpracheNichtGesetztFehler) {
      /*
       * Die Policy hat abgewiesen. Von aussen sieht das aus wie eine fehlende
       * Zeile, und genau so wird es beantwortet (AUT-06) — ein eigener Code
       * verriete, dass es die Zeile gibt und nur das Recht fehlt.
       */
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal/konto/profil', anfrage),
    303,
  );
}
