import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { RedaktionFehler, setzeGalerieRang } from '@/server/services/inhalt/redaktion';

/**
 * `POST /api/website/galerie` — ein Bild in die öffentliche Galerie aufnehmen
 * oder herausnehmen (§5.21, PUB-04).
 *
 * **Ein gewöhnliches Formular, kein JSON.** Die Pflegeseite ist eine Liste von
 * kleinen `<form>`-Elementen; sie funktioniert ohne JavaScript, und der Weg
 * endet auf einer 303 zurück auf die Liste.
 *
 * **`referenz.schreiben`, wie die Policy.** `authorize` prüft es hier, und
 * `t_medien_pflege` prüft es noch einmal in der Datenbank. Das ist keine
 * Doppelung aus Unsicherheit: die Route ist die erste Linie, die Policy die
 * zweite — und ein Bild auf einer öffentlichen Seite, das dort nicht hingehört,
 * ist nicht rückholbar.
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
  const medienId = String(daten.get('medienId') ?? '');
  /*
   * **„Herausnehmen" schlägt die Zahl.** Beide Knöpfe stehen in demselben
   * Formular und schicken deshalb beide das Zahlenfeld mit. Ohne diese
   * Reihenfolge nähme „Herausnehmen" das Bild nicht heraus, sondern setzte es
   * auf den Platz, der zufällig im Feld stand.
   */
  const rang = daten.get('entfernen') !== null
    ? null
    : Number.parseInt(String(daten.get('rang') ?? '0'), 10);

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'referenz.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await setzeGalerieRang(kontext, medienId, Number.isNaN(rang) ? null : rang);
      }));
  } catch (fehler) {
    if (fehler instanceof RedaktionFehler) {
      return NextResponse.json({ fehler: fehler.grund }, { status: 400 });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
