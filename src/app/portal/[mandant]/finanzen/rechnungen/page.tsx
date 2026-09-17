import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '../../../rechte';

/**
 * `/portal/[mandant]/finanzen/rechnungen` — das Rechnungsausgangsbuch
 * (FIN-02, FIN-16).
 *
 * **Die Statusabbildung steht hier und nicht im Datenmodell.** DESIGN §5
 * fuehrt ein FESTES Pillenvokabular, und `Festgeschrieben`, `Storniert` und
 * `Verworfen` stehen nicht darin. Sie hier zu erfinden hiesse, an DESIGN.md
 * vorbei eine Beschriftung einzufuehren, die der Rest der Plattform nicht
 * kennt — also wird auf das vorhandene Vokabular abgebildet und die
 * Rechnungsart steht als eigene Spalte daneben, wo sie ohnehin hingehoert:
 * ob ein Beleg ein Storno ist, ist keine Zustandsfrage.
 *
 * `02-datenmodell/05-FINANZEN.md` §2.3 Nr. 8 verlangt die sechs fehlenden
 * Pillen von DESIGN §5; bis sie dort stehen, bleibt es bei dieser Abbildung.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  // „Abgeschlossen" und nicht „Festgeschrieben": das Wort fehlt DESIGN §5.
  festgeschrieben: 'Abgeschlossen',
  verworfen: 'Archiviert',
};

const ART: Readonly<Record<string, string>> = {
  standard: 'Rechnung',
  abschlag: 'Abschlag',
  anzahlung: 'Anzahlung',
  schluss: 'Schlussrechnung',
  storno: 'Storno',
};

interface Zeile {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsart: string;
  readonly kunde: string;
  readonly brutto_cent: string;
  readonly rechnungsdatum: string | null;
  readonly faellig_am: string | null;
  readonly storniert_durch: string | null;
}

export default async function Rechnungsliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  /* Der Monat aus den Monatszahlen (DSH-04): `?monat=YYYY-MM` filtert nach Rechnungsdatum. */
  const suche = await searchParams;
  const monatRoh = typeof suche['monat'] === 'string' ? suche['monat'] : null;
  const monat = monatRoh !== null && /^\d{4}-\d{2}$/u.test(monatRoh) ? monatRoh : null;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/rechnungen`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;

  /* AUT-06: ein Knopf, dessen Ziel diese Sitzung nicht oeffnen darf,
     verraet die Existenz dessen, was er nicht zeigen darf. */
  const darf = await haeltRechte(sitzung, 'finanzen.schreiben');
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<Zeile>(
      /**
       * `storniert_durch` ist eine ABFRAGE ueber `zu_rechnung_id` und keine
       * Spalte: die Umkehrlesart wird nicht gespeichert, weil eine zweite
       * Zeile eine zweite Kopie derselben Tatsache waere (§4.8).
       */
      `select r.id, r.nummer, r.status::text as status,
              r.rechnungsart::text as rechnungsart, k.name as kunde,
              r.brutto_cent::text,
              to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
              to_char(r.faellig_am, 'DD.MM.YYYY') as faellig_am,
              (select s.nummer from rechnung_beziehung b
                 join rechnung s on s.id = b.von_rechnung_id
                where b.zu_rechnung_id = r.id and b.art = 'storno'
                limit 1) as storniert_durch
         from rechnung r
         join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
        where ($1::text is null or to_char(r.rechnungsdatum, 'YYYY-MM') = $1)
        order by r.nummer_laufend desc nulls first, r.erstellt_am desc`,
      [monat]))) as Promise<readonly Zeile[]>);

  return (
    <PortalRahmen
      titel="Rechnungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Rechnungen</h1>
        {monat === null ? null : (
          <p data-cse="monat-filter" className="text-sm text-text-muted">
            Rechnungsdatum im Monat <strong>{monat.slice(5, 7)}/{monat.slice(0, 4)}</strong>{' '}
            <Link href={`/portal/${mandant}/finanzen/rechnungen`} className="underline underline-offset-2">alle zeigen</Link>
          </p>
        )}
        {darf['finanzen.schreiben'] === true && (
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/neu`}
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
          >
            Neuer Entwurf
          </Link>
        )}
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch keine Rechnung. Ein Entwurf trägt keine Nummer — die entsteht
          erst beim Festschreiben, und deshalb hinterlässt ein verworfener
          Entwurf auch keine Lücke.
        </p>
      ) : (
        <DataTable
          beschriftung="Rechnungen dieser Gesellschaft mit Nummer, Kunde, Betrag und Zustand"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/finanzen/rechnungen/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.nummer ?? <span className="text-text-subtle">ohne — Entwurf</span>}
                </Link>
              ),
            },
            { schluessel: 'art', kopf: 'Art', zelle: (z) => ART[z.rechnungsart] ?? z.rechnungsart },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde },
            {
              schluessel: 'brutto',
              kopf: 'Brutto',
              numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.brutto_cent))),
            },
            {
              schluessel: 'datum',
              kopf: 'Datum',
              zelle: (z) => z.rechnungsdatum ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'faellig',
              kopf: 'Fällig',
              zelle: (z) => z.faellig_am ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'status',
              kopf: 'Zustand',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={PILLE[z.status] ?? 'Entwurf'} />
                  {z.storniert_durch === null ? null : (
                    <span className="text-xs text-text-muted">
                      aufgehoben durch {z.storniert_durch}
                    </span>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
