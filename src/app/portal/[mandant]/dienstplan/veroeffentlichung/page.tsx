import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { montag, tagePlus } from '@/lib/datum/kalendertag';
import { berlinHeute } from '@/server/db/heute';
import {
  UMFANG_TEXT, letzteVorgaenge, vorschau, zeitraumText,
  type Vorschau, type VorgangZeile,
} from '@/server/services/dienstplan/veroeffentlichung';

/**
 * `/portal/[mandant]/dienstplan/veroeffentlichung` — einen Zeitraum bekannt
 * geben (TIM-01, NOT-01).
 *
 * **Vier Fragen sind offen, und diese Seite beantwortet keine davon.** Sie
 * stehen unten auf der Seite, damit niemand glaubt, sie seien entschieden:
 *
 *  - **O-710** Welcher Zeitraum wird veröffentlicht — Woche, Monat, freies
 *    Fenster? Die Vorgabe „kommende Woche" ist eine Oberflächenvorgabe.
 *  - **O-711** Wer wird benachrichtigt — jede eingeteilte Person, oder auch
 *    Personen mit gestrichener Schicht?
 *  - **O-712** Was bedeutet eine Änderung NACH der Bekanntgabe?
 *  - **O-713** Ist eine bekanntgegebene Schicht gegen stille Änderung
 *    geschützt?
 *
 * **Was die Seite trotzdem vollständig tut.** Sie zeigt die Vorschau dessen,
 * was hinausginge: Zahl der Schichten, der unbesetzten, der offenen und der
 * blockierenden Konflikte, und je betroffener Person ihre Schichten in
 * Europe/Berlin — also genau die Nachricht, die sie bekäme. Blockierende
 * Konflikte stehen obenan; ob sie die Bekanntgabe SPERREN, ist Teil der
 * offenen Frage und wird hier nicht entschieden.
 *
 * **Kein Zustand auf `einsatz`.** `einsatz_status` kennt kein
 * `veroeffentlicht`, und das fehlt mit Absicht (K-17, `drizzle/0028`,
 * `04-PLANUNG-ZEIT.md` §224): `dienstplan.veroeffentlichen` ist ein Recht auf
 * eine HANDLUNG. Was entsteht, ist der Beleg des Vorgangs — wer, wann, welcher
 * Zeitraum, was stand darin, wie viele Menschen hat die Meldung erreicht.
 *
 * **Wer keinen Zugang hat, bekommt keine Meldung** (D-09), und das steht
 * sichtbar da. Eine Bekanntgabe, die die halbe Kolonne nicht erreicht, ist
 * keine — und der Planer muss es sehen, solange er noch anrufen kann.
 */
export const dynamic = 'force-dynamic';

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

export default async function Veroeffentlichung(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/dienstplan/veroeffentlichung`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  // Invariante 10: kein Schreibweg ohne genau einen aktiven Mandanten.
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const einWert = (schluessel: string): string | null => {
    const wert = frage[schluessel];
    return typeof wert === 'string' && wert !== '' ? wert : null;
  };

  /* „Heute" aus der DATENBANK, nicht aus der Prozessuhr (Invariante 2 und 5). */
  const heute = await berlinHeute();
  /**
   * Vorgabe: die KOMMENDE Woche, an Berliner Wochengrenzen.
   *
   * `montag()` rechnet auf ISO-Kalendertagen und braucht deshalb keine zweite
   * Zonenrechnung. Ein Fenster aus `now() + interval '7 days'` verschöbe sich
   * an jeder Umstellung um eine Stunde und schnitte den Rand des letzten Tages
   * ab — und was fehlte, wäre die Nachtschicht.
   */
  const vorgabeVon = tagePlus(montag(heute), 7);
  const rohVon = einWert('von');
  const rohBis = einWert('bis');
  const von = rohVon !== null && DATUM.test(rohVon) ? rohVon : vorgabeVon;
  const bis = rohBis !== null && DATUM.test(rohBis) && rohBis >= von
    ? rohBis
    : tagePlus(von, 6);
  const umfang = einWert('umfang') ?? (von === montag(von) && bis === tagePlus(von, 6)
    ? 'woche' : 'freier_zeitraum');

  const eben = einWert('veroeffentlicht');
  const empfaenger = einWert('empfaenger');
  const ohne = einWert('ohne');

  /*
   * Drei Rechte, und zwei davon sind die LESERECHTE — nicht das Torrecht.
   *
   * Die Seitenkarte tort diese Route auf `dienstplan.veroeffentlichen`. Die
   * Policies fragen etwas anderes: `einsatz`, `einsatz_zuordnung` und
   * `planungs_konflikt` sind fuer `cse_app` nur mit `dienstplan.lesen` lesbar,
   * `objekt` nur mit `objekt.lesen`. Eine Sitzung mit dem
   * Veroeffentlichungsrecht ohne Leserecht bekaeme eine Vorschau aus lauter
   * Nullen, der Knopf staende trotzdem da, und der Beleg behauptete danach
   * eine Bekanntgabe, die niemanden erreicht hat.
   *
   * Deshalb dieselbe Zeile wie in den Schwesterblaettern `…/quittung` und
   * `…/uebersteuern`: ohne `dienstplan.lesen` ist 404 die ehrliche Antwort und
   * nicht ein leeres Blatt (AUT-06). `objekt.lesen` fehlt seltener, raeumt die
   * Empfaengerliste aber genauso leer (der `join objekt` in der Vorschau) —
   * das steht als Warnung auf der Seite, und `veroeffentliche()` weist den
   * Schreibweg dann ab.
   */
  const darf = await haeltRechte(
    sitzung, 'dienstplan.veroeffentlichen', 'dienstplan.lesen', 'objekt.lesen',
    'dienstplan.arbzg_lesen',
  );
  if (darf['dienstplan.lesen'] !== true) notFound();

  const { bild, vorgaenge } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        bild: await vorschau(kontext, von, bis),
        vorgaenge: await letzteVorgaenge(kontext, 10),
      })),
  ) as Promise<{ bild: Vorschau; vorgaenge: readonly VorgangZeile[] }>);

  return (
    <PortalRahmen
      titel="Veröffentlichung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Dienstplan veröffentlichen</h1>
        <Link
          href={`/portal/${mandant}/dienstplan/woche?woche=${von}`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
        >
          Zum Dienstplan
        </Link>
      </div>

      {eben !== null && (
        <p
          data-cse="veroeffentlicht"
          className="mb-s5 max-w-prose rounded-lg border border-success bg-success-soft p-s4 text-sm text-success"
        >
          <strong>Veröffentlicht.</strong> {empfaenger ?? '0'} Person(en) haben eine
          Meldung im Posteingang.
          {ohne !== null && ohne !== '0' && (
            <>
              {' '}
              <strong>{ohne} Person(en) haben keinen Zugang</strong> und damit keine
              Meldung bekommen (D-09) — die erreicht nur ein Anruf.
            </>
          )}
        </p>
      )}

      <form
        method="get"
        data-cse="zeitraumwahl"
        className="mb-s5 flex flex-wrap items-end gap-s3 rounded-lg border border-line bg-surface p-s4"
      >
        <label>
          <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
            Von
          </span>
          <input
            type="date"
            name="von"
            defaultValue={von}
            className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm tabular-nums text-text"
          />
        </label>
        <label>
          <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
            Bis (einschließlich)
          </span>
          <input
            type="date"
            name="bis"
            defaultValue={bis}
            className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm tabular-nums text-text"
          />
        </label>
        <label>
          <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
            Zeitraumart — offen (O-710)
          </span>
          <select
            name="umfang"
            defaultValue={umfang}
            className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
          >
            <option value="woche">{UMFANG_TEXT.woche}</option>
            <option value="freier_zeitraum">{UMFANG_TEXT.freier_zeitraum}</option>
          </select>
        </label>
        <Button type="submit" variante="secondary">Vorschau</Button>
      </form>

      {bild.konflikteBlockierend > 0 && (
        <p
          data-cse="sperren-im-fenster"
          className="mb-s5 max-w-prose rounded-lg border border-danger bg-danger-soft p-s5 text-sm text-danger"
        >
          <strong>
            {String(bild.konflikteBlockierend)} blockierende(r) Konflikt(e) in diesem
            Zeitraum.
          </strong>{' '}
          Eine Sperre ist keine Warnung — sie ist eine Einteilung, die so nicht
          stattfinden darf (§ 34a GewO, SEC-04). Ob sie die Veröffentlichung
          aufhält, ist <strong>offen (O-712)</strong> und wird hier nicht
          entschieden; dass Sie trotz Sperre veröffentlicht haben, steht danach im
          Beleg.{' '}
          {/*
            * Der Konflikteingang verlangt zusaetzlich `dienstplan.arbzg_lesen`
            * (Routenregister, §5.10): er zeigt Ruhezeiten und Hoechstarbeitszeiten,
            * also Angaben ueber die Gesundheit von Menschen. Wer die Zahl hier
            * sehen darf, darf die Liste dahinter deshalb nicht zwangslaeufig
            * oeffnen — ohne das Recht bleibt der Satz und faellt der Verweis weg
            * (D-567, AUT-06).
            */}
          {darf['dienstplan.arbzg_lesen'] === true ? (
            <Link
              href={`/portal/${mandant}/dienstplan/konflikte`}
              className="underline"
            >
              Zum Konflikteingang
            </Link>
          ) : (
            <span>
              Der Konflikteingang selbst braucht <code>dienstplan.arbzg_lesen</code>.
            </span>
          )}
        </p>
      )}

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 mt-0 text-h3 text-text">
          Was hinausginge — {zeitraumText(von, bis)}
        </h2>
        <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
          <Kennzahl label="Schichten im Zeitraum" wert={bild.schichten} />
          <Kennzahl label="davon unbesetzt" wert={bild.unbesetzt} ton="warnung" />
          <Kennzahl label="offene Konflikte" wert={bild.konflikteOffen} ton="warnung" />
          <Kennzahl
            label="darunter blockierend"
            wert={bild.konflikteBlockierend}
            ton="sperre"
          />
          <Kennzahl label="betroffene Personen" wert={bild.personen.length} />
          <Kennzahl label="ohne Zugang" wert={bild.ohneZugang} ton="warnung" />
        </dl>
        <p className="m-0 mt-s4 max-w-prose text-sm text-text-muted">
          Gezählt wird in der Datenbank, nicht geschätzt: dieselbe Abfrage liefert
          diese Vorschau und die Zahlen, die im Beleg stehen. „Unbesetzt" heißt
          hier: weniger eingeteilt als Soll <em>oder</em> weniger zugesagt als
          Mindestbesetzung — dieselben beiden Zählungen wie in{' '}
          <Link
            href={`/portal/${mandant}/dienstplan/offene-schichten?von=${von}&bis=${bis}`}
            className="text-text underline-offset-2 hover:text-brand hover:underline"
          >
            Offene Schichten
          </Link>.
        </p>
      </section>

      <section className="mb-s6">
        <h2 className="mb-s2 mt-0 text-h3 text-text">Wer was bekäme</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Je Person eine Zeile, und darin genau die Schichten, die in ihrer
          Meldung stünden — Europe/Berlin, eine Nachtschicht am Abend ihres
          Beginns. Wer abgesagt hat, steht nicht dabei.
        </p>
        {bild.personen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            In diesem Zeitraum ist niemand eingeteilt. Eine Bekanntgabe erreichte
            damit niemanden — das heißt nicht, dass keine Schichten geplant wären
            ({String(bild.schichten)} im Fenster), sondern dass sie unbesetzt sind.
          </p>
        ) : (
          <DataTable
            beschriftung="Betroffene Personen mit ihren Schichten im gewählten Zeitraum"
            zeilen={bild.personen}
            schluessel={(p) => p.personId}
            spalten={[
              { schluessel: 'person', kopf: 'Person', zelle: (p) => p.person },
              {
                schluessel: 'anzahl',
                kopf: 'Schichten',
                numerisch: true,
                zelle: (p) => String(p.schichten),
              },
              {
                schluessel: 'fenster',
                kopf: 'Ihre Schichten',
                zelle: (p) => (
                  <span className="block tabular-nums">
                    {p.fenster.join(' · ')}
                  </span>
                ),
              },
              {
                schluessel: 'zugang',
                kopf: 'Erreichbar',
                zelle: (p) => (p.hatZugang
                  ? 'Posteingang'
                  : (
                    <span className="text-warning">
                      kein Zugang — nur telefonisch
                    </span>
                  )),
              },
            ]}
          />
        )}
      </section>

      <section className="mb-s6">
        <h2 className="mb-s2 mt-0 text-h3 text-text">Veröffentlichen</h2>
        {darf['dienstplan.veroeffentlichen'] !== true ? (
          <p className="max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            Zum Veröffentlichen fehlt das Recht{' '}
            <code className="text-xs">dienstplan.veroeffentlichen</code>. Die
            Vorschau oben steht trotzdem — wer den Plan lesen darf, darf sehen, was
            bekanntgegeben würde.
          </p>
        ) : darf['objekt.lesen'] !== true ? (
          /*
           * Kein Knopf ueber einer leeren Liste: die Empfaengerabfrage
           * verbindet `einsatz_zuordnung` mit `objekt`, und ohne
           * `objekt.lesen` raeumt die Policy sie leer. Der Beleg saehe dann
           * aus wie eine Bekanntgabe an niemanden — `veroeffentliche()` weist
           * den Weg deshalb auch serverseitig ab.
           */
          <p className="max-w-prose rounded-lg border border-warning bg-surface p-s4 text-sm text-text">
            Diese Sitzung darf Objekte nicht lesen (<code className="text-xs">objekt.lesen</code>).
            Die Empfängerliste oben bliebe damit leer, ohne dass jemand fehlt —
            und der Beleg behauptete eine Bekanntgabe, die niemanden erreicht
            hat. Der Weg ist bis dahin gesperrt.
          </p>
        ) : bild.schichten === 0 && bild.personen.length === 0 ? (
          <p className="max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            In diesem Zeitraum steht keine Schicht und ist niemand eingeteilt. Eine
            Bekanntgabe darüber wäre ein Beleg über nichts — wählen Sie einen anderen
            Zeitraum.
          </p>
        ) : (
          <form
            action="/api/dienstplan/veroeffentlichung"
            method="post"
            data-cse="veroeffentlichen"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="von" value={von} />
            <input type="hidden" name="bis" value={bis} />
            <input type="hidden" name="umfang" value={umfang} />
            <label className="block">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Notiz zum Vorgang (freiwillig)
              </span>
              <input
                name="notiz"
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                placeholder="Was war bei dieser Bekanntgabe besonders?"
              />
            </label>
            <div className="mt-s4 flex flex-wrap items-center gap-s3">
              <Button type="submit" variante="primary">
                {zeitraumText(von, bis)} veröffentlichen
              </Button>
              <span className="text-sm text-text-muted">
                {bild.personen.length === 0
                  ? 'Niemand ist eingeteilt — es ginge keine Meldung hinaus, der '
                    + 'Vorgang hielte aber fest, dass der Zeitraum bekanntgegeben wurde.'
                  : `${String(bild.personen.length - bild.ohneZugang)} Meldung(en) `
                    + 'gehen in den Posteingang.'}
              </span>
            </div>
          </form>
        )}
      </section>

      <section className="mb-s6">
        <h2 className="mb-s2 mt-0 text-h3 text-text">Bisherige Bekanntgaben</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Der Beleg: wer hat wann welchen Zeitraum bekanntgegeben, und was stand
          damals darin. Die Zeile bleibt stehen — eine Änderung ist eine zweite
          Bekanntgabe, nie ein Überschreiben der ersten (Invariante 8).
        </p>
        {vorgaenge.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            Noch nichts veröffentlicht. Das heißt nicht, dass niemand seinen Plan
            kennt — bis hierher gab es diesen Vorgang gar nicht.
          </p>
        ) : (
          <DataTable
            beschriftung="Die letzten zehn Bekanntgaben dieser Gesellschaft"
            zeilen={vorgaenge}
            schluessel={(v) => v.id}
            spalten={[
              {
                schluessel: 'zeitraum',
                kopf: 'Zeitraum',
                zelle: (v) => (
                  <span>
                    <span className="block tabular-nums text-text">
                      {zeitraumText(v.von, v.bis)}
                    </span>
                    <span className="block text-micro text-text-muted">
                      {UMFANG_TEXT[v.umfang] ?? v.umfang}
                    </span>
                  </span>
                ),
              },
              {
                schluessel: 'am',
                kopf: 'Veröffentlicht',
                zelle: (v) => (
                  <span>
                    <span className="block tabular-nums text-text">{v.amLokal}</span>
                    <span className="block text-micro text-text-muted">
                      {v.von_wem ?? 'Konto nicht einsehbar'}
                    </span>
                  </span>
                ),
              },
              {
                schluessel: 'schichten',
                kopf: 'Schichten',
                numerisch: true,
                zelle: (v) => String(v.schichten),
              },
              {
                schluessel: 'unbesetzt',
                kopf: 'unbesetzt',
                numerisch: true,
                zelle: (v) => String(v.unbesetzt),
              },
              {
                schluessel: 'konflikte',
                kopf: 'Konflikte (blockierend)',
                numerisch: true,
                zelle: (v) => (
                  <span className={v.konflikteBlockierend > 0 ? 'text-danger' : ''}>
                    {String(v.konflikteOffen)} ({String(v.konflikteBlockierend)})
                  </span>
                ),
              },
              {
                schluessel: 'empfaenger',
                kopf: 'Meldungen (ohne Zugang)',
                numerisch: true,
                zelle: (v) => `${String(v.empfaenger)} (${String(v.ohneZugang)})`,
              },
              {
                schluessel: 'notiz',
                kopf: 'Notiz',
                zelle: (v) => v.notiz ?? '—',
              },
            ]}
          />
        )}
      </section>

      <section
        data-cse="offene-fragen"
        className="rounded-lg border border-warning bg-warning-soft p-s5"
      >
        <h2 className="mb-s3 mt-0 text-h3 text-warning">Vier Fragen sind offen</h2>
        <p className="mb-s3 max-w-prose text-sm text-warning">
          Ein Veröffentlichungsablauf, den die Spezifikation nicht beschreibt,
          wäre eine erfundene Geschäftsregel (K-17). Deshalb gibt es hier keinen
          Zustand je Schicht, keine Sperre und kein Einfrieren — und deshalb steht
          hier, was noch entschieden werden muss:
        </p>
        <ul className="m-0 list-disc pl-s5 text-sm text-warning">
          <li>
            <strong>offen (O-710)</strong> — welcher Zeitraum wird
            veröffentlicht: Woche, Monat, freies Fenster? Heute: die kommende
            Woche als Vorgabe, jedes Fenster wählbar.
          </li>
          <li>
            <strong>offen (O-711)</strong> — wer wird benachrichtigt: jede
            eingeteilte Person, oder auch Personen mit gestrichener Schicht?
            Heute: wer im Fenster eine lebende Einteilung hat, ohne Absagen.
          </li>
          <li>
            <strong>offen (O-712)</strong> — was bedeutet eine Änderung nach der
            Bekanntgabe: neue Meldung, Sperre, gar nichts? Heute: nichts von
            selbst; eine zweite Bekanntgabe ist eine zweite Zeile.
          </li>
          <li>
            <strong>offen (O-713)</strong> — ist eine veröffentlichte Schicht
            gegen stille Änderung geschützt? Heute: nein, und zwar nicht aus
            Versehen — eine Sperre würde die Disposition am Einsatztag stehen
            lassen.
          </li>
        </ul>
      </section>
    </PortalRahmen>
  );
}

/**
 * Eine Zahl mit Beschriftung — kein Farbcode allein (DESIGN §9).
 *
 * Der Ton faerbt nur, was ohnehin im Wort steht: „darunter blockierend" ist
 * eine Sperre, gleich welche Farbe daran haengt.
 */
function Kennzahl({ label, wert, ton = 'neutral' }: {
  readonly label: string; readonly wert: number;
  readonly ton?: 'neutral' | 'warnung' | 'sperre';
}) {
  const klasse = wert === 0
    ? 'text-text'
    : ton === 'sperre' ? 'text-danger' : ton === 'warnung' ? 'text-warning' : 'text-text';
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd className={`m-0 mt-s1 text-h3 tabular-nums ${klasse}`}>{String(wert)}</dd>
    </div>
  );
}
