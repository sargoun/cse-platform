import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { leseKonflikt, uebersteuereBefund } from '@/server/services/dienstplan/konflikt';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/konflikt/uebersteuern` — eine ArbZG-WARNUNG bewusst stehen
 * lassen (TIM-06).
 *
 * **Das ist nicht `/api/konflikt`.** Dort wird der PLANUNGSKONFLIKT
 * quittiert; hier wird der ArbZG-BEFUND dahinter uebersteuert. Zwei
 * Aufzeichnungen, zwei Rechte, zwei Handlungen — `planungs_konflikt` ist die
 * Warnung im Eingang der Planung, `arbeitszeit_verstoss` ist der Befund, der
 * bei einer Pruefung nach § 3, § 4, § 5 ArbZG vorgelegt wird. Wer die Warnung
 * quittiert, hat den Befund nicht uebersteuert, und umgekehrt. Die Seite sagt
 * das in Worten und verweist auf den jeweils anderen Weg.
 *
 * **Drei Dinge, die dieser Weg NICHT tut:**
 *
 *  1. Er **schreibt nicht direkt**. `arbeitszeit_verstoss` gewaehrt `cse_app`
 *     kein Tabellenrecht `UPDATE`; ein direktes `update` bricht mit
 *     `permission denied for table arbeitszeit_verstoss` ab — also mit einem
 *     500er, nicht still mit null Zeilen. Der einzige Weg ist
 *     `app.arbzg_befund_quittieren`.
 *  2. Er **verlaesst sich nicht auf die Datenbank**. Diese Definer-Funktion
 *     prueft `dienstplan.arbzg_lesen`, also das SCHWAECHERE Recht. Das
 *     staerkere, `dienstplan.arbzg_uebersteuern`, setzt dieser Handler mit
 *     `authorize()` durch. Die Datenbank ist hier die zweite und
 *     ausdruecklich die schwaechere Linie.
 *  3. Er **uebersteuert keine Sperre**. Ein blockierender Konflikt ist durch
 *     KEIN Recht uebersteuerbar: § 34a GewO kennt keine Begruendung, die
 *     einen fehlenden Sachkundenachweis ersetzt. Welche Befunde blockieren,
 *     ist O-166 und offen — dieser Weg liest den gespeicherten Wert und
 *     leitet nichts daraus ab.
 *
 * **Ohne geschriebene Begruendung passiert nichts.** Eine leere
 * Uebersteuerung ist kein Vorgang, sondern ein Klick — und im Streit steht
 * dann da, dass jemand eine Arbeitszeitueberschreitung weggeklickt hat.
 */
export const dynamic = 'force-dynamic';

const MINDESTLAENGE = 10;
/**
 * Eine unlesbare Kennung ist eine 400 und kein 500.
 *
 * Ohne diese Pruefung landete `"neu"` in einem `$1::uuid`, Postgres
 * antwortete `invalid input syntax for type uuid`, und die Route mit einem
 * Serverfehler — die schlechteste aller Antworten (siehe `portal/kennung.ts`).
 */
const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const id = daten.get('konflikt');
  const begruendung = daten.get('begruendung');
  if (typeof id !== 'string' || !KENNUNG.test(id)) {
    return NextResponse.json({ fehler: 'kein_konflikt' }, { status: 400 });
  }
  if (typeof begruendung !== 'string' || begruendung.trim().length < MINDESTLAENGE) {
    return NextResponse.json(
      { fehler: 'begruendung_zu_kurz', mindestens: MINDESTLAENGE }, { status: 400 },
    );
  }

  try {
    const antwort = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'dienstplan.arbzg_uebersteuern', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const k = await leseKonflikt(kontext, id);
        // AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten.
        if (k === null) return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
        if (k.blockiert) {
          return NextResponse.json(
            { fehler: 'blockierend_nicht_uebersteuerbar' }, { status: 409 },
          );
        }
        if (k.verstoss === null) {
          /*
           * Kein Befund heisst hier ZWEI Dinge, und sie sind von aussen
           * dasselbe: an diesem Konflikt haengt keiner (`ueberschneidung`,
           * `qualifikation_entfallen`), oder die Sitzung haelt
           * `dienstplan.arbzg_lesen` nicht und die RLS hat ihn ausgeblendet.
           * Die Antwort nennt beides, weil ein Formular, das ohne Grund
           * scheitert, schlimmer ist als eines, das nicht dasteht.
           */
          return NextResponse.json(
            { fehler: k.arbzgSichtbar ? 'kein_arbzg_befund' : 'arbzg_nicht_einsehbar' },
            { status: 409 },
          );
        }
        if (k.verstoss.status !== 'offen') {
          return NextResponse.json({ fehler: 'nicht_offen' }, { status: 409 });
        }

        await uebersteuereBefund(kontext, k.verstoss.id, begruendung);
        return null;
      })) as Promise<NextResponse | null>);
    if (antwort !== null) return antwort;
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  /*
   * Das Ziel entsteht SERVERSEITIG und nicht aus `zurueck`.
   *
   * Der Rueckweg traegt eine Meldung (`?uebersteuert=1`), und die ginge
   * verloren, sobald `internesZiel` das mitgeschickte `zurueck` vorzieht.
   * Ausserdem ist ein serverseitig gebautes Ziel eines, das niemand vorgeben
   * kann; geprueft wird es trotzdem (Befund der Copilot-Runde auf PR 16).
   */
  const mandant = String(daten.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const ziel = internesZiel(
    `/portal/${mandant}/dienstplan/konflikte/${id}/uebersteuern?uebersteuert=1`,
    `/portal/${mandant}/dienstplan/konflikte`,
    anfrage,
  );
  return NextResponse.redirect(ziel, 303);
}
