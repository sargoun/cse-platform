import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { DataTable } from '@/components/ui/DataTable';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { formatiereGeld, type Cent } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgres, tageAusPostgres } from '@/server/services/finanz/menge';
import { tagDeutsch } from '@/lib/datum/kalendertag';
import { Recht } from '@/components/ui/Recht';
import {
  findeAnstellung, leseEntgelt, leseKonditionen,
  type AnstellungZeile, type KonditionZeile,
} from '@/server/services/personal/anstellung';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/personal/anstellungen/[id]/entgelt` — der interne
 * Kostensatz und die datierten Konditionen (K-05, D-09 §6, 01-KERN §6.15,
 * Invariante 1).
 *
 * **Eine Seite fuer eine Zahl, mit zwei Rechten und einer Spur.** Der Satz
 * kommt ausschliesslich aus `app.entgelt_lesen`: `anstellung.stundensatz_intern`
 * und `anstellung_kondition.stundensatz_intern_cent` sind `cse_app` als
 * SELECT entzogen (K-05), und die Funktion prueft `personal.entgelt_lesen` UND
 * den aktiven Mandanten, bevor sie antwortet. **Jeder** Aufruf schreibt eine
 * Auditzeile; die Seite sagt das sichtbar.
 *
 * **Der Satz je Stichtag wird EINZELN geholt.** Die Historie unten zeigt
 * Zeitraeume, Stunden und Grund — nicht die Betraege. Sie alle auf einmal zu
 * lesen hiesse, bei jedem Seitenaufruf so viele Auditzeilen zu schreiben, wie
 * es Konditionen gibt, und damit die Auskunft „wer hat welchen Satz gelesen"
 * wertlos zu machen. Ein Verweis je Zeile holt genau einen.
 *
 * **Gerechnet wird in CENT** (Invariante 1). Der Eurobetrag im Formular wird
 * serverseitig geparst; nie float, nie in einer Komponente.
 *
 * **Was hier NICHT erfunden wird:** die Tarifgruppen (O-610). Das Feld ist
 * frei und heisst so; eine Auswahlliste waere eine Tarifentscheidung in einer
 * Oberflaeche.
 */
export const dynamic = 'force-dynamic';

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

export default async function Entgeltblatt({
  params, searchParams,
}: {
  params: Promise<{ mandant: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/personal/anstellungen/${id}/entgelt`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: das Blatt der Beschaeftigung verlangt `personal.lesen`, diese
     Seite `personal.entgelt_lesen`, das Formular `personal.entgelt_schreiben`.
     Jeder Verweis wird vorher gefragt (D-581). */
  const darf = await haeltRechte(
    zugang.sitzung,
    'personal.lesen', 'personal.entgelt_lesen', 'personal.entgelt_schreiben',
    'personal.schreiben', 'personal.anstellung_beenden');
  /*
   * **Das Entgeltrecht wird VORHER gefragt, nicht am Fehler erkannt.**
   *
   * `app.entgelt_lesen` hebt `42501`, wenn das Recht fehlt - und ein Fehler
   * bricht die TRANSAKTION ab. `postgres.js` setzt keinen Savepoint je
   * Abfrage; die naechste Abfrage in derselben Transaktion
   * (`leseKonditionen`) scheiterte danach mit `25P02`, und der Zweig, der
   * "kein Recht" sauber anzeigen sollte, konnte gar nicht funktionieren. Die
   * Abwesenheitsseite fragt aus demselben Grund vorher.
   */
  const entgeltRecht = darf['personal.entgelt_lesen'] === true;

  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;
  const gespeichert = suche['gespeichert'] === '1';
  const heute = await berlinHeute();
  const rohStichtag = typeof suche['stichtag'] === 'string' ? suche['stichtag'] : null;
  const stichtag = rohStichtag !== null && DATUM.test(rohStichtag) ? rohStichtag : heute;

  const daten = await (db().begin(async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const zeile = await findeAnstellung(kontext, id);
      if (zeile === null) {
        return {
          zeile: null, satz: null, keinRecht: false,
          konditionen: [] as readonly KonditionZeile[],
        };
      }
      /*
       * Ohne das Recht wird `app.entgelt_lesen` gar nicht erst gerufen - siehe
       * oben. Die Konditionsliste kommt trotzdem: sie traegt keine Betraege
       * (Zeitraeume, Stunden, Grund) und ist genau die Auskunft, die jemand
       * ohne Entgeltrecht haben darf.
       */
      const satz: Cent | null = entgeltRecht
        ? await leseEntgelt(kontext, id, stichtag)
        : null;
      return {
        zeile, satz, keinRecht: !entgeltRecht,
        konditionen: await leseKonditionen(kontext, id),
      };
    })) as Promise<{
      zeile: AnstellungZeile | null; satz: Cent | null; keinRecht: boolean;
      konditionen: readonly KonditionZeile[];
    }>);

  if (daten.zeile === null) notFound();
  const { zeile, satz, keinRecht, konditionen } = daten;
  const laufend = konditionen.find((k) => k.giltBis === null) ?? null;

  const verweis = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text';
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Entgelt"
      wurzelTitel="Personal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="personal"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div data-cse="entgelt-kopf" className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Entgelt — {zeile.personName}</h1>
        <p className="m-0 text-sm text-text-muted">
          Personalnummer <span className="tabular-nums">{zeile.personalnummer}</span>
          {' · '}
          Stichtag <span className="tabular-nums">{tagDeutsch(stichtag)}</span>
        </p>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        {darf['personal.lesen'] === true && (
          <Link href={`/portal/${mandant}/personal/anstellungen/${id}`} className={verweis}>
            Zur Beschäftigung
          </Link>
        )}
        {darf['personal.schreiben'] === true && (
          <Link href={`/portal/${mandant}/personal/anstellungen/${id}/vertrag`} className={verweis}>
            Vertragseckdaten
          </Link>
        )}
        {darf['personal.anstellung_beenden'] === true && zeile.status !== 'beendet' && (
          <Link href={`/portal/${mandant}/personal/anstellungen/${id}/beenden`} className={verweis}>
            Beschäftigung beenden
          </Link>
        )}
      </nav>

      {gespeichert && (
        <Hinweis art="erfolg" cse="entgelt-gespeichert" className="mb-s5 max-w-prose">
          <strong>Kondition eingetragen.</strong> Die vorige offene Periode ist
          am Tag davor geschlossen; der Spiegel auf der Beschäftigung folgt der
          heute gültigen Kondition.
        </Hinweis>
      )}
      {meldung !== null && (
        <Hinweis art="warnung" cse="entgelt-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {meldung}
        </Hinweis>
      )}

      <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 text-h3 text-text">Interner Kostensatz</h2>
        {keinRecht ? (
          <p data-cse="entgelt-kein-recht" className="m-0 text-sm text-text-muted">
            Kein Recht auf Entgeltdaten in dieser Gesellschaft
            (<Recht schluessel="personal.entgelt_lesen" />). Das ist
            etwas anderes als „kein Satz hinterlegt" — die Zeile trägt
            möglicherweise einen, diese Sitzung darf ihn nicht sehen (K-05).
          </p>
        ) : (
          <>
            <p data-cse="entgelt-satz" className="m-0 text-h1 tabular-nums text-text">
              {satz === null ? '—' : `${formatiereGeld(satz)} / Stunde`}
            </p>
            {satz === null && (
              <p className="m-0 mt-s2 text-sm text-text-muted">
                Für den {tagDeutsch(stichtag)} ist kein Satz hinterlegt.
              </p>
            )}
            <dl className="m-0 mt-s4 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
              {/*
                Tage, Stunden und Kalendertage in der deutschen Schreibweise
                (V-196): „5", „38,50 h", „01.01.2026" — nicht „5.000",
                „38.50 h" und „2026-01-01".
              */}
              <Feld
                label="Gültig ab"
                wert={laufend === null ? 'keine Kondition hinterlegt' : tagDeutsch(laufend.giltAb)}
              />
              <Feld
                label="Wochenstunden"
                wert={zeile.wochenstunden === null
                  ? 'nicht hinterlegt' : `${formatiereMenge(mengeAusPostgres(zeile.wochenstunden))} h`}
              />
              <Feld
                label="Arbeitstage pro Woche"
                wert={zeile.arbeitstageWoche === null
                  ? 'nicht hinterlegt' : tageAusPostgres(zeile.arbeitstageWoche)}
              />
              <Feld label="Kostenstelle" wert={zeile.kostenstelle ?? 'nicht hinterlegt'} />
            </dl>
            <p className="mb-0 mt-s4 text-xs text-text-subtle" data-cse="entgelt-protokoll">
              <strong className="text-text">Dieser Abruf steht im Protokoll</strong> — mit
              Ihrem Konto, dem Stichtag und dem Zeitpunkt. Das ist keine Formalie:
              der interne Kostensatz ist der Grund, warum die Spalte für die
              Anwendungsrolle gesperrt ist und es genau einen Lesepfad gibt (K-05).
            </p>
          </>
        )}
        <p className="mb-0 mt-s4 text-sm text-text-muted">
          <strong className="text-text">Interner Kostensatz, kein Lohn.</strong> Er
          geht in Kalkulation, Lohnkosten und Projektmarge ein. Die
          Lohnabrechnung macht ein Lohnsystem — diese Plattform rechnet keine
          Löhne (D-06) und bereitet nur vor.
        </p>
      </section>

      <h2 className="mb-s3 text-h2 text-text">Konditionen</h2>
      {konditionen.length === 0 ? (
        <p data-cse="konditionen-leer" className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diese Beschäftigung ist noch keine datierte Kondition hinterlegt.
          Der Satz oben — wenn einer steht — kommt dann aus dem Spiegel auf der
          Beschäftigung, dem Bestand vor der datierten Tabelle. Eine Kondition
          einzutragen macht ihn datiert und jede vergangene Rechnung
          nachvollziehbar.
        </p>
      ) : (
        <div className="mb-s6">
          <DataTable
            beschriftung="Datierte Konditionen dieser Beschäftigung"
            zeilen={konditionen}
            schluessel={(k) => k.id}
            spalten={[
              {
                schluessel: 'zeitraum',
                kopf: 'Gilt',
                zelle: (k) => (
                  <span className="tabular-nums">
                    {tagDeutsch(k.giltAb)}
                    {' – '}
                    {k.giltBis === null ? 'offen' : tagDeutsch(k.giltBis)}
                  </span>
                ),
              },
              {
                schluessel: 'modell',
                kopf: 'Arbeitszeitmodell',
                zelle: (k) => k.arbeitszeitmodell,
              },
              {
                schluessel: 'stunden',
                kopf: 'Wochenstunden',
                numerisch: true,
                zelle: (k) => (k.wochenstunden === null
                  ? '—' : formatiereMenge(mengeAusPostgres(k.wochenstunden))),
              },
              {
                schluessel: 'tage',
                kopf: 'Arbeitstage',
                numerisch: true,
                zelle: (k) => tageAusPostgres(k.arbeitstageWoche),
              },
              { schluessel: 'grund', kopf: 'Grund', zelle: (k) => (k.grund ?? '—') },
              {
                schluessel: 'satz',
                kopf: 'Satz',
                zelle: (k) => (k.giltAb === stichtag
                  ? <span className="text-text">oben angezeigt</span>
                  : (
                    <Link
                      href={`/portal/${mandant}/personal/anstellungen/${id}/entgelt?stichtag=${k.giltAb}`}
                      className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                    >
                      Satz ansehen
                    </Link>
                  )),
              },
            ]}
          />
          <p className="mt-s3 max-w-prose text-xs text-text-subtle">
            Die Betraege stehen absichtlich nicht in der Tabelle: jeder Abruf
            eines Satzes ist ein protokollierter Zugriff, und eine Tabelle mit
            zehn Zeilen wären zehn Auditzeilen bei jedem Seitenaufruf. Ein
            Verweis je Zeile holt genau einen — mit Stichtag.
          </p>
        </div>
      )}

      <h2 className="mb-s3 text-h2 text-text">Neue Kondition</h2>
      {darf['personal.entgelt_schreiben'] !== true ? (
        <p data-cse="entgelt-kein-schreibrecht" className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Einen Kostensatz setzt, wer{' '}
          <Recht schluessel="personal.entgelt_schreiben" /> hält. Wer
          ihn lesen darf, darf ihn darum noch nicht ändern.
        </p>
      ) : (
        <form
          method="post"
          action={`/api/personal/anstellungen/${id}/entgelt`}
          data-cse="entgelt-formular"
          className="flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="zurueck" value={pfad} />

          <label className="flex flex-col gap-s2 text-sm text-text">
            Gilt ab
            <input type="date" name="giltAb" required className={feld} data-cse="entgelt-giltab" />
            <span className="text-xs text-text-subtle">
              Der Vertragsbeginn dieser Kondition — kein Vorbelegen mit „heute":
              eine rückwirkende Tariferhöhung wäre damit lautlos eine ab heute
              geltende. Die laufende Kondition wird am Tag davor geschlossen.
            </span>
          </label>

          <label className="flex flex-col gap-s2 text-sm text-text">
            Interner Stundensatz (Euro)
            <input
              name="stundensatz"
              inputMode="decimal"
              placeholder="17,50"
              className={feld}
              data-cse="entgelt-satz-eingabe"
            />
            <span className="text-xs text-text-subtle">
              Deutsche Schreibweise: Komma vor den Cent, Punkt für die Tausender.
              Gespeichert wird in ganzen Cent (Invariante 1) — nie als
              Gleitkommazahl. Leer lassen heisst „kein Satz hinterlegt".
            </span>
          </label>

          <label className="flex flex-col gap-s2 text-sm text-text">
            Wochenstunden
            <input name="wochenstunden" inputMode="decimal" placeholder="39" className={feld} />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            Arbeitstage pro Woche
            <input name="arbeitstageWoche" inputMode="decimal" placeholder="5" className={feld} />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            Arbeitszeitmodell
            <input name="arbeitszeitmodell" placeholder="unbekannt" className={feld} />
            <span className="text-xs text-text-subtle">
              Freies Feld: welche Beschäftigungs- und SV-Kategorien die Gruppe
              führt, ist <strong className="text-text">offen (O-18)</strong>. Eine
              Auswahlliste hier wäre eine erfundene Entscheidung mit Lohnwirkung.
            </span>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            Tarifgruppe
            <input name="tarifgruppe" className={feld} data-cse="entgelt-tarifgruppe" />
            <span className="text-xs text-text-subtle">
              Freies Feld und <strong className="text-text">offen (O-610)</strong>:
              welcher Branchentarif je Gesellschaft gilt — Gebäudereinigung RTV,
              Sicherheitsgewerbe Berlin, Bau — und welche Gruppen er führt, ist
              nicht entschieden. Diese Plattform rechnet keine Tariflöhne.
            </span>
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            Kostenstelle
            <input name="kostenstelle" className={feld} />
          </label>
          <label className="flex flex-col gap-s2 text-sm text-text">
            Grund
            <input
              name="grund"
              placeholder="Tariferhöhung · Vertragsänderung · Korrektur"
              className={feld}
            />
            <span className="text-xs text-text-subtle">
              Erscheint im Protokoll und in der Tabelle oben.
            </span>
          </label>

          <div>
            <Button type="submit" variante="primary" data-cse="entgelt-speichern">
              Kondition eintragen
            </Button>
          </div>
        </form>
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        <strong className="text-text">Offen (O-614):</strong> welche
        Anmeldestufe diese Seite verlangt. 05-API-KARTE führt die Entgeltroute
        als „Sitzung + 2FA", das Routen-Manifest führt sie mit{' '}
        <span className="font-mono">aal2: false</span>. Ausgeliefert ist der
        Stand des Manifests; welcher gilt, ist eine Entscheidung über die
        Zugangssicherheit und nicht über diese Datei.
        {/* TODO(client, O-614): Verlangt der Zugriff auf Entgeltdaten eine zweite Anmeldestufe (05-API-KARTE: „sitzung+2fa") oder genuegt die Sitzung mit dem Recht (Routen-Manifest: aal2 false)? */}
      </p>
    </PortalRahmen>
  );
}

function Feld({ label, wert }: { readonly label: string; readonly wert: string }) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 text-sm text-text">{wert}</dd>
    </div>
  );
}
