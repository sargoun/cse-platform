import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { CrmFehler } from '@/server/services/crm/anlegen';
import { setzeGrundlage } from '@/server/services/crm/kontakt-grundlage';
import { zurueckMitSchluessel } from '@/app/api/crm/rueckweg';

/**
 * `POST /api/crm/ansprechpartner/[id]/rechtsgrundlage` — die Grundlage nach
 * § 7 UWG setzen (CRM-08, LEG-08, 05-API-KARTE §C.7).
 *
 * **POST und nicht PUT.** Die API-Karte schreibt `PUT`; die Formulare im
 * Portal haben kein JavaScript, und ein HTML-Formular kennt genau `GET` und
 * `POST` (D-599). Ein `PUT` wäre hier ein Endpunkt, den die Seite davor nicht
 * erreichen kann — und ein zweiter Weg daneben wäre zwei Wege, von denen
 * einer gepflegt wird. Der Rumpf ist der der API-Karte:
 * `{ rechtsgrundlage, nachweis_quelle, nachweis_am, aehnliche_leistung? }`.
 *
 * **Bei einem Fehler geht es ZURÜCK auf das Formular, mit dem Grund** — wie
 * bei `POST /api/crm/kunde`. Eine JSON-Antwort wäre für einen Menschen ohne
 * JavaScript eine leere Seite mit geschweiften Klammern.
 *
 * Der Handler bleibt dünn: autorisieren, Dienst rufen, 303 zurück.
 *
 * **Zurück reisen nur Schlüssel** (D-769, D-772): `?fehler=<grund>` und
 * `?erfolg=gespeichert`. Hier standen der Satz des `CrmFehler` — samt der
 * Rechte in Backticks, des Namens einer Prüfbedingung und einer eingetippten
 * Belegnummer — und der Erfolgssatz in der Adresse; die Seite schlägt jetzt
 * nach (`GRUNDLAGE_RUECKWEG`).
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function POST(
  anfrage: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: 'unbekannte_kennung' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const zurueck = (daten.get('zurueck') as string | null) ?? '/portal';
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'crm.rechtsgrundlage_setzen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await setzeGrundlage(kontext, {
          ansprechpartnerId: id,
          /* Das Wort, wie es kam — der Dienst prüft es gegen das Enum (D-772 Nr. 14). */
          rechtsgrundlage: String(daten.get('rechtsgrundlage') ?? 'keine'),
          nachweisQuelle: wert('nachweisQuelle'),
          nachweisAm: wert('nachweisAm'),
          belegDokumentId: wert('belegDokumentId'),
          einwilligungKanaele: daten.getAll('kanal').map(String),
          aehnlicheLeistung: String(daten.get('aehnlicheLeistung') ?? '') === '1',
          aehnlicheBegruendung: wert('aehnlicheBegruendung'),
        });
      }));
  } catch (fehler) {
    /* Die Anmeldung zuerst (D-766, D-769 Nr. 7) — ein fehlendes Recht bleibt 404. */
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    if (fehler instanceof CrmFehler) {
      return zurueckMitSchluessel(anfrage, zurueck, 'fehler', fehler.grund);
    }
    throw fehler;
  }

  return zurueckMitSchluessel(anfrage, zurueck, 'erfolg', 'gespeichert');
}
