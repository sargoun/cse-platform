import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { monatsErster, monatVerschieben, monatsName } from '@/lib/datum/kalendertag';
import { stundenMinutenText } from '@/lib/datum/stunden';
import { leseMonatsliste, type KontoZeile } from './daten';

/**
 * `/portal/[mandant]/personal/stundenkonten` — Soll gegen Ist, Monat fuer
 * Monat (EMP-04, EMP-15, REP-04).
 *
 * **Diese Seite ist der erste Leser des Stundenkontos.** Der Dienst aus PR 37
 * bucht, sperrt und rechnet seit Wochen — nur sah es niemand. Eine Zahl, die
 * korrekt gefuehrt und nirgends angezeigt wird, ist im Betrieb dasselbe wie
 * keine Zahl.
 *
 * **Der Saldo steht nur da, wo eine Sollzeit hinterlegt ist.** `soll_minuten =
 * 0` heisst „nicht hinterlegt" (O-18) und nicht „nichts geschuldet"; der
 * gespeicherte Saldo ist dann rechnerisch die ganze geleistete Zeit. Als
 * „+152:30" angezeigt laese sich das als Ueberstundenberg, und aus dem wuerde
 * irgendwann eine Lohnzeile. Deshalb: `—` und der Grund daneben.
 *
 * **`offene Zeiten` ist der Grund, warum ein Monat nicht abgeschlossen werden
 * kann**, und steht darum in derselben Zeile wie das Konto. Der Abschluss
 * verweigert genau dann (`UnfreigegebeneZeitenFehler`), und wer die Zahl erst
 * dort saehe, erfuehre den Grund nach dem Scheitern.
 */
export const dynamic = 'force-dynamic';

const STATUS_TEXT: Readonly<Record<string, string>> = {
  offen: 'Offen',
  vorlaeufig: 'Vorläufig',
  gesperrt: 'Abgeschlossen',
};

export default async function Stundenkonten({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/stundenkonten`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const roh = typeof frage['monat'] === 'string' ? frage['monat'] : null;
  const monat = roh !== null && /^\d{4}-\d{2}(-\d{2})?$/u.test(roh)
    ? monatsErster(`${roh.slice(0, 7)}-01`)
    : monatsErster(await berlinHeute());

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, (kontext) => leseMonatsliste(kontext, monat)),
  ) as Promise<readonly KontoZeile[]>);

  const mitKonto = zeilen.filter((z) => z.kontoId !== null);
  const istSumme = mitKonto.reduce((s, z) => s + z.istMinuten, 0);
  const offeneZeiten = zeilen.reduce((s, z) => s + z.offeneZeiten, 0);
  const gesperrt = mitKonto.filter((z) => z.status === 'gesperrt').length;
  const ohneSoll = mitKonto.filter((z) => z.sollMinuten === 0).length;

  return (
    <PortalRahmen
      titel="Stundenkonten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Stundenkonten</h1>
        <p className="m-0 text-sm text-text-muted">{monatsName(monat)}</p>
      </div>

      <nav aria-label="Monat wechseln" className="mb-s5 flex flex-wrap items-center gap-s2">
        <Sprung mandant={mandant} ziel={monatVerschieben(monat, -1)} text="← Vormonat" />
        <Sprung mandant={mandant} ziel={monatsErster(await berlinHeute())} text="Aktueller Monat" />
        <Sprung mandant={mandant} ziel={monatVerschieben(monat, 1)} text="Folgemonat →" />
        <Link
          href={`/portal/${mandant}/personal/stundenkonten/abschluss?monat=${monat}`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Monatsabschluss
        </Link>
      </nav>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiStat
          label="Erfasst (Ist)"
          wert={stundenMinutenText(istSumme)}
          ton="info"
          icon="uhr"
        />
        <KpiStat
          label="Konten im Monat"
          wert={`${String(mitKonto.length)} von ${String(zeilen.length)}`}
          ton={mitKonto.length === zeilen.length ? 'success' : 'warning'}
          icon="personal"
        />
        <KpiStat
          label="Nicht freigegebene Zeiten"
          wert={String(offeneZeiten)}
          ton={offeneZeiten === 0 ? 'success' : 'warning'}
          icon="warnung"
        />
        <KpiStat
          label="Abgeschlossen"
          wert={`${String(gesperrt)} von ${String(mitKonto.length)}`}
          ton={gesperrt === 0 ? 'muted' : 'success'}
          icon="schloss"
        />
      </div>

      <div className="mt-s6">
        {zeilen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            In dieser Gesellschaft ist niemand beschäftigt — es gibt also auch
            kein Konto zu führen (D-09).
          </p>
        ) : (
          <DataTable
            beschriftung={`Stundenkonten ${monatsName(monat)}`}
            zeilen={zeilen}
            schluessel={(z) => z.anstellungId}
            spalten={[
              {
                schluessel: 'name',
                kopf: 'Beschäftigung',
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/personal/stundenkonten/${z.anstellungId}?jahr=${monat.slice(0, 4)}`}
                    className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                  >
                    {z.name}
                  </Link>
                ),
              },
              {
                schluessel: 'nummer',
                kopf: 'Personalnummer',
                zelle: (z) => <span className="tabular-nums">{z.personalnummer ?? '—'}</span>,
              },
              {
                schluessel: 'ist',
                kopf: 'Ist',
                numerisch: true,
                zelle: (z) => (z.kontoId === null
                  ? <span className="text-text-muted">—</span>
                  : stundenMinutenText(z.istMinuten)),
              },
              {
                schluessel: 'soll',
                kopf: 'Soll',
                numerisch: true,
                zelle: (z) => (z.kontoId === null || z.sollMinuten === 0
                  ? <span className="text-text-muted">nicht hinterlegt</span>
                  : stundenMinutenText(z.sollMinuten)),
              },
              {
                schluessel: 'vortrag',
                kopf: 'Vortrag',
                numerisch: true,
                zelle: (z) => (z.kontoId === null
                  ? <span className="text-text-muted">—</span>
                  : stundenMinutenText(z.saldoVortragMinuten)),
              },
              {
                schluessel: 'saldo',
                kopf: 'Saldo',
                numerisch: true,
                // Ohne Sollzeit gibt es keinen Saldo, nur eine Summe. Siehe Kopf.
                zelle: (z) => (z.kontoId === null || z.sollMinuten === 0
                  ? <span className="text-text-muted">—</span>
                  : (
                    <span className={z.saldoMinuten < 0 ? 'text-warning' : 'text-text'}>
                      {stundenMinutenText(z.saldoMinuten)}
                    </span>
                  )),
              },
              {
                schluessel: 'zeiten',
                kopf: 'Zeiten',
                numerisch: true,
                zelle: (z) => (z.zeiten === 0
                  ? <span className="text-text-muted">—</span>
                  : (
                    <span className="tabular-nums">
                      {String(z.zeiten)}
                      {z.offeneZeiten > 0 && (
                        <span className="text-warning">
                          {' · '}
                          {String(z.offeneZeiten)} offen
                        </span>
                      )}
                    </span>
                  )),
              },
              {
                schluessel: 'status',
                kopf: 'Status',
                zelle: (z) => (z.status === null
                  ? <span className="text-text-muted">Kein Konto</span>
                  : (
                    <span className={z.status === 'gesperrt' ? 'text-text-muted' : 'text-text'}>
                      {STATUS_TEXT[z.status] ?? z.status}
                    </span>
                  )),
              },
            ]}
          />
        )}
      </div>

      {ohneSoll > 0 && (
        <p className="mt-s5 max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
          {ohneSoll === 1
            ? 'Für ein Konto ist keine Sollzeit hinterlegt'
            : `Für ${String(ohneSoll)} Konten ist keine Sollzeit hinterlegt`}
          {' '}
          (O-18): wie viele Stunden ein Monat schuldet, hängt an Arbeitszeitmodell,
          Feiertagsbehandlung und Ausgleichszeitraum — vier Fragen, die niemand
          beantwortet hat. Solange sie offen sind, zeigt diese Seite die erfasste
          Zeit und keinen Saldo.
        </p>
      )}
    </PortalRahmen>
  );
}

function Sprung(
  { mandant, ziel, text }: { mandant: string; ziel: string; text: string },
) {
  return (
    <Link
      href={`/portal/${mandant}/personal/stundenkonten?monat=${ziel}`}
      className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
    >
      {text}
    </Link>
  );
}
