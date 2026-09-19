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
import { HINWEIS_TEXT, RichtlinieFehler, setzeRichtlinie }
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

/**
 * Wohin es nach dem Absenden zurueckgeht — aus einem GESCHLOSSENEN Satz.
 *
 * Dieselbe Regel steht an zwei Bildschirmen: in den Einstellungen als
 * Tabelle mit einem Anlegeformular, im Agentenzentrum
 * (`/portal/[mandant]/agenten/richtlinien`) als Liste mit je einer
 * Bearbeitungsseite. Beide schreiben durch DIESEN Handler — eine zweite
 * Route waere eine zweite Stelle, an der jemand das `authorize` vergisst.
 * Woher das Formular kam, darf es deshalb mitschicken; WAS daraus als
 * Adresse wird, entscheidet diese Karte und nicht das Feld.
 */
const ZIELE: Readonly<Record<string, (slug: string) => string>> = {
  einstellungen: (slug) => `/portal/${slug}/einstellungen/agent-richtlinien`,
  agenten: (slug) => `/portal/${slug}/agenten/richtlinien`,
};

/**
 * Zurueck zum Formular — mit einem CODE, nicht mit einem Satz.
 *
 * **Der Befund, der das gebracht hat.** Hier stand der fertige Text in der
 * Adresse (`?hinweis=Die Richtlinie ist gesetzt…`), und alle drei Bildschirme
 * gaben ihn unveraendert in einem Hinweiskasten aus. Damit liess sich ueber
 * einen Link jeder beliebige Satz in der Oberflaeche erscheinen lassen. Jetzt
 * faehrt nur der NAME mit; aufgeloest wird er aus `HINWEIS_TEXT`, und ein
 * Code, den diese Tabelle nicht kennt, zeigt gar nichts.
 */
function zurueck(anfrage: NextRequest, ziel: string, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const bauer = ZIELE[ziel] ?? ZIELE['einstellungen']!;
  const url = new URL(bauer(slug), erwarteterUrsprung(anfrage));
  if (hinweis !== undefined && HINWEIS_TEXT[hinweis] !== undefined) {
    url.searchParams.set('hinweis', hinweis);
  }
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
  /* Nicht die Adresse, sondern ihr NAME — aufgelöst wird er in `ZIELE`. */
  const ziel = text('ziel') ?? 'einstellungen';

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
        return zurueck(anfrage, ziel, 'gesetzt');
      }))) as NextResponse;
  } catch (fehler: unknown) {
    /*
     * **Der Aufrufer ist ein Formular, also bekommt er eine SEITE zurueck.**
     * Eine JSON-Antwort mit 422 laesst den Browser eine Datei anzeigen, auf
     * der `{"fehler":"im_code_gesperrt"}` steht — und genau dieser Fall ist
     * der, in dem jemand einen Satz braucht statt eines Codes. Den Satz
     * schreibt die Seite aus `HINWEIS_TEXT`; durch die Adresse faehrt nur
     * der Name.
     */
    if (fehler instanceof RichtlinieFehler) return zurueck(anfrage, ziel, fehler.grund);
    if (fehler instanceof GeldFehler) return zurueck(anfrage, ziel, 'wert');
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
