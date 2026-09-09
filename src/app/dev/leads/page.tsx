import { notFound } from 'next/navigation';
import type postgres from 'postgres';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { db } from '@/server/db/pool';
import { withOeffentlich } from '@/server/kontext/oeffentlich';

/**
 * Der Lead-Posteingang — die kleinste Ansicht, die REQ-05 beweisbar macht.
 *
 * **Warum unter `/dev` und nicht im Portal.** Das Portal braucht Anmeldung,
 * Sitzung und Mandantenumschalter; die kommen mit Phase 3. Diese Flaeche
 * zeigt, dass eine Einsendung als Lead mit Frist und Besitzer ankommt — mehr
 * behauptet sie nicht, und der Name sagt das. Sie ist in einem Deployment
 * abgeschaltet (`devFlaechenAn`), also 404.
 *
 * **Sie liest als Renderer** — also ohne `crm.lesen`. Genau deshalb steht hier
 * die Zusammenfassung aus `formular_eingang.daten` NICHT: der oeffentliche
 * Lesepfad kommt an Leads gar nicht heran, und das ist die Zusage aus
 * Akzeptanz (5). Was diese Seite zeigt, holt sie ueber die Definer-Funktion
 * `app.lead_posteingang`, die genau die Spalten herausgibt, die eine
 * Uebersicht braucht.
 */
export const dynamic = 'force-dynamic';

interface LeadZeile {
  leadnummer: string;
  betreff: string;
  firma_name: string | null;
  sla_frist_am: Date | string | null;
  eskalationsstufe: number;
  erste_reaktion_am: Date | string | null;
  mandant: string;
}

const berlin = (w: Date | string | null): string => {
  if (w === null) return '—';
  const d = w instanceof Date ? w : new Date(w);
  // Invariante 2: gespeichert UTC, angezeigt Europe/Berlin.
  return d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
};

export default async function LeadPosteingang() {
  if (!devFlaechenAn()) notFound();

  const zeilen = await (db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, async (kontext) =>
      kontext.abfrage<LeadZeile>(`select * from app.lead_posteingang()`),
    )) as Promise<readonly LeadZeile[]>);

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s5 p-s6">
      <h1 className="text-h1 text-text">Anfragen</h1>
      <p className="text-sm text-text-subtle">
        Die Reaktionszeit ist <strong>vorläufig</strong> auf 24 Stunden gesetzt (O-14) —
        sie ist noch nicht vom Mandanten bestätigt.
      </p>

      {zeilen.length === 0 ? (
        <p className="text-base text-text-muted">Noch keine Anfragen.</p>
      ) : (
        <table data-cse="lead-tabelle" className="w-full text-left text-sm">
          <caption className="sr-only">Eingegangene Angebotsanfragen</caption>
          <thead>
            <tr className="text-text-subtle">
              <th scope="col" className="p-s3">Nummer</th>
              <th scope="col" className="p-s3">Bereich</th>
              <th scope="col" className="p-s3">Firma</th>
              <th scope="col" className="p-s3">Frist</th>
              <th scope="col" className="p-s3">Stufe</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.leadnummer} data-cse="lead-zeile" className="border-t border-line">
                <td className="p-s3 text-text">{z.leadnummer}</td>
                <td className="p-s3 text-text-muted">{z.mandant}</td>
                <td className="p-s3 text-text-muted">{z.firma_name ?? '—'}</td>
                <td className="p-s3 text-text-muted" data-cse="lead-frist">
                  {berlin(z.sla_frist_am)}
                </td>
                <td className="p-s3 text-text-muted">{z.eskalationsstufe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
