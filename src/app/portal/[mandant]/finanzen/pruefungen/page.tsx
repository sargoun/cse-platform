import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  NICHT_GEPRUEFT, REGELN, offenePruefungen, regelText,
  type Befund, type Regel, type Vorabbefund,
} from '@/server/services/finanz/vorabpruefung';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/finanzen/pruefungen` — die Vorab-Liste vor der
 * Rechnungsstellung (04-SEITENKARTE.md §5.14, FIN-18, FIN-07, FIN-01, EMP-13).
 *
 * **Jede Zeile nennt die Regel, die sie ausgelöst hat.** Eine Prüfliste ohne
 * Regelangabe ist eine Meinungsliste: man kann ihr nicht widersprechen und
 * nicht nachrechnen. Regel, Fundstelle und Sprungziel stehen an der Zeile.
 *
 * **Der Sprung geht in den AUFTRAG, nicht in die Zeiterfassung** (EMP-13). Die
 * Buchhaltung erfährt, DASS Zeit fehlt, nicht von wem: `fin.auftrag_erfasste_
 * minuten()` gibt eine Zahl zurück und keine Zeile, und diese Seite gibt sie
 * genauso weiter.
 *
 * **Was noch fehlt, steht als benannte offene Frage — nicht als leere
 * Rubrik.** Die Seitenkarte nennt „and the other pre-invoice checks", ohne sie
 * aufzuzählen (O-601). Zwei der drei Prüfungen hier sind aus bestehenden
 * Zusagen abgeleitet und als solche gekennzeichnet; eine Frist zwischen
 * Auftragsabschluss und Rechnungsstellung ist nirgends gesetzt (O-602), und
 * die Seite setzt keine.
 *
 * **Die Seite ändert nichts.** Sie schreibt keine Rechnung und übergeht keine
 * Warnung. Übergangen wird FIN-18 nur mit protokollierter Begründung, und zwar
 * auf dem Festschreibebildschirm — hier steht sie, damit es vorher jemand
 * klären kann.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Vorab-Prüfungen — Finanzen' };

const REGEL_FILTER: readonly Regel[] = [
  'entwurf_ohne_quelle', 'fin18_keine_zeit', 'auftrag_ohne_rechnung',
];

function istRegel(wert: unknown): wert is Regel {
  return typeof wert === 'string' && (REGEL_FILTER as readonly string[]).includes(wert);
}

export default async function Pruefungsblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const regelRoh = typeof suche['regel'] === 'string' ? suche['regel'] : null;
  const regelFilter = istRegel(regelRoh) ? regelRoh : null;

  const tor = await mandantTor(`/portal/${mandant}/finanzen/pruefungen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * Diese Seite öffnet mit `finanzen.lesen`. Der AUFTRAG daneben verlangt
   * `auftrag.lesen` — wer Rechnungen liest, darf nicht zwangsläufig Aufträge
   * öffnen. Ohne das Recht steht die Auftragsnummer als Text; ein Verweis
   * führte auf 404 und verriete, was er verbirgt (AUT-06, D-581).
   */
  const darf = await haeltRechte(zugang.sitzung, 'auftrag.lesen');

  const befund = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) =>
      offenePruefungen(kontext))) as Promise<Vorabbefund>);

  const zeilen: readonly Befund[] = regelFilter === null
    ? befund.befunde
    : befund.befunde.filter((b) => b.regel === regelFilter);

  return (
    <PortalRahmen
      titel="Vorab-Prüfungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Vor der Rechnungsstellung</h1>
        {regelFilter === null ? null : (
          <p className="text-sm text-text-muted" data-cse="pruefungen-filter">
            Gefiltert auf <strong>{regelText(regelFilter).kurz}</strong>{' '}
            <Link
              href={`/portal/${mandant}/finanzen/pruefungen`}
              className="underline underline-offset-2"
            >
              alle zeigen
            </Link>
          </p>
        )}
      </div>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        {REGEL_FILTER.map((r) => {
          const t = regelText(r);
          const anzahl = befund.jeRegel[r];
          return (
            <Link
              key={r}
              href={`/portal/${mandant}/finanzen/pruefungen?regel=${r}`}
              className="group block rounded-lg"
              data-cse="pruefungen-kachel"
              data-regel={r}
            >
              <KpiStat
                label={t.kurz}
                wert={String(anzahl)}
                ton={anzahl === 0 ? 'muted' : t.stufe === 'fehler' ? 'danger' : 'warning'}
                icon={t.stufe === 'fehler' ? 'fehler' : 'warnung'}
                interaktiv
              />
            </Link>
          );
        })}
      </div>

      {befund.gesamt === 0 ? (
        <Hinweis art="erfolg" cse="pruefungen-leer" className="mb-s5">
          <p className="m-0 max-w-prose">
            Kein Befund. Kein abgeschlossener Auftrag ohne erfasste Minute, kein
            abgeschlossener Auftrag ohne Rechnung, keine Entwurfszeile ohne
            Herkunft. Das heisst nicht, dass alles geprüft ist — welche weiteren
            Vorab-Prüfungen diese Liste führen soll, ist offen (O-601), und sie
            steht unten.
          </p>
        </Hinweis>
      ) : (
        <DataTable
          beschriftung="Befunde vor der Rechnungsstellung, mit Regel und Sprungziel"
          zeilen={zeilen}
          schluessel={(b) => `${b.regel}-${b.zielId}-${b.zusatz ?? ''}`}
          spalten={[
            {
              schluessel: 'regel',
              kopf: 'Regel',
              zelle: (b) => {
                const t = regelText(b.regel);
                return (
                  <span className="inline-flex flex-col gap-s1">
                    <span className="inline-flex flex-wrap items-center gap-s2">
                      <StatusPill zustand={t.stufe === 'fehler' ? 'Fehler' : 'Wartet'} />
                      <span className="text-xs text-text-muted">{t.fundstelle}</span>
                    </span>
                    <span className="text-xs text-text">{t.kurz}</span>
                  </span>
                );
              },
            },
            {
              schluessel: 'nummer',
              kopf: 'Auftrag / Beleg',
              /*
               * Zwei Ziele, zwei Rechte: der Auftrag hinter `auftrag.lesen`,
               * der Rechnungsentwurf hinter `finanzen.lesen` — und das hält
               * diese Seite selbst. Ohne Auftragsrecht bleibt die Nummer Text.
               */
              zelle: (b) => (b.zielArt === 'rechnung' ? (
                <Link
                  href={`/portal/${mandant}/finanzen/rechnungen/${b.zielId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {b.nummer}
                </Link>
              ) : darf['auftrag.lesen'] === true ? (
                <Link
                  href={`/portal/${mandant}/auftraege/${b.zielId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {b.nummer}
                </Link>
              ) : b.nummer),
            },
            {
              schluessel: 'bezeichnung', kopf: 'Bezeichnung',
              zelle: (b) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-text">{b.bezeichnung}</span>
                  {b.zusatz === null ? null : (
                    <span className="text-xs text-text-muted">{b.zusatz}</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'kunde', kopf: 'Kunde',
              zelle: (b) => b.kunde ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'datum', kopf: 'Datum',
              zelle: (b) => b.datum ?? <span className="text-text-subtle">—</span>,
            },
          ]}
        />
      )}

      <section aria-labelledby="regeln-titel" className="mt-s7">
        <h2 id="regeln-titel" className="mb-s3 text-h2 text-text">
          Was diese Liste prüft — und warum
        </h2>
        <ul className="m-0 list-none space-y-s3 p-0">
          {REGELN.map((r) => (
            <li key={r.regel} className="rounded-lg border border-line bg-surface p-s5">
              <p className="m-0 flex flex-wrap items-baseline gap-s3">
                <span
                  className={`text-sm font-semibold ${
                    r.stufe === 'fehler' ? 'text-danger' : 'text-warning'}`}
                >
                  {r.kurz}
                </span>
                <span className="text-xs text-text-muted">{r.fundstelle}</span>
                <span className="text-xs text-text-muted">
                  {r.stufe === 'fehler'
                    ? 'hält die Festschreibung an'
                    : 'warnt, hält nicht an'}
                </span>
              </p>
              <p className="m-0 mt-s2 max-w-prose text-sm text-text">{r.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="offen-titel" className="mt-s7">
        <h2 id="offen-titel" className="mb-s3 text-h2 text-text">
          Was diese Liste NOCH NICHT prüft
        </h2>
        <p className="mb-s3 max-w-prose text-sm text-text-muted">
          Eine Prüfliste, die ihre eigenen Grenzen verschweigt, wird für
          vollständig gehalten. Deshalb stehen sie hier — als benannte offene
          Fragen und nicht als leere Rubrik.
        </p>
        <ul className="m-0 list-none space-y-s2 p-0">
          {NICHT_GEPRUEFT.map((n) => (
            <li key={n.frage} className="rounded-lg border border-line bg-surface-2 p-s4">
              <p className="m-0 text-sm text-text">{n.frage}</p>
              <p className="m-0 mt-s1 max-w-prose text-xs text-text-muted">{n.grund}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-s7 max-w-prose text-xs text-text-muted">
        Die Minuten kommen aus <code>fin.auftrag_erfasste_minuten()</code> und
        nicht aus der Sicht <code>zeiteintrag_auftrag</code>: die läuft mit
        <code> security_invoker</code>, und eine Buchhaltung ohne{' '}
        <code>zeit.lesen</code> bekäme dort überall null Minuten — also bei jedem
        Auftrag eine Warnung. Eine Warnung, die immer kommt, wird nach dem
        dritten Mal ungelesen weggeklickt.
      </p>
    </PortalRahmen>
  );
}
