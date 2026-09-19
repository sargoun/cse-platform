import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { sucheKandidaten, type DublettenKandidat } from '@/server/services/personal/dublette';
import { dublettenProbe, SPRACHEN, statusFuerEintritt } from '@/server/services/personal/einstellung';
import { berlinHeute } from '@/server/db/heute';
import { mandantTor, MandantAntwort } from '../../../../unterseite';

/**
 * `/portal/[mandant]/personal/anstellungen/neu` — einstellen (D-09, EMP-14,
 * `04-SEITENKARTE.md` §5.12, Invariante 9).
 *
 * **Zwei Schritte, und die Reihenfolge ist der ganze Sinn der Seite.** Erst
 * den Menschen FINDEN, dann die Beschäftigung anlegen. Eine Maske, die beides
 * in einem Formular vermischt, legt bei jeder Einstellung eine neue
 * `person`-Zeile an — auch für den Menschen, der seit Jahren bei der
 * Schwestergesellschaft arbeitet. Genau diese Dubletten sind der Grund, aus
 * dem `app.person_zusammenfuehren` (0194) existiert, und sie sind teuer:
 * Arbeitszeitgrenzen aggregieren je MENSCH über alle Gesellschaften
 * (Invariante 9), und bei zwei Zeilen aggregieren sie zweimal die Hälfte.
 *
 * **Die Suche über die Gesellschaftsgrenze gibt eine ZAHL zurück, keinen
 * Namen** (`app.person_dublettenpruefung`, 0365). `person` trägt keinen
 * Mandanten, ist aber nur dort lesbar, wo der Mensch beschäftigt ist — wer
 * bei der Schwestergesellschaft arbeitet, ist von hier aus unsichtbar. Dass
 * es ihn gibt, darf diese Seite sagen; wer er ist, ist eine Rechtsfrage
 * zwischen getrennten Verantwortlichen und offen (O-860). Die Seite sagt
 * deshalb „es gibt N" und bittet um Rückfrage, statt zu blockieren oder zu
 * verschweigen.
 *
 * **Was hier NICHT entsteht:** kein Stundensatz, keine Wochenstunden (der
 * Spiegel der datierten Kondition hat genau einen Schreiber, §6.14 — der Weg
 * ist `…/entgelt` mit `personal.entgelt_schreiben`) und kein Portalzugang
 * (EMP-01, eigenes Recht, eigene Seite).
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const SPRACH_TEXT: Readonly<Record<string, string>> = {
  de: 'Deutsch', en: 'Englisch', ar: 'Arabisch', tr: 'Türkisch',
};

function wort(
  p: Record<string, string | string[] | undefined>, name: string, max = 80,
): string {
  const roh = p[name];
  return typeof roh === 'string' ? roh.trim().slice(0, max) : '';
}

export default async function NeueAnstellung({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/anstellungen/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: beide Verweise führen auf Seiten mit EIGENEM Recht. Ein Knopf,
     dessen Ziel diese Sitzung nicht öffnen darf, verrät die Existenz dessen,
     was er nicht zeigen darf (D-581). */
  const darf = await haeltRechte(
    zugang.sitzung, 'personal.lesen', 'personal.zusammenfuehren');

  const suche = await searchParams;
  const vorname = wort(suche, 'vorname');
  const nachname = wort(suche, 'nachname');
  const gewaehlt = wort(suche, 'person', 40);
  const modus = wort(suche, 'modus', 12);
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;
  const gesucht = vorname !== '' || nachname !== '';
  const begriff = nachname !== '' ? nachname : vorname;

  const heute = await berlinHeute();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      /* DIESELBE Suche wie auf der Zusammenführungsseite — zwei Bildschirme
         dürfen auf dieselbe Frage nicht zwei Antworten geben. */
      kandidaten: begriff.length >= 2
        ? await sucheKandidaten(kontext, begriff)
        : ([] as readonly DublettenKandidat[]),
      /* Über die Gesellschaftsgrenze: zwei Zahlen, kein Name (0365, O-860).
         Sie kostet eine Auditzeile — eine Auskunft über Menschen ausserhalb
         der eigenen Gesellschaft ist eine Offenlegung, auch als Zahl. */
      probe: nachname.length >= 2
        ? await dublettenProbe(kontext, vorname, nachname)
        : { hier: 0, fremd: 0 },
    })))) as {
      kandidaten: readonly DublettenKandidat[];
      probe: { hier: number; fremd: number };
    };

  const person = UUID.test(gewaehlt)
    ? daten.kandidaten.find((k) => k.personId === gewaehlt) ?? null
    : null;
  /* Gewählt, aber nicht in der Trefferliste: die Suche wurde verändert, ohne
     die Wahl mitzuführen. Kein Fehler — nur kein Schritt 2. */
  const schritt2 = person !== null ? 'bestehend' : modus === 'neu' && gesucht ? 'neu' : null;

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 '
    + 'text-sm text-text';
  const verweis = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 '
    + 'text-sm text-text-muted transition-colors duration-fast hover:border-line-strong '
    + 'hover:text-text';
  const status = statusFuerEintritt(heute, heute);

  return (
    <PortalRahmen
      titel="Einstellen"
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
        <h1 className="m-0 text-h1 text-text">Einstellen</h1>
        <p className="m-0 text-sm text-text-muted">
          Erst der Mensch, dann die Beschäftigung (D-09)
        </p>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        {darf['personal.lesen'] === true && (
          <Link href={`/portal/${mandant}/personal/anstellungen`} className={verweis}>
            Zu den Beschäftigungen
          </Link>
        )}
        {darf['personal.zusammenfuehren'] === true && (
          <Link href={`/portal/${mandant}/personal/zusammenfuehren`} className={verweis}>
            Dubletten zusammenführen
          </Link>
        )}
      </nav>

      {meldung !== null && (
        <Hinweis art="warnung" cse="einstellung-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht angelegt.</strong> {meldung}
        </Hinweis>
      )}

      <h2 className="mb-s3 text-h2 text-text">1. Den Menschen finden</h2>
      <form
        method="get"
        action={pfad}
        data-cse="einstellung-suche"
        className="mb-s5 flex max-w-prose flex-wrap items-end gap-s3 rounded-lg border border-line bg-surface p-s5"
      >
        <label className="flex-1 text-sm text-text">
          <span className="mb-s2 block">Vorname</span>
          <input name="vorname" defaultValue={vorname} maxLength={80}
                 className={feld} data-cse="einstellung-vorname" />
        </label>
        <label className="flex-1 text-sm text-text">
          <span className="mb-s2 block">Nachname</span>
          <input name="nachname" defaultValue={nachname} maxLength={80}
                 className={feld} data-cse="einstellung-nachname" />
        </label>
        <Button type="submit" variante="secondary">Suchen</Button>
      </form>

      {!gesucht ? (
        <p data-cse="einstellung-ohne-suche"
           className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Ohne Suche kein zweiter Schritt. Das ist keine Formalie: wer schon einmal
          für die Gruppe gearbeitet hat, hat bereits eine Personenzeile — und eine
          zweite wäre eine Dublette, die später die Arbeitszeitgrenzen zerlegt, die
          je Mensch gelten (Invariante 9).
        </p>
      ) : (
        <>
          {/*
            * Die Auskunft über die Gesellschaftsgrenze. Sie steht VOR der
            * Trefferliste, weil sie das sagt, was die Liste nicht sagen kann:
            * dass es ausserhalb dieser Gesellschaft gleichnamige Menschen gibt.
            */}
          {nachname.length >= 2 && (
            daten.probe.fremd > 0 ? (
              <Hinweis art="warnung" cse="probe-fremd" className="mb-s5 max-w-prose">
                <strong>
                  {daten.probe.fremd === 1
                    ? 'Ein gleichnamiger Mensch'
                    : `${String(daten.probe.fremd)} gleichnamige Menschen`}{' '}
                  ausserhalb dieser Gesellschaft.
                </strong>{' '}
                Mehr steht hier nicht — kein Name, keine Kennung, keine Gesellschaft.
                Ob eine Gesellschaft mehr sehen darf und ob sie eine vorhandene
                Personenzeile übernehmen darf, statt eine zweite anzulegen, ist
                offen (O-860): es sind getrennte Verantwortliche, und wo ein Mensch
                sonst arbeitet, ist sein Datum und nicht das der Gruppe.
                <br />
                <span className="text-text">
                  Legen Sie trotzdem an, wenn es ein anderer Mensch ist. Ist es
                  derselbe, fragen Sie in der Personalstelle der Gruppe nach — die
                  Zusammenführung danach ist möglich, aber sie ist nicht mit einem
                  Klick rückgängig zu machen.
                </span>
                {/* TODO(client, O-860): Darf die Einstellungsmaske einer Gesellschaft mehr sehen als die ZAHL gleichnamiger Menschen in der Gruppe — Name, Kennung, beschaeftigende Gesellschaft — und darf sie eine bestehende `person` uebernehmen, statt eine zweite anzulegen? */}
              </Hinweis>
            ) : (
              <p data-cse="probe-keine-fremd"
                 className="mb-s5 max-w-prose text-sm text-text-muted">
                Ausserhalb dieser Gesellschaft trägt niemand diesen Namen. Die Probe
                läuft über die ganze Gruppe und gibt nur eine Zahl zurück (0365);
                jede Probe steht im Protokoll.
              </p>
            )
          )}

          {daten.kandidaten.length === 0 ? (
            <p data-cse="einstellung-leer"
               className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
              In dieser Gesellschaft trägt niemand diesen Namen. Das ist eine Aussage
              über <strong className="text-text">diese</strong> Gesellschaft: ein Mensch
              ist hier sichtbar, weil er hier beschäftigt ist (D-09).
            </p>
          ) : (
            <div className="mb-s6">
              <DataTable
                beschriftung={`Menschen in dieser Gesellschaft zu „${begriff}"`}
                zeilen={daten.kandidaten}
                schluessel={(k) => k.personId}
                spalten={[
                  {
                    schluessel: 'name', kopf: 'Name',
                    zelle: (k) => (
                      <span className="flex min-w-0 flex-col gap-s1">
                        {darf['personal.lesen'] === true ? (
                          <Link href={`/portal/${mandant}/personal/personen/${k.personId}`}
                                className="text-text underline decoration-line underline-offset-4 hover:decoration-current">
                            {k.name}
                          </Link>
                        ) : <span className="text-text">{k.name}</span>}
                        {k.zusammengefuehrtIn !== null && (
                          <span className="text-xs text-text-subtle">
                            zusammengeführt — zeigt auf einen anderen Datensatz
                          </span>
                        )}
                      </span>
                    ),
                  },
                  {
                    schluessel: 'telefon', kopf: 'Telefon',
                    zelle: (k) => (k.telefon === null
                      ? <span className="text-text-muted">—</span>
                      : <span className="tabular-nums">{k.telefon}</span>),
                  },
                  {
                    schluessel: 'anstellungen', kopf: 'Hier beschäftigt',
                    numerisch: true,
                    zelle: (k) => (
                      <span className="tabular-nums">
                        {String(k.aktiveAnstellungen)}
                        {k.anstellungen !== k.aktiveAnstellungen
                          && ` von ${String(k.anstellungen)}`}
                      </span>
                    ),
                  },
                  {
                    schluessel: 'waehlen', kopf: 'Beschäftigung anlegen',
                    zelle: (k) => (k.zusammengefuehrtIn !== null
                      ? <span className="text-xs text-text-subtle">führenden Datensatz wählen</span>
                      : (
                        <a
                          data-cse="person-waehlen"
                          href={`${pfad}?vorname=${encodeURIComponent(vorname)}&nachname=${encodeURIComponent(nachname)}&person=${k.personId}`}
                          className="text-text underline underline-offset-2 hover:text-brand"
                        >
                          Diesen Menschen
                        </a>
                      )),
                  },
                ]}
              />
              <p className="mt-s3 max-w-prose text-xs text-text-subtle">
                Das <strong className="text-text">Geburtsdatum steht hier nicht</strong>,
                obwohl es das beste Unterscheidungsmerkmal wäre: es ist der
                Anwendungsrolle als Spalte entzogen (SEC-03). Wer es zum Vergleich
                braucht, öffnet die Stammdatenseite — mit eigenem Recht und einer
                Auditzeile.
              </p>
            </div>
          )}

          {schritt2 === null && (
            <p className="mb-s6 max-w-prose text-sm text-text-muted">
              Keiner davon?{' '}
              <a
                data-cse="person-neu-waehlen"
                href={`${pfad}?vorname=${encodeURIComponent(vorname)}&nachname=${encodeURIComponent(nachname)}&modus=neu`}
                className="text-text underline underline-offset-2 hover:text-brand"
              >
                Einen neuen Menschen anlegen
              </a>
              .
            </p>
          )}
        </>
      )}

      <h2 className="mb-s3 text-h2 text-text">2. Die Beschäftigung</h2>
      {schritt2 === null ? (
        <p data-cse="schritt2-gesperrt"
           className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Zuerst suchen und dann wählen: entweder einen gefundenen Menschen oder
          ausdrücklich einen neuen. Eine Beschäftigung ohne Menschen gibt es nicht
          (D-09), und eine Maske, die beides zugleich aufnimmt, erzeugt genau die
          Dubletten, gegen die diese Reihenfolge steht.
        </p>
      ) : (
        <form
          method="post"
          action="/api/personal/anstellungen"
          data-cse="einstellung-formular"
          className="flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="modus" value={schritt2} />
          <input
            type="hidden"
            name="zurueck"
            value={`${pfad}?vorname=${encodeURIComponent(vorname)}`
              + `&nachname=${encodeURIComponent(nachname)}`
              + (schritt2 === 'bestehend' ? `&person=${person?.personId ?? ''}` : '&modus=neu')}
          />

          {schritt2 === 'bestehend' && person !== null ? (
            <>
              <input type="hidden" name="person" value={person.personId} />
              <p data-cse="gewaehlter-mensch" className="m-0 text-sm text-text">
                <strong>{person.name}</strong>{' '}
                <span className="font-mono text-xs text-text-muted">
                  {person.personId.slice(0, 8)}
                </span>
                <br />
                <span className="text-text-muted">
                  {person.aktiveAnstellungen === 0
                    ? 'Aktuell ohne laufende Beschäftigung in dieser Gesellschaft.'
                    : `Bereits ${String(person.aktiveAnstellungen)} laufende `
                      + 'Beschäftigung(en) hier — eine zweite ist möglich und bekommt '
                      + 'eine eigene Personalnummer, ein eigenes Stundenkonto und ein '
                      + 'eigenes Austrittsdatum (D-09).'}
                </span>
              </p>
            </>
          ) : (
            <fieldset className="m-0 flex flex-col gap-s3 border-0 p-0">
              <legend className="mb-s2 p-0 text-sm text-text">
                Neuer Mensch — die Angaben zur PERSON, nicht zur Beschäftigung
              </legend>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Vorname
                <input name="vorname" required defaultValue={vorname} maxLength={80}
                       className={feld} data-cse="neu-vorname" />
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Nachname
                <input name="nachname" required defaultValue={nachname} maxLength={80}
                       className={feld} data-cse="neu-nachname" />
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Telefon (Kontakt, optional)
                <input name="telefon" maxLength={40} className={feld} data-cse="neu-telefon" />
                <span className="text-xs text-text-subtle">
                  Die Nummer für die <strong className="text-text">Anmeldung</strong> im
                  Arbeiterportal ist eine andere und steht auf der Zugangsseite
                  (EMP-01) — sie ist der Anmeldeweg und wird dort mit eigenem Recht
                  gesetzt.
                </span>
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Sprache
                <select name="sprache" defaultValue="de" className={feld} data-cse="neu-sprache">
                  {SPRACHEN.map((s) => (
                    <option key={s} value={s}>{SPRACH_TEXT[s] ?? s}</option>
                  ))}
                </select>
                <span className="text-xs text-text-subtle">
                  Die vier aus EMP-12. Sie gilt dem MENSCHEN und nicht der
                  Beschäftigung — sie wandert mit, wenn er in einer zweiten
                  Gesellschaft anfängt.
                </span>
              </label>
            </fieldset>
          )}

          <label className="flex flex-col gap-s2 text-sm text-text">
            Personalnummer
            <input name="personalnummer" required maxLength={40}
                   className={feld} data-cse="einstellung-personalnummer" />
            <span className="text-xs text-text-subtle">
              Eindeutig <strong className="text-text">in dieser Gesellschaft</strong>;
              dieselbe Nummer bei der Schwestergesellschaft ist in Ordnung (D-09).
              Die Plattform schlägt keine vor: welche Systematik hier gilt, steht in
              keinem Dokument, und eine erfundene stünde in der ersten
              Lohnabrechnung im Weg.
            </span>
          </label>

          <label className="flex flex-col gap-s2 text-sm text-text">
            Eintritt
            <input name="eintritt" type="date" required defaultValue={heute}
                   className={feld} data-cse="einstellung-eintritt" />
            <span className="text-xs text-text-subtle">
              Der erste Arbeitstag. Liegt er in der Zukunft, entsteht die
              Beschäftigung als <em>geplant</em> und wird am Eintrittstag von selbst{' '}
              <em>aktiv</em> — der Kalender entscheidet, nicht der Klick. Heute
              ({heute}) wäre sie sofort <em>{status}</em>.
            </span>
          </label>

          <div>
            <Button type="submit" variante="primary" data-cse="einstellung-absenden">
              Beschäftigung anlegen
            </Button>
          </div>

          <p className="m-0 text-xs text-text-subtle">
            Angelegt werden die Vertragseckdaten. Der interne Stundensatz, das
            Arbeitszeitmodell und die Wochenstunden folgen als{' '}
            <strong className="text-text">datierte Kondition</strong> auf der
            Entgeltseite mit eigenem Recht (§6.15, K-05) — sie hier nebenbei zu
            setzen wäre eine zweite Schreibfläche über derselben Spalte. Der
            Portalzugang ist ebenfalls ein eigener Schritt (EMP-01). Gelöscht wird
            nichts: eine Beschäftigung endet mit einem Austrittsdatum
            (Invariante 8).
          </p>
        </form>
      )}
    </PortalRahmen>
  );
}
