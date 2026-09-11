import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  besetzeVeranstaltung, type EventBesetzung,
} from '@/server/services/security/eventbesetzung';
import { alsAntwort } from '../antwort';

/**
 * `POST /api/sicherheit/event-besetzung` — kurzfristige Besetzung eines
 * Veranstaltungsdienstes (SEC-08, SEC-04, TIM-05).
 *
 * **`dienstplan.schreiben`, nicht `security.schreiben`** — dasselbe Recht, das
 * `04-SEITENKARTE.md` dem Besetzungsbrett gibt und das
 * `/api/einsaetze/[id]/besetzen` verlangt. Was hier entsteht, ist eine Schicht
 * und eine Einteilung; ein eigenes Security-Recht dafür wäre ein zweiter
 * Schlüssel zu derselben Tür.
 *
 * **Kein Sammelabbruch.** Der Dienst gibt je Person einen Befund zurück —
 * besetzt, §34a-Sperre, Arbeitszeitwarnung, schon eingeteilt. Dass eine von
 * acht Wachen keinen gültigen Nachweis hat, darf die anderen sieben nicht
 * verhindern; die Antwort sagt, wer durchkam und wer warum nicht.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const veranstaltungId = daten.get('veranstaltung');
  if (typeof veranstaltungId !== 'string' || veranstaltungId === '') {
    return NextResponse.json({ fehler: 'keine_veranstaltung' }, { status: 400 });
  }
  const anstellungIds = daten.getAll('anstellung')
    .filter((w): w is string => typeof w === 'string' && w !== '');
  const mandant = String(daten.get('mandant') ?? '');

  let befund: EventBesetzung;
  try {
    befund = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'dienstplan.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return besetzeVeranstaltung(kontext, {
          veranstaltungId,
          anstellungIds,
          bestaetigt: daten.get('bestaetigt') === '1',
        });
      })) as Promise<EventBesetzung>);
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  /**
   * Aus dem Formular zurück auf das Brett, mit dem Ergebnis in der Adresse:
   * `?erzeugt=n&offen=m`. Eine JSON-Zeile liest niemand, der gerade auf einen
   * Knopf gedrückt hat — und die Seite zeigt die Befunde ohnehin neu.
   */
  const offen = befund.ergebnisse.length - befund.erzeugt;
  if (mandant === '') {
    return NextResponse.json(
      { erzeugt: befund.erzeugt, einsatz: befund.einsatzId, befunde: befund.ergebnisse },
      { status: 200 },
    );
  }
  const ziel = `/portal/${mandant}/security/veranstaltungen/${veranstaltungId}/besetzung`
    + `?erzeugt=${String(befund.erzeugt)}&offen=${String(offen)}`;
  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, ziel, anfrage), 303,
  );
}
