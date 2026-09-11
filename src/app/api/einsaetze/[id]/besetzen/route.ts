import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  besetzeEinsatz, AbwesendWarnungOffen, ArbzgWarnungOffen, UeberschneidungWarnungOffen,
} from '@/server/services/dienstplan/einteilung';
import { QualifikationFehlt } from '@/server/services/nachweis/tor';

/**
 * `POST /api/einsaetze/[id]/besetzen` — jemanden einteilen (TIM-05, TIM-06,
 * SEC-04, LEG-03, LEG-04).
 *
 * **Die Prüfungen stehen im DIENST, nicht hier.** Diese Datei autorisiert,
 * ruft und übersetzt Fehler in Antworten — mehr nicht. Ein Handler, der
 * selbst prüft, ist ein Handler, an dem man vorbeikommt, indem man einen
 * anderen aufruft.
 *
 * **Zwei Ausgänge für zwei Sorten Befund.** Eine fehlende Qualifikation ist
 * eine Sperre: die Antwort ist 422, und es gibt keinen Parameter, der sie
 * aufhebt. Ein Arbeitszeitbefund ist eine Warnung: die Antwort ist ebenfalls
 * 422, aber ein zweiter Aufruf mit `bestaetigt` schreibt — und schreibt dabei
 * den Verstoss und den Konflikt mit, der im Eingang quittiert werden muss.
 * Ein Weg, der die Warnung still überginge, sähe aus wie „nichts gefunden".
 *
 * Aus dem Formular kommend endet beides auf der Schicht selbst, mit
 * `?pruefe=<anstellung>` — dort steht die Vorschau mit allen Gründen, statt
 * einer JSON-Zeile, die niemand liest.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const { id: einsatzId } = await kontextParam.params;
  const daten = await anfrage.formData();
  const anstellungId = daten.get('anstellung');
  if (typeof anstellungId !== 'string' || anstellungId === '') {
    return NextResponse.json({ fehler: 'keine_anstellung' }, { status: 400 });
  }
  const bestaetigt = daten.get('bestaetigt') === '1';
  const funktion = typeof daten.get('funktion') === 'string'
    && (daten.get('funktion') as string).trim() !== ''
    ? (daten.get('funktion') as string).trim()
    : null;

  const mandant = String(daten.get('mandant') ?? '');
  const zurueckStandard = `/portal/${mandant}/dienstplan/einsatz/${einsatzId}`;

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'dienstplan.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await besetzeEinsatz(kontext, {
          einsatzId, anstellungId, funktion, bestaetigt,
        });
      }));
  } catch (fehler) {
    /**
     * Beide Tore führen aus dem Formular heraus auf die Vorschau — dieselbe
     * Seite, dieselben Gründe, im Klartext. Der JSON-Aufrufer bekommt 422 mit
     * den Befunden; er hat kein Formular, in das er zurückkehren könnte.
     */
    if (fehler instanceof ArbzgWarnungOffen || fehler instanceof AbwesendWarnungOffen
        || fehler instanceof UeberschneidungWarnungOffen
        || fehler instanceof QualifikationFehlt) {
      if (mandant !== '') {
        return NextResponse.redirect(
          internesZiel(
            `${zurueckStandard}?pruefe=${encodeURIComponent(anstellungId)}`,
            zurueckStandard, anfrage),
          303,
        );
      }
      if (fehler instanceof ArbzgWarnungOffen) {
        return NextResponse.json(
          { fehler: 'arbzg_warnung', befunde: fehler.befunde }, { status: 422 });
      }
      if (fehler instanceof AbwesendWarnungOffen) {
        return NextResponse.json(
          { fehler: 'abwesend', hinweis: fehler.hinweis }, { status: 422 });
      }
      /*
       * Die Überschneidungswarnung ist neu, und ohne diesen Zweig wäre sie
       * hier als unbekannter Fehler gelandet: 500 statt 422, und dem Planer
       * stünde „Serverfehler" da, wo „dieser Mensch steht um dieselbe Stunde
       * schon auf jener Schicht" stehen muss. Die Gegenschichten reisen mit —
       * eine Warnung, die nicht sagt WOGEGEN, ist keine.
       */
      if (fehler instanceof UeberschneidungWarnungOffen) {
        return NextResponse.json(
          { fehler: 'ueberschneidung', ueberschneidungen: fehler.ueberschneidungen },
          { status: 422 });
      }
      return NextResponse.json(
        { fehler: 'qualifikation_fehlt', befund: fehler.befund }, { status: 422 });
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
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      return NextResponse.json({ fehler: code }, { status });
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, zurueckStandard, anfrage), 303);
}
