import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { SupabaseSpeicher } from '@/server/storage/adapter';
import { MAX_BYTES, pruefeGroesse } from '@/server/storage/mime';
import { CamtFehler } from '@/server/services/finanz/bank/camt';
import { ImportFehler, importiereAuszug }
  from '@/server/services/finanz/bank/import';

/**
 * `POST /api/buchhaltung/bank` — einen CAMT.053-Kontoauszug einlesen
 * (ACC-04, PR 61).
 *
 * **Es gibt keinen Abruf bei der Bank.** Kein PSD2, kein FinTS, keine
 * Zugangsdaten. Ein Mensch lädt die Datei hoch, die seine Bank ihm
 * bereitstellt; diese Route liest sie.
 *
 * **Der Prüfwert der Datei entscheidet über den zweiten Versuch.** Dieselbe
 * Datei noch einmal hochzuladen ist ein Nichtereignis und wird als solches
 * gemeldet — nicht als Fehler, denn es ist keiner: wer unsicher ist, ob der
 * Import durchlief, lädt sie eben noch einmal hoch.
 *
 * **`jetzt` kommt aus der SERVERUHR, hier und nirgends sonst**
 * (Invariante 5).
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
  const datei = daten.get('datei');
  if (!(datei instanceof File) || datei.size === 0) {
    return NextResponse.json(
      { fehler: 'keine_datei', text: 'Es wurde keine Datei übermittelt.' },
      { status: 400 });
  }

  /*
   * **Die Groesse wird VOR dem Lesen geprueft.** `datei.size` steht fest,
   * bevor ein Byte im Speicher liegt; `arrayBuffer()` erst danach zu rufen
   * heisst, dass eine zu grosse Datei die Grenze erst erreicht, wenn sie
   * vollstaendig alloziert ist — und die Kopie in die `Uint8Array` noch
   * einmal so viel kostet. Die Byte-Pruefung bleibt fuer das, was
   * angenommen wurde.
   */
  if (datei.size > MAX_BYTES) {
    return NextResponse.json(
      { fehler: 'zu_gross', text: 'Die Datei überschreitet die Grenze.' },
      { status: 413 });
  }
  const bytes = new Uint8Array(await datei.arrayBuffer());
  try {
    pruefeGroesse(bytes);
  } catch {
    return NextResponse.json(
      { fehler: 'zu_gross', text: 'Die Datei überschreitet die Grenze.' },
      { status: 413 });
  }

  try {
    const ergebnis = await db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'zahlung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return importiereAuszug(kontext, new SupabaseSpeicher(), bytes, new Date());
      }));

    return NextResponse.json(ergebnis);
  } catch (fehler) {
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    /*
     * Ein Leser- oder Importfehler ist eine Aussage ueber die DATEI, nicht
     * ueber den Server: unlesbares XML, ein Auszug ohne IBAN, ein Konto, das
     * es nicht gibt. Der Satz steht auf Deutsch und gehoert dem Menschen, der
     * die Datei hochgeladen hat — 422 und nicht 500.
     */
    if (fehler instanceof CamtFehler || fehler instanceof ImportFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, text: fehler.message }, { status: 422 });
    }
    throw fehler;
  }
}
