import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { KpiStat } from '@/components/ui/KpiStat';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Icon } from '@/components/ui/Icon';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import {
  BEWACHER_STATUS, BEWACHER_VORWARNUNG_TAGE, leseRegister, securityGebucht, STATUS_TEXT,
  type BewacherStatus, type RegisterAusschnitt,
} from '@/server/services/security/bewacherregister';

/**
 * `/portal/[mandant]/security/bewacherregister` — § 34a GewO, handerfasst
 * (SEC-03, LEG-04, D-09).
 *
 * **Personen OHNE Eintrag stehen mit in der Liste**, oben. Genau sie sind die
 * Lücke, die SEC-03 sichtbar machen soll: wer eine Bewachungstätigkeit
 * ausübt, muss im Bewacherregister stehen, und eine Liste, die nur die
 * erfassten Einträge zeigt, wäre am kürzesten, wenn niemand etwas erfasst hat.
 *
 * **„Nicht verbunden" steht über der Tabelle, und es bleibt stehen.** Es gibt
 * keine Schnittstelle zum Bewacherregister — keinen Abgleich, keinen Knopf
 * „Status abrufen", keine simulierte Antwort. Der Stand ist abgetippt, und das
 * muss auf dem Bildschirm stehen, sonst liest sich „Registriert" wie eine
 * behördliche Auskunft.
 *
 * **Das Format der Bewacher-ID wird NICHT geprüft (O-40).** Eine geratene
 * Prüfziffernregel würde eine von der Behörde ausgestellte Kennung abweisen —
 * in dem Register, das über die Einsetzbarkeit eines Menschen entscheidet.
 *
 * **Diese Seite prüft das Security-Modul selbst.** Die zentrale Modulsperre in
 * `zugang.ts` prüft den Modulteil der Routenrechte; diese Route trägt als
 * einziges Recht `personal.bewacher_verwalten`, und `personal` ist ein
 * Querschnittsmodul. Ohne die Prüfung hier wäre
 * `/portal/bau/security/bewacherregister` für jede `admin`/`leitung`
 * erreichbar, obwohl REALTIME Service kein Security gebucht hat — und ein
 * leeres Bewacherregister in einer Baugesellschaft ist eine Aussage, die
 * niemand treffen wollte.
 */
export const dynamic = 'force-dynamic';

/**
 * DESIGN §5 führt ein geschlossenes Pillenvokabular. „Registriert",
 * „Beantragt", „Erloschen" und „Gesperrt" stehen nicht darin — abgebildet
 * statt erfunden, und der Klartext steht als WORT daneben (DESIGN §9).
 */
const PILLE: Readonly<Record<BewacherStatus, PillZustand>> = {
  beantragt: 'Wartet',
  registriert: 'Aktiv',
  abgelehnt: 'Abgelehnt',
  erloschen: 'Archiviert',
  gesperrt: 'Fehler',
  unbekannt: 'Inaktiv',
};

export default async function Bewacherregister(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const meldung = typeof suche['ok'] === 'string' ? suche['ok'] : null;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const tor = await mandantTor(`/portal/${mandant}/security/bewacherregister`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* AUT-06: das Nachweisregister und die Personenakte verlangen andere Rechte
     als diese Route. Ein Verweis ohne das Recht dahinter führt auf 404. */
  const darf = await haeltRechte(
    sitzung, 'personal.nachweis_lesen', 'personal.lesen', 'personal.bewacher_verwalten',
    'security.lesen', 'dokument.lesen',
  );

  const heute = await berlinHeute();
  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      /* Erst das Modul, dann die Daten: eine Gesellschaft ohne Security hat
         diese Seite nicht (D-377, AUT-06). */
      if (!(await securityGebucht(kontext))) return null;
      return leseRegister(kontext, heute);
    })) as Promise<RegisterAusschnitt | null>);

  if (daten === null) notFound();

  const ohneEintrag = daten.zeilen.filter((z) => z.eintragId === null);
  const gesperrt = daten.zeilen.filter(
    (z) => z.eintragId !== null && !z.einsetzbarAmStichtag);
  /* Die Schwelle ist ein benannter PLATZHALTER im Dienst, keine Zahl in dieser
     Seite: `bewacher_eintrag` trägt keine Warnstufen, und in welchem Vorlauf
     eine ablaufende Erlaubnis zu melden ist, ist offen (O-707). Die Kachel
     nennt die Zahl deshalb UND sagt, dass sie noch nicht entschieden ist. */
  const laufenAb = daten.zeilen.filter(
    (z) => z.einsetzbarAmStichtag && z.restTage !== null
      && z.restTage <= BEWACHER_VORWARNUNG_TAGE);
  const kannSchreiben = darf['personal.bewacher_verwalten'] === true;

  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 px-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Bewacherregister"
      wurzelTitel="Sicherheit"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {/* Auch der RUECKWEG steht unter dem Recht seines Ziels: der Modulkopf
          verlangt `security.lesen`, diese Route nur
          `personal.bewacher_verwalten`. Ohne das erste fuehrte „← Sicherheit"
          auf ein 404 (AUT-06). */}
      {darf['security.lesen'] === true && (
        <nav aria-label="Zurück" className="mb-s4">
          <Link
            href={`/portal/${mandant}/security`}
            className="text-sm text-text-muted underline hover:text-text"
          >
            ← Sicherheit
          </Link>
        </nav>
      )}

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Bewacherregister</h1>
        <p className="m-0 text-sm tabular-nums text-text-muted">Stichtag {daten.stichtag}</p>
      </div>

      {/*
        „Nicht verbunden" steht ÜBER der Tabelle und nicht als Fussnote: ohne
        diesen Satz liest sich „Registriert" wie eine behördliche Auskunft.
        Ein Knopf „Status abrufen" wäre eine vorgetäuschte Integration.
      */}
      <Hinweis art="warnung" cse="register-nicht-verbunden" className="mb-s4 max-w-prose">
        <strong>Nicht mit dem Bewacherregister verbunden.</strong> Es gibt keine
        Schnittstelle zum behördlichen Register: jeder Stand auf dieser Seite ist
        <strong> handerfasst</strong> und so alt wie sein Eintrag. Ein Abgleich
        findet nicht statt, und diese Seite tut auch nicht so — sie zeigt keinen
        Knopf, der einen Abruf vortäuscht.
      </Hinweis>

      <Hinweis art="hinweis" cse="register-o40" className="mb-s5 max-w-prose">
        <strong>Offen (O-40):</strong> Format und Prüfziffer der Bewacher-ID, die
        Pflichtfelder, das Statusvokabular und die dem Register zu meldenden
        Ereignisse sind nicht festgelegt. Das Feld nimmt deshalb, was die Behörde
        ausgestellt hat (1 bis 32 Zeichen), und keine Frist wird aus einem Datum
        abgeleitet. Eine geratene Prüfziffernregel würde eine echte Kennung
        abweisen — in dem Register, das über die Einsetzbarkeit eines Menschen
        entscheidet.
      </Hinweis>

      {meldung !== null && (
        <Hinweis art="erfolg" cse="register-ok" className="mb-s5 max-w-prose">
          <strong>Gespeichert.</strong> {meldung}
        </Hinweis>
      )}
      {fehler !== null && (
        <Hinweis art="warnung" cse="register-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {fehler}
        </Hinweis>
      )}

      {daten.geprueft['personal.nachweis_lesen'] !== true && (
        <Hinweis art="hinweis" cse="register-lesepfad" className="mb-s5 max-w-prose">
          <strong>Der Lesepfad hängt an einem anderen Recht als diese Seite.</strong>{' '}
          Die Route verlangt <code>personal.bewacher_verwalten</code>, die
          Lesepolitik der Tabelle verlangt <code>personal.nachweis_lesen</code>.
          Dieses Konto hält das zweite nicht — erfasste Einträge bleiben deshalb
          unsichtbar, und die Spalten unten stehen leer. Das ist nicht dasselbe
          wie „kein Eintrag erfasst".
        </Hinweis>
      )}

      <div className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiStat
          label="Beschäftigte im Register"
          wert={String(daten.zeilen.length)}
          icon="person"
          ton="info"
        />
        <KpiStat
          label="Kein Eintrag erfasst"
          wert={String(ohneEintrag.length)}
          icon="warnung"
          ton={ohneEintrag.length === 0 ? 'muted' : 'warning'}
        />
        <KpiStat
          label="Nicht einsetzbar"
          wert={String(gesperrt.length)}
          icon="fehler"
          ton={gesperrt.length === 0 ? 'muted' : 'danger'}
        />
        <KpiStat
          label={`Läuft in ${String(BEWACHER_VORWARNUNG_TAGE)} Tagen ab — Frist offen (O-707)`}
          wert={String(laufenAb.length)}
          icon="uhr"
          ton={laufenAb.length === 0 ? 'muted' : 'warning'}
        />
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Ein Eintrag hängt am <strong className="text-text">Menschen</strong>, nicht
        an der Gesellschaft (D-09): wer bei zwei Schwestergesellschaften
        beschäftigt ist, hat eine Bewacher-ID, nicht zwei. Diese Liste zeigt die
        Menschen mit lebender Anstellung in dieser Gesellschaft — sortiert nach
        Ablauf, nicht nach Name. Einsetzbar ist nur, wessen Eintrag am Stichtag{' '}
        <strong className="text-text">registriert</strong> und gültig ist; das ist
        dieselbe Bedingung, die das § 34a-Tor bei jeder Einteilung anwendet.
      </p>

      <Hinweis art="hinweis" cse="bewacher-frist-offen" className="mb-s5 max-w-prose">
        <strong>Der Vorwarnvorlauf ist nicht entschieden (O-707).</strong>{' '}
        Die Kachel „Läuft in {BEWACHER_VORWARNUNG_TAGE} Tagen ab" rechnet gegen
        einen <strong>Platzhalter</strong>. Anders als bei den Qualifikationen,
        wo die Schwellen als <code>warnung_tage</code> im Katalog stehen, trägt
        <code> bewacher_eintrag</code> keine Warnstufen — in welchem Vorlauf
        eine ablaufende Bewacher-Erlaubnis zu melden ist, muss der Auftraggeber
        festlegen. Bis dahin ist die Zahl ein Anhalt, keine Frist.
      </Hinweis>

      {daten.zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In dieser Gesellschaft ist niemand beschäftigt, dessen Eintrag hier
          stehen könnte. Das Register folgt den Anstellungen — ohne Anstellung
          gibt es keine Zeile.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {daten.zeilen.map((z) => {
            const abgelaufen = z.restTage !== null && z.restTage < 0;
            return (
              <li
                key={z.anstellungId}
                className="mb-s3"
                data-cse="bewacher-zeile"
                data-person={z.personId}
                data-status={z.status ?? 'kein_eintrag'}
              >
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-s3">
                    <span className="text-base text-text">
                      {darf['personal.lesen'] === true ? (
                        <Link
                          href={`/portal/${mandant}/personal/personen/${z.personId}`}
                          className="underline-offset-2 hover:text-brand hover:underline"
                        >
                          {z.name}
                        </Link>
                      ) : z.name}
                      {z.personalnummer !== null && (
                        <span className="ml-s2 text-sm tabular-nums text-text-muted">
                          {z.personalnummer}
                        </span>
                      )}
                    </span>
                    {z.eintragId === null ? (
                      /* §9: das WORT trägt die Bedeutung. „Kein Eintrag erfasst"
                         ist keine Pille aus DESIGN §5 und wird keine. */
                      <span className="text-sm text-warning" data-cse="kein-eintrag">
                        <Icon
                          name="warnung"
                          groesse="sm"
                          className="mr-s2 inline-block align-[-2px]"
                        />
                        kein Eintrag erfasst
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-baseline gap-s3">
                        <StatusPill zustand={PILLE[z.status ?? 'unbekannt']} />
                        <span className="text-sm text-text-muted">
                          {STATUS_TEXT[z.status ?? 'unbekannt']}
                        </span>
                      </span>
                    )}
                  </div>

                  {z.eintragId === null ? (
                    <p className="m-0 mt-s2 max-w-prose text-sm text-text-muted">
                      Beschäftigt seit <span className="tabular-nums">{z.eintrittAm}</span>.
                      Solange kein Eintrag erfasst ist, ist nicht belegt, dass diese
                      Person im Bewacherregister steht — und das § 34a-Tor lässt
                      keine Einteilung auf eine Bewachungstätigkeit zu.
                    </p>
                  ) : (
                    <>
                      <p className="m-0 mt-s2 text-sm text-text-muted">
                        Bewacher-ID{' '}
                        <code className="text-text">{z.bewacherId ?? '—'}</code>
                        {' · registriert seit '}
                        <span className="tabular-nums">{z.registriertSeit ?? '—'}</span>
                        {' · gültig bis '}
                        <span
                          className={abgelaufen ? 'tabular-nums text-danger' : 'tabular-nums'}
                        >
                          {z.gueltigBis ?? 'unbefristet'}
                        </span>
                        {z.restTage !== null && (
                          <span className={abgelaufen ? 'ml-s2 text-danger' : 'ml-s2'}>
                            (
                            {abgelaufen
                              ? `seit ${String(-z.restTage)} Tagen abgelaufen`
                              : `${String(z.restTage)} Tage`}
                            )
                          </span>
                        )}
                      </p>
                      <p className="m-0 mt-s2 text-sm text-text-muted">
                        Prüfung: letzte{' '}
                        <span className="tabular-nums">{z.letztePruefungAm ?? '—'}</span>
                        {', nächste '}
                        <span className="tabular-nums">{z.naechstePruefungAm ?? '—'}</span>
                        {' · Stand '}
                        {z.quelle ?? 'manuell'}, nicht verbunden
                        {' · Registerauszug '}
                        {z.registerauszugDokumentId === null ? 'nicht hinterlegt'
                          : darf['dokument.lesen'] === true ? (
                            <Link
                              href={`/portal/${mandant}/dokumente/${z.registerauszugDokumentId}`}
                              className="underline hover:text-text"
                            >
                              hinterlegt
                            </Link>
                          ) : 'hinterlegt'}
                      </p>
                      {/* SEC-04 ist eine harte Sperre: abgelaufen ist ein
                          Sperrgrund, keine Warnung. */}
                      {!z.einsetzbarAmStichtag && (
                        <p className="m-0 mt-s2 text-sm text-danger" data-cse="nicht-einsetzbar">
                          <Icon
                            name="fehler"
                            groesse="sm"
                            className="mr-s2 inline-block align-[-2px]"
                          />
                          Am Stichtag nicht einsetzbar — das § 34a-Tor lehnt jede
                          Einteilung auf eine Bewachungstätigkeit ab.
                        </p>
                      )}
                      {z.bemerkung !== null && (
                        <p className="m-0 mt-s2 max-w-prose text-sm text-text-muted">
                          {z.bemerkung}
                        </p>
                      )}
                    </>
                  )}

                  {kannSchreiben && (
                    <form
                      method="post"
                      action="/api/security/bewacherregister"
                      data-cse="bewacher-formular"
                      className="mt-s4 flex flex-wrap items-end gap-s3 border-t border-line pt-s4"
                    >
                      <input type="hidden" name="mandant" value={mandant} />
                      <input
                        type="hidden"
                        name="art"
                        value={z.eintragId === null ? 'erfassen' : 'aendern'}
                      />
                      <input type="hidden" name="person" value={z.personId} />
                      {z.eintragId !== null && (
                        <input type="hidden" name="eintrag" value={z.eintragId} />
                      )}
                      <label className="block">
                        <span className="mb-s1 block text-xs text-text-muted">
                          Bewacher-ID (ohne Formatprüfung, O-40)
                        </span>
                        <input
                          name="bewacher_id"
                          required
                          maxLength={32}
                          defaultValue={z.bewacherId ?? ''}
                          className={`${feld} w-44`}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-s1 block text-xs text-text-muted">Status</span>
                        <select
                          name="status"
                          required
                          className={`${feld} w-36`}
                          defaultValue={z.status ?? 'beantragt'}
                        >
                          {BEWACHER_STATUS.map((s) => (
                            <option key={s} value={s}>{STATUS_TEXT[s]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-s1 block text-xs text-text-muted">
                          Registriert seit
                        </span>
                        <input
                          name="registriert_seit"
                          type="date"
                          defaultValue={z.registriertSeit ?? ''}
                          className={`${feld} w-40`}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-s1 block text-xs text-text-muted">
                          Gültig bis (leer = unbefristet)
                        </span>
                        <input
                          name="gueltig_bis"
                          type="date"
                          defaultValue={z.gueltigBis ?? ''}
                          className={`${feld} w-40`}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-s1 block text-xs text-text-muted">Letzte Prüfung</span>
                        <input
                          name="letzte_pruefung"
                          type="date"
                          defaultValue={z.letztePruefungAm ?? ''}
                          className={`${feld} w-40`}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-s1 block text-xs text-text-muted">
                          Nächste Prüfung (wird nicht abgeleitet)
                        </span>
                        <input
                          name="naechste_pruefung"
                          type="date"
                          defaultValue={z.naechstePruefungAm ?? ''}
                          className={`${feld} w-40`}
                        />
                      </label>
                      <label className="block grow">
                        <span className="mb-s1 block text-xs text-text-muted">Bemerkung</span>
                        <input
                          name="bemerkung"
                          maxLength={400}
                          defaultValue={z.bemerkung ?? ''}
                          className={`${feld} w-full`}
                        />
                      </label>
                      <Button type="submit" variante="secondary" data-cse="bewacher-speichern">
                        {z.eintragId === null ? 'Eintrag erfassen' : 'Eintrag fortschreiben'}
                      </Button>
                    </form>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-s6 max-w-prose text-xs text-text-subtle">
        Gelöscht wird hier nichts (Invariante 8). Ein Eintrag wird
        fortgeschrieben; jede Änderung steht im Änderungsprotokoll
        (<code>trg_bewacher_eintrag_audit</code>).
      </p>
    </PortalRahmen>
  );
}
