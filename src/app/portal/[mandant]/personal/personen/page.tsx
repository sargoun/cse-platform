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
import { haeltRechte } from '@/app/portal/rechte';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { lesePersonen, spracheText, type PersonZeile } from './daten';

/**
 * `/portal/[mandant]/personal/personen` — die MENSCHEN (D-09, EMP-14).
 *
 * **Warum es diese Liste neben den Beschäftigungen gibt.** Die Kachel
 * „Personen" auf der Übersicht zählt seit PR 18 Menschen und führte bis
 * hierher auf eine Auffangseite: die Zahl stimmte, das Ziel war leer. Und die
 * beiden Listen sind wirklich verschieden — wer für zwei Gesellschaften
 * arbeitet, steht in `Beschäftigungen` zweimal und hier einmal. Genau darum
 * geht es in D-09: der Mensch gehört keiner Gesellschaft, die Beschäftigung
 * schon.
 *
 * **Kein Geburtsdatum und kein Entgelt.** Das erste hat sein eigenes Recht
 * (`personal.stammdaten_lesen`, Seitenkarte `personen/[id]/stammdaten`), das
 * zweite ist der Anwendungsrolle als Spaltenrecht entzogen (K-05).
 */
export const dynamic = 'force-dynamic';

export default async function Personenliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/personen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: „Nachweise" verlangt laut Manifest `personal.nachweis_lesen`,
     „Stundenkonten" `zeit.konto_lesen`; diese Liste öffnet mit `personal.lesen`
     allein. Ohne das Recht führte der Knopf auf 404 und verriet, was er nicht
     zeigen darf (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'personal.nachweis_lesen', 'zeit.konto_lesen');

  const heute = await berlinHeute();
  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, (kontext) => lesePersonen(kontext, heute)),
  ) as Promise<readonly PersonZeile[]>);

  const doppelt = zeilen.filter((z) => z.anstellungen > 1).length;

  return (
    <PortalRahmen
      titel="Personen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Personen</h1>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 Mensch' : `${String(zeilen.length)} Menschen`}
          {doppelt > 0 && ` · ${String(doppelt)} mit mehreren Beschäftigungen`}
        </p>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        <Verweis mandant={mandant} ziel="anstellungen" text="Beschäftigungen" />
        {darf['personal.nachweis_lesen'] === true && (
          <Verweis mandant={mandant} ziel="nachweise" text="Nachweise" />
        )}
        {darf['zeit.konto_lesen'] === true && (
          <Verweis mandant={mandant} ziel="stundenkonten" text="Stundenkonten" />
        )}
      </nav>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In dieser Gesellschaft ist niemand beschäftigt. Sichtbar ist ein
          Mensch hier, weil er hier arbeitet — `person` selbst trägt keinen
          Mandanten (D-09).
        </p>
      ) : (
        <DataTable
          beschriftung="Menschen, die in dieser Gesellschaft beschäftigt sind"
          zeilen={zeilen}
          schluessel={(z) => z.personId}
          spalten={[
            {
              schluessel: 'name',
              kopf: 'Name',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/personal/personen/${z.personId}`}
                  className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                >
                  {z.name}
                </Link>
              ),
            },
            {
              schluessel: 'sprache',
              kopf: 'Sprache',
              // EMP-12: Arbeiterbildschirme sprechen die Sprache des Menschen.
              zelle: (z) => spracheText(z.sprache),
            },
            {
              schluessel: 'telefon',
              kopf: 'Telefon',
              zelle: (z) => (z.telefon === null
                ? <span className="text-text-muted">—</span>
                : <span className="tabular-nums">{z.telefon}</span>),
            },
            {
              schluessel: 'anstellungen',
              kopf: 'Beschäftigungen',
              numerisch: true,
              zelle: (z) => (
                <span className="tabular-nums">
                  {String(z.aktiveAnstellungen)}
                  {z.anstellungen !== z.aktiveAnstellungen
                    && ` von ${String(z.anstellungen)}`}
                </span>
              ),
            },
            {
              schluessel: 'nachweise',
              kopf: 'Nachweise',
              numerisch: true,
              zelle: (z) => (z.nachweise === 0
                ? <span className="text-text-muted">—</span>
                : (
                  <span className="tabular-nums">
                    {String(z.nachweise)}
                    {z.nachweiseAbgelaufen > 0 && (
                      <span className="text-danger">
                        {' · '}
                        {String(z.nachweiseAbgelaufen)} abgelaufen
                      </span>
                    )}
                  </span>
                )),
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Diese Liste zählt Menschen, die Liste der Beschäftigungen zählt
        Arbeitsverhältnisse. Wer in zwei Gesellschaften der Gruppe arbeitet,
        steht dort zweimal und hier einmal — mit einer Personalnummer je
        Gesellschaft und einem einzigen Nachweisbestand (D-09).
      </p>
    </PortalRahmen>
  );
}

function Verweis(
  { mandant, ziel, text }: { mandant: string; ziel: string; text: string },
) {
  const klasse = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text';
  if (ziel === 'anstellungen') {
    return (
      <Link href={`/portal/${mandant}/personal/anstellungen`} className={klasse}>{text}</Link>
    );
  }
  if (ziel === 'nachweise') {
    return (
      <Link href={`/portal/${mandant}/personal/nachweise`} className={klasse}>{text}</Link>
    );
  }
  return (
    <Link href={`/portal/${mandant}/personal/stundenkonten`} className={klasse}>{text}</Link>
  );
}
