import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { legeSchluesselAn } from '@/server/services/security/schluessel';
import { artenAktion } from '../arten';
import { alsAntwort } from '../antwort';
import { feldText as text } from '../formular';

/**
 * `POST /api/sicherheit/schluessel` — einen Schlüssel in den Bestand nehmen
 * (SEC-07).
 *
 * **Kein Statusfeld, und das ist keine Auslassung.** `status`,
 * `aktueller_besitzer_text` und `letzte_quittung_id` sind aus dem Journal
 * ABGELEITET (0079 §6); der Auslöser `s_status_abgeleitet` weist jede direkte
 * Änderung ab. Ein Formularfeld dafür wäre die Einladung, den Bestand zu
 * behaupten statt ihn zu buchen — und genau das macht die Frage „wer hatte
 * Zutritt" unbeantwortbar.
 *
 * **Die Schlüsselart ist optional, weil der Katalog LEER ausgeliefert wird**
 * (O-148). Eine Pflichtauswahl aus einer leeren Liste verhinderte das Anlegen
 * des ersten Schlüssels; eine geratene Liste sähe bestätigt aus (K-17).
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const mandant = String(daten.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');

  /*
   * D-783 (O-148): Voreinstellung und Pflege der Schlüsselarten — ein Handler
   * für beide Kataloge (`../arten`), hinter Lesen UND Schreiben des Moduls.
   */
  const artenAntwort = await artenAktion(anfrage, sitzung, daten, {
    tabelle: 'schluesselart', rechtLesen: 'schluessel.lesen', rechtSchreiben: 'schluessel.schreiben',
    seiten: { liste: `/portal/${mandant}/security/schluessel` },
  });
  if (artenAntwort !== null) return artenAntwort;

  const objektId = text(daten, 'objekt');
  const bezeichnung = text(daten, 'bezeichnung');
  if (objektId === null || bezeichnung === null) {
    return NextResponse.json({ fehler: 'pflichtfeld_fehlt' }, { status: 400 });
  }

  let neu: string;
  try {
    neu = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'schluessel.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return legeSchluesselAn(kontext, {
          objektId,
          bezeichnung,
          schluesselartId: text(daten, 'schluesselart'),
          schluesselNummer: text(daten, 'nummer'),
          schliessanlage: text(daten, 'schliessanlage'),
          sicherungskarteNummer: text(daten, 'sicherungskarte'),
        });
      })) as Promise<string>);
  } catch (fehler) {
    const antwort = alsAntwort(fehler, anfrage);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/security/schluessel/${neu}`,
      anfrage,
    ),
    303,
  );
}
