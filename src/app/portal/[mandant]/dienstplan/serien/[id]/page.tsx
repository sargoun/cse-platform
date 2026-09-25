import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { LeistungsankerFeld } from '@/components/portal/LeistungsankerFeld';
import { LEISTUNGSANKER_TEXTE } from '@/lib/i18n/verwaltung/leistungsanker';
import { eigenerEintrag } from '@/lib/nachschlagen';
import {
  listeAnkerbareLeistungen, type AnkerbareLeistung,
} from '@/server/services/dienstplan/leistungsanker';
import type { BereichSchluessel } from '@/lib/design/theme';
import { Nutzlastblatt } from '@/components/ui/Nutzlastblatt';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { NUTZLAST_TEXTE } from '@/lib/i18n/verwaltung/nutzlast';
import { SERIE_PFLEGE_TEXTE } from '@/lib/i18n/verwaltung/dienstplan-serie-pflege';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { WOCHENTAGE } from '@/lib/datum/rrule';
import {
  ausnahmeLeserecht, ausnahmeSchreibrecht, leseAusnahmen, leseSerie, leseSerienEinsaetze,
  type AusnahmeZeile, type SerienBlatt, type SerienEinsatzZeile,
} from '@/server/services/dienstplan/serie';
import { lesbareRegel } from '@/lib/datum/regeltext';
import { MAX_DAUER_MINUTEN } from '@/server/services/dienstplan/vorkommnisse';
import {
  ANOMALIE_TEXT, AUSNAHME_TEXT, Feld, QUELLE_TEXT,
} from './Bausteine';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/dienstplan/serien/[id]` — das Blatt einer Serie
 * (TIM-02, TIM-03, CLN-02, D-487).
 *
 * Es beantwortet die Frage, die im Plan selbst nicht steht: **woher kommen
 * diese Schichten?** `generiert_bis` steht deshalb gross — eine
 * stehengebliebene Serie sieht sonst aus wie eine Serie ohne Termine, und der
 * Unterschied ist der zwischen „nichts zu tun" und „der Generator läuft
 * nicht".
 *
 * **`planungsserie` traegt keines der Kopffelder.** Kein `bezeichnung`, kein
 * `objekt_id`, keine `rrule`, kein `dtstart`, keine `dauer_minuten`, keine
 * Feiertagsregel, kein `gueltig_ab`. Alles davon kommt aus dem TRAEGER —
 * `turnus`, `posten` oder `veranstaltung` —, und `leseSerie` ist deshalb ein
 * `coalesce`-Join und kein Einzelsatz-Read. Wer das als
 * `select * from planungsserie` baut, bekommt eine Seite mit lauter leeren
 * Feldern und keine Fehlermeldung.
 *
 * **Drei Ausnahmearten, nicht zwei.** `turnus_ausnahme_art` ist
 * ('ausfall','zusatz','verschiebung'), und `zusatz` IST im Generator
 * implementiert. Ein Formular mit nur zwei Arten liesse eine bestehende
 * `zusatz`-Zeile unbeschriftet und den einzigen Weg, eine Zusatzschicht in
 * eine Serie zu haengen, unerreichbar.
 *
 * **Das Gewerkerecht, nicht `dienstplan.*`.** Die Ausnahmetabellen gehoeren
 * den Gewerken: `turnus_ausnahme` verlangt zum Lesen `reinigung.lesen` und
 * zum Schreiben `reinigung.schreiben`, `posten_ausnahme` entsprechend
 * `security.*` (0029, 0069). Die Route hier ist auf `dienstplan.lesen` getort.
 * Eine Sitzung ohne das Gewerkerecht sieht deshalb eine LEERE Ausnahmeliste —
 * und die Seite sagt „nicht einsehbar" statt „keine Ausnahme". Das Formular
 * steht nur da, wenn das Schreibrecht wirklich gehalten wird; ein Knopf, der
 * in einer Policy endet, ist schlechter als keiner.
 */
export const dynamic = 'force-dynamic';

export default async function Serienblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/dienstplan/serien/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const angelegt = typeof frage['ausnahme'] === 'string' ? frage['ausnahme'] : null;
  const erzeugt = typeof frage['erzeugt'] === 'string' ? frage['erzeugt'] : null;
  const storniert = typeof frage['storniert'] === 'string' ? frage['storniert'] : null;
  const gepflegt = typeof frage['gepflegt'] === 'string' ? frage['gepflegt'] : null;
  const pflegeFehler = typeof frage['fehler'] === 'string' ? frage['fehler'] : null;

  const gelesen = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const blatt = await leseSerie(kontext, id);
        if (blatt === null) return null;
        /*
         * Die Leistungszeilen fuer den Anker des Turnus (V-191) — unter der
         * RLS des Betrachters: ohne `auftrag.lesen` ist die Liste leer, und
         * die Maske zeigt dann KEIN Feld (siehe unten).
         */
        const [lesen] = await kontext.abfrage<{ darf: boolean }>(
          `select app.hat_recht('auftrag.lesen', app.aktiver_mandant()) as darf`);
        return {
          blatt,
          einsaetze: await leseSerienEinsaetze(kontext, id),
          ausnahmen: await leseAusnahmen(kontext, blatt),
          anker: blatt.turnusId !== null && lesen?.darf === true
            ? await listeAnkerbareLeistungen(kontext, blatt.auftragLeistungId) : null,
        };
      }),
  ) as Promise<{
    blatt: SerienBlatt;
    einsaetze: readonly SerienEinsatzZeile[];
    ausnahmen: readonly AusnahmeZeile[];
    anker: readonly AnkerbareLeistung[] | null;
  } | null>);
  // AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten.
  if (gelesen === null) notFound();
  const { blatt, einsaetze, ausnahmen, anker } = gelesen;

  const leserecht = ausnahmeLeserecht(blatt);
  const schreibrecht = ausnahmeSchreibrecht(blatt);
  const darf = await haeltRechte(
    sitzung,
    'dienstplan.schreiben',
    ...(leserecht === null ? [] : [leserecht]),
    ...(schreibrecht === null ? [] : [schreibrecht]),
  );
  const ausnahmenEinsehbar = leserecht !== null && darf[leserecht] === true;
  const darfAusnahmeAnlegen = schreibrecht !== null
    && darf['dienstplan.schreiben'] === true && darf[schreibrecht] === true;
  const istPosten = blatt.postenId !== null;
  const tNutzlast = nachSprache(NUTZLAST_TEXTE, zugang.sprache);
  const tP = nachSprache(SERIE_PFLEGE_TEXTE, zugang.sprache);
  const tL = nachSprache(LEISTUNGSANKER_TEXTE, zugang.sprache);
  /* Was die Adresse meldet, steht nur als eigener Satz da — nie ihr Wortlaut (V-192). */
  const erledigtText = gepflegt === null ? undefined : eigenerEintrag(tP.erledigt, gepflegt);

  return (
    <PortalRahmen
      titel="Serie"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">
          {blatt.bezeichnung}
          {blatt.archiviert && <span className="ml-s3 text-h3 text-text-muted">archiviert</span>}
        </h1>
        <div className="flex flex-wrap gap-s2">
          <Link
            href={`/portal/${mandant}/dienstplan/serien`}
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted hover:border-line-strong hover:text-text"
          >
            Zur Serienliste
          </Link>
          {blatt.gueltigAb !== null && (
            <Link
              href={`/portal/${mandant}/dienstplan/woche?woche=${blatt.gueltigAb}`}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted hover:border-line-strong hover:text-text"
            >
              Zum Dienstplan
            </Link>
          )}
        </div>
      </div>

      {angelegt !== null && (
        <p
          data-cse="ausnahme-angelegt"
          className="mb-s5 max-w-prose rounded-lg border border-success bg-success-soft p-s4 text-sm text-success"
        >
          <strong>Ausnahme angelegt.</strong> Der Generator ist sofort gelaufen:{' '}
          {erzeugt ?? '0'} Schicht(en) erzeugt, {storniert ?? '0'} storniert. Eine
          Ausnahme, die erst der Nachtlauf anwendet, wäre bis morgen eine Zeile
          ohne Wirkung.
        </p>
      )}

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 mt-0 text-h3 text-text">Woraus die Schichten entstehen</h2>
        <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
          <Feld label="Quelle" wert={QUELLE_TEXT[blatt.quelle] ?? blatt.quelle} />
          <Feld label="Objekt" wert={blatt.objekt ?? 'nicht einsehbar'} />
          <Feld
            label={istPosten ? 'Posten' : 'Revier'}
            wert={(istPosten ? blatt.posten : blatt.revier) ?? '—'}
          />
          <Feld
            label="Regel"
            wert={blatt.rrule === null
              ? 'einzelnes Fenster — eine Veranstaltung ist keine Wiederholung (SEC-08)'
              : lesbareRegel(blatt.rrule)}
          />
          <Feld
            label="Beginn (Wanduhr Europe/Berlin)"
            wert={blatt.beginnLokal ?? '—'}
            zahl
          />
          <Feld label="Dauer" wert={stundenAusMinuten(blatt.dauerMinuten)} zahl />
          <Feld
            label="Besetzung"
            wert={`${String(blatt.sollBesetzung)} soll · `
              + `${String(blatt.minBesetzung)} mindestens`}
            zahl
          />
          <Feld
            label="Am Feiertag"
            wert={blatt.feiertagsregel === 'ausfall'
              ? `fällt aus (${blatt.feiertagBundesland})`
              : `findet statt (${blatt.feiertagBundesland})`}
          />
          <Feld
            label="Gültig"
            wert={blatt.gueltigBis === null
              ? `ab ${blatt.gueltigAb ?? '—'}`
              : `${blatt.gueltigAb ?? '—'} bis ${blatt.gueltigBis}`}
            zahl
          />
        </dl>

        <p className="m-0 mt-s4 max-w-prose text-sm text-text-muted">
          Die Dauer ist eine Aussage über die <strong>Wanduhr</strong>, nicht über
          die verstrichene Zeit: 22:00 plus 480 Minuten ist 06:00 — in jeder der
          drei Nächte. Erst der Abstand der Zeitpunkte unterscheidet sie, 480
          Minuten in einer normalen Nacht, 420 in der Vorstellungs- und 540 in
          der Rückstellungsnacht (K-11).
        </p>
      </section>

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 mt-0 text-h3 text-text">Stand des Generators</h2>
        <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
          <Feld
            label="Geplant bis"
            wert={blatt.generiertBis ?? 'noch nie gelaufen'}
            zahl={blatt.generiertBis !== null}
            gross
          />
          <Feld label="Horizont" wert={`${String(blatt.horizontTage)} Tage`} zahl />
          <Feld
            label="Letzter Lauf"
            wert={blatt.letzteGenerierungLokal ?? '—'}
            zahl={blatt.letzteGenerierungLokal !== null}
          />
          <Feld label="Schichten insgesamt" wert={String(blatt.einsaetze)} zahl />
          <Feld label="Zeitzone" wert={blatt.zeitzone} />
          <Feld
            label="Zustand"
            wert={blatt.archiviert ? 'archiviert — erzeugt nichts mehr' : 'aktiv'}
          />
        </dl>
        {blatt.generiertBis === null && (
          <p className="m-0 mt-s4 max-w-prose text-sm text-warning">
            Diese Serie hat noch nie Schichten erzeugt. Das ist nicht dasselbe wie
            „nichts zu tun" — wahrscheinlicher ist, dass der Generator für sie
            nicht gelaufen ist.
          </p>
        )}
        {/*
          * **Die Meldung des Laufs als BLATT, nicht als JSON.** Hier stand
          * `JSON.stringify(...)` in einem `code`-Element: `{"uebersprungen":3,
          * "grund":"kein_posten"}`. Was der Lauf übersprungen hat, gehört
          * einer Objektleitung gesagt und nicht einem Entwickler (§8.4) —
          * und wer es nicht liest, sucht den Fehler bei sich.
          */}
        {Object.keys(blatt.letzteMeldung).length > 0 && (
          <div className="mt-s4 max-w-prose">
            <p className="m-0 mb-s2 text-sm text-text-muted">
              Letzte Meldung des Laufs — was er übersprungen hat, steht hier und
              wird nicht verschluckt (§8.4).
            </p>
            <Nutzlastblatt
              nutzlast={blatt.letzteMeldung}
              sprache={zugang.sprache ?? 'de'}
              texte={tNutzlast}
              cse="letzte-meldung"
            />
          </div>
        )}
      </section>

      <section className="mb-s6">
        <h2 className="mb-s2 mt-0 text-h3 text-text">Schichten im Horizont</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Ab heute, in Europe/Berlin. Stornierte Schichten stehen mit — eine
          Schicht, die der Generator wegen einer Serienänderung storniert hat,
          fehlte sonst einfach, und im Plan wäre eine Lücke ohne Grund
          (Invariante 8).
        </p>
        {einsaetze.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            Keine Schicht ab heute. Bei einer aktiven Serie heißt das: der
            Generator ist für sie nicht gelaufen.
          </p>
        ) : (
          <DataTable
            beschriftung="Materialisierte Schichten dieser Serie ab heute"
            zeilen={einsaetze}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'tag',
                kopf: 'Tag',
                zelle: (z) => <span className="tabular-nums">{z.tagLokal}</span>,
              },
              {
                schluessel: 'fenster',
                kopf: 'Fenster',
                zelle: (z) => (
                  <span>
                    <span className="block tabular-nums text-text">
                      {z.beginnLokal}–{z.endeLokal}{z.endetAmFolgetag ? ' (+1)' : ''}
                    </span>
                    {z.zeitanomalie !== 'keine' && (
                      <span
                        data-cse="zeitanomalie"
                        className="block text-micro text-warning"
                      >
                        {ANOMALIE_TEXT[z.zeitanomalie] ?? z.zeitanomalie}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'besetzung',
                kopf: 'Eingeteilt / Soll',
                numerisch: true,
                zelle: (z) => `${String(z.eingeteilt)} / ${String(z.sollBesetzung)}`,
              },
              {
                schluessel: 'herkunft',
                kopf: 'Herkunft',
                zelle: (z) => (z.ausAusnahme ? 'Ausnahme' : 'Regel'),
              },
              {
                schluessel: 'status',
                kopf: 'Status',
                zelle: (z) => (z.storniert
                  ? <StatusPill zustand="Abgelehnt" />
                  : z.status === 'laufend'
                    ? <StatusPill zustand="In Arbeit" />
                    : <StatusPill zustand="Geplant" />),
              },
              {
                schluessel: 'weg',
                kopf: 'Schicht',
                zelle: (z) => (
                  <span>
                    <Link
                      href={`/portal/${mandant}/dienstplan/einsatz/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline"
                    >
                      Öffnen
                    </Link>
                    {z.storniert && z.stornoGrund !== null && (
                      <span className="block text-micro text-text-muted">
                        storniert: {z.stornoGrund}
                      </span>
                    )}
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>

      <section data-cse="ausnahmen">
        <h2 className="mb-s2 mt-0 text-h3 text-text">Einzeltermin-Ausnahmen</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Die dokumentierte Abweichung an einem Tag: <strong>Ausfall</strong> (der
          Termin entfällt), <strong>Verschiebung</strong> (er findet zu einer
          anderen Zeit statt) und <strong>Zusatztermin</strong> (einer, den die
          Regel nicht hergibt). Der Grund ist Pflicht — eine Ausnahme, die sich
          nicht begründet, ist keine Dokumentation.
        </p>

        {!ausnahmenEinsehbar ? (
          <p
            data-cse="ausnahmen-nicht-einsehbar"
            className="rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning"
          >
            Die Ausnahmen sind <strong>nicht einsehbar</strong> — dafür fehlt das
            Gewerkerecht{' '}
            <code className="text-xs">{leserecht ?? 'reinigung.lesen'}</code>. Das
            heißt <strong>nicht</strong>, dass es keine gibt.
          </p>
        ) : ausnahmen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            Keine Ausnahme zu dieser Serie. Jede Schicht kommt aus der Regel.
          </p>
        ) : (
          <DataTable
            beschriftung="Dokumentierte Abweichungen dieser Serie mit Grund und Urheber"
            zeilen={ausnahmen}
            schluessel={(a) => a.id}
            spalten={[
              {
                schluessel: 'datum',
                kopf: 'Tag',
                zelle: (a) => <span className="tabular-nums">{a.datum}</span>,
              },
              {
                schluessel: 'art',
                kopf: 'Art',
                zelle: (a) => AUSNAHME_TEXT[a.art] ?? a.art,
              },
              {
                schluessel: 'ersatz',
                kopf: 'Ersatzbeginn',
                zelle: (a) => (a.ersatzBeginnLokal === null
                  ? '—'
                  : <span className="tabular-nums">{a.ersatzBeginnLokal}</span>),
              },
              {
                schluessel: 'dauer',
                kopf: 'Dauer',
                numerisch: true,
                zelle: (a) => (a.dauerMinuten === null
                  ? 'wie die Serie'
                  : stundenAusMinuten(a.dauerMinuten)),
              },
              {
                schluessel: 'staerke',
                kopf: 'Stärke',
                numerisch: true,
                zelle: (a) => (a.ersatzBesetzung === null
                  ? 'unverändert'
                  : String(a.ersatzBesetzung)),
              },
              { schluessel: 'grund', kopf: 'Grund', zelle: (a) => a.grund },
              {
                schluessel: 'wer',
                kopf: 'Angelegt',
                zelle: (a) => (
                  <span>
                    <span className="block tabular-nums text-text">{a.angelegtLokal}</span>
                    <span className="block text-micro text-text-muted">
                      {a.angelegtVon ?? 'Konto nicht einsehbar'}
                    </span>
                  </span>
                ),
              },
            ]}
          />
        )}

        {schreibrecht === null ? (
          <p className="mt-s5 max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            Eine Veranstaltung kennt keine Einzeltermin-Ausnahme (SEC-08): ein
            einzelnes Fenster wird geändert oder abgesagt. Es gibt dafür keine
            Tabelle — und eine Eingabe ohne Tabelle wäre eine, die verschwindet.
          </p>
        ) : !darfAusnahmeAnlegen ? (
          <p className="mt-s5 max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            Zum Anlegen einer Ausnahme fehlt ein Recht: verlangt werden{' '}
            <Recht schluessel="dienstplan.schreiben" sprache={zugang.sprache} /> und{' '}
            <Recht schluessel={schreibrecht} sprache={zugang.sprache} /> — das zweite, weil die
            Ausnahmetabelle dem Gewerk gehört und nicht dem Dienstplan.
          </p>
        ) : (
          <form
            action={`/api/dienstplan/serien/${id}/ausnahmen`}
            method="post"
            data-cse="ausnahme-formular"
            className="mt-s5 rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="mandant" value={mandant} />
            <h3 className="mb-s4 mt-0 text-base text-text">Ausnahme anlegen</h3>
            <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Betroffener Tag
                </span>
                <input
                  type="date"
                  name="datum"
                  required
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm tabular-nums text-text"
                />
              </label>
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Art
                </span>
                <select
                  name="art"
                  defaultValue="ausfall"
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                >
                  <option value="ausfall">Ausfall — der Termin entfällt</option>
                  <option value="verschiebung">Verschiebung — andere Zeit</option>
                  <option value="zusatz">Zusatztermin — zusätzlich zur Regel</option>
                </select>
              </label>
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Ersatztag (Verschiebung)
                </span>
                <input
                  type="date"
                  name="ersatz_datum"
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm tabular-nums text-text"
                />
              </label>
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Ersatzbeginn HH:MM
                </span>
                <input
                  type="time"
                  name="ersatz_zeit"
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm tabular-nums text-text"
                />
              </label>
              {/*
                * Die Obergrenze kommt aus dem Dienst, nicht aus der Tastatur:
                * `nominalesEnde` wirft ab 1440, und ein Formular, das 1440
                * anbietet, produzierte dann einen 500er statt einer Meldung.
                */}
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Dauer in Minuten
                </span>
                <input
                  type="number"
                  name="dauer"
                  min={15}
                  max={MAX_DAUER_MINUTEN}
                  placeholder={String(blatt.dauerMinuten)}
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm tabular-nums text-text"
                />
              </label>
              {istPosten && (
                <label>
                  <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                    Ersatzbesetzung
                  </span>
                  <input
                    type="number"
                    name="ersatz_besetzung"
                    min={1}
                    placeholder={String(blatt.sollBesetzung)}
                    className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm tabular-nums text-text"
                  />
                </label>
              )}
            </div>
            <label className="mt-s4 block">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Grund (mindestens 10 Zeichen)
              </span>
              <textarea
                name="grund"
                required
                minLength={10}
                rows={2}
                className="w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                placeholder="Warum weicht dieser Termin ab?"
              />
            </label>
            <div className="mt-s4 flex flex-wrap items-center gap-s3">
              <Button type="submit" variante="primary">Ausnahme anlegen</Button>
              <span className="text-sm text-text-muted">
                Der Generator läuft sofort — die Ausnahme wirkt nicht erst morgen.
              </span>
            </div>
            {istPosten && (
              <p className="m-0 mt-s4 max-w-prose text-sm text-text-muted">
                Eine <strong>Ersatzbesetzung</strong> setzt die Sollstärke dieser
                einen Nacht herab. Ob sie dabei unter die Mindestbesetzung des
                Postens gehen darf, ist <strong>offen (O-714)</strong>; bis dahin
                wird das Minimum mitgesenkt, damit keine Schicht entsteht, die von
                Anfang an als unterbesetzt gemeldet wird.
              </p>
            )}
          </form>
        )}
      </section>

      {/*
        **Die Serie pflegen** (V-021). `serie.ts` legte Serien an, `leseSerie`
        zeigte sie, `legeAusnahmeAn` setzte Ausnahmen fuer einzelne Tage — und
        keine Zeile aenderte je eine bestehende Serie. `archiviert_am` stand
        seit 0028 da und wurde nie geschrieben.

        Drei getrennte Formulare, weil es drei getrennte Handlungen sind: die
        REGEL liegt auf dem Traeger, der LAUF auf der Serie, und das Beenden
        ist ein Datum, waehrend das Archivieren ein Zustand ist.
      */}
      <section className="mt-s6" data-cse="serie-pflege">
        <h2 className="mb-s2 text-h2 text-text">{tP.pflegeTitel}</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">{tP.pflegeErklaerung}</p>

        {pflegeFehler !== null && (
          <Hinweis art="warnung" cse="pflege-fehler" className="mb-s4 max-w-prose">
            {eigenerEintrag(tP.fehler, pflegeFehler)
              ?? eigenerEintrag(tL.fehler, pflegeFehler) ?? tP.fehlerSonst}
          </Hinweis>
        )}
        {erledigtText !== undefined && pflegeFehler === null && (
          <Hinweis art="erfolg" cse="pflege-erledigt" className="mb-s4 max-w-prose">
            {erledigtText}
            {erzeugt !== null && storniert !== null
              && /^\d{1,6}$/u.test(erzeugt) && /^\d{1,6}$/u.test(storniert)
              ? ` — ${erzeugt} / ${storniert} ${tP.bilanz}.` : ''}
          </Hinweis>
        )}

        {blatt.archiviert ? (
          <Hinweis art="hinweis" cse="serie-archiviert" className="max-w-prose">
            {tP.schonArchiviert}
          </Hinweis>
        ) : darf['dienstplan.schreiben'] !== true ? (
          <Hinweis art="hinweis" cse="pflege-kein-recht" className="max-w-prose">
            {tP.keinSchreibrecht}{' '}
            <Recht schluessel="dienstplan.schreiben" sprache={zugang.sprache} />.
          </Hinweis>
        ) : (
          <div className="flex flex-col gap-s5">
            {/* Die Regel — nur ein Turnus traegt eine. */}
            {blatt.turnusId === null ? (
              <Hinweis art="hinweis" cse="pflege-kein-turnus" className="max-w-prose">
                {tP.nurTurnus}
              </Hinweis>
            ) : darfAusnahmeAnlegen && (
              <form method="post" action={`/api/dienstplan/serien/${id}`}
                    data-cse="pflege-regel"
                    className="flex max-w-[60ch] flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
                <input type="hidden" name="aktion" value="regel" />
                <input type="hidden" name="mandant" value={mandant} />
                <h3 className="m-0 text-base text-text">{tP.regelTitel}</h3>
                <p className="m-0 text-sm text-text-muted">{tP.regelErklaerung}</p>
                <label className="flex flex-col gap-s2 text-sm text-text">
                  {tP.bezeichnung}
                  <input name="bezeichnung" maxLength={120} defaultValue={blatt.bezeichnung}
                         className={PFLEGEFELD} data-cse="pflege-bezeichnung" />
                </label>
                <fieldset className="m-0 border-0 p-0">
                  <legend className="mb-s2 p-0 text-sm text-text">{tP.wochentage}</legend>
                  <div className="flex flex-wrap gap-s3">
                    {WOCHENTAGE.map((w) => (
                      <label key={w} className="flex items-center gap-s2 text-sm text-text">
                        <input type="checkbox" name="tag" value={w} className="min-h-5 min-w-5"
                               defaultChecked={(blatt.rrule ?? '').includes(w)} />
                        {w}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="flex flex-wrap gap-s4">
                  <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                    {tP.beginn}
                    <input type="time" name="beginn" defaultValue={blatt.beginnLokal ?? ''}
                           className={PFLEGEFELD} data-cse="pflege-beginn" />
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                    {tP.dauer} <span className="text-text-muted">{tP.minuten}</span>
                    <input type="number" name="dauer" min={15} max={1439}
                           defaultValue={blatt.dauerMinuten}
                           className={PFLEGEFELD} data-cse="pflege-dauer" />
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                    {tP.feiertage}
                    <select name="feiertage" defaultValue={blatt.feiertagsregel}
                            className={PFLEGEFELD} data-cse="pflege-feiertage">
                      <option value="ausfall">{tP.feiertageAusfall}</option>
                      <option value="unveraendert">{tP.feiertageUnveraendert}</option>
                    </select>
                  </label>
                </div>
                {/*
                  Der Abrechnungsanker (V-191, TIM-12). Ohne `auftrag.lesen`
                  steht hier ein Satz und KEIN Feld — die Route aendert den
                  Anker nur, wenn das Feld geschickt wurde.
                */}
                <LeistungsankerFeld leistungen={anker} gewaehlt={blatt.auftragLeistungId}
                                    sprache={zugang.sprache} feldKlasse={PFLEGEFELD} />
                <div>
                  <Button type="submit" variante="primary" data-cse="pflege-regel-knopf">
                    {tP.regelSpeichern}
                  </Button>
                </div>
              </form>
            )}

            {/* Der Lauf — gehoert der Serie und nicht dem Gewerk. */}
            <form method="post" action={`/api/dienstplan/serien/${id}`}
                  data-cse="pflege-lauf"
                  className="flex max-w-[60ch] flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
              <input type="hidden" name="aktion" value="lauf" />
              <input type="hidden" name="mandant" value={mandant} />
              <h3 className="m-0 text-base text-text">{tP.laufTitel}</h3>
              <p className="m-0 text-sm text-text-muted">{tP.laufErklaerung}</p>
              <div className="flex flex-wrap gap-s4">
                <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                  {tP.horizont}
                  <input type="number" name="horizont" min={1} max={400}
                         defaultValue={blatt.horizontTage}
                         className={PFLEGEFELD} data-cse="pflege-horizont" />
                  <span className="text-xs text-text-muted">{tP.horizontErklaerung}</span>
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                  {tP.bundesland}
                  <input name="bundesland" maxLength={2} pattern="[A-Za-z]{2}"
                         defaultValue={blatt.feiertagBundesland}
                         className={PFLEGEFELD} data-cse="pflege-bundesland" />
                </label>
              </div>
              <div>
                <Button type="submit" variante="secondary" data-cse="pflege-lauf-knopf">
                  {tP.laufSpeichern}
                </Button>
              </div>
            </form>

            {/* Beenden — ein Datum. */}
            {blatt.veranstaltungId === null && darfAusnahmeAnlegen && (
              <form method="post" action={`/api/dienstplan/serien/${id}`}
                    data-cse="pflege-beenden"
                    className="flex max-w-[60ch] flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
                <input type="hidden" name="aktion" value="beenden" />
                <input type="hidden" name="mandant" value={mandant} />
                <h3 className="m-0 text-base text-text">{tP.beendenTitel}</h3>
                <p className="m-0 text-sm text-text-muted">{tP.beendenErklaerung}</p>
                <label className="flex flex-col gap-s2 text-sm text-text">
                  {tP.beendenBis}
                  <input type="date" name="bis" required defaultValue={blatt.gueltigBis ?? ''}
                         className={PFLEGEFELD} data-cse="pflege-bis" />
                </label>
                <div>
                  <Button type="submit" variante="secondary" data-cse="pflege-beenden-knopf">
                    {tP.beenden}
                  </Button>
                </div>
              </form>
            )}

            {/* Archivieren — ein Zustand, mit Grund. */}
            <form method="post" action={`/api/dienstplan/serien/${id}`}
                  data-cse="pflege-archivieren"
                  className="flex max-w-[60ch] flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
              <input type="hidden" name="aktion" value="archivieren" />
              <input type="hidden" name="mandant" value={mandant} />
              <h3 className="m-0 text-base text-text">{tP.archivTitel}</h3>
              <p className="m-0 text-sm text-text-muted">{tP.archivErklaerung}</p>
              <label className="flex flex-col gap-s2 text-sm text-text">
                {tP.archivGrund}
                <input name="grund" required minLength={3} maxLength={300}
                       placeholder={tP.archivGrundBeispiel}
                       className={PFLEGEFELD} data-cse="pflege-archiv-grund" />
              </label>
              <div>
                <Button type="submit" variante="danger" data-cse="pflege-archiv-knopf">
                  {tP.archivieren}
                </Button>
              </div>
            </form>
          </div>
        )}
      </section>
    </PortalRahmen>
  );
}

const PFLEGEFELD = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 '
  + 'text-sm text-text';
