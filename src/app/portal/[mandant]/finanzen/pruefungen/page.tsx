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
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { UEBERSICHT_TEXTE } from '@/lib/i18n/verwaltung/finanzen/uebersicht';

/**
 * `/portal/[mandant]/finanzen/pruefungen` — die Vorab-Liste vor der
 * Rechnungsstellung (04-SEITENKARTE.md §5.14, FIN-18, FIN-07, FIN-01, EMP-13).
 *
 * **Jede Zeile nennt die Regel, die sie ausgelöst hat.** Eine Prüfliste ohne
 * Regelangabe ist eine Meinungsliste: man kann ihr nicht widersprechen und
 * nicht nachrechnen. Regel, Fundstelle und Sprungziel stehen an der Zeile.
 *
 * **Der Sprung geht in den AUFTRAG, nicht in die Zeiterfassung** (EMP-13). Die
 * Buchhaltung erfährt, DASS Zeit fehlt, nicht von wem und nicht wie viel:
 * `fin.auftraege_ohne_zeit()` gibt eine Menge von Auftragskennungen zurück und
 * keine Zeiteintragszeile, und diese Seite gibt sie genauso weiter.
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

/*
 * Funktions-, Sicht- und Rechtenamen lauten in beiden Sprachen gleich und
 * stehen deshalb hier und nicht in der Texttabelle (siehe deren Kopf).
 */
const FN_AUFTRAEGE_OHNE_ZEIT = 'fin.auftraege_ohne_zeit()';
const SICHT_ZEITEINTRAG_AUFTRAG = 'zeiteintrag_auftrag';
const SICHT_INVOKER = 'security_invoker';
const RECHT_ZEIT_LESEN = 'zeit.lesen';
const FN_ERFASSTE_MINUTEN = 'fin.auftrag_erfasste_minuten()';
const RECHT_FESTSCHREIBEN = 'finanzen.festschreiben';
const RECHT_FINANZEN_LESEN = 'finanzen.lesen';

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

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(UEBERSICHT_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const befund = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) =>
      offenePruefungen(kontext))) as Promise<Vorabbefund>);

  const zeilen: readonly Befund[] = regelFilter === null
    ? befund.befunde
    : befund.befunde.filter((b) => b.regel === regelFilter);

  return (
    <PortalRahmen
      titel={t.pruefungenTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{t.pruefungenUeberschrift}</h1>
        {regelFilter === null ? null : (
          <p className="text-sm text-text-muted" data-cse="pruefungen-filter">
            {t.gefiltertAuf} <strong>{regelText(regelFilter).kurz}</strong>{' '}
            <Link
              href={`/portal/${mandant}/finanzen/pruefungen`}
              className="underline underline-offset-2"
            >
              {t.alleZeigen}
            </Link>
          </p>
        )}
      </div>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        {REGEL_FILTER.map((r) => {
          const rt = regelText(r);
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
                label={rt.kurz}
                wert={String(anzahl)}
                ton={anzahl === 0 ? 'muted' : rt.stufe === 'fehler' ? 'danger' : 'warning'}
                icon={rt.stufe === 'fehler' ? 'fehler' : 'warnung'}
                interaktiv
              />
            </Link>
          );
        })}
      </div>

      {befund.gesamt === 0 ? (
        <Hinweis art="erfolg" cse="pruefungen-leer" className="mb-s5">
          <p className="m-0 max-w-prose">
            {t.keinBefund}
          </p>
        </Hinweis>
      ) : (
        <DataTable
          beschriftung={t.tabellePruefungen}
          zeilen={zeilen}
          schluessel={(b) => `${b.regel}-${b.zielId}-${b.zusatz ?? ''}`}
          spalten={[
            {
              schluessel: 'regel',
              kopf: t.regelKopf,
              zelle: (b) => {
                const rt = regelText(b.regel);
                return (
                  <span className="inline-flex flex-col gap-s1">
                    <span className="inline-flex flex-wrap items-center gap-s2">
                      <StatusPill
                        zustand={rt.stufe === 'fehler' ? 'Fehler' : 'Wartet'}
                        sprache={zugang.sprache}
                      />
                      <span className="text-xs text-text-muted">{rt.fundstelle}</span>
                    </span>
                    <span className="text-xs text-text">{rt.kurz}</span>
                  </span>
                );
              },
            },
            {
              schluessel: 'nummer',
              kopf: t.auftragBelegKopf,
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
              schluessel: 'bezeichnung', kopf: g.bezeichnung,
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
              schluessel: 'kunde', kopf: g.kunde,
              zelle: (b) => b.kunde ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'datum', kopf: g.datum,
              zelle: (b) => b.datum ?? <span className="text-text-subtle">—</span>,
            },
          ]}
        />
      )}

      <section aria-labelledby="regeln-titel" className="mt-s7">
        <h2 id="regeln-titel" className="mb-s3 text-h2 text-text">
          {t.regelnTitel}
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
                  {r.stufe === 'fehler' ? t.haeltAn : t.warntNur}
                </span>
              </p>
              <p className="m-0 mt-s2 max-w-prose text-sm text-text">{r.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="offen-titel" className="mt-s7">
        <h2 id="offen-titel" className="mb-s3 text-h2 text-text">
          {t.nochNichtGeprueftTitel}
        </h2>
        <p className="mb-s3 max-w-prose text-sm text-text-muted">
          {t.grenzenEinleitung}
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
        {t.fin18MengeVor} <code>{FN_AUFTRAEGE_OHNE_ZEIT}</code>{' '}
        {t.fin18MengeNachFunktion} <code>{SICHT_ZEITEINTRAG_AUFTRAG}</code>
        {t.fin18MengeNachSicht}
        <code> {SICHT_INVOKER}</code>{t.fin18MengeNachInvoker}{' '}
        <code>{RECHT_ZEIT_LESEN}</code> {t.fin18MengeNachRecht}{' '}
        <code>{FN_ERFASSTE_MINUTEN}</code>{t.fin18MengeNachMinuten}{' '}
        <code>{RECHT_FESTSCHREIBEN}</code>{t.fin18MengeNachFestschreiben}{' '}
        <code>{RECHT_FINANZEN_LESEN}</code> {t.fin18MengeSchluss}
      </p>
    </PortalRahmen>
  );
}
