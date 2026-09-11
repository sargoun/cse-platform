import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { monatsErster, monatsName } from '@/lib/datum/kalendertag';
import { stundenMinutenText } from '@/lib/datum/stunden';
import { berlinAnzeige } from '@/server/services/zeit/dauer';
import { leseBewegungen, type Bewegung } from '@/server/services/zeit/stundenkonto';
import { leseJahr, leseKontoZeile, type JahresMonat, type KontoZeile } from '../daten';

/**
 * `/portal/[mandant]/personal/stundenkonten/[anstellungId]` — ein Konto, seine
 * zwoelf Monate und der Auszug dahinter (EMP-04, EMP-15).
 *
 * **Der Auszug ist der eigentliche Inhalt.** Ein Saldo ohne seine Buchungen ist
 * eine Behauptung: er sagt „+7:30", aber nicht, aus welcher Schicht das kam und
 * wer sie gebucht hat. Der Dienst fuehrt deshalb keinen Saldo, sondern eine
 * Buchungsreihe — und diese Seite zeigt sie in derselben Reihenfolge.
 *
 * **Der Vortrag steht in jeder Monatszeile.** Er ist die Klammer zwischen den
 * Monaten: ohne ihn liest sich ein Jahr als zwoelf unverbundene Zahlen, und der
 * Uebertrag, ueber den am Jahresende gestritten wird, waere nirgends sichtbar.
 */
export const dynamic = 'force-dynamic';

const STATUS_TEXT: Readonly<Record<string, string>> = {
  offen: 'Offen',
  vorlaeufig: 'Vorläufig',
  gesperrt: 'Abgeschlossen',
};

const ART_TEXT: Readonly<Record<string, string>> = {
  arbeitszeit: 'Arbeitszeit',
  abwesenheit: 'Abwesenheit',
  feiertag: 'Feiertag',
  korrektur: 'Korrektur',
  uebertrag: 'Übertrag',
  auszahlung: 'Auszahlung',
  freizeitausgleich: 'Freizeitausgleich',
};

const QUELLE_TEXT: Readonly<Record<string, string>> = {
  zeiteintrag: 'Zeiteintrag',
  abwesenheit: 'Abwesenheit',
  manuell: 'Manuell',
  import: 'Import',
  system: 'System',
};

export default async function Kontoblatt({
  params, searchParams,
}: {
  params: Promise<{ mandant: string; anstellungId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, anstellungId } = await params;
  const pfad = `/portal/${mandant}/personal/stundenkonten/${anstellungId}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const heute = await berlinHeute();
  const rohMonat = typeof frage['monat'] === 'string' ? frage['monat'] : null;
  const gewaehlterMonat = rohMonat !== null && /^\d{4}-\d{2}(-\d{2})?$/u.test(rohMonat)
    ? monatsErster(`${rohMonat.slice(0, 7)}-01`)
    : monatsErster(heute);
  const rohJahr = typeof frage['jahr'] === 'string' ? frage['jahr'] : null;
  const jahr = rohJahr !== null && /^\d{4}$/u.test(rohJahr)
    ? Number(rohJahr)
    : Number(gewaehlterMonat.slice(0, 4));

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const kopf = await leseKontoZeile(kontext, anstellungId, gewaehlterMonat);
      const monate = await leseJahr(kontext, anstellungId, jahr);
      const konto = monate.find(
        (m) => m.jahr === Number(gewaehlterMonat.slice(0, 4))
          && m.monat === Number(gewaehlterMonat.slice(5, 7)),
      ) ?? null;
      const bewegungen = konto === null
        ? []
        : await leseBewegungen(kontext, konto.kontoId);
      return { kopf, monate, konto, bewegungen };
    }),
  ) as Promise<{
    kopf: KontoZeile | null;
    monate: readonly JahresMonat[];
    konto: JahresMonat | null;
    bewegungen: readonly Bewegung[];
  }>);

  // Keine Zeile heisst hier: es gibt diese Beschaeftigung in diesem Bereich
  // nicht — oder die Sitzung darf sie nicht sehen. Beides ist ein 404, und
  // zwar derselbe: eine Unterscheidung verriete die Existenz (AUT-06).
  if (daten.kopf === null) notFound();
  const { kopf, monate, konto, bewegungen } = daten;

  const summeBewegungen = bewegungen.reduce((s, b) => s + b.minuten, 0);

  return (
    <PortalRahmen
      titel="Stundenkonto"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.name}</h1>
        <p className="m-0 text-sm text-text-muted">
          {kopf.personalnummer ?? 'ohne Personalnummer'}
          {' · '}
          Jahr <span className="tabular-nums">{String(jahr)}</span>
        </p>
      </div>

      <nav aria-label="Jahr wechseln" className="mb-s5 flex flex-wrap items-center gap-s2">
        <Sprung
          mandant={mandant}
          anstellungId={anstellungId}
          jahr={jahr - 1}
          monat={gewaehlterMonat}
          text={`← ${String(jahr - 1)}`}
        />
        <Sprung
          mandant={mandant}
          anstellungId={anstellungId}
          jahr={jahr + 1}
          monat={gewaehlterMonat}
          text={`${String(jahr + 1)} →`}
        />
        <Link
          href={`/portal/${mandant}/personal/stundenkonten?monat=${gewaehlterMonat}`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Alle Konten
        </Link>
      </nav>

      <h2 className="mb-s3 text-h3 text-text">Monate {String(jahr)}</h2>
      {monate.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für {String(jahr)} gibt es zu dieser Beschäftigung kein Konto. Das ist
          eine Aussage über das Jahr, nicht über die Person: Konten entstehen
          monatsweise, und ein Monat ohne Konto hat nie gebucht.
        </p>
      ) : (
        <DataTable
          beschriftung={`Monate ${String(jahr)}`}
          zeilen={monate}
          schluessel={(m) => m.kontoId}
          spalten={[
            {
              schluessel: 'monat',
              kopf: 'Monat',
              zelle: (m) => {
                const erster = `${String(m.jahr)}-${String(m.monat).padStart(2, '0')}-01`;
                return (
                  <Link
                    href={`/portal/${mandant}/personal/stundenkonten/${anstellungId}?monat=${erster}`}
                    className={erster === gewaehlterMonat
                      ? 'font-medium text-text underline decoration-line underline-offset-4'
                      : 'text-text underline decoration-line underline-offset-4 hover:decoration-current'}
                  >
                    {monatsName(erster)}
                  </Link>
                );
              },
            },
            {
              schluessel: 'ist',
              kopf: 'Ist',
              numerisch: true,
              zelle: (m) => stundenMinutenText(m.istMinuten),
            },
            {
              schluessel: 'korrektur',
              kopf: 'Korrektur',
              numerisch: true,
              zelle: (m) => (m.korrekturMinuten === 0
                ? <span className="text-text-muted">—</span>
                : stundenMinutenText(m.korrekturMinuten)),
            },
            {
              schluessel: 'soll',
              kopf: 'Soll',
              numerisch: true,
              zelle: (m) => (m.sollMinuten === 0
                ? <span className="text-text-muted">nicht hinterlegt</span>
                : stundenMinutenText(m.sollMinuten)),
            },
            {
              schluessel: 'vortrag',
              kopf: 'Vortrag',
              numerisch: true,
              zelle: (m) => stundenMinutenText(m.saldoVortragMinuten),
            },
            {
              schluessel: 'saldo',
              kopf: 'Saldo',
              numerisch: true,
              zelle: (m) => (m.sollMinuten === 0
                ? <span className="text-text-muted">—</span>
                : stundenMinutenText(m.saldoMinuten)),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (m) => (
                <span className={m.status === 'gesperrt' ? 'text-text-muted' : 'text-text'}>
                  {STATUS_TEXT[m.status] ?? m.status}
                  {m.gesperrtAm !== null && (
                    <>
                      {' · '}
                      <span className="tabular-nums">{berlinAnzeige(m.gesperrtAm)}</span>
                    </>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}

      <h2 className="mb-s3 mt-s6 text-h3 text-text">
        Auszug {monatsName(gewaehlterMonat)}
      </h2>
      {konto === null ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für {monatsName(gewaehlterMonat)} gibt es kein Konto — also auch keine
          Buchungen. Angelegt wird es beim ersten Buchen oder durch den
          Rollover, nicht durch das Öffnen dieser Seite.
        </p>
      ) : bewegungen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Das Konto steht, hat aber keine Buchung. Erfasste Zeit fließt erst mit
          der Freigabe auf das Konto (§ 7.3) — ungeprüfte Zeiten laufen nicht in
          den Lohn.
        </p>
      ) : (
        <>
          <DataTable
            beschriftung={`Buchungen ${monatsName(gewaehlterMonat)}`}
            zeilen={bewegungen}
            schluessel={(b) => b.id}
            spalten={[
              {
                schluessel: 'tag',
                kopf: 'Wirksam',
                zelle: (b) => <span className="tabular-nums">{b.wirksamAm}</span>,
              },
              {
                schluessel: 'art',
                kopf: 'Art',
                zelle: (b) => ART_TEXT[b.art] ?? b.art,
              },
              {
                schluessel: 'minuten',
                kopf: 'Dauer',
                numerisch: true,
                zelle: (b) => stundenMinutenText(b.minuten),
              },
              {
                schluessel: 'quelle',
                kopf: 'Quelle',
                zelle: (b) => (b.zeiteintragId === null
                  ? (QUELLE_TEXT[b.quelle] ?? b.quelle)
                  : (
                    <Link
                      href={`/portal/${mandant}/zeiten/${b.zeiteintragId}`}
                      className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                    >
                      {QUELLE_TEXT[b.quelle] ?? b.quelle}
                    </Link>
                  )),
              },
              {
                schluessel: 'grund',
                kopf: 'Begründung',
                zelle: (b) => b.begruendung ?? <span className="text-text-muted">—</span>,
              },
            ]}
          />
          <p className="mt-s3 text-sm text-text-muted">
            Summe der Buchungen:{' '}
            <span className="tabular-nums text-text">{stundenMinutenText(summeBewegungen)}</span>
            {' · '}
            geführtes Ist:{' '}
            <span className="tabular-nums text-text">{stundenMinutenText(konto.istMinuten)}</span>
            {summeBewegungen !== konto.istMinuten + konto.korrekturMinuten && (
              <span className="text-danger">
                {' · '}
                Die beiden Zahlen gehen auseinander — das ist ein Befund für den
                nächtlichen Abgleich, keine Anzeigefrage.
              </span>
            )}
          </p>
        </>
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Dieses Konto gehört zu EINER Beschäftigung. Wer in zwei Gesellschaften
        arbeitet, hat zwei Konten mit eigenen Zahlen (D-09); die zusammengefasste
        Zahl entsteht in der Personenansicht und wird nirgends gespeichert
        (EMP-15).
      </p>
    </PortalRahmen>
  );
}

function Sprung({
  mandant, anstellungId, jahr, monat, text,
}: {
  mandant: string; anstellungId: string; jahr: number; monat: string; text: string;
}) {
  return (
    <Link
      href={`/portal/${mandant}/personal/stundenkonten/${anstellungId}?jahr=${String(jahr)}&monat=${monat}`}
      className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
    >
      {text}
    </Link>
  );
}
