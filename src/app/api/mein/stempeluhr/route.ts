import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import { KeineEigeneSchichtFehler, mandantDerZuordnung }
  from '@/server/services/mitarbeiter/stempeluhr';
import { stempleAusDerSitzung } from '@/server/services/zeit/checkin';

/**
 * `POST /api/mein/stempeluhr` — die Arbeiterin stempelt selbst ein und aus
 * (D-618, O-93, TIM-07, EMP-01, Migration 0373).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Kein Recht wird geprueft, und das ist die Entscheidung — nicht ihr Fehlen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `zeit.checkin_verwalten` ist das Recht der PLANUNG, Marken fuer FREMDE
 * auszugeben; eine Reinigungskraft haelt es nicht und soll es nicht halten.
 * Geprueft wird stattdessen das, worauf es hier ankommt — und zwar in der
 * Datenbank, nicht hier: `app.checkin_aus_der_sitzung` (0373) besteht darauf,
 * dass die Anfrage aus dem ARBEITERportal kommt (K-04) und dass die Einteilung
 * DIESER Person gehoert. Beides kann diese Route nicht umgehen, auch wenn sie
 * es wollte (Invariante 3).
 *
 * **Der Mandant kommt aus der EINTEILUNG, nie aus dem Formular** (K-02). Ein
 * Mensch mit zwei Beschaeftigungen stempelt bei einer Gesellschaft (D-09);
 * welche, sagt die Zeile, und die Person-Scope-Policies geben nur die eigenen
 * Einteilungen frei.
 *
 * **Die Geraetezeit wandert mit und entscheidet nichts** (Invariante 5). Sie
 * landet in `zeiteintrag.geraete_zeit_*`, die Datenbank leitet
 * `zeitabweichung_sek` daraus ab, und die abgerechnete Dauer bleibt die
 * Differenz zweier Serverinstants. Ein Telefon mit falscher Uhr erzeugt damit
 * eine SPUR, keinen Schaden.
 *
 * **Antwort ist eine Weiterleitung, keine JSON-Nutzlast.** Der Knopf steht in
 * einem gewoehnlichen `<form method="post">` und funktioniert damit ohne
 * JavaScript — im Treppenhaus, auf einem alten Telefon, bei schlechtem Netz.
 * Genau dafuer ist die Stempeluhr gebaut.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (sitzung.personId === null || sitzung.personId === '') {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const zuordnungId = String(daten.get('zuordnung') ?? '');
  const zweckRoh = String(daten.get('zweck') ?? '');
  if (!UUID.test(zuordnungId)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  if (zweckRoh !== 'checkin' && zweckRoh !== 'checkout') {
    return NextResponse.json({ fehler: 'unbekannter_vorgang' }, { status: 400 });
  }

  /*
   * Die Geraetezeit kommt aus einem versteckten Feld, das die Seite mit
   * JavaScript fuellt. Fehlt sie — kein JavaScript, altes Telefon —, wird
   * eben keine Abweichung dokumentiert. Der Stempel gilt trotzdem: die
   * Erfassung darf nicht daran haengen, dass ein Skript geladen hat.
   */
  const geraeteRoh = String(daten.get('geraete_zeit') ?? '');
  const geraeteZeit = geraeteRoh === '' ? null : new Date(geraeteRoh);
  const gueltigeGeraetezeit =
    geraeteZeit !== null && !Number.isNaN(geraeteZeit.getTime()) ? geraeteZeit : null;

  let ergebnis: 'eingecheckt' | 'ausgecheckt' | 'abgelehnt';
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) => {
      const mandantId = await withPersonScope(tx, sitzung, async (kontext) =>
        mandantDerZuordnung(kontext, zuordnungId));

      const imMandanten: Sitzung = {
        ...sitzung, ansicht: 'mandant', aktiverMandantId: mandantId, portal: 'mitarbeiter',
      };
      return withTenant(tx, imMandanten, async (kontext) => {
        const r = await stempleAusDerSitzung(kontext, {
          zuordnungId,
          zweck: zweckRoh,
          geraeteZeit: gueltigeGeraetezeit,
          ip: anfrage.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
          userAgent: anfrage.headers.get('user-agent'),
        });
        return r.art;
      });
    }) as Promise<'eingecheckt' | 'ausgecheckt' | 'abgelehnt'>);
  } catch (fehler) {
    if (fehler instanceof KeineEigeneSchichtFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    /*
     * **`z_offen_uk` ist hier kein Serverfehler, sondern eine Auskunft.** Der
     * eindeutige Index laesst je Person genau einen offenen Eintrag zu; ein
     * Doppeltipp auf einer langsamen Verbindung trifft ihn. Die Seite bietet
     * in diesem Zustand ohnehin „Arbeit beenden" an — wer trotzdem hier
     * landet, soll kein rotes Fenster sehen, sondern seine Schicht.
     */
    const text = (fehler as { message?: string }).message ?? '';
    if (text.includes('z_offen_uk') || text.includes('duplicate key')) {
      return NextResponse.redirect(
        internesZiel('/portal/mein?stempel=schon_offen', '/portal', anfrage), 303);
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`/portal/mein?stempel=${ergebnis}`, '/portal', anfrage), 303);
}
