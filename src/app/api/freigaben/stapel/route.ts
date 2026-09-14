import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { StapelFehler, entscheideStapel } from '@/server/services/freigabe/stapel';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/freigaben/stapel` — Routinevorgänge zusammen genehmigen (APR-04).
 *
 * **Jede Freigabe bekommt trotzdem ihren eigenen Schnappschuss.** Der Stapel
 * ist eine Schleife, kein Sammelupdate: APR-07 verlangt den Beweis, WAS zum
 * Zeitpunkt der Entscheidung vorlag, und der ist je Vorgang verschieden.
 *
 * **Markierte Vorgänge fallen heraus, sie brechen den Stapel nicht ab.** Ein
 * Stapel, der an der ersten unsicheren Zeile stirbt, erzieht dazu, ihn nicht
 * zu benutzen; einer, der sie mitnimmt, hebelt APR-03 aus. Der Bericht sagt
 * je übersprungenem Vorgang, warum.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function codeVersion(): string {
  return process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['CSE_CODE_VERSION'] ?? 'entwicklung';
}

function herkunftsAdresse(anfrage: NextRequest): string | null {
  const roh = (anfrage.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  return roh === '' ? null : roh;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const mandant = (String(daten.get('mandant') ?? '')).replace(/[^a-z0-9-]/gu, '');
  const ids = daten.getAll('freigabe')
    .filter((w): w is string => typeof w === 'string')
    .filter((w) => UUID.test(w));
  const seite = `/portal/${mandant}/freigaben`;

  try {
    const bericht = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /*
         * **Nicht `freigabe.entscheiden`.** Der Katalog führt
         * `freigabe.stapel_entscheiden` als eigenes, bindbares Recht: wer
         * einzeln entscheiden darf, darf nicht schon fünfzig auf einmal.
         */
        await authorize(sitzung, { recht: 'freigabe.stapel_entscheiden', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        return entscheideStapel(kontext, ids, {
          ip: herkunftsAdresse(anfrage),
          userAgent: anfrage.headers.get('user-agent'),
          codeVersion: codeVersion(),
        });
      }))) as {
        genehmigt: number; uebersprungen: readonly unknown[];
        verzoegert: number; ausgefuehrt: number;
      };

    /*
     * Vier Zahlen, weil vier Dinge geschehen sein koennen: genehmigt,
     * uebersprungen, mit laufendem Einspruchsfenster (APR-05) und gleich
     * ausgefuehrt (§4.8). „5 genehmigt" allein liesse offen, ob etwas
     * passiert ist.
     */
    const ziel = `${seite}?stapel=${String(bericht.genehmigt)}`
      + `&uebersprungen=${String(bericht.uebersprungen.length)}`
      + `&verzoegert=${String(bericht.verzoegert)}`
      + `&ausgefuehrt=${String(bericht.ausgefuehrt)}`;
    return NextResponse.redirect(internesZiel(ziel, seite, anfrage), 303);
  } catch (fehler) {
    if (fehler instanceof StapelFehler) {
      return NextResponse.redirect(
        internesZiel(`${seite}?fehler=${fehler.code}`, seite, anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }
}
