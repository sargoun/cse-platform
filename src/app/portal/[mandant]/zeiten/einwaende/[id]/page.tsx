import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { ENTSCHIEDEN, leseEinwand, type EinwandBlatt } from '@/server/services/zeit/einwand';

/**
 * `/portal/[mandant]/zeiten/einwaende/[id]` — der einzelne Einwand in voll
 * (EMP-07, TIM-11).
 *
 * **Links die Meldung des Menschen, rechts die Aufzeichnung.** Was die Person
 * angibt (`behauptet_*`), steht als TEXT da und nie in einem vorbelegten Feld:
 * es ist die Aussage eines Menschen, keine Messung (Invariante 5). Wer sie
 * übernimmt, tut das als Korrektur mit Grund und Spur (TIM-11) — nicht durch
 * einen Klick auf „Übernehmen", den es hier deshalb nicht gibt.
 *
 * **Die Spalten heissen paarweise.** `zeiteintrag` trägt
 * `geraete_zeit_beginn`/`geraete_zeit_ende` und
 * `zeitabweichung_beginn_sek`/`zeitabweichung_ende_sek`, dazu
 * `dauer_brutto_minuten`/`dauer_netto_minuten`. Ein `zeitabweichung_sek` gibt
 * es NICHT — wer es so baut, zeigt eine Abweichung, die keine Spalte hat, und
 * die Seite bleibt an dieser Stelle für immer leer.
 *
 * **Die häufigste Verwechslung steht hier ausdrücklich:** eine anerkannte
 * Meldung ohne Korrektur. Anerkennen sagt, DASS die Meldung zutrifft; die neue
 * Fassung des Zeiteintrags prägt `korrigiereZeiteintrag` mit ihrem eigenen
 * Recht. Diese Seite sagt deshalb, ob eine Korrektur gefolgt ist
 * (`zeiteintrag_korrektur.zeit_einwand_id`) — oder eben nicht.
 *
 * **Über den eigenen Einwand entscheidet man nicht** (EMP-07). Der Auslöser
 * in der Datenbank verbietet es; hier steht statt des Formulars der Grund,
 * denn ein Knopf, der im Auslöser endet, ist ein Serverfehler mit Anlauf.
 *
 * **Zwei Rechte, nicht eines.** Das Manifest tort diese Route auf
 * `zeit.einwand_entscheiden`; `zeit_einwand` und `zeiteintrag` sind für
 * `cse_app` aber nur mit `zeit.lesen` lesbar. Ohne das zweite bekäme die
 * Sitzung notFound() ohne Grund — es wird deshalb ausdrücklich mitverlangt.
 */
export const dynamic = 'force-dynamic';

const ART_TEXT: Readonly<Record<string, string>> = {
  eintrag_fehlt: 'Eintrag fehlt',
  zeit_falsch: 'Zeit falsch',
  pause_falsch: 'Pause falsch',
  zuordnung_falsch: 'Zuordnung falsch',
  sonstiges: 'Sonstiges',
};

const STATUS_TEXT: Readonly<Record<string, string>> = {
  offen: 'Offen',
  in_pruefung: 'In Prüfung',
  anerkannt: 'Anerkannt',
  teilweise_anerkannt: 'Teilweise anerkannt',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
};

const EINTRAG_STATUS_TEXT: Readonly<Record<string, string>> = {
  laufend: 'läuft',
  abgeschlossen: 'abgeschlossen',
  offen_nacherfassung: 'Nacherfassung offen',
  storniert: 'storniert',
};

const KORREKTUR_ART_TEXT: Readonly<Record<string, string>> = {
  zeit_korrektur: 'Zeit korrigiert',
  pause_korrektur: 'Pause korrigiert',
  zuordnung_korrektur: 'Zuordnung korrigiert',
  nacherfassung: 'Nacherfassung',
  storno: 'Storniert',
};

export default async function Einwandblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/zeiten/einwaende/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  // Invariante 10: kein Schreibweg ohne genau einen aktiven Mandanten.
  if (sitzung.aktiverMandantId === null) notFound();

  const darf = await haeltRechte(sitzung, 'zeit.lesen', 'zeit.korrigieren');
  /* Ohne `zeit.lesen` traefe die Policy null Zeilen — dann ist 404 die
     ehrliche Antwort und nicht ein leeres Blatt (AUT-06). */
  if (darf['zeit.lesen'] !== true) notFound();

  const e = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => leseEinwand(kontext, id)),
  ) as Promise<EinwandBlatt | null>);
  // AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten.
  if (e === null) notFound();

  const entschieden = (ENTSCHIEDEN as readonly string[]).includes(e.status);
  const entscheidbar = !entschieden && !e.eigener;

  return (
    <PortalRahmen
      titel="Zeit-Einwand"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{e.person}</h1>
        <div className="flex flex-wrap gap-s2">
          <Link
            href={`/portal/${mandant}/zeiten/einwaende`}
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted hover:border-line-strong hover:text-text"
          >
            Zum Einwandeingang
          </Link>
        </div>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Der Mensch ändert seinen Zeiteintrag nie selbst — das ist der Grund,
        warum die Aufzeichnung im Lohnstreit etwas wert ist. Was er hat, ist
        dieser eine Weg: er meldet die Abweichung, die Planung entscheidet, und
        erst die Entscheidung führt zu einer Korrektur.
      </p>

      <div className="mb-s6 grid grid-cols-1 gap-s5 xl:grid-cols-2">
        <section
          data-cse="meldung"
          className="rounded-lg border border-line bg-surface p-s5"
        >
          <h2 className="mb-s4 mt-0 text-h3 text-text">Die Meldung</h2>
          <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <Feld label="Zustand" wert={STATUS_TEXT[e.status] ?? e.status} />
            <Feld label="Art" wert={ART_TEXT[e.art] ?? e.art} />
            <Feld label="Betroffener Tag (Berlin)" wert={e.betrifftDatum} zahl />
            <Feld label="Eingereicht" wert={e.eingereichtLokal} zahl />
            <Feld
              label="Eingereicht von"
              wert={e.eingereichtVon ?? 'Konto nicht einsehbar'}
            />
          </dl>

          <h3 className="mb-s2 mt-s5 text-base text-text">Im Wortlaut</h3>
          <p className="m-0 max-w-prose text-sm text-text">{e.begruendung}</p>

          {(e.behauptetBeginnLokal !== null || e.behauptetEndeLokal !== null
            || e.behauptetPauseMinuten !== null) && (
            <div
              data-cse="behauptet"
              className="mt-s5 rounded-lg border border-warning bg-warning-soft p-s4"
            >
              <h3 className="mb-s2 mt-0 text-base text-warning">
                Angabe der Person — keine Messung
              </h3>
              <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-3">
                <Feld label="Angegebener Beginn" wert={e.behauptetBeginnLokal ?? '—'} zahl />
                <Feld label="Angegebenes Ende" wert={e.behauptetEndeLokal ?? '—'} zahl />
                <Feld
                  label="Angegebene Pause"
                  wert={e.behauptetPauseMinuten === null
                    ? '—' : `${String(e.behauptetPauseMinuten)} min`}
                  zahl
                />
              </dl>
              <p className="m-0 mt-s3 max-w-prose text-sm text-warning">
                Diese Werte sind <strong>nirgends vorbelegt</strong>. Sie werden
                gelesen und nicht durchgeklickt — wer sie übernimmt, schreibt eine
                Korrektur mit Grund und Spur (Invariante 5, TIM-11).
              </p>
            </div>
          )}
        </section>

        <section
          data-cse="aufzeichnung"
          className="rounded-lg border border-line bg-surface p-s5"
        >
          <h2 className="mb-s4 mt-0 text-h3 text-text">Die Aufzeichnung</h2>
          {e.eintrag === null ? (
            <p className="m-0 max-w-prose text-sm text-text-muted">
              Zu diesem Tag gibt es <strong>keinen Zeiteintrag</strong> — genau das
              ist die Meldung (Art „Eintrag fehlt"). Es fehlt hier also nichts;
              der fehlende Eintrag ist der Gegenstand des Vorgangs. Was daraus
              wird, entsteht als Nacherfassung mit ihrer eigenen Spur (TIM-09).
            </p>
          ) : (
            <>
              <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2">
                <Feld label="Beginn (Serveruhr)" wert={e.eintrag.beginnLokal} zahl />
                <Feld
                  label="Ende (Serveruhr)"
                  wert={e.eintrag.endeLokal ?? 'läuft noch'}
                  zahl={e.eintrag.endeLokal !== null}
                />
                <Feld
                  label="Netto"
                  wert={e.eintrag.nettoMinuten === null
                    ? '—' : stundenAusMinuten(e.eintrag.nettoMinuten)}
                  zahl
                />
                <Feld
                  label="Brutto"
                  wert={e.eintrag.bruttoMinuten === null
                    ? '—' : stundenAusMinuten(e.eintrag.bruttoMinuten)}
                  zahl
                />
                <Feld label="Pause" wert={`${String(e.eintrag.pauseMinuten)} min`} zahl />
                <Feld
                  label="Zustand"
                  wert={EINTRAG_STATUS_TEXT[e.eintrag.status] ?? e.eintrag.status}
                />
                <Feld label="Objekt" wert={e.eintrag.objekt ?? 'ohne Objekt'} />
                <Feld label="Gerätezeit Beginn" wert={e.eintrag.geraeteZeitBeginnLokal ?? '—'} zahl />
                <Feld label="Gerätezeit Ende" wert={e.eintrag.geraeteZeitEndeLokal ?? '—'} zahl />
                <Feld
                  label="Abweichung Beginn"
                  wert={abweichung(e.eintrag.abweichungBeginnSek)}
                  zahl
                />
                <Feld
                  label="Abweichung Ende"
                  wert={abweichung(e.eintrag.abweichungEndeSek)}
                  zahl
                />
              </dl>
              <p className="m-0 mt-s4 max-w-prose text-sm text-text-muted">
                Maßgeblich ist die Serveruhr (Invariante 5). Die Gerätezeit steht
                daneben, weil eine Abweichung ohne den Wert, aus dem sie entsteht,
                nicht nachprüfbar wäre. Es sind je ZWEI Werte — Beginn und Ende —
                und nicht einer.
              </p>
              <p className="m-0 mt-s4 text-sm">
                <Link
                  href={`/portal/${mandant}/zeiten/${e.eintrag.id}`}
                  data-cse="zum-eintrag"
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  Zum Zeiteintrag
                </Link>
                {e.eintrag.ersetztDurchId !== null && (
                  <>
                    {' · '}
                    <Link
                      href={`/portal/${mandant}/zeiten/${e.eintrag.ersetztDurchId}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline"
                    >
                      zur aktuellen Fassung
                    </Link>
                  </>
                )}
              </p>
              {e.eintrag.storniert && (
                <p className="m-0 mt-s3 text-sm text-danger">
                  Dieser Eintrag ist storniert — die Zeile bleibt stehen, weil eine
                  gelöschte Aufzeichnung nichts mehr belegt (Invariante 8).
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <section data-cse="entscheidung" className="mb-s6">
        <h2 className="mb-s2 mt-0 text-h3 text-text">
          {entschieden ? 'Die Entscheidung' : 'Entscheiden'}
        </h2>

        {entschieden ? (
          <div className="rounded-lg border border-line bg-surface p-s5">
            <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-3">
              <Feld label="Entscheidung" wert={STATUS_TEXT[e.status] ?? e.status} />
              <Feld label="Am (Serveruhr)" wert={e.entschiedenLokal ?? '—'} zahl />
              <Feld
                label="Von"
                wert={e.entschiedenVon ?? 'Konto nicht einsehbar'}
              />
            </dl>
            <p className="m-0 mt-s4 max-w-prose text-sm text-text">
              {e.entscheidungBegruendung
                ?? 'Ohne Begründung — bei einer Entscheidung sollte das nicht vorkommen.'}
            </p>
          </div>
        ) : e.eigener ? (
          <p
            data-cse="eigener-einwand"
            className="max-w-prose rounded-lg border border-danger bg-danger-soft p-s5 text-sm text-danger"
          >
            <strong>Über den eigenen Einwand entscheidet man nicht</strong>
            {' '}(EMP-07). Die Aufzeichnung behält ihren Beweiswert nur, wenn die
            betroffene Person sie nicht selbst bewegt — die Entscheidung trifft
            die Planung. Das Formular fehlt hier nicht aus Versehen: der Auslöser
            in der Datenbank weist den Vorgang ohnehin ab.
          </p>
        ) : entscheidbar ? (
          <form
            action="/api/zeit/einwand/entscheidung"
            method="post"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="einwand" value={e.id} />
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="zurueck" value={pfad} />
            <label className="block">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Begründung (mindestens 10 Zeichen — außer bei „In Prüfung")
              </span>
              <textarea
                name="begruendung"
                minLength={10}
                rows={3}
                data-cse="begruendung"
                className="w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                placeholder="Was wurde geprüft, und was folgt daraus?"
              />
            </label>
            <div className="mt-s4 flex flex-wrap items-end gap-s3">
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Entscheidung
                </span>
                <select
                  name="status"
                  defaultValue="anerkannt"
                  className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                >
                  <option value="in_pruefung">In Prüfung (noch keine Entscheidung)</option>
                  <option value="anerkannt">Anerkannt</option>
                  <option value="teilweise_anerkannt">Teilweise anerkannt</option>
                  <option value="abgelehnt">Abgelehnt</option>
                </select>
              </label>
              <Button type="submit" variante="primary">Entscheiden</Button>
            </div>
            <p className="m-0 mt-s4 max-w-prose text-sm text-text-muted">
              Anerkennen ändert die Zeit noch nicht — die neue Fassung entsteht
              mit der Korrektur, und die trägt ihre eigene Spur und ihr eigenes
              Recht (TIM-11).
            </p>
          </form>
        ) : (
          <p className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Dieser Einwand ist nicht mehr zu entscheiden ({STATUS_TEXT[e.status] ?? e.status}).
          </p>
        )}
      </section>

      <section data-cse="korrekturfolge">
        <h2 className="mb-s2 mt-0 text-h3 text-text">Ist eine Korrektur gefolgt?</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Das ist die häufigste Verwechslung: „ich habe es doch anerkannt".
          Anerkennen sagt, DASS die Meldung zutrifft — die neue Fassung des
          Zeiteintrags entsteht erst mit der Korrektur.
        </p>
        {e.korrektur !== null ? (
          <div
            data-cse="korrektur"
            className="rounded-lg border border-success bg-success-soft p-s5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-s3">
              <span className="text-base text-success">
                <strong>
                  {KORREKTUR_ART_TEXT[e.korrektur.art] ?? e.korrektur.art}
                </strong>
                {' · '}
                {e.korrektur.grundKategorie}
              </span>
              <span className="text-sm tabular-nums text-success">
                {e.korrektur.amLokal}
              </span>
            </div>
            <p className="m-0 mt-s2 max-w-prose text-sm text-success">
              {e.korrektur.begruendung}
            </p>
            <p className="m-0 mt-s2 text-sm text-success">
              {e.korrektur.durchVon ?? 'Konto nicht einsehbar'}
              {e.korrektur.ersatzZeiteintragId !== null && (
                <>
                  {' · '}
                  <Link
                    href={`/portal/${mandant}/zeiten/${e.korrektur.ersatzZeiteintragId}`}
                    className="underline"
                  >
                    zur neuen Fassung
                  </Link>
                </>
              )}
            </p>
          </div>
        ) : e.status === 'anerkannt' || e.status === 'teilweise_anerkannt' ? (
          <div
            data-cse="anerkannt-ohne-korrektur"
            className="rounded-lg border border-warning bg-warning-soft p-s5"
          >
            <p className="m-0 max-w-prose text-sm text-warning">
              <strong>Anerkannt, aber keine Korrektur.</strong> Genau dieser Fall
              ist der, den man sehen will: die Meldung ist als zutreffend
              anerkannt, und die Aufzeichnung steht unverändert da. Solange das so
              bleibt, ist der Zeiteintrag nach der eigenen Entscheidung falsch.
            </p>
            {darf['zeit.korrigieren'] === true && e.eintrag !== null && (
              <p className="m-0 mt-s3 text-sm">
                <Link
                  href={`/portal/${mandant}/zeiten/${e.eintrag.id}/korrektur`}
                  data-cse="zur-korrektur"
                  className="text-warning underline"
                >
                  Korrektur schreiben
                </Link>
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            Keine Korrektur zu dieser Meldung — bei diesem Zustand ist das
            richtig.
          </p>
        )}
      </section>
    </PortalRahmen>
  );
}

/**
 * `-7200` → `-7200 s — Gerät ging nach`. Das Vorzeichen trägt die Richtung.
 *
 * Die Abweichung ist GERÄT MINUS SERVER (`kern.stempel_feldzeit()` in 0034,
 * D-134): eine negative Zahl heisst, die Telefonuhr lag HINTER der Serveruhr —
 * das Gerät ging nach. Derselbe Satz stand auf dem Zeiteintragsblatt einmal
 * verkehrt herum, und das ist das Teure daran: wer eine § 17-Aufzeichnung
 * prüft, liest den Satz und nicht das Vorzeichen.
 */
function abweichung(sekunden: number | null): string {
  if (sekunden === null) return '—';
  if (sekunden === 0) return '0 s — Gerät und Server gleich';
  const richtung = sekunden < 0 ? 'Gerät ging nach' : 'Gerät ging vor';
  return `${String(sekunden)} s — ${richtung}`;
}

function Feld({ label, wert, zahl = false }: {
  readonly label: string; readonly wert: string; readonly zahl?: boolean;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd className={`m-0 mt-s1 text-sm text-text ${zahl ? 'tabular-nums' : ''}`}>{wert}</dd>
    </div>
  );
}
