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
import { berlinAnzeige } from '@/server/services/zeit/dauer';
import { nachweislage, type Nachweislage } from '@/server/services/nachweis/uebersicht';
import { kennungOder404 } from '../../../../kennung';
import {
  lageVon, leseNachweis, leseWarnungen, type RegisterZeile, type WarnungZeile,
} from '../daten';

/**
 * `/portal/[mandant]/personal/nachweise/[id]` — ein Nachweis, sein
 * Quittungsbuch und die übrige Lage des Menschen (SEC-02, SEC-03, EMP-08).
 *
 * **Das Quittungsbuch ist der Grund, warum es diese Seite gibt.** „Läuft in 30
 * Tagen ab" ist eine Meldung, die jemand bekommen haben muss. Ohne die Liste
 * der quittierten Stufen liesse sich nicht unterscheiden, ob niemand gewarnt
 * wurde oder ob alle die Warnung ignoriert haben — zwei sehr verschiedene
 * Gespräche, und nur eines davon ist ein Fehler der Plattform.
 *
 * **Der Registerstatus sagt, WOHER er kommt.** Es gibt keine Schnittstelle zum
 * Bewacherregister; der Status ist handerfasst, und die Seite schreibt das hin
 * (CLAUDE.md: keine vorgetäuschten Anbindungen).
 */
export const dynamic = 'force-dynamic';

const STATUS_TEXT: Readonly<Record<string, string>> = {
  beantragt: 'Beantragt',
  gueltig: 'Gültig',
  abgelaufen: 'Abgelaufen',
  widerrufen: 'Widerrufen',
  abgelehnt: 'Abgelehnt',
};

export default async function Nachweisblatt({
  params,
}: {
  params: Promise<{ mandant: string; id: string }>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/personal/nachweise/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const heute = await berlinHeute();
  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const kopf = await leseNachweis(kontext, heute, id);
      if (kopf === null) return { kopf: null, warnungen: [], lage: null };
      return {
        kopf,
        warnungen: await leseWarnungen(kontext, id),
        /**
         * Der Dienst aus PR 31 — er liest den PERSONENKOPF und rührt
         * `anstellung` nicht an. Die Seite baut sich die Liste deshalb nicht
         * selbst zusammen: ein eigener Join „nur für die Personalnummer"
         * trüge den Stundensatz der anderen Gesellschaft mit hinaus (K-05).
         */
        lage: await nachweislage(
          { unsafe: (s: string, w?: readonly unknown[]) => kontext.abfrage(s, w) },
          kopf.personId, heute),
      };
    }),
  ) as Promise<{
    kopf: RegisterZeile | null;
    warnungen: readonly WarnungZeile[];
    lage: Nachweislage | null;
  }>);

  // Kein Unterschied zwischen „gibt es nicht" und „darfst du nicht sehen":
  // ein 403 bestätigte die Existenz (AUT-06).
  if (daten.kopf === null || daten.lage === null) notFound();
  const { kopf, warnungen, lage } = daten;
  const zustand = lageVon(kopf);

  return (
    <PortalRahmen
      titel="Nachweis"
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
          {kopf.qualifikation}
          {' · '}
          Stichtag <span className="tabular-nums">{heute}</span>
        </p>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        <Link
          href={`/portal/${mandant}/personal/nachweise`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Zum Register
        </Link>
      </nav>

      {zustand === 'abgelaufen' && kopf.blockiertEinsatz && (
        <p
          data-cse="nachweis-sperre"
          className="mb-s5 max-w-prose rounded-lg border border-danger bg-danger-soft p-s4 text-sm text-danger"
        >
          Dieser Nachweis ist abgelaufen und sperrt die Einteilung hart
          (SEC-04, § 34a GewO). Die Sperre lässt sich nicht mit einer Begründung
          übergehen — anders als eine Arbeitszeitwarnung.
        </p>
      )}

      <dl className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
        <Feld name="Status" wert={STATUS_TEXT[kopf.status] ?? kopf.status} />
        <Feld name="Gültig ab" wert={kopf.gueltigAb} zahl />
        <Feld name="Gültig bis" wert={kopf.gueltigBis ?? 'unbefristet'} zahl />
        <Feld name="Nummer" wert={kopf.nummer ?? '—'} />
        <Feld name="Ausstellende Stelle" wert={kopf.ausstellendeStelle ?? '—'} />
        <Feld
          name="Sperrt Einsätze"
          wert={kopf.blockiertEinsatz ? 'Ja — harte Sperre (SEC-04)' : 'Nein'}
        />
        <Feld
          name="Warnstufen"
          wert={kopf.stufen.length === 0
            ? 'keine hinterlegt'
            : kopf.stufen.map((s) => `${String(s)} Tage`).join(' · ')}
        />
        <Feld
          name="Dokument"
          wert={kopf.dokumentId === null ? 'nicht hinterlegt' : 'hinterlegt'}
        />
        {kopf.widerrufenAm !== null && (
          <Feld name="Widerrufen am" wert={berlinAnzeige(kopf.widerrufenAm)} zahl />
        )}
      </dl>

      <h2 className="mb-s3 text-h3 text-text">Gemeldete Warnungen</h2>
      {warnungen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diesen Nachweis hat der Ablaufwächter noch keine Stufe gemeldet.
          Das heisst nicht „alles in Ordnung": es heisst, dass keine Schwelle
          unterschritten war, als der Wächter zuletzt lief.
        </p>
      ) : (
        <DataTable
          beschriftung="Quittungsbuch des Ablaufwächters"
          zeilen={warnungen}
          schluessel={(w) => `${w.gueltigBis}:${String(w.stufeTage)}`}
          spalten={[
            {
              schluessel: 'stufe',
              kopf: 'Stufe',
              numerisch: true,
              zelle: (w) => `${String(w.stufeTage)} Tage`,
            },
            {
              schluessel: 'bezug',
              kopf: 'Bezogen auf Ablauf',
              zelle: (w) => <span className="tabular-nums">{w.gueltigBis}</span>,
            },
            {
              schluessel: 'wann',
              kopf: 'Gemeldet',
              zelle: (w) => (
                <span className="tabular-nums">{berlinAnzeige(w.ausgeloestAm)}</span>
              ),
            },
          ]}
        />
      )}

      <h2 className="mb-s3 mt-s6 text-h3 text-text">Weitere Nachweise dieses Menschen</h2>
      <DataTable
        beschriftung="Nachweislage der Person"
        zeilen={lage.nachweise}
        schluessel={(n) => n.nachweisId}
        spalten={[
          {
            schluessel: 'bezeichnung',
            kopf: 'Nachweis',
            zelle: (n) => (n.nachweisId === kopf.nachweisId
              ? <span className="text-text">{n.bezeichnung} (dieser)</span>
              : (
                <Link
                  href={`/portal/${mandant}/personal/nachweise/${n.nachweisId}`}
                  className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                >
                  {n.bezeichnung}
                </Link>
              )),
          },
          {
            schluessel: 'gueltig',
            kopf: 'Gültig',
            zelle: (n) => (
              <span className="tabular-nums">
                {n.gueltigAb}
                {' – '}
                {n.gueltigBis ?? 'unbefristet'}
              </span>
            ),
          },
          {
            schluessel: 'stichtag',
            kopf: 'Deckt den Stichtag',
            zelle: (n) => (n.gueltigAmStichtag
              ? <span className="text-success">Ja</span>
              : (
                <span className={n.blockiertEinsatz ? 'text-danger' : 'text-warning'}>
                  Nein
                  {n.blockiertEinsatz && ' — sperrt'}
                </span>
              )),
          },
        ]}
      />

      <h2 className="mb-s3 mt-s6 text-h3 text-text">Bewacherregister (SEC-03)</h2>
      <div className="rounded-lg border border-line bg-surface p-s5 text-sm">
        {lage.bewacher.vorhanden ? (
          <dl className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <Feld name="Bewacher-ID" wert={lage.bewacher.bewacherId ?? '—'} zahl />
            <Feld name="Status" wert={lage.bewacher.status ?? '—'} />
            <Feld name="Gültig bis" wert={lage.bewacher.gueltigBis ?? 'unbefristet'} zahl />
            <Feld
              name="Deckt den Stichtag"
              wert={lage.bewacher.gueltigAmStichtag ? 'Ja' : 'Nein'}
            />
          </dl>
        ) : (
          <p className="m-0 text-text-muted">
            Für diesen Menschen ist kein Eintrag im Bewacherregister erfasst.
          </p>
        )}
        <p className="mb-0 mt-s4 text-text-muted">
          <strong className="text-text">Nicht verbunden.</strong> Es gibt keine
          Schnittstelle zum Bewacherregister; dieser Stand ist handerfasst
          (Quelle: {lage.bewacher.quelle}). Was hier steht, hat jemand
          abgetippt — nicht die Behörde bestätigt.
        </p>
      </div>
    </PortalRahmen>
  );
}

function Feld(
  { name, wert, zahl = false }: { name: string; wert: string; zahl?: boolean },
) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{name}</dt>
      <dd className={`m-0 mt-s1 text-base text-text${zahl ? ' tabular-nums' : ''}`}>
        {wert}
      </dd>
    </div>
  );
}
