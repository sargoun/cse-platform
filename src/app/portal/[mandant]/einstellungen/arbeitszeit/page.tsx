import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  GESETZ, GEWERKE, GEWERK_TEXT, UEBERTRAG_ARTEN, ladeArbeitszeitmodelle,
  ladeTarifvereinbarungen, type ModellZeile, type TarifZeile,
} from '@/server/services/zeit/arbeitszeitmodell';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/arbeitszeit` — Arbeitszeitmodelle und die
 * strengere Tarifregel (EMP-04, TIM-06, TIM-14, LEG-03, O-18, O-50).
 *
 * **Die gesetzlichen ArbZG-Grenzen stehen hier nur zum Vergleich.**
 * 04-SEITENKARTE §5.24 ist ausdruecklich: „The ArbZG limits are not
 * settings". Ein Feld, das sie senkt, wird abgewiesen — vom Dienst mit dem
 * Namen des Werts und von der Datenbank noch einmal
 * (`tv_mindestens_gesetz`). Ein Tarifvertrag kann nur STRENGER sein.
 *
 * **`0` Sollminuten heisst „nicht hinterlegt", nicht „nichts geschuldet".**
 * Solange O-18 offen ist, antwortet die Sollzeitregel `null`, das
 * Stundenkonto fuehrt `soll_minuten = 0`, und ein Saldo daraus machte jede
 * geleistete Minute zur Ueberstunde. Deshalb traegt jede Zeile ohne
 * Bestaetigung die Entwurfsmarke, und der Satz darunter sagt, was das
 * bedeutet.
 *
 * **Warum die Werte nicht vorbelegt sind.** 39 Stunden, fuenf Arbeitstage,
 * dreissig Tage Urlaub — alles plausibel, alles geraten, und jedes mit
 * Lohnfolge. O-18 fragt konkret: wie viele Arbeitstage hat die Woche, senkt
 * ein Feiertag die Sollzeit oder wird er gutgeschrieben, rechnet das Konto
 * gegen den Monat oder gegen einen Ausgleichszeitraum, und muessen die
 * Modellschluessel den Lohncodes entsprechen (ACC-12).
 */
export const dynamic = 'force-dynamic';

/** Minuten als Stunden-und-Minuten-Text — Anzeige, keine Rechnung. */
function minuten(wert: number | null): string {
  if (wert === null) return '—';
  const h = Math.floor(wert / 60);
  const m = wert % 60;
  return h === 0 ? `${String(m)} min` : `${String(h)} h ${String(m).padStart(2, '0')} min`;
}

export default async function Arbeitszeit(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/arbeitszeit`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      modelle: await ladeArbeitszeitmodelle(kontext),
      tarife: await ladeTarifvereinbarungen(kontext),
      /*
       * Der Vorgabetag kommt aus der Datenbank, nicht aus `new Date()`: die
       * Uhr des Node-Prozesses liest UTC und boete am 31.12. um 23:30
       * Berliner Zeit den falschen Tag an (K-11, Invariante 2).
       */
      tage: await kontext.abfrage<{ heute: string; morgen: string }>(
        `select app.berlin_heute()::text as heute,
                (app.berlin_heute() + 1)::text as morgen`),
    }))) as Promise<{
      modelle: readonly ModellZeile[];
      tarife: readonly TarifZeile[];
      tage: readonly { heute: string; morgen: string }[];
    }>);

  const heute = daten.tage[0]?.heute ?? '';
  const morgen = daten.tage[0]?.morgen ?? '';
  const laufendeModelle = daten.modelle.filter((m) => m.gueltigBis === null);
  const offeneModelle = laufendeModelle.filter((m) => m.istPlatzhalter).length;
  const laufendeTarife = daten.tarife.filter((t) => t.giltBis === null);

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const knopf = 'mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base '
    + 'font-semibold text-white hover:bg-brand-hover';

  return (
    <PortalRahmen
      titel="Arbeitszeit"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Arbeitszeit</h1>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p data-cse="arbeitszeit-hinweis"
           className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweis}
        </p>
      ) : null}

      <Hinweis art="hinweis" cse="arbeitszeit-nicht-einstellbar" className="mb-s5 max-w-[72ch]">
        <strong>Die gesetzlichen Grenzen stehen hier nur zum Vergleich.</strong> Acht
        bzw. zehn Stunden am Tag (§ 3 ArbZG), {String(GESETZ.pause6h)} bzw.{' '}
        {String(GESETZ.pause9h)} Minuten Pause (§ 4) und{' '}
        {minuten(GESETZ.ruhezeit)} Ruhezeit (§ 5) sind keine Einstellung dieser
        Plattform. Ein eingetragener Wert darunter wird abgewiesen — ein Tarifvertrag
        kann nur strenger sein.
      </Hinweis>

      {/* 1 — Arbeitszeitmodelle */}
      <section aria-labelledby="modelle-titel" className="mb-s7">
        <h2 id="modelle-titel" className="mb-s3 text-h2 text-text">Arbeitszeitmodelle</h2>
        <p data-cse="modelle-offen" data-offen={String(offeneModelle)}
           className="mb-s4 max-w-[72ch] rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {laufendeModelle.length === 0
            ? 'Es ist kein Modell hinterlegt. Solange hier keines steht, gibt es in '
              + 'den Anstellungskonditionen nichts zu wählen.'
            : offeneModelle === 0
              ? 'Alle laufenden Modelle sind bestätigt.'
              : `${String(offeneModelle)} von ${String(laufendeModelle.length)} `
                + 'laufenden Modellen sind unbestätigt (O-18).'}{' '}
          <strong>Solange die Sollzeitregel „offen" ist, führt das Stundenkonto
          soll_minuten = 0 — und 0 heisst dort „nicht hinterlegt", nicht „nichts
          geschuldet".</strong> Ein Saldo aus einer geratenen Sollzeit machte jede
          geleistete Minute zur Überstunde, und das fiele nicht auf: das Konto zeigte
          eine plausible Zahl, jeden Monat, jahrelang.
        </p>
        {daten.modelle.length === 0 ? (
          <p data-cse="modelle-leer"
             className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Es ist kein Modell hinterlegt.
          </p>
        ) : (
          <div data-cse="arbeitszeitmodelle">
            <DataTable
              beschriftung="Arbeitszeitmodelle mit Wochenstunden, Sollzeitregel, Übertrag und Gültigkeit"
              zeilen={[...daten.modelle]}
              schluessel={(m) => m.id}
              spalten={[
                { schluessel: 'schluessel', kopf: 'Schlüssel',
                  zelle: (m) => <code className="text-xs">{m.schluessel}</code> },
                { schluessel: 'bezeichnung', kopf: 'Bezeichnung',
                  zelle: (m) => m.bezeichnung },
                { schluessel: 'wochenstunden', kopf: 'Wochenstunden', numerisch: true,
                  zelle: (m) => (m.wochenstunden === null
                    ? <span className="text-text-subtle">nicht hinterlegt</span>
                    : m.wochenstunden) },
                { schluessel: 'arbeitstage', kopf: 'Arbeitstage/Woche', numerisch: true,
                  zelle: (m) => (m.arbeitstageWoche === null
                    ? <span className="text-text-subtle">nicht hinterlegt</span>
                    : m.arbeitstageWoche) },
                { schluessel: 'sollzeit', kopf: 'Sollzeitregel',
                  zelle: (m) => (m.sollzeitregel === 'offen'
                    ? <span className="text-warning">offen (O-18)</span>
                    : <code className="text-xs">{m.sollzeitregel}</code>) },
                { schluessel: 'uebertrag', kopf: 'Übertrag',
                  zelle: (m) => (m.uebertragArt === 'offen'
                    ? <span className="text-warning">offen (O-18)</span>
                    : `${m.uebertragArt}${m.uebertragGrenzeMinuten === null ? ''
                      : ` · max. ${minuten(m.uebertragGrenzeMinuten)}`}`) },
                { schluessel: 'verfall', kopf: 'Verfall',
                  zelle: (m) => (m.verfallMonate === null
                    ? <span className="text-warning">offen (O-18)</span>
                    : `nach ${String(m.verfallMonate)} Monaten`) },
                { schluessel: 'gueltig', kopf: 'Gültig',
                  zelle: (m) => `${m.gueltigAb} – ${m.gueltigBis ?? 'offen'}` },
                { schluessel: 'zustand', kopf: 'Zustand',
                  zelle: (m) => (
                    m.gueltigBis !== null
                      ? <StatusPill zustand="Archiviert" />
                      : m.istPlatzhalter
                        ? <StatusPill zustand="Entwurf" />
                        : <StatusPill zustand="Aktiv" />) },
              ]}
            />
          </div>
        )}
      </section>

      {/* 2 — Tarifvereinbarung neben dem Gesetz */}
      <section aria-labelledby="tarif-titel" className="mb-s7">
        <h2 id="tarif-titel" className="mb-s3 text-h2 text-text">
          Tarifliche Pausen- und Ruhezeitregel
        </h2>
        <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
          Hinterlegt wird nur, was STRENGER ist als das Gesetz (O-50). Je Gewerk gilt
          eine Fassung ab einem Tag; die Prüfung nach § 4 und § 5 ArbZG nimmt dann den
          strengeren Wert. Ist nichts hinterlegt, gilt das Gesetz — und das ist eine
          Aussage, keine Lücke.
        </p>
        <div data-cse="tarifvergleich">
          <DataTable
            beschriftung="Gesetzliche Grenzen und die hinterlegte Tarifregel je Gewerk"
            zeilen={GEWERKE.map((g) => {
              const t = laufendeTarife.find((z) => z.gewerk === g);
              return { gewerk: g, tarif: t };
            })}
            schluessel={(z) => z.gewerk}
            spalten={[
              { schluessel: 'gewerk', kopf: 'Gewerk',
                zelle: (z) => GEWERK_TEXT[z.gewerk] },
              { schluessel: 'gesetz', kopf: 'Gesetz (§ 4, § 5 ArbZG)',
                zelle: () => (
                  <span className="text-xs text-text-muted">
                    {minuten(GESETZ.pause6h)} / {minuten(GESETZ.pause9h)} Pause ·{' '}
                    {minuten(GESETZ.ruhezeit)} Ruhezeit
                  </span>
                ) },
              { schluessel: 'tarif', kopf: 'Tarif',
                zelle: (z) => (z.tarif === undefined
                  ? <span className="text-text-subtle">nicht hinterlegt (O-50)</span>
                  : (
                    <span className="text-xs text-text">
                      {minuten(z.tarif.pauseAb6hMinuten)} / {minuten(z.tarif.pauseAb9hMinuten)}{' '}
                      Pause · {minuten(z.tarif.ruhezeitMinuten)} Ruhezeit
                    </span>
                  )) },
              { schluessel: 'quelle', kopf: 'Tarifvertrag',
                zelle: (z) => (z.tarif === undefined ? '—'
                  : `${z.tarif.bezeichnung}${z.tarif.fundstelle === null ? ''
                    : ` · ${z.tarif.fundstelle}`}`) },
              { schluessel: 'ab', kopf: 'Gilt ab',
                zelle: (z) => z.tarif?.giltAb ?? '—' },
              { schluessel: 'zustand', kopf: 'Zustand',
                zelle: (z) => {
                  if (z.tarif === undefined) return <StatusPill zustand="Offen" />;
                  if (z.tarif.istPlatzhalter) return <StatusPill zustand="Entwurf" />;
                  return z.tarif.strengerAlsGesetz
                    ? <StatusPill zustand="Aktiv" />
                    : (
                      <span className="flex items-center gap-s2">
                        <StatusPill zustand="Inaktiv" />
                        <span className="text-xs text-text-muted">
                          wirkt nicht — gleich dem Gesetz
                        </span>
                      </span>
                    );
                } },
            ]}
          />
        </div>
      </section>

      {/* 3 — Schreibwege */}
      <div className="grid grid-cols-1 gap-s4 lg:grid-cols-2">
        <section aria-labelledby="modell-setzen-titel"
                 className="rounded-lg border border-line bg-surface p-s5">
          <h2 id="modell-setzen-titel" className="text-h2 text-text">Modell hinterlegen</h2>
          <p className="mt-s2 text-xs text-text-muted">
            Die neue Fassung gilt ab dem angegebenen Tag; die bisherige endet am Tag
            davor und bleibt lesbar. Ein Tag vor heute ({heute}) legt eine
            rückwirkende Fassung an — nötig für die Übernahme von Altbeständen. Ob
            und ab wann ein Monat dafür gesperrt sein muss, ist offen (O-626);
            überschneiden dürfen sich zwei Fassungen desselben Schlüssels nicht.
          </p>
          <form method="post"
                action={`/api/einstellungen/arbeitszeit?mandant=${mandant}&was=modell`}>
            <label className="mt-s4 block text-sm text-text" htmlFor="schluessel">
              Schlüssel
            </label>
            <input id="schluessel" name="schluessel" type="text" required className={feld}
                   placeholder="vollzeit_39" />
            <p className="mt-s2 text-xs text-text-muted">
              Der Schlüssel ist das Ziel von{' '}
              <code>anstellung_kondition.arbeitszeitmodell</code>. Ob er den Lohncodes
              entsprechen muss, ist offen (O-18, ACC-12).
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="bezeichnung">
              Bezeichnung
            </label>
            <input id="bezeichnung" name="bezeichnung" type="text" required className={feld}
                   placeholder="Vollzeit" />

            <label className="mt-s4 block text-sm text-text" htmlFor="wochenstunden">
              Wochenstunden
            </label>
            <input id="wochenstunden" name="wochenstunden" type="text" inputMode="decimal"
                   className={feld} placeholder="39" />

            <label className="mt-s4 block text-sm text-text" htmlFor="arbeitstage">
              Arbeitstage je Woche
            </label>
            <input id="arbeitstage" name="arbeitstage" type="text" inputMode="decimal"
                   className={feld} placeholder="5" />

            <label className="mt-s4 block text-sm text-text" htmlFor="uebertragArt">
              Übertragsregel
            </label>
            <select id="uebertragArt" name="uebertragArt" className={feld}
                    defaultValue="offen">
              {UEBERTRAG_ARTEN.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <p className="mt-s2 text-xs text-text-muted">
              „offen" heisst: es wird nichts übertragen und nichts verfallen gelassen.
              Eine geratene Verfallsregel löscht Überstunden (O-18) — deshalb steht
              hier eine geschlossene Liste mit genau diesem einen Wert und kein
              Freitextfeld. Die Liste wächst, wenn O-18 beantwortet ist.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="uebertragGrenze">
              Kappung des Übertrags in Minuten
            </label>
            <input id="uebertragGrenze" name="uebertragGrenze" type="number" min={0}
                   step={1} className={feld} />

            <label className="mt-s4 block text-sm text-text" htmlFor="verfallMonate">
              Verfall nach Monaten
            </label>
            <input id="verfallMonate" name="verfallMonate" type="number" min={0} step={1}
                   className={feld} />

            <label className="mt-s4 block text-sm text-text" htmlFor="gueltigAb">
              Gültig ab
            </label>
            <input id="gueltigAb" name="gueltigAb" type="date" required className={feld}
                   defaultValue={morgen} />

            <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="bestaetigt" value="ja" />
              Werte sind bestätigt (nicht mehr Platzhalter)
            </label>

            <button type="submit" className={knopf}>Modell hinterlegen</button>
          </form>
        </section>

        <section aria-labelledby="tarif-setzen-titel"
                 className="rounded-lg border border-line bg-surface p-s5">
          <h2 id="tarif-setzen-titel" className="text-h2 text-text">
            Tarifregel hinterlegen
          </h2>
          <p className="mt-s2 text-xs text-text-muted">
            Leere Felder heissen „der Tarif sagt dazu nichts" — dann gilt das Gesetz.
            Das ist nicht dasselbe wie 0, und 0 würde abgewiesen.
          </p>
          <form method="post"
                action={`/api/einstellungen/arbeitszeit?mandant=${mandant}&was=tarif`}>
            <label className="mt-s4 block text-sm text-text" htmlFor="gewerk">Gewerk</label>
            <select id="gewerk" name="gewerk" required className={feld}>
              {GEWERKE.map((g) => (
                <option key={g} value={g}>{GEWERK_TEXT[g]}</option>
              ))}
            </select>

            <label className="mt-s4 block text-sm text-text" htmlFor="tarifBezeichnung">
              Tarifvertrag
            </label>
            <input id="tarifBezeichnung" name="bezeichnung" type="text" required
                   className={feld} placeholder="Rahmentarifvertrag Gebäudereinigung" />

            <label className="mt-s4 block text-sm text-text" htmlFor="fundstelle">
              Fundstelle
            </label>
            <input id="fundstelle" name="fundstelle" type="text" className={feld}
                   placeholder="§ 5 RTV" />

            <label className="mt-s4 block text-sm text-text" htmlFor="pause6">
              Pause ab 6 Stunden, in Minuten (mind. {String(GESETZ.pause6h)})
            </label>
            <input id="pause6" name="pause6" type="number" min={GESETZ.pause6h} step={1}
                   className={feld} />

            <label className="mt-s4 block text-sm text-text" htmlFor="pause9">
              Pause ab 9 Stunden, in Minuten (mind. {String(GESETZ.pause9h)})
            </label>
            <input id="pause9" name="pause9" type="number" min={GESETZ.pause9h} step={1}
                   className={feld} />

            <label className="mt-s4 block text-sm text-text" htmlFor="ruhezeit">
              Ruhezeit in Minuten (mind. {String(GESETZ.ruhezeit)})
            </label>
            <input id="ruhezeit" name="ruhezeit" type="number" min={GESETZ.ruhezeit}
                   step={1} className={feld} />

            <label className="mt-s4 block text-sm text-text" htmlFor="giltAb">Gilt ab</label>
            <input id="giltAb" name="giltAb" type="date" required className={feld}
                   defaultValue={morgen} />

            <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="bestaetigt" value="ja" />
              Werte sind bestätigt (nicht mehr Platzhalter)
            </label>

            <button type="submit" className={knopf}>Tarifregel hinterlegen</button>
          </form>
        </section>
      </div>

      <p className="mt-s7 max-w-[72ch] text-sm text-text-subtle">
        Die ArbZG-Prüfung selbst rechnet über Gesellschaftsgrenzen hinweg: ein Mensch,
        der sechs Stunden reinigt und fünf Stunden bewacht, hat elf Stunden gearbeitet
        (D-09, K-06). Diese Seite konfiguriert die Grenzen, sie prüft nicht — geprüft
        wird im Dienstplan und in der Zeiterfassung.
      </p>
    </PortalRahmen>
  );
}
