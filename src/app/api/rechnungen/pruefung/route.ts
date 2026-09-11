import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import {
  berichtAlsJson, PruefEingabeFehler, pruefeRechnung,
} from '@/server/services/finanz/ustg14';

/**
 * `POST /api/rechnungen/pruefung` — der §14-UStG-Vorabbericht, lesend
 * (FIN-04, FIN-05, FIN-13, LEG-05).
 *
 * **Derselbe Dienst wie die Festschreibung.** `05-FINANZEN.md` §6 verlangt
 * EINEN Vorabpruefer; diese Adresse ruft `pruefeRechnung` und formt das
 * Ergebnis, sie entscheidet nichts selbst. Eine zweite Liste hier waere die,
 * die veraltet — und die Wache `validator-nicht-uebersprungen` bricht den
 * Build, wenn jemand sie doch schreibt.
 *
 * **`finanzen.lesen` und nicht `finanzen.festschreiben`.** Der Bericht sagt,
 * was fehlt; er stellt nichts aus. Wer die Rechnung sehen darf, darf sehen,
 * warum sie noch nicht hinausgehen kann — sonst muesste die Buchhaltung
 * jemanden mit Festschreibungsrecht fragen, um einen Tippfehler in der
 * Kundenanschrift zu finden.
 *
 * **POST, obwohl nichts geschrieben wird** — wie die drei Geschwisteradressen
 * dieses Moduls (D-252) und wie `05-API-KARTE.md` §C.9 es fuer
 * `…/preflight` notiert. Die Adresse traegt eine Rechnungskennung im Rumpf,
 * und ein weitergeleiteter Link auf einen fremden Beleg soll nicht Teil der
 * Sitzungsgeschichte werden.
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
  const rechnungId = daten.get('rechnungId');
  if (typeof rechnungId !== 'string' || rechnungId === '') {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    /**
     * `SCHNAPPSCHUSS`: eine Nur-Lese-Transaktion. Der Bericht darf unter
     * keinen Umstaenden etwas veraendern — er ist die Vorschau auf einen
     * Uebergang, nicht der Uebergang.
     */
    const bericht = await (db().begin(SCHNAPPSCHUSS,
      async (tx: postgres.TransactionSql) =>
        withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
          await authorize(
            sitzung,
            { recht: 'finanzen.lesen', schreibend: false },
            rechtepruefer(kontext.abfrage.bind(kontext)),
          );
          return berichtAlsJson(await pruefeRechnung(kontext, rechnungId));
        })) as Promise<Record<string, unknown>>);

    const fehler = bericht['fehler'];
    return NextResponse.json({
      blockierend: Array.isArray(fehler) && fehler.length > 0,
      bericht,
    });
  } catch (fehler) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler || fehler instanceof PruefEingabeFehler) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    throw fehler;
  }
}
