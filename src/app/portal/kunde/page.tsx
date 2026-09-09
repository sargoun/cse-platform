import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withKundeScope, KeinKundenzugangFehler } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../Anmeldung';
import { portalZugang } from '../zugang';

/**
 * `/portal/kunde` — das Kundenportal (AUT-01, DSH-03).
 *
 * **Es zeigt keine leeren Listen.** `kunde_zugang` entsteht mit dem CRM-Modul
 * (Phase 4); bis dahin gibt `app.sichtbare_mandanten()` im Kunden-Scope die
 * leere Menge zurueck — fail closed und ausdruecklich so dokumentiert. Eine
 * Uebersicht ueber dieser Menge zeigte "keine Auftraege", "keine Rechnungen",
 * "keine Nachweise", und das liest sich wie ein Kunde ohne Geschaeft. Wer die
 * beiden verwechselt, ruft beim Kunden an.
 *
 * Deshalb sagt diese Seite, was ist.
 */
export const dynamic = 'force-dynamic';

export default async function Kundenportal() {
  const zugang = await portalZugang('/portal/kunde');
  if (zugang === null) return <AnmeldungNoetig />;

  let zugriff = true;
  try {
    await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withKundeScope(tx, zugang.sitzung, async (kontext) =>
        kontext.abfrage(`select 1 as eins`))) as Promise<unknown>);
  } catch (fehler) {
    if (!(fehler instanceof KeinKundenzugangFehler)) throw fehler;
    zugriff = false;
  }

  return (
    <PortalRahmen
      titel="Kundenportal"
      bereich={null}
      nurLesen
      leiste={zugang.leiste}
      wurzel="/portal/kunde"
      aktiverTab="uebersicht"
      sichtbareTabs={zugang.sichtbareTabs}
    >
      <h1 className="mb-s5 text-h1 text-text">Übersicht</h1>
      {zugriff ? (
        <p className="text-base text-text-muted">
          Ihre Aufträge, Rechnungen und Nachweise erscheinen hier.
        </p>
      ) : (
        <p data-cse="kein-kundenzugang" className="max-w-[72ch] text-base text-text">
          Für diese Anmeldung ist noch kein Kundenzugang hinterlegt. Die
          Zuordnung von Zugängen zu Kunden entsteht mit dem CRM-Modul; bis
          dahin stünde hier eine Liste, die leer aussieht, obwohl sie nur noch
          nicht angeschlossen ist.
        </p>
      )}
    </PortalRahmen>
  );
}
