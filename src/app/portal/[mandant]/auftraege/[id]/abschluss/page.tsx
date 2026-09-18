import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { alsStundenText } from '@/server/services/kalkulation/richtzeit';
import { PRUEFLISTE_ZIELRECHTE, ladePruefliste } from '@/server/services/auftrag/abschluss';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { FELD, FEHLERTEXT, type AbschlussKopf } from './daten';

/**
 * `/portal/[mandant]/auftraege/[id]/abschluss` — OPS-05, und die
 * FIN-18-Warnungen ZUERST.
 *
 * **Was dieser Klick wirklich tut.** Er setzt nicht ein Statusfeld — er
 * ARMIERT eine Sperre im Rechnungsweg. `pruefeZeiterfassung`
 * (`services/finanz/positionsquelle.ts`) liest
 * `status = 'abgeschlossen' or abgeschlossen_am is not null` und macht daraus
 * die FIN-18-Warnung, die nach D-366/D-367 die Festschreibung anhaelt, bis
 * jemand sie mit einer protokollierten Begruendung von mindestens zehn
 * Zeichen uebergeht — und zwar VOR der Nummernvergabe, weil sie danach
 * wertlos waere. Das steht auf dieser Seite, nicht in einem Kommentar: wer
 * abschliesst, soll wissen, was er scharf stellt.
 *
 * **Die Zahlen kommen aus einer DEFINER-Funktion.**
 * `fin.auftrag_abschluss_befunde` (0299). Direkt zu zaehlen wiederholte genau
 * den Fehler, den D-366 beschreibt: `zeiteintrag` verlangt `zeit.lesen`, und
 * eine Rolle ohne dieses Recht bekaeme null Zeilen — die Pruefliste meldete
 * dann stumm „nichts offen". Das ist kein fehlender Hinweis, sondern ein
 * falscher FREISPRUCH (AUT-05).
 *
 * **Und keiner der Befunde sperrt.** Welche verbindlich sind, ist offen
 * (O-730) — sichtbar in jeder Zeile. Eine erfundene Sperre waere schlimmer
 * als keine: sie hielte Arbeit auf, die niemand aufhalten wollte, und der Weg
 * daran vorbei waere ein Klick, den sich danach jeder angewoehnt.
 */
export const dynamic = 'force-dynamic';

export default async function Abschluss(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const pfad = `/portal/${mandant}/auftraege/${id}/abschluss`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;
  /**
   * Die Rechte der VERWEISE in der Pruefliste — jede Zeile nennt ihr eigenes.
   *
   * Ein Verweis auf die Zeitseite fuer jemanden ohne `zeit.lesen` fuehrte auf
   * 404 und verriete damit, was er nicht zeigen darf (AUT-06). Die Zahl bleibt
   * sichtbar (sie kommt aus der Definer-Funktion), nur der Weg dorthin
   * verschwindet.
   *
   * Die Liste kommt aus dem DIENST (`PRUEFLISTE_ZIELRECHTE`) und wird hier
   * nicht ein zweites Mal aufgeschrieben: `haeltRechte` legt NUR die
   * uebergebenen Schluessel in seine Karte, ein hier vergessenes Recht waere
   * also `undefined` und damit fuer jeden Benutzer „fehlt" — auch fuer
   * `super_admin`. Dazu `auftrag.lesen` fuer den Rueckverweis auf den Auftrag.
   */
  const darf = await haeltRechte(
    sitzung, 'auftrag.lesen', ...PRUEFLISTE_ZIELRECHTE);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<AbschlussKopf>(
        `select a.id, a.auftragsnummer, a.bezeichnung, a.status::text as status,
                a.art::text as art, ku.name as kunde, o.bezeichnung as objekt,
                a.auftragswert_netto_cent::text as auftragswert,
                to_char(a.start_datum, 'DD.MM.YYYY') as start_datum,
                to_char(a.laufzeit_bis, 'DD.MM.YYYY') as laufzeit_bis,
                a.abnahme_am::text as abnahme_am_iso,
                to_char(a.abnahme_am, 'DD.MM.YYYY') as abnahme_am,
                to_char(a.gewaehrleistung_bis, 'DD.MM.YYYY') as gewaehrleistung_bis,
                a.sicherheitseinbehalt_bp,
                a.sicherheitseinbehalt_cent::text as sicherheitseinbehalt_cent,
                to_char(a.abgeschlossen_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as abgeschlossen_am,
                vb.name as verantwortlich
           from auftrag a
           join kunde ku on ku.id = a.kunde_id
           left join objekt o on o.id = a.objekt_id
           left join benutzer vb on vb.id = a.verantwortlich_benutzer_id
          where a.id = $1`, [id]);
      if (kopf === undefined) return null;
      const pruefliste = await ladePruefliste(kontext, id);
      return { kopf, pruefliste };
    })) as Promise<{
      kopf: AbschlussKopf;
      pruefliste: Awaited<ReturnType<typeof ladePruefliste>>;
    } | null>);

  if (daten === null) notFound();
  const { kopf, pruefliste } = daten;

  const abgeschlossen = kopf.status === 'abgeschlossen' || kopf.abgeschlossen_am !== null;
  const storniert = kopf.status === 'storniert';
  const zielRecht: Readonly<Record<string, boolean>> = darf;

  return (
    <PortalRahmen
      titel={`Abschluss — ${kopf.auftragsnummer}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={abgeschlossen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="auftraege"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['auftrag.lesen'] === true && (
        <nav aria-label="Zurück" className="mb-s3">
          <Link
            href={`/portal/${mandant}/auftraege/${id}`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            ← {kopf.auftragsnummer}
          </Link>
        </nav>
      )}

      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">Auftrag abschließen</h1>
        <StatusPill zustand={abgeschlossen ? 'Abgeschlossen' : 'In Arbeit'} />
      </div>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="abschluss-fehler" className="mb-s5">
          <strong>Der Auftrag ist nicht abgeschlossen.</strong>{' '}
          {FEHLERTEXT[fehler] ?? 'Der Vorgang wurde abgewiesen.'}
        </Hinweis>
      )}

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Kunde</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.kunde}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Objekt</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.objekt ?? <span className="text-text-subtle">—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Laufzeit</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.start_datum} – {kopf.laufzeit_bis ?? 'unbefristet'}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Auftragswert
          </dt>
          <dd className="m-0 mt-s1 cse-zahl text-sm text-text">
            {kopf.auftragswert === null
              ? <span className="text-text-subtle">—</span>
              : formatiereGeld(cent(BigInt(kopf.auftragswert)))}
          </dd>
        </div>
      </dl>

      {/* ------------------------------------------------------------------ */}
      {/* Die Pruefliste — ZUERST, und der Knopf zuletzt.                    */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="pruefliste" className="mb-s7">
        <h2 id="pruefliste" className="text-h2 text-text">Was an diesem Auftrag offen ist</h2>
        <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
          {pruefliste.offeneBefunde === 0
            ? 'Kein Befund offen.'
            : `${String(pruefliste.offeneBefunde)} von ${String(pruefliste.befunde.length)} `
              + 'Prüfpunkten trägt eine Zahl.'}{' '}
          Die Zahlen kommen aus einer Datenbankfunktion mit eigenem Recht — nicht
          aus direkten Zählungen. Eine Rolle ohne{' '}
          <code className="text-text">zeit.lesen</code> hätte sonst „nichts offen"
          gelesen, obwohl sie nichts sehen konnte (AUT-05).
        </p>

        <Hinweis art="warnung" cse="o730" className="mb-s4">
          <strong>Keiner dieser Befunde sperrt den Abschluss — offen (O-730).</strong>{' '}
          Welche von ihnen verbindlich verhindern, dass ein Auftrag geschlossen
          wird, und welche nur gesehen worden sein müssen, ist nicht entschieden.
          Bis zur Antwort <em>warnen alle</em>. FIN-18 selbst ist entschieden
          (D-366, D-367): es warnt im <strong>Rechnungsweg</strong> und wird nur
          mit protokollierter Begründung übergangen.
        </Hinweis>

        <DataTable
          beschriftung="Offene Posten an diesem Auftrag vor dem Abschluss"
          zeilen={pruefliste.befunde}
          schluessel={(b) => b.schluessel}
          spalten={[
            {
              schluessel: 'ampel', kopf: 'Stand',
              zelle: (b) => (
                <StatusPill zustand={b.anzahl === 0 ? 'Bereit' : 'Offen'} />
              ),
            },
            {
              schluessel: 'was', kopf: 'Befund',
              zelle: (b) => (
                <span>
                  {b.titel}
                  <span className="block text-xs text-text-muted">{b.erklaerung}</span>
                </span>
              ),
            },
            {
              schluessel: 'anzahl', kopf: 'Anzahl', numerisch: true,
              zelle: (b) => String(b.anzahl),
            },
            {
              schluessel: 'wirkung', kopf: 'Wirkung',
              zelle: () => (
                <span className="text-warning">warnt (offen, O-730)</span>
              ),
            },
            {
              schluessel: 'weg', kopf: 'Nachsehen',
              zelle: (b) => {
                if (b.anzahl === 0 || b.ziel === null) {
                  return <span className="text-text-subtle">—</span>;
                }
                /*
                 * Der Verweis nur, wenn das Ziel sich oeffnen laesst. Ein
                 * Menuepunkt, der auf 404 fuehrt, ist schlechter als keiner
                 * (AUT-06, D-581).
                 */
                if (b.zielRecht !== null && zielRecht[b.zielRecht] !== true) {
                  return (
                    <span className="text-text-subtle">
                      Ihnen fehlt {b.zielRecht}
                    </span>
                  );
                }
                return (
                  <Link
                    href={`/portal/${mandant}/${b.ziel}`}
                    className="text-text underline underline-offset-2 hover:text-brand"
                  >
                    ansehen →
                  </Link>
                );
              },
            },
          ]}
        />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* FIN-18 — was der Abschluss ARMIERT.                                */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="fin18" className="mb-s7">
        <h2 id="fin18" className="text-h2 text-text">Was dieser Abschluss scharf stellt</h2>
        {pruefliste.fin18Trifft ? (
          <Hinweis art="warnung" cse="fin18-trifft" className="mt-s4">
            <strong>An diesem Auftrag ist keine einzige Minute erfasst (FIN-18).</strong>{' '}
            Mit dem Abschluss wird die FIN-18-Warnung im Rechnungsweg scharf:
            jede Rechnung auf diesen Auftrag hält an, bis jemand sie mit einer
            protokollierten Begründung von mindestens zehn Zeichen übergeht
            (D-366, D-367) — und zwar <em>vor</em> der Nummernvergabe, weil sie
            danach wertlos wäre. Das ist kein Grund, nicht abzuschließen; es ist
            der Grund, es zu wissen.
          </Hinweis>
        ) : (
          <p data-cse="fin18-erfuellt" className="mt-s4 text-sm text-text">
            <strong>
              {alsStundenText(BigInt(pruefliste.erfassteMinuten) * 60n)} Std.
            </strong>{' '}
            sind an diesem Auftrag erfasst ({pruefliste.erfassteMinuten} Minuten
            netto). Die FIN-18-Warnung greift damit nicht. Die Zahl kommt aus{' '}
            <code className="text-text">fin.auftrag_erfasste_minuten</code> — eine
            Zahl, keine Zeilen: wer abschließt, erfährt <em>dass</em> Zeit erfasst
            wurde, nicht von wem (EMP-13).
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Der Abschluss selbst.                                              */}
      {/* ------------------------------------------------------------------ */}
      {abgeschlossen ? (
        <Hinweis art="hinweis" cse="schon-abgeschlossen">
          <strong>Abgeschlossen am {kopf.abgeschlossen_am}</strong> (Anzeige in
          Europe/Berlin, gespeichert in UTC). Der Abschluss ist{' '}
          <strong>einwegig</strong>: das Datum ist unveränderlich und der Status
          wird nicht zurückgedreht — ein Zurückdrehen entschärfte die
          FIN-18-Warnung ohne Spur. Ob ein Wiederöffnen überhaupt vorgesehen ist,
          ist eine offene Frage — sichtbar als <strong>offen (O-734)</strong>.
          <dl className="m-0 mt-s4 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s2">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Abnahme
            </dt>
            <dd className="m-0 text-sm text-text">
              {kopf.abnahme_am ?? <span className="text-text-subtle">nicht erfasst</span>}
            </dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Gewährleistung bis
            </dt>
            <dd className="m-0 text-sm text-text">
              {kopf.gewaehrleistung_bis
                ?? <span className="text-text-subtle">nicht erfasst</span>}
            </dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Sicherheitseinbehalt
            </dt>
            <dd className="m-0 cse-zahl text-sm text-text">
              {kopf.sicherheitseinbehalt_bp !== null
                ? `${(kopf.sicherheitseinbehalt_bp / 100).toLocaleString('de-DE')} %`
                : kopf.sicherheitseinbehalt_cent !== null
                  ? formatiereGeld(cent(BigInt(kopf.sicherheitseinbehalt_cent)))
                  : <span className="text-text-subtle">keiner</span>}
            </dd>
          </dl>
        </Hinweis>
      ) : storniert ? (
        <Hinweis art="hinweis" cse="storniert">
          Dieser Auftrag ist storniert. Ein stornierter Auftrag wird nicht
          abgeschlossen — er ist aufgehoben, nicht beendet.
        </Hinweis>
      ) : (
        <section aria-labelledby="maske">
          <h2 id="maske" className="text-h2 text-text">Abnahme und Abschluss</h2>
          <form
            method="post"
            action="/api/auftrag/abschluss"
            data-cse="abschluss-form"
            className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="auftragId" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
              Abnahme, Gewährleistung und Sicherheitseinbehalt stehen in{' '}
              <strong>dieser</strong> Maske, nicht auf einer eigenen Seite: die
              Abnahme <em>ist</em> der Anlass des Abschlusses, und wer sie
              getrennt erfasst, erfasst sie nicht.
            </p>

            <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-text" htmlFor="abnahmeAm">
                  Abnahme am
                </label>
                <input
                  id="abnahmeAm"
                  name="abnahmeAm"
                  type="date"
                  defaultValue={kopf.abnahme_am_iso ?? ''}
                  className={FELD}
                />
                <p className="mt-s1 text-xs text-text-muted">
                  Ein Kalendertag, keine Uhrzeit — die Abnahme ist ein Tag.
                </p>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="gewaehrleistungBis">
                  Gewährleistung bis
                </label>
                <input
                  id="gewaehrleistungBis"
                  name="gewaehrleistungBis"
                  type="date"
                  className={FELD}
                />
                <p className="mt-s1 text-xs text-text-muted">
                  Braucht ein Abnahmedatum — von ihm läuft sie
                  (<code>auftrag_gewaehrleistung_nach_abnahme</code>).
                </p>
              </div>
            </div>

            <fieldset className="mt-s5 rounded-md border border-line p-s4">
              <legend className="px-s2 text-sm text-text">
                Sicherheitseinbehalt — offen (O-20)
              </legend>
              <p className="mb-s4 max-w-[72ch] text-xs text-text-muted">
                Welche VOB/B-§16-Bedingungen gelten, welcher Einbehaltssatz, wann
                er freigegeben wird und ob eine Bürgschaft ihn ersetzt, ist{' '}
                <strong>nicht entschieden (O-20)</strong>. Hier wird deshalb nur
                festgehalten, was vereinbart wurde — <em>gerechnet wird
                nichts</em>. Und genau <strong>eines</strong> von beiden:{' '}
                <code>auftrag_einbehalt_eindeutig</code> lässt keinen Satz und
                keinen Betrag gleichzeitig zu.
              </p>
              <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-text" htmlFor="einbehaltProzent">
                    Satz in Prozent
                  </label>
                  <input
                    id="einbehaltProzent"
                    name="einbehaltProzent"
                    type="text"
                    inputMode="decimal"
                    placeholder="z. B. 5"
                    defaultValue={kopf.sicherheitseinbehalt_bp === null
                      ? '' : (kopf.sicherheitseinbehalt_bp / 100).toLocaleString('de-DE')}
                    className={FELD}
                  />
                </div>
                <div>
                  <label className="block text-sm text-text" htmlFor="einbehaltBetrag">
                    Oder: fester Betrag (€)
                  </label>
                  <input
                    id="einbehaltBetrag"
                    name="einbehaltBetrag"
                    type="text"
                    inputMode="decimal"
                    placeholder="z. B. 2.500,00"
                    defaultValue={kopf.sicherheitseinbehalt_cent === null
                      ? ''
                      : formatiereGeld(cent(BigInt(kopf.sicherheitseinbehalt_cent)))
                        .replace(' €', '')}
                    className={FELD}
                  />
                  <p className="mt-s1 text-xs text-text-muted">
                    Deutsch geschrieben; gespeichert werden ganze Cent, nie eine
                    Fließkommazahl (Invariante 1).
                  </p>
                </div>
              </div>
            </fieldset>

            <p className="mt-s5 text-xs text-text-muted">
              <strong>Der Abschluss ist einwegig.</strong> Das Abschlussdatum kommt
              aus der Serveruhr (Invariante 5) und wird danach nicht geändert; der
              Status wird nicht zurückgedreht. Korrektur läuft über einen Nachtrag
              oder einen neuen Auftrag — offen (O-734).
            </p>

            <button
              type="submit"
              data-cse="auftrag-abschliessen"
              className="mt-s4 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
            >
              Auftrag abschließen
            </button>
          </form>
        </section>
      )}
    </PortalRahmen>
  );
}
