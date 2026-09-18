import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { fuehreLaufAus, type AgentKennung } from '@/server/agent/orchestrator';
import { ENTWURF_AUFTRAEGE, fuelleTatsachen } from '@/server/agent/auftraege';
import { slugFuer } from '../../../portal/[mandant]/agenten/kennung';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/agenten/lauf` — einen Agenten laufen lassen (AGT-01, §4).
 *
 * **Der Knopf legt VOR, er sendet nicht.** Am Ende des Laufs steht eine
 * `freigabe` mit Status `offen` im Posteingang; was daraus wird, entscheidet
 * ein Mensch (Invariante 7). Deshalb verlangt diese Route auch nicht das
 * Recht, etwas zu senden, sondern `agent.starten` — und der Posteingang
 * verlangt danach sein eigenes.
 *
 * **Und sie wählt den Auftrag nicht frei.** Was ein Agent formulieren darf,
 * steht in `server/agent/auftraege.ts`: Vorlage, Vorgangsart und die Frage,
 * woher die Tatsachen kommen. Ein Rumpf, der eine beliebige Vorlage mitgäbe,
 * wäre ein Weg, das Modell an den Diensten vorbei zu füttern.
 *
 * **Und der Bereich kommt aus der Sitzung, nicht aus dem Rumpf.** Der Lauf
 * ist ohnehin an `app.aktiver_mandant()` gebunden (Invariante 3); seit der
 * Slug fuer die Umleitung aus derselben Quelle kommt, koennen Lauf und Ziel
 * nicht mehr auseinanderlaufen.
 *
 * **Ein Doppelklick legt keinen zweiten Vorschlag vor.** Das Formular bringt
 * einen Schlüssel mit, der Lauf trägt ihn als `idempotenzSchluessel`, und
 * `starteAufgabe` findet die vorhandene Aufgabe statt eine zweite anzulegen.
 * Ohne ihn war die Zusage der Oberfläche unwahr: jede Wiederholung — ein
 * zweiter Klick, ein Neuladen der Bestätigung, eine wiederholte Zustellung —
 * erzeugte eine weitere Aufgabe und eine weitere offene Freigabe, und
 * jemand hätte dieselbe Sache zweimal entschieden.
 */
export const dynamic = 'force-dynamic';

function codeVersion(): string {
  return process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['CSE_CODE_VERSION'] ?? 'entwicklung';
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
  const agent = String(daten.get('agent') ?? '') as AgentKennung;

  const auftrag = ENTWURF_AUFTRAEGE[agent];
  if (auftrag === undefined) {
    return NextResponse.json({ fehler: 'unbekannter_agent' }, { status: 400 });
  }

  /*
   * **Der Schlüssel kommt aus dem Formular, nicht von hier.** Das Formular
   * setzt ihn einmal beim Zeichnen der Seite; jede Wiederholung DESSELBEN
   * Absendens trägt denselben Wert. Würde die Route ihn erfinden — aus der
   * Uhr, aus einer Zufallszahl —, wäre jeder Klick wieder neu, und die
   * Idempotenz bestünde nur im Kommentar.
   *
   * Er wird beschnitten und auf ein enges Alphabet gebracht: er geht als
   * Wert in eine Spalte mit Eindeutigkeitsbedingung, und ein Schlüssel von
   * beliebiger Länge aus beliebigen Zeichen ist eine Eingabe, die jemand
   * sendet.
   */
  const schluessel = String(daten.get('schluessel') ?? '')
    .replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 64);
  if (schluessel === '') {
    return NextResponse.json({ fehler: 'kein_schluessel' }, { status: 400 });
  }

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(sitzung, { recht: 'agent.aufgabe_starten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        /*
         * **Der Slug kommt aus der Sitzung, nicht aus dem Rumpf** (Invariante 3,
         * dieselbe Stelle wie `?mandant=` beim Berichtsexport).
         *
         * Das Formular trug ihn bisher als verstecktes Feld mit, und nur er
         * bestimmte, wohin die 303 zeigte — waehrend der Lauf selbst gegen
         * `sitzung.aktiverMandantId` gebunden lief. Wer den Bereich in einem
         * zweiten Reiter gewechselt hatte, schickte den alten Slug ab: der
         * Lauf entstand richtig in der aktiven Gesellschaft, die Umleitung
         * fuehrte aber auf die Agentenseite der anderen — und dort steht der
         * Vorschlag nicht. Er sah aus wie ein Lauf, der nichts erzeugt hat.
         */
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        const lauf = await fuehreLaufAus(kontext, {
          ...auftrag,
          agent,
          // Die Tatsachen kommen aus DIESER Gesellschaft, durch RLS begrenzt.
          tatsachen: await fuelleTatsachen(
            { abfrage: kontext.abfrage.bind(kontext) }, agent),
          idempotenzSchluessel: `${agent}:${schluessel}`,
          angefordertVon: sitzung.benutzerId,
          codeVersion: codeVersion(),
        });
        return { lauf, slug: bereich.slug };
      }))) as { lauf: Awaited<ReturnType<typeof fuehreLaufAus>>; slug: string };

    /*
     * Drei Ausgänge, drei Sätze — und der gestörte ist einer davon, kein
     * Absturz: „kein Modell freigegeben" ist ein Betriebszustand (§8).
     */
    const { lauf } = ergebnis;
    /*
     * **Der Pfad braucht den SLUG des Agenten, nicht seinen Enum-Wert.**
     *
     * Hier stand `${agent}`, also der Wert aus dem Formular — und der ist
     * `kennung::text`, also `ceo_assistent`. Die Detailseite loest aber nur
     * Slugs auf (`kennungFuer('ceo-assistent')`) und ruft bei allem anderen
     * `notFound()`. Jeder Lauf des CEO-Assistenten endete damit nach dem 303
     * auf einem 404: der Vorschlag lag vor, und der Bildschirm sagte „diese
     * Seite gibt es nicht". Die drei anderen Agenten trugen es nicht, weil
     * ihr Slug ihrem Enum-Wert gleicht — also fiel es genau bei dem einen
     * auf, bei dem beide auseinandergehen. Die Listenseite macht es seit je
     * richtig (`slugFuer(a.kennung)`); diese Stelle war die Ausnahme.
     */
    const seite = `/portal/${ergebnis.slug}/agenten/${slugFuer(agent)}`;
    const ziel = lauf.gestoert !== null
      ? `${seite}?lauf=gestoert&code=${encodeURIComponent(lauf.gestoert.code)}`
      : lauf.bestand
        ? `${seite}?lauf=bestand`
        : `${seite}?lauf=vorgelegt&freigabe=${String(lauf.freigabeId)}`;
    return NextResponse.redirect(internesZiel(ziel, seite, anfrage), 303);
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }
}
