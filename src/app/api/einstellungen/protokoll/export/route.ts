import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { ZipFehler } from '@/server/services/archiv/zip';
import {
  AuditBuendelFehler, erstelleAuditBuendel, packeAuditBuendel, type AuditBuendel,
} from '@/server/services/audit/buendel';

/**
 * `GET /api/einstellungen/protokoll/export?mandant=&von=&bis=&format=manifest|zip`
 * — das Beweismittelbuendel ueber das Pruefprotokoll (SEC-A9, DOC-08, LEG-01).
 *
 * Nach dem Muster von `/api/dokumente/buendel`: `manifest` gibt es immer
 * (kanonisches JSON mit dem SHA-256 im Kopf), `zip` packt Manifest und CSV
 * dazu. Jeder Abruf steht im Protokoll — ein Beweismittel verlaesst das Haus,
 * und das gehoert selbst protokolliert.
 *
 * **Warum ein GET schreibt.** Drei Dinge entstehen beim Abruf: die
 * Kettenglieder, die noch fehlten, die Protokollzeile fuer das Lesen der
 * Nutzlasten, und die Zeile fuer den Abruf selbst. Ein lesendes GET, das
 * seinen eigenen Abruf nicht protokolliert, waere bei einem Beweismittel die
 * falsche Sparsamkeit.
 *
 * **Der Bereich kommt aus der SITZUNG.** `?mandant=` steht nur fuer den
 * Dateinamen in der Adresse (Invariante 3) — wer den Slug tauscht, bekommt
 * ein anders benanntes Buendel seiner eigenen Gesellschaft, nie ein fremdes.
 *
 * **Die Vorher/Nachher-Werte haengen am ZWEITEN FAKTOR, und zwar nicht
 * hier.** `system.audit_sensitiv_lesen` traegt seit 0206
 * `berechtigung.erfordert_2fa`; `app.hat_recht` gibt es in einer
 * `aal1`-Sitzung damit gar nicht erst zurueck, und `erstelleAuditBuendel`
 * liefert ein REDIGIERTES Buendel mit dem Grund im Manifest. Die Pruefung
 * steht bewusst an der Berechtigung und nicht in diesem Handler: die Werte
 * sind auch ueber `app.audit_nutzlast_buendel` und `app.audit_nutzlast_lesen`
 * erreichbar, und ein Riegel je Handler deckt je einen Weg.
 */
export const dynamic = 'force-dynamic';

function dateiname(slug: string, b: AuditBuendel, endung: string): string {
  return `protokoll-${slug}-${b.filter.von}_bis_${b.filter.bis}`
    + `-${b.manifestSha256.slice(0, 12)}${endung}`;
}

export async function GET(anfrage: NextRequest): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const p = anfrage.nextUrl.searchParams;
  const slug = (p.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const von = p.get('von') ?? '';
  const bis = p.get('bis') ?? '';
  const format = p.get('format') ?? 'manifest';
  const leerNull = (name: string): string | null => {
    const wert = (p.get(name) ?? '').trim();
    return wert === '' ? null : wert;
  };
  if (format !== 'manifest' && format !== 'zip') {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    const { buendel, bytes } = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        /*
         * `schreibend: true`, obwohl es ein GET ist: der Aufruf schreibt drei
         * Dinge (Kettenglieder, die Protokollzeile der Nutzlast, die des
         * Abrufs). Damit laeuft auch die Invariante-10-Pruefung von
         * `authorize` — `withTenant` faengt die Gruppenansicht zwar ohnehin
         * ab, aber die Wache gehoert an die Stelle, die die Absicht kennt.
         */
        await authorize(
          sitzung, { recht: 'system.audit_exportieren', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const b = await erstelleAuditBuendel(kontext, {
          von, bis,
          objektTyp: leerNull('objektTyp'),
          objektId: leerNull('objektId'),
          akteurTyp: leerNull('akteurTyp'),
        });
        const aus = format === 'zip' ? packeAuditBuendel(b) : b.manifest;
        await kontext.schreibe(
          `select app.protokolliere('audit.buendel_abgerufen', 'audit_log', null, null,
                                    $1::jsonb, app.aktiver_mandant())`,
          /* Ein Objekt, kein JSON-Text: der Treiber kodiert einen Text ein zweites Mal (D-467). */
          [{ format, von: b.filter.von, bis: b.filter.bis,
            manifestSha256: b.manifestSha256, zeilen: b.zeilen.length,
            redigiert: b.redigiert, gekettet: b.deckung.gekettet }]);
        return { buendel: b, bytes: aus };
      }))) as { buendel: AuditBuendel; bytes: Uint8Array };

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'content-type': format === 'zip'
          ? 'application/zip' : 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${dateiname(
          slug, buendel, format === 'zip' ? '.zip' : '-manifest.json')}"`,
        'x-cse-manifest-sha256': buendel.manifestSha256,
        /* Ehrlich im Kopf: ein redigiertes Buendel sagt es, nicht nur im Manifest. */
        'x-cse-redigiert': buendel.redigiert ? 'ja' : 'nein',
        'cache-control': 'no-store',
      },
    });
  } catch (fehler: unknown) {
    if (fehler instanceof AuditBuendelFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.grund === 'zeitraum' ? 400 : 409 });
    }
    if (fehler instanceof ZipFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message }, { status: 409 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }
}
