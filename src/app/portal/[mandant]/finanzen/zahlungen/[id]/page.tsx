import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereIban } from '@/server/services/finanz/zahlung/iban';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/finanzen/zahlungen/[id]` — eine Zahlung und wohin sie
 * gegangen ist (FIN-14, ACC-04).
 *
 * **Der Bildschirm, der die Frage „wo ist das Geld hin" beantwortet.** Eine
 * Überweisung deckt oft mehrere Rechnungen, und ein Teil davon ist manchmal
 * gar kein Geld — ein Skonto nach §17 UStG, eine Bankgebühr, ein abgeschriebener
 * Rest. Ohne diese Liste steht in den Büchern eine Summe, deren Verbleib
 * niemand nachvollziehen kann.
 *
 * **Zurückgenommen wird durch STORNO, nie durch Löschen** (Invariante 8). Der
 * Auslöser aus 0121 gibt die Posten anschließend von selbst wieder frei.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly id: string;
  readonly zahlungsdatum: string;
  readonly valuta: string | null;
  readonly betrag_cent: string;
  readonly zahlungsmittel: string;
  readonly referenz: string | null;
  readonly notiz: string | null;
  readonly storniert_am: string | null;
  readonly storno_grund: string | null;
  readonly konto: string | null;
  readonly iban: string | null;
}

interface ZuordnungZeile {
  readonly id: string;
  readonly art: string;
  readonly betrag_cent: string;
  readonly notiz: string | null;
  readonly rechnungsnummer: string | null;
  readonly posten_art: string;
}

const ART: Readonly<Record<string, string>> = {
  zahlung: 'Zahlung',
  skonto: 'Skonto (§17 UStG)',
  gebuehr: 'Bankgebühr',
  differenz: 'Abgeschriebene Differenz',
  mahngebuehr: 'Mahngebühr',
  zins: 'Verzugszinsen',
  bauabzugsteuer_einbehalt: 'Einbehalt §48 EStG',
  ueberzahlung: 'Überzahlung — als Guthaben geführt',
};

const MITTEL: Readonly<Record<string, string>> = {
  ueberweisung: 'Überweisung',
  lastschrift: 'Lastschrift',
  bar: 'Barzahlung',
  karte: 'Kartenzahlung',
  verrechnung: 'Verrechnung',
};

export default async function ZahlungDetail(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/zahlungen/[id]`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kopf: (await kontext.abfrage<Kopf>(
        `select z.id, to_char(z.zahlungsdatum, 'DD.MM.YYYY') as zahlungsdatum,
                to_char(z.valuta, 'DD.MM.YYYY') as valuta, z.betrag_cent::text,
                z.zahlungsmittel::text as zahlungsmittel, z.referenz, z.notiz,
                to_char(z.storniert_am, 'DD.MM.YYYY') as storniert_am, z.storno_grund,
                b.bezeichnung as konto, b.iban
           from zahlung z
           left join bankkonto b on b.id = z.bankkonto_id and b.mandant_id = z.mandant_id
          where z.id = $1::uuid`, [id]))[0] ?? null,
      zeilen: await kontext.abfrage<ZuordnungZeile>(
        `select zz.id, zz.art::text as art, zz.betrag_cent::text, zz.notiz,
                r.nummer as rechnungsnummer, op.art::text as posten_art
           from zahlung_zuordnung zz
           join offener_posten op on op.id = zz.offener_posten_id
                                 and op.mandant_id = zz.mandant_id
           left join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
          where zz.zahlung_id = $1::uuid
          order by zz.erstellt_am`, [id]),
    }))) as Promise<{ kopf: Kopf | null; zeilen: readonly ZuordnungZeile[] }>);

  if (daten.kopf === null) notFound();
  const kopf = daten.kopf;

  const verteilt = daten.zeilen
    .filter((z) => ['zahlung', 'mahngebuehr', 'zins', 'ueberzahlung'].includes(z.art))
    .reduce((s, z) => s + BigInt(z.betrag_cent), 0n);
  const rest = BigInt(kopf.betrag_cent) - verteilt;

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel={`Zahlung vom ${kopf.zahlungsdatum}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zahlungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/zahlungen`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Zahlungen
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">
          {formatiereGeld(cent(BigInt(kopf.betrag_cent)))} vom {kopf.zahlungsdatum}
        </h1>
        {kopf.storniert_am === null ? null : <StatusPill zustand="Archiviert" />}
      </div>

      {kopf.storniert_am === null ? null : (
        <p className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          Storniert am {kopf.storniert_am}: {kopf.storno_grund}. Die betroffenen
          Forderungen sind dadurch wieder offen.
        </p>
      )}

      <dl className="mb-s7 grid max-w-prose grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">Zahlungsmittel</dt>
          <dd className="text-text">{MITTEL[kopf.zahlungsmittel] ?? kopf.zahlungsmittel}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Wertstellung</dt>
          <dd className="text-text">{kopf.valuta ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Konto</dt>
          <dd className="text-text">
            {kopf.konto === null ? '—' : `${kopf.konto} · ${formatiereIban(kopf.iban ?? '')}`}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Referenz</dt>
          <dd className="text-text">{kopf.referenz ?? '—'}</dd>
        </div>
      </dl>

      <section aria-labelledby="zuordnung-titel" className="mb-s7">
        <h2 id="zuordnung-titel" className="mb-s3 text-h2 text-text">Wohin sie gebucht wurde</h2>
        {daten.zeilen.length === 0 ? (
          <p className="rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
            Diese Zahlung ist keiner Forderung zugeordnet. Das Geld ist da und
            steht in keiner Rechnung.
          </p>
        ) : (
          <>
            <DataTable
              beschriftung="Zuordnungen dieser Zahlung mit Art, Betrag und Beleg"
              zeilen={daten.zeilen}
              schluessel={(z) => z.id}
              spalten={[
                { schluessel: 'art', kopf: 'Art', zelle: (z) => ART[z.art] ?? z.art },
                {
                  schluessel: 'beleg', kopf: 'Beleg',
                  zelle: (z) => z.rechnungsnummer
                    ?? (z.posten_art === 'debitor_guthaben' ? 'Guthaben des Kunden' : '—'),
                },
                {
                  schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
                  zelle: (z) => formatiereGeld(cent(BigInt(z.betrag_cent))),
                },
                {
                  schluessel: 'notiz', kopf: 'Begründung',
                  zelle: (z) => z.notiz ?? <span className="text-text-subtle">—</span>,
                },
              ]}
            />
            {rest === 0n ? null : (
              <p className="mt-s3 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
                {formatiereGeld(cent(rest))} dieser Zahlung sind keiner
                Forderung zugeordnet.
              </p>
            )}
          </>
        )}
      </section>

      {kopf.storniert_am !== null ? null : (
        <section aria-labelledby="storno-titel">
          <h2 id="storno-titel" className="mb-s3 text-h2 text-text">Zahlung stornieren</h2>
          <form
            method="post"
            action={`/api/finanzen/zahlungen?mandant=${mandant}`}
            className="max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="aktion" value="stornieren" />
            <input type="hidden" name="zahlungId" value={kopf.id} />
            <label className="block text-sm text-text" htmlFor="grund">
              Grund — er steht später allein in den Büchern
            </label>
            <input
              id="grund" name="grund" type="text" required minLength={5}
              placeholder="Lastschrift vom Kunden zurückgegeben" className={feld}
            />
            <p className="mt-s2 max-w-prose text-xs text-text-muted">
              Die Zahlung wird nicht gelöscht (Invariante 8). Sie bleibt mit
              ihrem Grund stehen, und die Forderungen, die sie geschlossen hat,
              sind danach wieder offen.
            </p>
            <button
              type="submit"
              className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
            >
              Stornieren
            </button>
          </form>
        </section>
      )}
    </PortalRahmen>
  );
}
