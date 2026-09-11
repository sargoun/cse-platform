import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { legeAnweisungAn } from '@/server/services/security/dienstanweisung';
import { alsAntwort } from '../antwort';
import { feldText as text, uebersetzungen } from '../formular';

/**
 * `POST /api/sicherheit/dienstanweisungen` — eine Dienstanweisung anlegen
 * (SEC-06, DOC-05, EMP-12).
 *
 * **Kopf und erste Fassung in EINER Anfrage.** Eine Anweisung ohne Text ist
 * keine, und zwei Adressen ergäben den Zustand „Kopf ohne Fassung", in dem
 * die Oberfläche eine Anweisung zeigt, die niemand lesen kann. Der Kopf
 * entsteht als Entwurf; die Freigabe ist ein Ankreuzfeld, weil sie derselbe
 * Vorgang ist und nicht ein zweiter, den jemand vergisst.
 *
 * **Die Fassungsnummer und der Inhalts-Hash kommen nicht von hier.** Beides
 * setzt `a_da_version_vorbereiten` (0078 §7) — die Nummer unter einer Sperre
 * auf dem Kopf, damit zwei gleichzeitig angelegte Entwürfe nicht dieselbe
 * bekommen, und den Hash aus dem Inhalt, damit er nicht die Prüfsumme dessen
 * ist, der geprüft wird.
 *
 * **`dienstanweisung.schreiben`** — dasselbe Recht, das die `WITH CHECK`-Hälfte
 * der Zeilenpolitik verlangt (K-03). Die Rolle `mitarbeiter` hält es NICHT;
 * ihr Weg ist die Bestätigung, und die hat ihre eigene Adresse.
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
  const mandant = String(daten.get('mandant') ?? '');
  const titel = text(daten, 'titel');
  const gueltigAb = text(daten, 'gueltig_ab');
  if (titel === null || gueltigAb === null) {
    return NextResponse.json({ fehler: 'pflichtfeld_fehlt' }, { status: 400 });
  }

  let neu: string;
  try {
    neu = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'dienstanweisung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const { anweisungId } = await legeAnweisungAn(kontext, {
          titel,
          objektId: text(daten, 'objekt'),
          postenId: text(daten, 'posten'),
          inhalt: text(daten, 'inhalt'),
          inhaltI18n: uebersetzungen(daten),
          gueltigAb,
          aenderungshinweis: text(daten, 'aenderungshinweis'),
          kenntnisnahmePflicht: daten.get('ohne_pflicht') !== '1',
          veroeffentlichen: daten.get('veroeffentlichen') === '1',
        });
        return anweisungId;
      })) as Promise<string>);
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/security/dienstanweisungen/${neu}`,
      anfrage,
    ),
    303,
  );
}
