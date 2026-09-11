import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/personal/anstellungen` — die Beschäftigungen dieser
 * Gesellschaft (D-09, EMP-02).
 *
 * **Die Liste nennt BESCHÄFTIGUNGEN, nicht Menschen.** Wer für zwei
 * Gesellschaften arbeitet, steht in beiden Listen mit einer eigenen
 * Personalnummer, einem eigenen Eintritt und einem eigenen Konto — das ist
 * D-09 und nicht eine Doppelung.
 *
 * **Kein Lohn, nirgends** (K-05): `anstellung.stundensatz_intern` ist
 * `cse_app` als Spaltenrecht entzogen. Diese Seite fragt ihn gar nicht erst
 * ab; sie könnte es auch nicht.
 *
 * Der Eintrag „Personal" in der Navigation zeigte bisher hierher — und hier
 * war nichts. Ein Menüpunkt auf einen 404 ist die teuerste Art, eine Lücke zu
 * zeigen.
 */
export const dynamic = 'force-dynamic';

interface Zeile {
  readonly id: string;
  readonly name: string;
  readonly personalnummer: string | null;
  readonly eintritt: string;
  readonly austritt: string | null;
  readonly status: string;
  readonly arbeitszeitmodell: string | null;
  readonly wochenstunden: string | null;
  readonly abwesend_offen: number;
}

const STATUS_TEXT: Readonly<Record<string, string>> = {
  aktiv: 'Aktiv',
  ruhend: 'Ruhend',
  beendet: 'Beendet',
};

export default async function Anstellungsliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/anstellungen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<Zeile>(
      /**
       * `abwesend_offen` zählt nur BEANTRAGTE Abwesenheiten — und auch das
       * nur, wenn die Sitzung `zeit.abwesenheit_lesen` hält; sonst gibt die
       * RLS nichts heraus und die Zahl ist 0. Sie ist ein Hinweis, keine
       * Kennzahl: „hier wartet eine Entscheidung".
       */
      `select a.id,
              (p.vorname || ' ' || p.nachname)      as name,
              a.personalnummer,
              to_char(a.eintritt, 'YYYY-MM-DD')     as eintritt,
              to_char(a.austritt, 'YYYY-MM-DD')     as austritt,
              a.status::text                        as status,
              a.arbeitszeitmodell,
              a.wochenstunden::text                 as wochenstunden,
              (select count(*) from abwesenheit ab
                where ab.mandant_id = a.mandant_id and ab.anstellung_id = a.id
                  and ab.status = 'beantragt')::int as abwesend_offen
         from anstellung a
         join person p on p.id = a.person_id
        where a.geloescht_am is null
        order by a.status, p.nachname, p.vorname`,
    ))) as Promise<readonly Zeile[]>);

  return (
    <PortalRahmen
      titel="Personal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Beschäftigungen</h1>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 Beschäftigung' : `${String(zeilen.length)} Beschäftigungen`}
        </p>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        <Link
          href={`/portal/${mandant}/personal/abwesenheiten`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Abwesenheiten
        </Link>
        <Link
          href={`/portal/${mandant}/personal/antraege`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Anträge
        </Link>
        <Link
          href={`/portal/${mandant}/personal/stundenkonten`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Stundenkonten
        </Link>
        <Link
          href={`/portal/${mandant}/personal/nachweise`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Nachweise
        </Link>
      </nav>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In dieser Gesellschaft ist niemand beschäftigt. Das ist eine Aussage
          über diese Gesellschaft — ein Mensch kann in einer anderen sehr wohl
          angestellt sein (D-09).
        </p>
      ) : (
        <DataTable
          beschriftung="Beschäftigungen dieser Gesellschaft"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'name', kopf: 'Person', zelle: (z) => z.name },
            {
              schluessel: 'nummer',
              kopf: 'Personalnummer',
              zelle: (z) => (
                <span className="tabular-nums">{z.personalnummer ?? '—'}</span>
              ),
            },
            {
              schluessel: 'eintritt',
              kopf: 'Eintritt',
              zelle: (z) => (
                <span className="tabular-nums">
                  {z.eintritt}
                  {z.austritt !== null && ` – ${z.austritt}`}
                </span>
              ),
            },
            {
              schluessel: 'modell',
              kopf: 'Arbeitszeit',
              zelle: (z) => (z.wochenstunden === null
                ? (z.arbeitszeitmodell ?? '—')
                : `${z.wochenstunden.replace('.', ',')} h/Woche`),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="flex flex-wrap items-center gap-s2 text-sm">
                  <span className={z.status === 'aktiv' ? 'text-text' : 'text-text-muted'}>
                    {STATUS_TEXT[z.status] ?? z.status}
                  </span>
                  {z.abwesend_offen > 0 && (
                    <Link
                      href={`/portal/${mandant}/personal/abwesenheiten`}
                      className="text-warning underline"
                    >
                      {z.abwesend_offen === 1
                        ? '1 offene Abwesenheit'
                        : `${String(z.abwesend_offen)} offene Abwesenheiten`}
                    </Link>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Der Stundensatz steht hier nicht und lässt sich hier auch nicht
        erfragen: er ist der Anwendungsrolle als Spaltenrecht entzogen und
        hängt an einem eigenen, protokollierten Weg (K-05).
      </p>
    </PortalRahmen>
  );
}
