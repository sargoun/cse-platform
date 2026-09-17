import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { GeldFehler, parseGeld } from '@/server/services/finanz/geld';
import { RichtlinieFehler, setzeRichtlinie }
  from '@/server/services/agent/richtlinie';
import { AKTIONEN, type Aktion } from '@/server/agent/policy';

/**
 * `POST /api/einstellungen/agent-richtlinien` — eine Richtlinie des
 * Ausgangs-Gates setzen (AGT-03, APR-01, Invariante 7).
 *
 * Der Handler bleibt duenn: pruefen, den Dienst rufen, antworten. Ob eine
 * Aktion ueberhaupt automatisch hinausgehen DARF, entscheidet nicht er,
 * sondern `setzeRichtlinie` — und fuer Angebot, Nachtrag und
 * Behinderungsanzeige `gate()` selbst.
 *
 * `agent.richtlinie_verwalten` und nicht `versand.freigeben`: hier wird die
 * REGEL gesetzt, nicht eine Nachricht freigegeben. Wer Richtlinien pflegt,
 * laesst damit noch nichts hinausgehen — und wer freigibt, aendert damit
 * keine Regel.
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(
    `/portal/${slug}/einstellungen/agent-richtlinien`, erwarteterUrsprung(anfrage));
  if (hinweis !== undefined) url.searchParams.set('hinweis', hinweis);
  return NextResponse.redirect(url, 303);
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
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  const aktion = text('aktion');
  if (aktion === null || !(AKTIONEN as readonly string[]).includes(aktion)) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }
  const maxBetrag = text('maxBetrag');

  try {
    const grenze = maxBetrag === null ? null : parseGeld(maxBetrag);
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'agent.richtlinie_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await setzeRichtlinie(kontext, {
          aktion: aktion as Aktion,
          autoErlaubt: text('autoErlaubt') === 'ja',
          istAktiv: text('istAktiv') === 'ja',
          maxBetragCent: grenze,
          begruendung: text('begruendung'),
        });
        return zurueck(anfrage,
          'Die Richtlinie ist gesetzt. Sie gilt ab dem nächsten Versandversuch; '
          + 'was vorher freigegeben wurde, bleibt freigegeben.');
      }))) as NextResponse;
  } catch (fehler: unknown) {
    /*
     * **Der Aufrufer ist ein Formular, also bekommt er eine SEITE zurueck.**
     * Eine JSON-Antwort mit 422 laesst den Browser eine Datei anzeigen, auf
     * der `{"fehler":"im_code_gesperrt"}` steht — und genau dieser Fall ist
     * der, in dem jemand einen Satz braucht statt eines Codes.
     */
    if (fehler instanceof GeldFehler || fehler instanceof RichtlinieFehler) {
      return zurueck(anfrage, fehler.message);
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    throw fehler;
  }
}
