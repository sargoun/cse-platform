import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { LIEFERANTEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/lieferanten';
import { lieferanten, type LieferantZeile } from '@/server/services/finanz/lieferant';

/**
 * `/portal/[mandant]/finanzen/lieferanten` — die Kreditorenstammdaten
 * (V-006, FIN-14, ACC-05).
 *
 * **Der Befund war ein Pflichtfeld ohne Tabelleninhalt.**
 * `/finanzen/eingangsrechnungen/neu` verlangt einen Lieferanten; `lieferant`
 * trug seit `0123` Policy, Grant, Nummernindex, IBAN-Prüfung, §48-Datum und
 * einen Auslöser gegen Rechnungsbetrug — und keinen einzigen Erzeuger. Ausser
 * dem Seed konnte niemand eine Zeile anlegen, und damit war die
 * Kreditorenbuchhaltung für jede Gesellschaft ohne Demodaten unbenutzbar.
 */
export const dynamic = 'force-dynamic';

const RECHT_SCHREIBEN = 'eingang.schreiben';

export const metadata = { title: 'Lieferanten' };

export default async function Lieferanten(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/finanzen/lieferanten`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(LIEFERANTEN_TEXTE, zugang.sprache);

  const darf = await haeltRechte(zugang.sitzung, RECHT_SCHREIBEN);
  const suche = await searchParams;
  const auchArchivierte = suche['archiv'] === '1';

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => lieferanten(kontext, auchArchivierte))
  ) as Promise<readonly LieferantZeile[]>);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s2 flex flex-wrap items-center justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.titel}</h1>
        {darf[RECHT_SCHREIBEN] === true && (
          <Link
            href={`/portal/${mandant}/finanzen/lieferanten/neu`}
            data-cse="lieferant-neu"
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-s4
                       text-sm font-semibold text-white hover:bg-brand-hover"
          >
            {t.neu}
          </Link>
        )}
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      <nav aria-label={t.status} className="mb-s5 flex flex-wrap gap-s2">
        <Link
          href={auchArchivierte
            ? `/portal/${mandant}/finanzen/lieferanten`
            : `/portal/${mandant}/finanzen/lieferanten?archiv=1`}
          data-cse="lieferant-archivschalter"
          className="inline-flex min-h-11 items-center rounded-md border border-line
                     px-s3 text-sm text-text-muted transition-colors duration-fast
                     hover:border-line-strong hover:text-text"
        >
          {auchArchivierte ? t.statusAktiv : t.archivieren}
        </Link>
      </nav>

      {zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="keine-lieferanten" className="max-w-prose">
          <strong className="block">{t.keine}</strong>
          {t.keineErklaerung}
        </Hinweis>
      ) : (
        <DataTable
          beschriftung={t.titel}
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'nummer', kopf: t.nummer,
              zelle: (z) => (
                <Link href={`/portal/${mandant}/finanzen/lieferanten/${z.id}`}
                      data-cse="lieferant-blatt"
                      className="tabular-nums text-text underline-offset-2
                                 hover:text-brand hover:underline">
                  {z.lieferantennummer}
                </Link>
              ),
            },
            { schluessel: 'name', kopf: t.name, zelle: (z) => z.name },
            { schluessel: 'ort', kopf: t.ort, zelle: (z) => z.ort ?? '—' },
            {
              /*
               * **`gesperrt` traegt die `Fehler`-Pille** — nicht, weil ein
               * Fehler vorlaege, sondern weil DESIGN §5 ein GESCHLOSSENES
               * Vokabular fuehrt und „Gesperrt" nicht darin steht. Eine
               * eigene Pille waere hier erfunden; `portal/gruppe/kunden`
               * bildet denselben Zustand seit je auf denselben Ton ab, und
               * zwei Schreibweisen fuer eine Sache waeren schlimmer als eine
               * ungenaue. Das WORT steht daneben, damit die Farbe nicht das
               * einzige Signal ist (DESIGN §9).
               */
              schluessel: 'status', kopf: t.status,
              zelle: (z) => (
                <span className="flex flex-wrap items-center gap-s2">
                  <StatusPill sprache={zugang.sprache}
                              zustand={z.archiviert ? 'Archiviert'
                                : z.status === 'gesperrt' ? 'Fehler' : 'Aktiv'} />
                  {z.status === 'gesperrt' && !z.archiviert && (
                    <span className="text-xs text-text-muted">{t.statusGesperrt}</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'bau', kopf: t.bauleistung,
              zelle: (z) => (z.leistungsart === null ? '—'
                : z.leistungsart === 'bau' ? t.leistungsartBau : t.leistungsartReinigung),
            },
            {
              schluessel: 'rechnungen', kopf: t.rechnungen,
              zelle: (z) => String(z.rechnungen),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
