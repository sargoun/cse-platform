import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { monatszahlen, type Monatszahlen } from '@/server/services/buchhaltung/monatszahlen';
import { liesWirtschaftsjahr, wirtschaftsjahrVon } from '@/server/services/buchhaltung/wirtschaftsjahr';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/buchhaltung/monatszahlen` — Erloese, Aufwand, Ergebnis
 * je Monat des Wirtschaftsjahrs, BWA-artig (ACC-08, REP-01, PR 65, D-484).
 *
 * BWA-artig, keine Betriebswirtschaftliche Auswertung: die Zahlen kommen aus den Belegen nach
 * Rechnungsdatum, ohne Abgrenzung, Personal, Abschreibung. Jede Zahl fuehrt
 * auf die Liste des Monats (DSH-04); ein geschlossener Monat zeigt daneben,
 * was beim Schliessen eingefroren wurde.
 */
export const dynamic = 'force-dynamic';

const STATUS: Readonly<Record<string, 'Offen' | 'In Prüfung' | 'Abgeschlossen'>> = {
  offen: 'Offen', vorlaeufig_geschlossen: 'In Prüfung', geschlossen: 'Abgeschlossen',
};

export default async function MonatszahlenSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/buchhaltung/monatszahlen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * `/finanzen/rechnungen` verlangt laut Manifest `finanzen.lesen`,
   * `/finanzen/eingangsrechnungen` `eingang.lesen`; diese Seite oeffnet mit
   * `buchhaltung.lesen`. Wer die Monatszahlen lesen darf, darf nicht
   * zwangslaeufig die Listen dahinter oeffnen — die Zahl fuehrte dann auf 404
   * und verriete, was sie nicht zeigen darf (AUT-06, Copilot-Runde auf PR 16 /
   * D-581). Ohne das Recht steht der Betrag ohne Verweis.
   */
  const darf = await haeltRechte(zugang.sitzung, 'finanzen.lesen', 'eingang.lesen');
  const suche = await searchParams;
  const jahrRoh = typeof suche['jahr'] === 'string' ? suche['jahr'] : null;
  const gewaehlt = jahrRoh !== null && /^\d{4}$/u.test(jahrRoh) ? Number(jahrRoh) : null;

  const z = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const wj = await liesWirtschaftsjahr(kontext);
      const [heute] = await kontext.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
      const jahr = gewaehlt ?? wirtschaftsjahrVon(heute?.tag ?? '2026-01-01', wj);
      return monatszahlen(kontext, jahr, wj);
    })) as Promise<Monatszahlen>);

  const basis = `/portal/${mandant}/buchhaltung/monatszahlen`;
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2';
  const geld = (c: bigint) => <span className={c < 0n ? 'text-danger' : ''}>{formatiereGeld(c as never)}</span>;

  return (
    <PortalRahmen
      titel="Monatszahlen"
      wurzelTitel="Buchhaltung"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="buchhaltung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Monatszahlen {z.bezeichnung} <span className="text-h3 text-text-muted">(BWA-artig)</span></h1>
        <nav aria-label="Wirtschaftsjahr" data-cse="monatszahlen-jahr" className="flex gap-s2">
          <a href={`${basis}?jahr=${String(z.jahr - 1)}`} className={knopf}>‹ {String(z.jahr - 1)}</a>
          <a href={`${basis}?jahr=${String(z.jahr + 1)}`} className={knopf}>{String(z.jahr + 1)} ›</a>
        </nav>
      </div>
      <Hinweis cse="monatszahlen-lesart" className="mb-s5 max-w-prose">
        <strong>BWA-artig — keine Betriebswirtschaftliche Auswertung.</strong> Erlöse sind die festgeschriebenen Ausgangsrechnungen nach
        Rechnungsdatum (netto), Aufwand die freigegebenen und gebuchten Eingangsrechnungen nach
        Rechnungsdatum und Betriebsausgaben nach Belegdatum (netto), Ergebnis die Differenz. Personal, Abschreibungen, Abgrenzungen und Steuern fehlen — die
        Betriebswirtschaftliche Auswertung erstellt der Steuerberater aus dem DATEV-Export.
        Wirtschaftsjahr ab {String(z.wirtschaftsjahr.beginnTag)}.{String(z.wirtschaftsjahr.beginnMonat)}.
        {z.wirtschaftsjahr.istPlatzhalter ? ' — angenommen (O-05).' : '.'}
      </Hinweis>

      <ul data-cse="monatszahlen-summen" className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <li><KpiStat label="Erlöse netto" wert={formatiereGeld(z.summe.erloeseCent)} icon="rechnung" ton="success" /></li>
        <li><KpiStat label="Aufwand netto" wert={formatiereGeld(z.summe.aufwandCent)} icon="eingang" ton="info" /></li>
        <li><KpiStat label="Ergebnis (BWA-artig)" wert={formatiereGeld(z.summe.ergebnisCent)} icon="uebersicht"
                     ton={z.summe.ergebnisCent < 0n ? 'danger' : 'muted'} /></li>
      </ul>

      <DataTable
        beschriftung={`Monatszahlen ${z.bezeichnung} — Erlöse, Aufwand, Ergebnis je Monat`}
        zeilen={z.monate}
        schluessel={(m) => m.monat}
        spalten={[
          { schluessel: 'monat', kopf: 'Monat', zelle: (m) => m.label },
          { schluessel: 'erloese', kopf: 'Erlöse netto', numerisch: true,
            zelle: (m) => (darf['finanzen.lesen'] === true ? (
              <Link href={`/portal/${mandant}/finanzen/rechnungen?monat=${m.monat}`} data-cse="monat-erloese"
                    className="underline-offset-2 hover:text-brand hover:underline">
                {geld(m.erloeseCent)}
              </Link>
            ) : geld(m.erloeseCent)) },
          { schluessel: 'rechnungen', kopf: 'Rechnungen', numerisch: true, zelle: (m) => String(m.rechnungen) },
          /*
            * **Aufwand aus zwei Quellen** (V-215): Eingangsrechnungen und
            * Betriebsausgaben — je mit ihrem Verweis, und die Summe daneben.
            * Vorher stand hier nur die erste, und das Ergebnis war um jede
            * gebuchte Tankquittung zu hoch.
            */
          { schluessel: 'eingang', kopf: 'Eingangsrechnungen netto', numerisch: true,
            zelle: (m) => (darf['eingang.lesen'] === true ? (
              <Link href={`/portal/${mandant}/finanzen/eingangsrechnungen?monat=${m.monat}`} data-cse="monat-eingang"
                    className="underline-offset-2 hover:text-brand hover:underline">
                {geld(m.aufwandEingangCent)}
              </Link>
            ) : geld(m.aufwandEingangCent)) },
          { schluessel: 'ausgaben', kopf: 'Betriebsausgaben netto', numerisch: true,
            zelle: (m) => (darf['eingang.lesen'] === true ? (
              <Link href={`/portal/${mandant}/finanzen/ausgaben?monat=${m.monat}`} data-cse="monat-ausgaben"
                    className="underline-offset-2 hover:text-brand hover:underline">
                {geld(m.aufwandAusgabenCent)}
              </Link>
            ) : geld(m.aufwandAusgabenCent)) },
          { schluessel: 'aufwand', kopf: 'Aufwand netto', numerisch: true,
            zelle: (m) => <span data-cse="monat-aufwand" data-cent={m.aufwandCent.toString()}>{geld(m.aufwandCent)}</span> },
          { schluessel: 'ergebnis', kopf: 'Ergebnis', numerisch: true,
            zelle: (m) => <strong data-cse="monat-ergebnis" data-cent={m.ergebnisCent.toString()}>{geld(m.ergebnisCent)}</strong> },
          { schluessel: 'periode', kopf: 'Monat',
            zelle: (m) => (m.periode === null ? <span className="text-text-subtle">kein Buchungsmonat</span> : (
              <span className="inline-flex flex-wrap items-center gap-s2">
                <StatusPill zustand={STATUS[m.periode.status] ?? 'Offen'} />
                {m.periode.eingefroren === null ? null : (
                  <span className={`text-xs ${m.periode.abweichung ? 'text-warning' : 'text-text-muted'}`}
                        data-cse="monat-eingefroren" data-abweichung={m.periode.abweichung ? '1' : '0'}>
                    eingefroren {formatiereGeld(m.periode.eingefroren.ergebnisCent)}
                    {m.periode.abweichung ? ' — weicht ab: nachträglich kam ein Beleg mit altem Datum' : ''}
                  </span>
                )}
              </span>
            )) },
        ]}
      />
      <p className="mt-s4 text-xs text-text-subtle">
        Gruppensicht: <Link href={`/portal/gruppe/finanzen?jahr=${String(z.jahr)}`} className="underline underline-offset-2">Finanzen der Gruppe</Link> — die Summe der Gesellschaften, nach Kalenderjahr.
      </p>
    </PortalRahmen>
  );
}
