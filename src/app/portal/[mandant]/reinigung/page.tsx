import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { KpiStat } from '@/components/ui/KpiStat';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../unterseite';
import { ladeReinigungKopf, type ReinigungKopf } from '@/server/services/reinigung/uebersicht';
import { lesbareRegel } from '@/lib/datum/regeltext';

/**
 * `/portal/[mandant]/reinigung` — der Modulkopf der Gebäudereinigung
 * (CLN-01, CLN-02, CLN-04).
 *
 * **Drei Fragen, und die dritte ist die, die niemand stellt.** Was läuft
 * heute, was ist noch nicht unterschrieben — und *läuft der Generator noch*.
 * Eine Serie, deren `generiert_bis` in der Vergangenheit liegt, erzeugt keine
 * Schichten mehr; der Dienstplan sieht dann aus wie ein ruhiger Tag. Deshalb
 * steht „Generator steht" hier als eigene Kachel und nicht als Fussnote.
 *
 * **Jede Kachel sagt, ob sie geprüft wurde.** Die Route hält `reinigung.lesen`;
 * `einsatz` und `planungsserie` liegen hinter `dienstplan.lesen`,
 * `leistungsnachweis` hinter `nachweis.lesen`. Ohne diese Rechte filtert RLS
 * still, und eine Null wäre eine Entwarnung, die niemand geprüft hat. Steht
 * das Recht nicht, steht statt der Zahl „nicht geprüft" — im Text, nicht nur
 * in der Farbe (DESIGN §9).
 */
export const dynamic = 'force-dynamic';

const NACHWEIS_PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  vorgelegt: 'In Prüfung',
  signiert: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
  storniert: 'Archiviert',
};

/** Die eine Stelle, an der „nicht geprüft" formuliert wird. */
const UNGEPRUEFT = 'nicht geprüft';

export default async function ReinigungKopfSeite(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/reinigung`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* AUT-06: die Ziele hinter den Verweisen verlangen andere Rechte als dieser
     Kopf — `…/reinigung/leistungsnachweise/[id]` fordert `nachweis.lesen`,
     `…/dienstplan/woche` fordert `dienstplan.lesen`, `…/reinigung/turnus`
     fordert `reinigung.schreiben` für das Anlegen. Ein Verweis, der auf 404
     führt, verrät, was er nicht zeigen darf. */
  const darf = await haeltRechte(
    sitzung, 'nachweis.lesen', 'dienstplan.lesen', 'reinigung.schreiben',
  );

  const heute = await berlinHeute();
  const kopf = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) =>
      ladeReinigungKopf(kontext, heute))) as Promise<ReinigungKopf>);

  const unterbesetzt = kopf.schichtenHeute === null
    ? null
    : kopf.schichtenHeute.filter((s) => s.besetzt < s.soll).length;

  return (
    <PortalRahmen
      titel="Reinigung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Reinigung</h1>
        <p className="m-0 text-sm tabular-nums text-text-muted">
          Stand {heute} (Berlin)
        </p>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Revier, Turnus, Schicht, Nachweis — in dieser Reihenfolge entsteht eine
        Reinigungsleistung. Ein Revier ist die Fläche, ein Turnus die Regel, die
        Schicht der Termin und der Leistungsnachweis das Dokument, das der Kunde
        unterschreibt.
      </p>

      <div className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href={`/portal/${mandant}/reinigung/reviere`} className="group no-underline">
          <KpiStat
            label="Reviere"
            wert={String(kopf.reviere)}
            icon="objekt"
            ton="info"
            interaktiv
          />
        </Link>
        <KpiStat
          label="Schichten heute"
          wert={kopf.schichtenHeute === null ? UNGEPRUEFT : String(kopf.schichtenHeute.length)}
          icon="kalender"
          ton={kopf.schichtenHeute === null ? 'muted' : 'info'}
          {...(unterbesetzt !== null && unterbesetzt > 0
            ? { delta: { richtung: 'ab' as const, text: `${String(unterbesetzt)} unterbesetzt` } }
            : {})}
        />
        <KpiStat
          label="Nachweise offen"
          wert={kopf.offeneNachweise === null ? UNGEPRUEFT : String(kopf.offeneNachweise.length)}
          icon="dokument"
          ton={kopf.offeneNachweise === null || kopf.offeneNachweise.length === 0
            ? 'muted' : 'warning'}
        />
        <KpiStat
          label="Generator steht"
          wert={kopf.stehendeSerien === null ? UNGEPRUEFT : String(kopf.stehendeSerien.length)}
          icon="warnung"
          ton={kopf.stehendeSerien === null || kopf.stehendeSerien.length === 0
            ? 'muted' : 'danger'}
        />
      </div>

      {/* --- Liste 1: die Schichten des Berliner Kalendertages -------------- */}
      <section className="mb-s6" data-cse="reinigung-heute">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">Heute</h2>
          {darf['dienstplan.lesen'] === true && (
            <Link
              href={`/portal/${mandant}/dienstplan/woche`}
              className="text-sm underline hover:text-text"
            >
              Zum Dienstplan
            </Link>
          )}
        </div>

        {kopf.schichtenHeute === null ? (
          <Hinweis art="hinweis" cse="heute-ungeprueft" className="max-w-prose">
            <strong>Nicht geprüft.</strong> Die Schichten des Tages stehen im
            Dienstplan, und dieses Konto hält dessen Leserecht nicht. Das ist
            nicht dasselbe wie „heute ist nichts geplant".
          </Hinweis>
        ) : kopf.schichtenHeute.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für heute steht keine Reinigungsschicht im Plan. Stehen Turnusse
            daneben und der Generator ist gelaufen, heisst das: heute ist
            wirklich nichts angesetzt.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {kopf.schichtenHeute.map((s) => (
              <li
                key={s.id}
                data-cse="heute-schicht"
                className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3
                           border-b border-line pb-s2 text-sm last:border-0"
              >
                <span className="text-text">
                  <span className="tabular-nums text-text-muted">
                    {s.beginnLokal} – {s.endeLokal}
                  </span>
                  {' · '}
                  {s.objekt}
                  {s.revier !== null && ` · ${s.revier}`}
                </span>
                <span
                  className={`tabular-nums ${s.besetzt < s.soll ? 'text-warning' : 'text-text-muted'}`}
                >
                  {s.besetzt} von {s.soll} besetzt
                  {s.besetzt < s.soll && ' — es fehlen Kräfte'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Liste 2: Nachweise, die noch niemand unterschrieben hat -------- */}
      <section className="mb-s6" data-cse="reinigung-nachweise">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">Nachweise ohne Unterschrift</h2>
          {darf['nachweis.lesen'] === true && (
            <Link
              href={`/portal/${mandant}/reinigung/leistungsnachweise`}
              className="text-sm underline hover:text-text"
            >
              Alle Leistungsnachweise
            </Link>
          )}
        </div>

        {kopf.offeneNachweise === null ? (
          <Hinweis art="hinweis" cse="nachweise-ungeprueft" className="max-w-prose">
            <strong>Nicht geprüft.</strong> Leistungsnachweise liegen hinter dem
            Recht <code>nachweis.lesen</code>, das dieses Konto hier nicht hält.
          </Hinweis>
        ) : kopf.offeneNachweise.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Kein Nachweis im Entwurf und keiner beim Kunden. Jeder erfasste
            Leistungszeitraum ist unterschrieben oder abgeschlossen.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {kopf.offeneNachweise.map((n) => (
              <li
                key={n.id}
                data-cse="offener-nachweis"
                className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3
                           border-b border-line pb-s2 text-sm last:border-0"
              >
                <span className="text-text">
                  {darf['nachweis.lesen'] === true ? (
                    <Link
                      href={`/portal/${mandant}/reinigung/leistungsnachweise/${n.id}`}
                      className="underline hover:text-text"
                    >
                      {n.nummer ?? 'ohne Nummer'}
                    </Link>
                  ) : (n.nummer ?? 'ohne Nummer')}
                  {' · '}
                  {n.objekt ?? '—'}
                  <span className="ml-s2 text-text-muted">
                    {n.leistungszeitraumVon} – {n.leistungszeitraumBis}
                  </span>
                </span>
                <StatusPill zustand={NACHWEIS_PILLE[n.status] ?? 'Offen'} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Liste 3: die Gesundheit der Turnusse --------------------------- */}
      <section data-cse="reinigung-turnusgesundheit">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">Turnusse</h2>
          <Link
            href={`/portal/${mandant}/reinigung/turnus`}
            className="text-sm underline hover:text-text"
          >
            Alle Turnusse
          </Link>
        </div>

        {kopf.stehendeSerien === null && (
          <Hinweis art="hinweis" cse="serien-ungeprueft" className="mb-s4 max-w-prose">
            <strong>Der Generatorstand ist nicht geprüft.</strong> Er steht in
            der Planungsserie, und die liegt hinter <code>dienstplan.lesen</code>.
            Die Regeln selbst stehen unten — ob daraus Schichten entstanden
            sind, sagt diese Ansicht nicht.
          </Hinweis>
        )}

        {kopf.turnusse.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Noch kein Turnus angelegt. Ohne Turnus entsteht keine wiederkehrende
            Schicht — und ohne Schicht kein Leistungsnachweis.
            {darf['reinigung.schreiben'] === true && (
              <>
                {' '}
                <Link
                  href={`/portal/${mandant}/reinigung/turnus/neu`}
                  className="underline hover:text-text"
                >
                  Turnus anlegen
                </Link>
                .
              </>
            )}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-s4 lg:grid-cols-2">
            {kopf.turnusse.filter((t) => !t.archiviert).slice(0, 12).map((t) => {
              const steht = t.planungsserieId !== null
                && (t.generiertBis === null || t.generiertBis < kopf.heute);
              return (
                <Card key={t.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-s3">
                    <Link
                      href={`/portal/${mandant}/reinigung/turnus/${t.id}`}
                      className="text-base text-text underline-offset-2 hover:text-brand hover:underline"
                    >
                      {t.bezeichnung}
                    </Link>
                    <span className="text-sm tabular-nums text-text-muted">
                      {t.beginnLokal} · {stundenAusMinuten(t.dauerMinuten)}
                    </span>
                  </div>
                  <p className="m-0 mt-s2 text-sm text-text-muted">
                    {t.objekt ?? `Objekt ${UNGEPRUEFT}`}
                    {' · '}
                    {t.revier}
                    {' · '}
                    {lesbareRegel(t.rrule)}
                  </p>
                  <p className="m-0 mt-s2 text-sm">
                    {/* „nicht geprüft" steht VOR „keine Serie": ohne
                        `dienstplan.lesen` ist `planungsserieId` immer null,
                        und „Keine Serie" wäre dann ein Fehlalarm auf jedem
                        Turnus — der Fehlentwarnung nebenan genau gegenläufig. */}
                    {!t.serieGeprueft ? (
                      <span className="text-text-muted">Generatorstand {UNGEPRUEFT}</span>
                    ) : t.planungsserieId === null ? (
                      <span className="text-warning">
                        Keine Serie — der Generator hat diesen Turnus noch nie gesehen
                      </span>
                    ) : steht ? (
                      <span className="text-danger">
                        Generator steht — geplant nur bis{' '}
                        <span className="tabular-nums">{t.generiertBis ?? 'nie'}</span>
                      </span>
                    ) : (
                      <span className="text-text-muted">
                        Geplant bis{' '}
                        <span className="tabular-nums">{t.generiertBis}</span>
                        {t.einsaetze !== null && ` · ${String(t.einsaetze)} Schicht(en)`}
                      </span>
                    )}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </PortalRahmen>
  );
}
