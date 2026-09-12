import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  neueFassung, veroeffentlicheFassung,
} from '@/server/services/security/dienstanweisung';
import { alsAntwort } from '../../../antwort';
import { feldText as text, uebersetzungen } from '../../../formular';

/**
 * `POST /api/sicherheit/dienstanweisungen/[id]/version` — eine neue Fassung
 * anlegen oder eine bestehende freigeben (SEC-06, DOC-05, Abnahme 1).
 *
 * **Zwei Vorgänge, eine Adresse, und das ist kein Sammelsurium.** Anlegen und
 * Freigeben brauchen dieselbe Sitzung, denselben Ursprungscheck, denselben
 * Mandantenkontext und dasselbe Recht — und die Freigabe IST der zweite Halbsatz
 * des Anlegens. Zwei Adressen wären zwei Stellen, an denen die Prüfung fehlen
 * kann. Welcher der beiden gemeint ist, sagt das Feld `fassung`: ist es
 * gesetzt, wird genau diese Entwurfsfassung freigegeben; fehlt es, entsteht
 * eine neue.
 *
 * **Freigeben ändert KEINE alte Kenntnisnahme.** Es setzt
 * `veroeffentlicht_am`; den Rest — `aktive_version_id` fortschreiben, Status
 * setzen, die Pflichtpopulation vervollständigen — tut
 * `kern.oeffne_kenntnisnahme_pflicht` (0078 §8). Dass jede frühere
 * Bestätigung damit veraltet ist, ist ein VERGLEICH beim Lesen und kein Lauf,
 * der Beweiszeilen anfasst.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest,
  kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const { id } = await kontextParam.params;
  const daten = await anfrage.formData();
  const mandant = String(daten.get('mandant') ?? '');
  const fassungId = text(daten, 'fassung');

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'dienstanweisung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        // Die Kennung aus dem PFAD geht mit: die Route sagt, welche
        // Dienstanweisung gemeint ist, und der Dienst prueft es (AUT-06).
        if (fassungId !== null) return veroeffentlicheFassung(kontext, fassungId, id);

        const gueltigAb = text(daten, 'gueltig_ab');
        if (gueltigAb === null) {
          throw Object.assign(new Error('Eine Fassung braucht einen Tag, ab dem sie gilt.'), {
            code: 'pflichtfeld_fehlt', status: 400,
          });
        }
        await neueFassung(kontext, id, {
          inhalt: text(daten, 'inhalt'),
          inhaltI18n: uebersetzungen(daten),
          gueltigAb,
          aenderungshinweis: text(daten, 'aenderungshinweis'),
          veroeffentlichen: daten.get('veroeffentlichen') === '1',
        });
        return undefined;
      }));
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/security/dienstanweisungen/${id}`,
      anfrage,
    ),
    303,
  );
}
