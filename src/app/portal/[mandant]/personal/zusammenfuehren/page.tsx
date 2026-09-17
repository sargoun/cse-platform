import Link from 'next/link';
import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { DataTable } from '@/components/ui/DataTable';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { sucheKandidaten, type DublettenKandidat } from '@/server/services/personal/dublette';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/personal/zusammenfuehren` — zwei `person`-Zeilen sind ein
 * Mensch (D-09, LEG-09, Invariante 8, Invariante 9, 01-KERN §6.13).
 *
 * **Zwei Schritte auf einer Seite: finden und zusammenfuehren.** Die Suche
 * stellt Kandidaten NEBENEINANDER — beide Namen, beide Telefonnummern, Anzahl
 * Beschaeftigungen, Anzahl Nachweise, ob ein Zugang besteht — und schlaegt
 * nichts vor. Eine Heuristik, die „sehr wahrscheinlich dieselbe Person"
 * behauptet, wird geklickt; und eine falsch zusammengefuehrte Personalakte ist
 * mit dem Zeigermodell absichtlich nicht mit einem Klick rueckgaengig zu
 * machen.
 *
 * **Was die Zusammenfuehrung TUT und was nicht.** Sie setzt den Zeiger
 * `person.zusammengefuehrt_in_person_id` und schreibt eine Auditzeile mit
 * beiden Kennungen und dem Grund. Sie haengt KEINE Zeile um: 50 Tabellen haben
 * einen Fremdschluessel auf `person`, die Zeitdomaene traegt `person_id`
 * denormalisiert in zusammengesetzten Fremdschluesseln ohne
 * `on update cascade`, und ein Teil der Kindzeilen ist eingefroren — ein
 * `update` daran wird von einem Ausloeser abgewiesen. Die Geschichte laesst
 * sich nicht umschreiben, und sie soll es nicht: `nachweis` haengt mit
 * `(nachweis_id, person_id)` an seinen Warnungen, und `mitarbeiter_zugang`
 * traegt `unique (person_id)` — hat die Dublette ebenfalls einen Zugang (der
 * Regelfall), waere jedes Umhaengen ein 23505.
 *
 * **Gelesen wird der Mensch danach ueber `app.person_kanonisch`**, und
 * `app.person_identitaeten` liefert beide Kennungen fuer jede Aggregation je
 * Person (Invariante 9, ArbZG).
 *
 * **Offen und benannt (O-611):** welche Angaben bei Widerspruch gewinnen,
 * welcher Portalzugang ueberlebt, ob eine Zusammenfuehrung rueckgaengig
 * gemacht werden kann, und ob eine Gesellschaft eine Dublette zusammenfuehren
 * darf, deren zweite Beschaeftigung bei einer Schwestergesellschaft liegt.
 * Ausgeliefert ist die engste Annahme: beide Zeilen muessen in DIESER
 * Gesellschaft beschaeftigt sein.
 */
export const dynamic = 'force-dynamic';

export default async function Zusammenfuehren({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/zusammenfuehren`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: „Personen" verlangt `personal.lesen`, diese Seite
     `personal.zusammenfuehren` — wer nur das zweite haelt, bekaeme hinter dem
     Verweis ein 404 (D-581). */
  const darf = await haeltRechte(zugang.sitzung, 'personal.lesen');

  const suche = await searchParams;
  const begriff = typeof suche['q'] === 'string' ? suche['q'] : '';
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;
  const fertig = suche['zusammengefuehrt'] === '1';

  const kandidaten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => sucheKandidaten(kontext, begriff)),
  ) as Promise<readonly DublettenKandidat[]>);

  const waehlbar = kandidaten.filter((k) => k.zusammengefuehrtIn === null);
  const verweis = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text';
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Dubletten zusammenführen"
      wurzelTitel="Personal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="personal"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Dubletten zusammenführen</h1>
        <p className="m-0 text-sm text-text-muted">
          {begriff === ''
            ? 'Suchbegriff eingeben'
            : `${String(kandidaten.length)} Treffer zu „${begriff}"`}
        </p>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        {darf['personal.lesen'] === true && (
          <Link href={`/portal/${mandant}/personal/personen`} className={verweis}>
            Zu den Personen
          </Link>
        )}
      </nav>

      {fertig && (
        <Hinweis art="erfolg" cse="merge-fertig" className="mb-s5 max-w-prose">
          <strong>Zusammengeführt.</strong> Die veraltete Zeile bleibt lesbar und
          zeigt jetzt auf die führende; ihre Geschichte — Zeiteinträge,
          Wachbuch, Nachweise — bleibt unverändert dort, wo sie entstanden ist.
          Aggregationen je Mensch lesen beide Kennungen über
          <span className="font-mono"> app.person_identitaeten</span>.
        </Hinweis>
      )}
      {meldung !== null && (
        <Hinweis art="warnung" cse="merge-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht zusammengeführt.</strong> {meldung}
        </Hinweis>
      )}

      <h2 className="mb-s3 text-h2 text-text">1. Finden</h2>
      <form
        method="get"
        action={pfad}
        data-cse="merge-suche"
        className="mb-s5 flex max-w-prose flex-wrap items-end gap-s3 rounded-lg border border-line bg-surface p-s5"
      >
        <label className="flex-1 text-sm text-text">
          <span className="mb-s2 block">Nachname oder Vorname</span>
          <input name="q" defaultValue={begriff} className={feld} data-cse="merge-suchbegriff" />
        </label>
        <Button type="submit" variante="secondary">Suchen</Button>
      </form>

      {begriff === '' ? (
        <p className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Zwei Zeichen genügen. Gesucht wird unter den Menschen, die in{' '}
          <strong className="text-text">dieser</strong> Gesellschaft beschäftigt
          sind — `person` trägt keinen Mandanten (D-09), sichtbar ist ein Mensch
          hier, weil er hier arbeitet.
        </p>
      ) : kandidaten.length === 0 ? (
        <p data-cse="merge-leer" className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Treffer. Das ist eine Aussage über diese Gesellschaft, nicht über
          die Gruppe: eine Dublette, deren zweite Beschäftigung bei einer
          Schwestergesellschaft liegt, ist von hier aus nicht sichtbar — und
          dürfte von hier aus auch nicht zusammengeführt werden (offen, O-611).
        </p>
      ) : (
        <div className="mb-s6">
          <DataTable
            beschriftung={`Kandidaten zu „${begriff}"`}
            zeilen={kandidaten}
            schluessel={(k) => k.personId}
            spalten={[
              {
                schluessel: 'name',
                kopf: 'Name',
                zelle: (k) => (
                  <span>
                    {darf['personal.lesen'] === true ? (
                      <Link
                        href={`/portal/${mandant}/personal/personen/${k.personId}`}
                        className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                      >
                        {k.name}
                      </Link>
                    ) : (
                      <span className="text-text">{k.name}</span>
                    )}
                    {k.zusammengefuehrtIn !== null && (
                      <span className="ml-s2 text-xs text-text-subtle">
                        (schon zusammengeführt)
                      </span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'telefon',
                kopf: 'Telefon',
                zelle: (k) => (k.telefon === null
                  ? <span className="text-text-muted">—</span>
                  : <span className="tabular-nums">{k.telefon}</span>),
              },
              {
                schluessel: 'anstellungen',
                kopf: 'Beschäftigungen',
                numerisch: true,
                zelle: (k) => (
                  <span className="tabular-nums">
                    {String(k.aktiveAnstellungen)}
                    {k.anstellungen !== k.aktiveAnstellungen && ` von ${String(k.anstellungen)}`}
                  </span>
                ),
              },
              {
                schluessel: 'nachweise',
                kopf: 'Nachweise',
                numerisch: true,
                zelle: (k) => (k.nachweise === null
                  ? <span className="text-text-subtle">nicht prüfbar</span>
                  : <span className="tabular-nums">{String(k.nachweise)}</span>),
              },
              {
                schluessel: 'zugang',
                kopf: 'Portalzugang',
                zelle: (k) => (k.hatZugang ? 'ja' : 'nein'),
              },
              {
                schluessel: 'kennung',
                kopf: 'Kennung',
                zelle: (k) => (
                  <span className="font-mono text-xs text-text-muted">
                    {k.personId.slice(0, 8)}
                  </span>
                ),
              },
            ]}
          />
          <p className="mt-s3 max-w-prose text-xs text-text-subtle">
            Das <strong className="text-text">Geburtsdatum steht hier nicht</strong>,
            obwohl es das beste Unterscheidungsmerkmal wäre: es ist der
            Anwendungsrolle als Spalte entzogen (SEC-03). Wer es zum Vergleich
            braucht, öffnet die Stammdatenseite der beiden Menschen — mit
            eigenem Recht und je einer Auditzeile. Das ist langsamer und
            richtig: ein Dublettenabgleich ist kein Grund, jedem Bearbeiter
            jedes Geburtsdatum zu zeigen.
          </p>
        </div>
      )}

      <h2 className="mb-s3 text-h2 text-text">2. Zusammenführen</h2>
      {waehlbar.length < 2 ? (
        <p data-cse="merge-zu-wenig" className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Zum Zusammenführen braucht es zwei noch nicht zusammengeführte
          Datensätze in der Trefferliste. Suchen Sie den Nachnamen, unter dem
          beide stehen.
        </p>
      ) : (
        <form
          method="post"
          action="/api/personal/zusammenfuehren"
          data-cse="merge-formular"
          className="flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="zurueck" value={`${pfad}?q=${encodeURIComponent(begriff)}`} />

          <label className="flex flex-col gap-s2 text-sm text-text">
            Veraltete Zeile (bleibt und zeigt danach auf die führende)
            <select name="dublette" required className={feld} data-cse="merge-dublette">
              <option value="">— wählen —</option>
              {waehlbar.map((k) => (
                <option key={k.personId} value={k.personId}>
                  {k.name} · {k.personId.slice(0, 8)} · {String(k.anstellungen)} Beschäftigungen
                  {k.hatZugang ? ' · mit Zugang' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-s2 text-sm text-text">
            Führende Zeile (der Mensch, unter dem weitergearbeitet wird)
            <select name="fuehrend" required className={feld} data-cse="merge-fuehrend">
              <option value="">— wählen —</option>
              {waehlbar.map((k) => (
                <option key={k.personId} value={k.personId}>
                  {k.name} · {k.personId.slice(0, 8)} · {String(k.anstellungen)} Beschäftigungen
                  {k.hatZugang ? ' · mit Zugang' : ''}
                </option>
              ))}
            </select>
            <span className="text-xs text-text-subtle">
              Die führende Zeile wird <strong className="text-text">gewählt</strong> und
              nicht erraten — nicht die ältere, nicht die mit mehr Feldern.
            </span>
          </label>

          <label className="flex flex-col gap-s2 text-sm text-text">
            Grund
            <input
              name="grund"
              required
              placeholder="Doppelt angelegt bei der Einstellung · Namensschreibweise"
              className={feld}
              data-cse="merge-grund"
            />
          </label>

          <label className="flex flex-col gap-s2 text-sm text-text">
            Bestätigung: Nachname der führenden Zeile
            <input name="bestaetigung" required className={feld} data-cse="merge-bestaetigung" />
            <span className="text-xs text-text-subtle">
              Getippt und nicht angehakt. Ein Kästchen „Ja, ich bin sicher" wird
              angehakt; wer den Namen tippt, hat die führende Zeile gelesen — und
              genau die Verwechslung „falsche Zeile als führend gewählt" ist der
              Fehler, der hier teuer ist.
            </span>
          </label>

          <div>
            <Button type="submit" variante="primary" data-cse="merge-absenden">
              Zusammenführen
            </Button>
          </div>

          <p className="m-0 text-xs text-text-subtle">
            Es wird nichts gelöscht (Invariante 8) und nichts umgehängt: die
            veraltete Zeile bleibt lesbar und zeigt auf die führende, ihre
            Geschichte bleibt, wo sie entstanden ist, und eine Auditzeile trägt
            beide Kennungen mit dem Grund.
          </p>
        </form>
      )}

      <Hinweis art="hinweis" cse="merge-offen" className="mt-s6 max-w-prose">
        <strong>Was hier nicht entschieden ist (O-611).</strong> Welche Angaben
        bei Widerspruch gewinnen, welcher Portalzugang überlebt, wenn beide
        Zeilen einen haben, ob eine Zusammenführung rückgängig gemacht werden
        kann, und ob eine Gesellschaft eine Dublette zusammenführen darf, deren
        zweite Beschäftigung bei einer Schwestergesellschaft liegt und die sie
        deshalb nicht sehen kann. Ausgeliefert ist die engste Annahme: beide
        Zeilen müssen in dieser Gesellschaft beschäftigt sein, kein Feld wird
        übernommen, kein Zugang widerrufen. Was die Zusammenführung heute leistet,
        ist die Identität — damit Arbeitszeitgrenzen je Mensch und nicht je Zeile
        aggregieren (Invariante 9).
        {/* TODO(client, O-611): Welche Angaben gewinnen beim Zusammenfuehren zweier Personenzeilen, welcher Portalzugang ueberlebt, laesst sich eine Zusammenfuehrung zuruecknehmen — und darf eine Gesellschaft eine Dublette zusammenfuehren, deren zweite Beschaeftigung bei einer Schwestergesellschaft liegt? */}
      </Hinweis>
    </PortalRahmen>
  );
}
