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
import { haeltRechte } from '@/app/portal/rechte';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { lageVon, leseRegister, type Lage, type RegisterZeile } from './daten';

/**
 * `/portal/[mandant]/personal/nachweise` — das Nachweisregister mit der
 * 60/30/7-Eskalation (SEC-02, SEC-03, EMP-08, LEG-04).
 *
 * **Der Ablaufwächter meldete bisher an niemanden.** `meldeAblaufwarnungen`
 * quittiert seine Stufen seit PR 31 sauber in `nachweis_warnung` — nur gab es
 * keinen Bildschirm, auf dem jemand die Lage sieht. Und es ist genau die Lage,
 * die eine Einteilung verhindert: `assertZuordnungZulaessig` sperrt hart, wenn
 * ein § 34a-Nachweis am Einsatztag nicht mehr deckt. Die Planerin sah bis
 * hierher die Sperre, aber nicht ihren Grund und nicht ihr Datum.
 *
 * **Sortiert nach Ablauf, nicht nach Namen.** Ein Register, das alphabetisch
 * beginnt, verlangt vom Leser, das Dringende selbst zu suchen. Unbefristete
 * Nachweise stehen am Ende — sie sind nie dringend.
 *
 * **Die Schwellen kommen aus `qualifikation.warnung_tage`**, derselben Quelle,
 * nach der der Wächter meldet. Eine Konstante in dieser Seite wäre eine zweite
 * Wahrheit über „kritisch".
 */
export const dynamic = 'force-dynamic';

const LAGE_TEXT: Readonly<Record<Lage, string>> = {
  abgelaufen: 'Abgelaufen',
  kritisch: 'Läuft bald ab',
  warnung: 'Im Vorwarnfenster',
  gueltig: 'Gültig',
  unbefristet: 'Unbefristet',
  ungueltig: 'Widerrufen',
};

/** DESIGN §9: Farbe ist nie das einzige Signal — der Text steht daneben. */
const LAGE_KLASSE: Readonly<Record<Lage, string>> = {
  abgelaufen: 'text-danger',
  kritisch: 'text-warning',
  warnung: 'text-warning',
  gueltig: 'text-text',
  unbefristet: 'text-text-muted',
  ungueltig: 'text-text-muted',
};

function restText(z: RegisterZeile): string {
  if (z.restTage === null) return 'unbefristet';
  if (z.restTage < 0) {
    const tage = Math.abs(z.restTage);
    return tage === 1 ? 'seit 1 Tag abgelaufen' : `seit ${String(tage)} Tagen abgelaufen`;
  }
  if (z.restTage === 0) return 'läuft heute ab';
  return z.restTage === 1 ? 'noch 1 Tag' : `noch ${String(z.restTage)} Tage`;
}

export default async function Nachweisregister({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/nachweise`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: „Beschäftigungen" verlangt laut Manifest `personal.lesen`, das
     Nachweisblatt `…/nachweise/[id]` `personal.nachweis_verwalten`; dieses
     Register öffnet mit `personal.nachweis_lesen` allein. Ohne das Recht
     führte der Verweis auf 404 und verriet, was er nicht zeigen darf
     (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'personal.lesen', 'personal.nachweis_verwalten');

  const frage = await searchParams;
  const filter = typeof frage['lage'] === 'string' ? frage['lage'] : null;
  const heute = await berlinHeute();

  const alle = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, (kontext) => leseRegister(kontext, heute)),
  ) as Promise<readonly RegisterZeile[]>);

  const mitLage = alle.map((z) => ({ zeile: z, lage: lageVon(z) }));
  const zaehle = (l: Lage): number => mitLage.filter((m) => m.lage === l).length;
  const sperrend = mitLage.filter(
    (m) => m.lage === 'abgelaufen' && m.zeile.blockiertEinsatz).length;

  const gezeigt = filter === null
    ? mitLage
    : mitLage.filter((m) => m.lage === filter);

  return (
    <PortalRahmen
      titel="Nachweise"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Nachweise</h1>
        <p className="m-0 text-sm text-text-muted">
          Stichtag <span className="tabular-nums">{heute}</span>
          {' · '}
          {alle.length === 1 ? '1 Nachweis' : `${String(alle.length)} Nachweise`}
        </p>
      </div>

      <nav aria-label="Lage filtern" className="mb-s5 flex flex-wrap items-center gap-s2">
        <Filter mandant={mandant} wert={null} aktiv={filter} text="Alle" />
        <Filter mandant={mandant} wert="abgelaufen" aktiv={filter} text="Abgelaufen" />
        <Filter mandant={mandant} wert="kritisch" aktiv={filter} text="Läuft bald ab" />
        <Filter mandant={mandant} wert="warnung" aktiv={filter} text="Vorwarnfenster" />
        {darf['personal.lesen'] === true && (
          <Link
            href={`/portal/${mandant}/personal/anstellungen`}
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
          >
            Beschäftigungen
          </Link>
        )}
      </nav>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiStat
          label="Abgelaufen"
          wert={String(zaehle('abgelaufen'))}
          icon="fehler"
          ton={zaehle('abgelaufen') === 0 ? 'muted' : 'danger'}
        />
        <KpiStat
          label="Sperrt Einsätze"
          wert={String(sperrend)}
          icon="schloss"
          ton={sperrend === 0 ? 'muted' : 'danger'}
        />
        <KpiStat
          label="Läuft bald ab"
          wert={String(zaehle('kritisch'))}
          icon="warnung"
          ton={zaehle('kritisch') === 0 ? 'muted' : 'warning'}
        />
        <KpiStat
          label="Gültig"
          wert={String(zaehle('gueltig') + zaehle('unbefristet'))}
          icon="ok"
          ton="success"
        />
      </div>

      {sperrend > 0 && (
        <p
          data-cse="nachweis-sperre"
          className="mb-s5 max-w-prose rounded-lg border border-danger bg-danger-soft p-s4 text-sm text-danger"
        >
          {sperrend === 1
            ? 'Ein abgelaufener Nachweis sperrt die Einteilung hart'
            : `${String(sperrend)} abgelaufene Nachweise sperren die Einteilung hart`}
          {' '}
          (SEC-04, § 34a GewO). Die Sperre lässt sich nicht übergehen — auch
          nicht mit einer Begründung. Wer eingeteilt werden soll, braucht einen
          Nachweis, der den Einsatztag deckt.
        </p>
      )}

      {gezeigt.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {alle.length === 0
            ? 'In diesem Bereich ist kein Nachweis erfasst. Das ist eine Aussage über das Register, nicht über die Menschen — ein Nachweis hängt am Menschen (D-09) und wird von der Gesellschaft erfasst, die ihn geprüft hat.'
            : 'Zu diesem Filter steht nichts an.'}
        </p>
      ) : (
        <DataTable
          beschriftung="Nachweisregister"
          zeilen={gezeigt}
          schluessel={(m) => m.zeile.nachweisId}
          spalten={[
            {
              schluessel: 'person',
              kopf: 'Person',
              // Ohne `personal.nachweis_verwalten` bleibt der Name — nur der Weg
              // zum Blatt fällt weg (AUT-06, s. o.).
              zelle: (m) => (darf['personal.nachweis_verwalten'] === true
                ? (
                  <Link
                    href={`/portal/${mandant}/personal/nachweise/${m.zeile.nachweisId}`}
                    className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                  >
                    {m.zeile.name}
                  </Link>
                )
                : <span className="text-text">{m.zeile.name}</span>),
            },
            {
              schluessel: 'qualifikation',
              kopf: 'Nachweis',
              zelle: (m) => (
                <span>
                  {m.zeile.qualifikation}
                  {m.zeile.blockiertEinsatz && (
                    <span className="ml-s2 text-micro uppercase tracking-[0.08em] text-danger">
                      sperrend
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'gueltig',
              kopf: 'Gültig',
              zelle: (m) => (
                <span className="tabular-nums">
                  {m.zeile.gueltigAb}
                  {' – '}
                  {m.zeile.gueltigBis ?? 'unbefristet'}
                </span>
              ),
            },
            {
              schluessel: 'rest',
              kopf: 'Restlaufzeit',
              numerisch: true,
              zelle: (m) => (
                <span className={LAGE_KLASSE[m.lage]}>{restText(m.zeile)}</span>
              ),
            },
            {
              schluessel: 'gemeldet',
              kopf: 'Gewarnt',
              zelle: (m) => (m.zeile.gemeldeteStufen.length === 0
                ? <span className="text-text-muted">—</span>
                : (
                  <span className="tabular-nums text-text-muted">
                    {m.zeile.gemeldeteStufen.map((s) => `${String(s)} T`).join(' · ')}
                  </span>
                )),
            },
            {
              schluessel: 'lage',
              kopf: 'Lage',
              zelle: (m) => <span className={LAGE_KLASSE[m.lage]}>{LAGE_TEXT[m.lage]}</span>,
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Das Register führt Nachweise von MENSCHEN (D-09). Wer in zwei
        Gesellschaften der Gruppe beschäftigt ist, hat einen Nachweis — nicht
        zwei Kopien, die auseinanderlaufen. Sichtbar ist er hier, weil die
        Person in diesem Bereich beschäftigt ist; Entgeltdaten der anderen
        Gesellschaft trägt diese Seite nicht und kann sie auch nicht erfragen
        (K-05).
      </p>
    </PortalRahmen>
  );
}

function Filter({
  mandant, wert, aktiv, text,
}: {
  mandant: string; wert: string | null; aktiv: string | null; text: string;
}) {
  const ist = wert === aktiv;
  return (
    <Link
      href={wert === null
        ? `/portal/${mandant}/personal/nachweise`
        : `/portal/${mandant}/personal/nachweise?lage=${wert}`}
      aria-current={ist ? 'true' : undefined}
      className={[
        'inline-flex min-h-11 items-center rounded-md border px-s3 text-sm',
        'transition-colors duration-fast',
        ist
          ? 'border-line-strong bg-surface-2 text-text'
          : 'border-line text-text-muted hover:border-line-strong hover:text-text',
      ].join(' ')}
    >
      {text}
    </Link>
  );
}
