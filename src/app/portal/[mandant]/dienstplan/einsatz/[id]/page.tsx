import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { stundenText } from '@/server/services/dienstplan/wochenraster';
import { beschriftung } from '../../daten';
import { Button } from '@/components/ui/Button';
import { pruefeEinteilung, type Vorschau } from '@/server/services/dienstplan/einteilung';
import type { ArbzgBefund } from '@/server/services/zeit/arbzg';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { SCHICHT_TEXTE } from '@/lib/i18n/verwaltung/dienstplan-schicht';

/**
 * `/portal/[mandant]/dienstplan/einsatz/[id]` — die einzelne Schicht.
 *
 * Sie ist das Ziel jedes Blocks im Plan (DSH-04: keine Zahl ohne Weg zu ihren
 * Zeilen) und zeigt, was an dieser Schicht haengt: Zeitfenster, Objekt,
 * Besetzung — und, sobald PR 31/32 sie liefern, Qualifikation und ArbZG.
 *
 * **Die Besetzung nennt Anstellungen, nicht Personen** (D-09). Wer fuer zwei
 * Gesellschaften arbeitet, ist EIN Mensch mit zwei Beschaeftigungen; die
 * Schicht gehoert einer davon, und die Anzeige sagt welcher.
 *
 * Eine fremde Schicht ist **404 und nie 403** (AUT-06): die Existenz einer
 * Zeile in einem anderen Mandanten ist selbst eine Auskunft.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly id: string;
  readonly plan_datum: string;
  readonly beginn: Date;
  readonly ende: Date;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
  readonly endet_am_folgetag: boolean;
  readonly zeitanomalie: string;
  readonly status: string;
  readonly quelle: string;
  readonly quell_schluessel: string;
  readonly soll: number;
  readonly besetzt: number;
  readonly objekt: string;
  readonly objekt_id: string;
  readonly kunde: string | null;
  readonly revier: string | null;
  readonly feiertag: string | null;
  readonly storno_grund: string | null;
  /**
   * Die Mischung gegen den Schnappschuss (V-129, D-624, §9.4): `null`
   * unbesetzt, `true` erfüllt, `false` falsch gemischt. Sie MELDET — gesperrt
   * wird je Zuordnung.
   */
  readonly anforderung_erfuellt: boolean | null;
  /** Die Anforderungen des Schnappschusses, lesbar — `[]`, wenn keine galt. */
  readonly anforderungen: readonly {
    readonly bezeichnung: string; readonly geltung: string; readonly mindestanzahl: number;
    readonly zwingend: boolean;
  }[];
  /** Hat die Schicht begonnen? Dann ist der Schnappschuss eingefroren. */
  readonly begonnen: boolean;
}

interface Kandidat {
  readonly id: string;
  readonly name: string;
  readonly personalnummer: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

interface Besetzung {
  readonly id: string;
  readonly name: string;
  readonly personalnummer: string | null;
  readonly funktion: string | null;
  readonly status: string;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
}

export default async function Einsatzblatt({
  params, searchParams,
}: {
  params: Promise<{ mandant: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/dienstplan/einsatz/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: das Nachweisregister `…/personal/nachweise` verlangt laut Manifest
     `personal.nachweis_lesen`, diese Schicht nur `dienstplan.lesen` — wer die
     Sperre im Pruefblatt sah, bekam hinter „Nachweisregister oeffnen" ein 404.
     Ein Verweis auf 404 verraet, was er nicht zeigen darf (Copilot-Runde auf
     PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'personal.nachweis_lesen', 'dienstplan.schreiben');
  /*
   * Nur die Absage unten spricht beide Sprachen (V-013). Der uebrige Rumpf
   * dieser Seite ist deutsch fest verdrahtet und steht dafuer in der
   * Ausnahmeliste der Uebersetzungswache; ein neuer Block laesst sich nicht
   * dorthin nachtragen, ohne die Sperrklinke rueckwaerts zu drehen.
   */
  const t = nachSprache(SCHICHT_TEXTE, zugang.sprache);

  const frage = await searchParams;
  const rohPruefling = typeof frage['pruefe'] === 'string' ? frage['pruefe'] : null;
  const pruefling = rohPruefling !== null && UUID.test(rohPruefling) ? rohPruefling : null;
  /**
   * Die getippte Funktion reist ueber die Vorschau mit.
   *
   * Sie ging verloren: das erste Formular schickt `funktion`, der Dienst wirft
   * eine Warnung, die Route leitet auf `?pruefe=` um — und das Formular unter
   * dem Pruefblatt trug das Feld nicht. „Vorarbeit" war nach der Bestaetigung
   * weg, ohne Meldung, und die Schicht stand mit einer Besetzung ohne Rolle im
   * Plan. Gekuerzt auf die Laenge, die ein Rollenname hat; `funktion` ist
   * `text` und nimmt sonst jede beliebige Adressenlaenge auf.
   */
  const rohFunktion = typeof frage['funktion'] === 'string' ? frage['funktion'] : '';
  const funktion = rohFunktion.trim().slice(0, 80);
  /**
   * Der Grund einer Abweisung — aus den drei Formularen dieser Seite
   * (Einteilung absagen, Einteilen, Schicht absagen; V-158).
   *
   * Die Routen schickten `?fehler=` hierher (die Schicht-Absage) bzw.
   * antworteten mit rohem JSON (die beiden Einteilungsrouten) — und diese
   * Seite las keines von beiden. Nachgeschlagen wird in `SCHICHT_TEXTE.fehler`,
   * in der Sprache der Sitzung; ein unbekannter Grund bekommt einen
   * allgemeinen Satz und erscheint nie roh.
   */
  const abgewiesen = typeof frage['fehler'] === 'string' ? frage['fehler'] : null;

  const daten = await db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select e.id, to_char(e.plan_datum,'YYYY-MM-DD') as plan_datum,
                e.beginn_zeitpunkt as beginn, e.ende_zeitpunkt as ende,
                to_char(e.beginn_lokal,'HH24:MI') as beginn_lokal,
                to_char(e.ende_lokal,'HH24:MI')   as ende_lokal,
                e.endet_am_folgetag,
                e.zeitanomalie::text as zeitanomalie,
                e.status::text as status, e.quelle::text as quelle, e.quell_schluessel,
                e.soll_besetzung::int as soll, e.besetzt_anzahl::int as besetzt,
                o.bezeichnung as objekt, o.id as objekt_id,
                k.name as kunde, r.bezeichnung as revier,
                f.bezeichnung as feiertag, e.storno_grund,
                e.anforderung_erfuellt,
                (e.beginn_zeitpunkt <= now()) as begonnen,
                -- V-129: die Anforderungen aus dem SCHNAPPSCHUSS, nicht aus
                -- dem Katalog von heute. Kein Backtick in diesem Kommentar.
                coalesce((select jsonb_agg(jsonb_build_object(
                                   'bezeichnung', coalesce(q.bezeichnung, 'Qualifikation'),
                                   'geltung', a->>'geltung',
                                   'mindestanzahl', coalesce((a->>'mindestanzahl')::int, 1),
                                   'zwingend', coalesce((a->>'zwingend')::boolean, true))
                                 order by q.bezeichnung)
                            from jsonb_array_elements(
                                   case when jsonb_typeof(e.anforderung_snapshot) = 'array'
                                        then e.anforderung_snapshot else '[]'::jsonb end) a
                            left join qualifikation q on q.id = (a->>'qualifikation_id')::uuid),
                         '[]'::jsonb) as anforderungen
           from einsatz e
           join objekt o on o.mandant_id = e.mandant_id and o.id = e.objekt_id
           left join kunde  k on k.mandant_id = e.mandant_id and k.id = e.kunde_id
           left join revier r on r.mandant_id = e.mandant_id and r.id = e.revier_id
           left join feiertag f on f.id = e.feiertag_id
          where e.id = $1`,
        [id],
      );
      if (kopf === undefined) return null;

      const besetzung = await kontext.abfrage<Besetzung>(
        /**
         * Ueber `anstellung` und `person` — und die Personalnummer kommt aus
         * der ANSTELLUNG, weil sie je Gesellschaft eine eigene ist. Ein Mensch
         * mit zwei Beschaeftigungen hat zwei; sie zu mischen waere D-09
         * genau falsch herum.
         */
        `select z.id,
                (p.vorname || ' ' || p.nachname) as name,
                a.personalnummer, z.funktion, z.status::text as status,
                to_char((z.beginn_zeitpunkt at time zone 'Europe/Berlin'), 'HH24:MI') as beginn_lokal,
                to_char((z.ende_zeitpunkt   at time zone 'Europe/Berlin'), 'HH24:MI') as ende_lokal
           from einsatz_zuordnung z
           join anstellung a on a.mandant_id = z.mandant_id and a.id = z.anstellung_id
           join person p     on p.id = a.person_id
          where z.einsatz_id = $1 and z.entfernt_am is null
          order by p.nachname, p.vorname`,
        [id],
      );
      /**
       * Wer ueberhaupt in Frage kommt: aktive Beschaeftigungen DIESER
       * Gesellschaft, die auf dieser Schicht noch nicht stehen. Eine Auswahl,
       * die schon Eingeteilte anbietet, fuehrt auf einen 409, den niemand
       * gebraucht haette (D-09: die Einteilung nennt eine Beschaeftigung).
       */
      const kandidaten = await kontext.abfrage<Kandidat>(
        `select a.id, (p.vorname || ' ' || p.nachname) as name, a.personalnummer
           from anstellung a
           join person p on p.id = a.person_id
          where a.mandant_id = $2 and a.geloescht_am is null and a.status = 'aktiv'
            and not exists (
              select 1 from einsatz_zuordnung z
               where z.einsatz_id = $1 and z.anstellung_id = a.id
                 and z.entfernt_am is null and z.status <> 'abgesagt')
          order by p.nachname, p.vorname`,
        [id, kontext.aktiverMandantId],
      );

      /**
       * Die VORSCHAU — nur, wenn eine Beschaeftigung benannt ist.
       *
       * Sie laeuft auf dem GET, weil PR 33 Abnahme 3 genau das verlangt: der
       * Planer sieht Qualifikation und Arbeitszeit, BEVOR er speichert. Sie
       * schreibt nichts ausser der Auditzeile, die K-06 fuer jeden Uebertritt
       * ueber die Gesellschaftsgrenze fordert.
       */
      const vorschau = pruefling === null
        ? null
        : await pruefeEinteilung(kontext, id, pruefling);

      return { kopf, besetzung, kandidaten, vorschau };
    }));

  // AUT-06: eine fremde oder nicht vorhandene Zeile ist 404, nie 403.
  if (daten === null) notFound();
  const { kopf, besetzung, kandidaten, vorschau } = daten;
  const dauer = stundenText({ id: kopf.id, beginn: new Date(kopf.beginn), ende: new Date(kopf.ende) });

  return (
    <PortalRahmen
      titel="Schicht"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      /*
       * **Der Rückweg trägt die WOCHE mit** — und deshalb steht er hier und
       * nicht in der Ableitung (D-613). Der Vorfahr dieser Adresse wäre
       * `/dienstplan`; wer aus der Woche des 14. Mai in eine Schicht klickt,
       * will aber in genau diese Woche zurück, nicht in die laufende. Eine
       * Hülle, die das erriete, erfände eine Regel.
       */
      zurueck={{
        ziel: `/portal/${mandant}/dienstplan/woche?woche=${kopf.plan_datum}`,
        text: 'Zurück zum Dienstplan',
      }}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.objekt}</h1>
        <StatusPill zustand={statusPille(kopf.status)} />
      </div>

      {abgewiesen !== null && (
        <Hinweis art="warnung" cse="einsatz-fehler" className="mb-s5 max-w-prose">
          <strong className="block">{t.nichtGespeichert}</strong>
          <span role="alert">{t.fehler[abgewiesen] ?? t.fehlerSonst}</span>
        </Hinweis>
      )}

      <dl className="m-0 grid gap-s4 sm:grid-cols-2 lg:grid-cols-3">
        <Feld beschriftung="Tag" wert={beschriftung(kopf.plan_datum)} />
        <Feld
          beschriftung="Zeitfenster (Berlin)"
          wert={`${kopf.beginn_lokal}–${kopf.ende_lokal}${kopf.endet_am_folgetag ? ' (Folgetag)' : ''}`}
        />
        <Feld beschriftung="Dauer" wert={dauer} />
        <Feld beschriftung="Kunde" wert={kopf.kunde ?? 'ohne Kundenbezug'} />
        <Feld beschriftung="Revier" wert={kopf.revier ?? '—'} />
        <Feld
          beschriftung="Besetzung"
          wert={`${String(kopf.besetzt)} von ${String(kopf.soll)}`}
          hinweis={kopf.besetzt < kopf.soll ? 'unterbesetzt' : null}
        />
        <Feld
          beschriftung="Qualifikationsmischung"
          wert={kopf.anforderungen.length === 0
            ? 'keine Anforderung hinterlegt'
            : kopf.anforderung_erfuellt === null ? 'nicht bewertet — niemand eingeteilt'
              : kopf.anforderung_erfuellt ? 'erfüllt' : 'nicht erfüllt'}
          hinweis={kopf.anforderung_erfuellt === false ? 'falsch gemischt' : null}
        />
      </dl>

      {/*
        * V-129, D-624: was diese Schicht verlangt — aus ihrem Schnappschuss.
        * Ab Beginn eingefroren: ein später geänderter Katalog macht eine
        * vergangene Schicht nicht rückwirkend falsch besetzt (0028).
        */}
      {kopf.anforderungen.length > 0 && (
        <section data-cse="einsatz-anforderungen" className="mt-s5">
          <h2 className="mb-s2 text-sm uppercase tracking-[0.08em] text-text-muted">
            Anforderungen dieser Schicht
          </h2>
          <ul className="m-0 flex list-none flex-col gap-s1 p-0 text-sm text-text">
            {kopf.anforderungen.map((a) => (
              <li key={`${a.bezeichnung}-${a.geltung}`}>
                {a.bezeichnung} — {a.geltung === 'jeder'
                  ? 'jede eingeteilte Kraft'
                  : `mindestens ${String(a.mindestanzahl)}`}
                {a.zwingend ? '' : ' (Warnung, keine Sperre)'}
              </li>
            ))}
          </ul>
          <p className="mb-0 mt-s2 text-xs text-text-subtle">
            {kopf.begonnen
              ? 'Stand zum Beginn der Schicht — eingefroren.'
              : 'Folgt dem Anforderungskatalog bis zum Beginn der Schicht; ab dann eingefroren.'}
          </p>
        </section>
      )}

      {kopf.zeitanomalie !== 'keine' && (
        <p
          data-cse="zeitanomalie"
          className="mt-s5 rounded-md bg-warning-soft px-s3 py-s2 text-sm text-warning"
        >
          {kopf.zeitanomalie === 'dst_luecke'
            ? 'Zeitumstellung: die geplante Ortszeit gibt es an diesem Tag nicht — die Schicht '
              + 'beginnt zum Umstellungszeitpunkt.'
            : 'Zeitumstellung: die geplante Ortszeit gibt es an diesem Tag zweimal — gerechnet '
              + 'wird mit dem früheren Zeitpunkt (offen: O-163).'}
        </p>
      )}

      {kopf.feiertag !== null && (
        <p className="mt-s3 rounded-md bg-info-soft px-s3 py-s2 text-sm text-info">
          Feiertag: {kopf.feiertag} — die Schicht findet trotzdem statt.
        </p>
      )}

      {kopf.storno_grund !== null && (
        <p className="mt-s3 rounded-md bg-danger-soft px-s3 py-s2 text-sm text-danger">
          Storniert: {kopf.storno_grund}
        </p>
      )}

      <h2 className="mb-s3 mt-s6 text-h3 text-text">Besetzung</h2>
      {besetzung.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch niemand eingeteilt. Die Einteilung nennt eine Beschäftigung, nicht
          eine Person — wer für zwei Gesellschaften arbeitet, ist ein Mensch mit
          zwei Beschäftigungen, und die Schicht gehört genau einer davon (D-09).
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {besetzung.map((b) => (
            <li
              key={b.id}
              data-cse="besetzung"
              className="flex flex-wrap items-baseline justify-between gap-s3 border-b border-line py-s3"
            >
              <span className="text-sm text-text">{b.name}</span>
              <span className="flex flex-wrap items-center gap-s3">
                <span className="text-sm tabular-nums text-text-muted">
                  {b.beginn_lokal}–{b.ende_lokal}
                  {b.personalnummer !== null ? ` · ${b.personalnummer}` : ''}
                  {b.funktion !== null ? ` · ${b.funktion}` : ''}
                </span>
                {/*
                  Absagen mit Grund, in derselben Zeile. Die Zeile bleibt danach
                  stehen (Invariante 8) — sie wandert nur aus der Besetzung
                  heraus, und die ausgegebenen Check-in-Marken verfallen.

                  V-158: `minLength={3}` — der Dienst verlangt drei Zeichen
                  (GRUND_MINDESTLAENGE), das Feld verlangte nur `required`, und
                  „ok" endete als rohes JSON. Und das Formular steht nur, wo
                  `dienstplan.schreiben` da ist: die Route verlangt es, und ein
                  Knopf, dessen Route abweist, verrät mehr, als er hilft.
                */}
                {darf['dienstplan.schreiben'] === true && (
                  <form
                    action={`/api/einsaetze/${kopf.id}/absagen`}
                    method="post"
                    className="flex flex-wrap items-center gap-s2"
                  >
                    <input type="hidden" name="zuordnung" value={b.id} />
                    <input type="hidden" name="mandant" value={mandant} />
                    <input type="hidden" name="zurueck" value={pfad} />
                    <label>
                      <span className="sr-only">Grund der Absage</span>
                      <input
                        name="grund"
                        required
                        minLength={3}
                        maxLength={300}
                        placeholder="Grund"
                        className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                      />
                    </label>
                    <Button type="submit" variante="ghost">Absagen</Button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {kopf.storno_grund === null && (
        <section className="mt-s5 rounded-lg border border-line bg-surface p-s5">
          <h3 className="mb-s2 mt-0 text-base text-text">Einteilen</h3>
          <p className="mb-s4 max-w-prose text-sm text-text-muted">
            {kopf.besetzt >= kopf.soll
              ? `Die Schicht ist mit ${String(kopf.besetzt)} von ${String(kopf.soll)} besetzt. `
                + 'Eine weitere Einteilung ist möglich — die Sollzahl ist ein Plan, keine Sperre.'
              : `Noch ${String(kopf.soll - kopf.besetzt)} von ${String(kopf.soll)} offen.`}
          </p>

          {kandidaten.length === 0 ? (
            <p className="m-0 text-sm text-text-muted">
              Keine weitere aktive Beschäftigung in dieser Gesellschaft, die
              nicht schon eingeteilt wäre.
            </p>
          ) : darf['dienstplan.schreiben'] !== true ? null : (
            <form
              action={`/api/einsaetze/${kopf.id}/besetzen`}
              method="post"
              className="flex flex-wrap items-end gap-s3"
            >
              <input type="hidden" name="mandant" value={mandant} />
              <input type="hidden" name="zurueck" value={pfad} />
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Beschäftigung
                </span>
                <select
                  name="anstellung"
                  defaultValue={vorschau === null ? '' : (pruefling ?? '')}
                  required
                  className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                >
                  <option value="">Bitte wählen</option>
                  {kandidaten.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}{k.personalnummer !== null ? ` · ${k.personalnummer}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Funktion (optional)
                </span>
                <input
                  name="funktion"
                  placeholder="z. B. Vorarbeit"
                  className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                />
              </label>
              <Button type="submit" variante="secondary">Prüfen und einteilen</Button>
            </form>
          )}

          {vorschau !== null && pruefling !== null && (
            <Pruefblatt
              vorschau={vorschau}
              einsatzId={kopf.id}
              anstellungId={pruefling}
              mandant={mandant}
              pfad={pfad}
              funktion={funktion}
              name={kandidaten.find((k) => k.id === pruefling)?.name ?? 'die Beschäftigung'}
              darfNachweise={darf['personal.nachweis_lesen'] === true}
              darfEinteilen={darf['dienstplan.schreiben'] === true}
            />
          )}
        </section>
      )}

      {/*
        Qualifikation und Arbeitszeit stehen als VORSCHAU im Einteilen-Feld —
        also nur dann, wenn tatsächlich geprüft wurde. Ein Dauerpanel
        „keine Verstöße" wäre eine Aussage, die niemand geprüft hat, und genau
        die Sorte stiller Falschauskunft, gegen die K-06 geschrieben ist.
      */}
      {/*
        **Die Schicht absagen** (V-013). Bis dahin setzte `storniert` nur der
        Generator, wenn die Serie das Vorkommnis nicht mehr wollte — eine von
        Hand geplante Schicht liess sich nie wieder abstellen, und die Absage
        einer Serienschicht ging nur ueber das Aendern der Serie.

        Der Knopf steht NUR, solange die Schicht lebt: fuer eine schon
        abgesagte gibt es oben den Grund, und ein zweiter Knopf daneben waere
        ein Weg, der auf 409 fuehrt.
      */}
      {kopf.storno_grund === null && darf['dienstplan.schreiben'] === true && (
        <section data-cse="schicht-absagen"
                 className="mt-s6 rounded-lg border border-line bg-surface p-s5">
          <h3 className="mb-s2 mt-0 text-base text-text">{t.absagenTitel}</h3>
          <p className="mb-s4 max-w-prose text-sm text-text-muted">{t.absagenErklaerung}</p>
          <form method="post" action="/api/dienstplan/einsatz"
                className="flex flex-wrap items-end gap-s3">
            <input type="hidden" name="aktion" value="absagen" />
            <input type="hidden" name="einsatz" value={kopf.id} />
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="zurueck" value={pfad} />
            <input type="hidden" name="fehlerweg" value={pfad} />
            <label className="flex min-w-[24ch] flex-1 flex-col gap-s2 text-sm text-text">
              {t.absageGrund}
              <input name="grund" required minLength={3} maxLength={300}
                     placeholder={t.absageGrundBeispiel}
                     className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                     data-cse="schicht-absage-grund" />
            </label>
            <Button type="submit" variante="danger" data-cse="schicht-absage-knopf">
              {t.absagen}
            </Button>
          </form>
        </section>
      )}

      <p className="mt-s6 text-micro text-text-subtle">
        Herkunft: {kopf.quelle} · Schlüssel <code className="tabular-nums">{kopf.quell_schluessel}</code>
      </p>
    </PortalRahmen>
  );
}

function Feld({
  beschriftung: label, wert, hinweis = null,
}: { readonly beschriftung: string; readonly wert: string; readonly hinweis?: string | null }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-s4">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd className="m-0 mt-s1 text-base text-text">
        {wert}
        {hinweis !== null && <span className="ml-s2 text-sm text-warning">{hinweis}</span>}
      </dd>
    </div>
  );
}

/** Der Status der Schicht auf das feste Vokabular von DESIGN §5 abgebildet. */
function statusPille(status: string): 'In Arbeit' | 'Geplant' | 'Abgeschlossen' | 'Abgelehnt' {
  switch (status) {
    case 'laufend': return 'In Arbeit';
    case 'abgeschlossen': return 'Abgeschlossen';
    case 'storniert': return 'Abgelehnt';
    default: return 'Geplant';
  }
}

/** „A" · „A und B" · „A, B und C" — damit die Schaltfläche keinen Grund verschweigt. */
function satzliste(worte: readonly string[]): string {
  if (worte.length <= 1) return worte[0] ?? '';
  return `${worte.slice(0, -1).join(', ')} und ${worte[worte.length - 1] ?? ''}`;
}

const REGEL_TEXT: Readonly<Record<string, string>> = {
  tagesarbeitszeit_ueber_8h: 'Tagesarbeitszeit über 8 Stunden (§ 3 ArbZG)',
  tagesarbeitszeit_ueber_10h: 'Tagesarbeitszeit über 10 Stunden (§ 3 ArbZG)',
  ruhezeit_unter_11h: 'Ruhezeit unter 11 Stunden (§ 5 ArbZG)',
  pause_fehlt_ueber_6h: 'Pause fehlt bei über 6 Stunden (§ 4 ArbZG)',
  pause_fehlt_ueber_9h: 'Pause zu kurz bei über 9 Stunden (§ 4 ArbZG)',
  ausgleichszeitraum_ueberschritten: 'Ausgleichszeitraum überschritten (§ 3 Satz 2 ArbZG)',
};

/**
 * Was die Prüfung gefunden hat — und was daraus folgt.
 *
 * **Zwei Sorten, zwei Ausgänge.** Eine fehlende Qualifikation hat KEIN
 * Formular darunter: § 34a GewO kennt keine Begründung, die einen fehlenden
 * Sachkundenachweis ersetzt (SEC-04). Ein Arbeitszeitbefund hat eines — mit
 * dem ausdrücklichen Wort, dass er gesehen wurde. Übergangen heisst dabei
 * nicht verschwunden: die Einteilung schreibt den Verstoss und legt den
 * Konflikt an, der im Eingang mit Begründung quittiert werden muss.
 *
 * Text, nicht Farbe (DESIGN §9): jede Zeile sagt, WAS gefunden wurde.
 */
function Pruefblatt({
  vorschau, einsatzId, anstellungId, mandant, pfad, funktion, name, darfNachweise,
  darfEinteilen,
}: {
  readonly vorschau: Vorschau;
  readonly einsatzId: string;
  readonly anstellungId: string;
  readonly mandant: string;
  readonly pfad: string;
  readonly funktion: string;
  readonly name: string;
  /** Haelt die Sitzung `personal.nachweis_lesen`? Sonst gibt es den Weg ins Register nicht (AUT-06). */
  readonly darfNachweise: boolean;
  /**
   * Haelt sie `dienstplan.schreiben`? Sonst steht die Vorschau ohne Knopf da
   * — die Route wiese ihn ab (V-158).
   */
  readonly darfEinteilen: boolean;
}) {
  const gesperrt = vorschau.qualifikationsfehler !== null;
  const befunde: readonly ArbzgBefund[] = vorschau.arbzg ?? [];
  const doppelt = vorschau.ueberschneidungen;

  /**
   * Was dieser eine Klick übergeht — beim Namen genannt.
   *
   * Die Beschriftung kannte die Überschneidung nicht: das Blatt zeigte
   * „Qualifikation geprüft", „Keine Abmeldung", „Kein Befund" und eine
   * primäre Schaltfläche „Einteilen", während das Formular darunter
   * unbedingt `bestaetigt=1` trug. Wer auf dem einzigen Weg ankam, den die
   * Oberfläche anbietet — 422 aus `besetzeEinsatz`, 303 auf `?pruefe=` —,
   * übersah die Doppelbesetzung nicht, er bekam sie nie zu sehen; die Zusage
   * „der Planer sieht die Gegenschicht und muss sie mit `bestaetigt`
   * übergehen" war auf diesem Weg unerfüllbar, und der Fall fiel erst am
   * Einsatztag um 06:00 vor dem zweiten Objekt auf.
   */
  const uebergangen: string[] = [];
  if (vorschau.abwesend !== null) uebergangen.push('Abmeldung');
  if (doppelt.length > 0) uebergangen.push('Doppelbesetzung');
  if (befunde.length > 0) uebergangen.push('Befund');
  const beschriftungKnopf = uebergangen.length === 0
    ? 'Einteilen'
    : `Trotz ${satzliste(uebergangen)} einteilen`;

  return (
    <div
      data-cse="pruefblatt"
      data-gesperrt={gesperrt ? 'ja' : 'nein'}
      className={`mt-s5 rounded-lg border p-s4 ${
        gesperrt ? 'border-danger bg-danger-soft' : 'border-line bg-surface-2'
      }`}
    >
      <h4 className="mb-s2 mt-0 text-base text-text">Prüfung für {name}</h4>

      {gesperrt ? (
        <>
          <p className="m-0 max-w-prose text-sm text-danger">
            <strong>Gesperrt.</strong> {vorschau.qualifikationsfehler}
          </p>
          <p className="m-0 mt-s2 max-w-prose text-sm text-danger">
            Es gibt hier kein Übergehen-Feld. § 34a GewO kennt keine
            Begründung, die einen fehlenden Nachweis ersetzt — die Einteilung
            muss eine andere Person bekommen.
          </p>
          {/*
            Der Weg aus der Sperre heraus. Ohne ihn endet der Bildschirm mit
            einem Nein und lässt offen, WO man nachsieht — und die Planerin
            sucht den Nachweisstand dann in einer Mail.

            AUT-06: nur fuer eine Sitzung, die `personal.nachweis_lesen` haelt —
            das Register verlangt es laut Manifest, und ein Verweis, der auf 404
            fuehrt, verraet, was er nicht zeigen darf (Copilot-Runde auf PR 16 /
            D-581). Kein ausgegrauter Ersatz: der Absatz fehlt dann ganz.
          */}
          {darfNachweise && (
            <p className="m-0 mt-s2 text-sm">
              <Link
                href={`/portal/${mandant}/personal/nachweise`}
                className="text-danger underline decoration-danger underline-offset-4"
              >
                Nachweisregister öffnen
              </Link>
            </p>
          )}
        </>
      ) : (
        <p className="m-0 text-sm text-text-muted">
          Qualifikation geprüft zum Schichtdatum
          {vorschau.qualifikation !== null && ` ${vorschau.qualifikation.stichtag}`}
          {vorschau.qualifikation !== null
            && vorschau.qualifikation.anforderungenGefunden === 0
            && ' — es war allerdings keine Anforderung hinterlegt (O-149).'}
        </p>
      )}

      <h5 className="mb-s2 mt-s4 text-sm uppercase tracking-[0.08em] text-text-muted">
        Abwesenheit
      </h5>
      {!vorschau.abwesenheitGeprueft ? (
        <p className="m-0 max-w-prose text-sm text-warning">
          Nicht geprüft: dafür fehlt das Recht `zeit.abwesenheit_lesen`. Das ist
          <strong> nicht</strong> dasselbe wie „nicht abgemeldet".
        </p>
      ) : vorschau.abwesend === null ? (
        <p className="m-0 text-sm text-text-muted">
          Keine Abmeldung in diesem Zeitraum.
        </p>
      ) : (
        <p
          data-cse="abwesend-befund"
          className="m-0 max-w-prose text-sm text-warning"
        >
          <strong>Achtung:</strong> Diese Beschäftigung {vorschau.abwesend}. Warum,
          steht hier nicht — das ist ein Gesundheitsdatum und hängt an einem
          eigenen Recht (Art. 9 DSGVO).
        </p>
      )}

      <h5 className="mb-s2 mt-s4 text-sm uppercase tracking-[0.08em] text-text-muted">
        Überschneidung
      </h5>
      {doppelt.length === 0 ? (
        <p className="m-0 max-w-prose text-sm text-text-muted">
          Keine andere Schicht dieser Person in diesem Zeitfenster — in dieser
          Gesellschaft. Eine Schicht in einer Schwestergesellschaft bleibt hier
          ungenannt (K-06); sie erreicht die Planung über den Arbeitszeitbefund.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {doppelt.map((u) => (
            <li
              key={u.zuordnungId}
              data-cse="ueberschneidung-befund"
              className="border-t border-line py-s2 text-sm text-warning"
            >
              <strong>Doppelbesetzung:</strong> Diese Person steht im selben
              Zeitraum bereits auf{' '}
              {/*
                Der Weg zur Gegenschicht. Ohne ihn nennt die Warnung ein Objekt
                und eine Uhrzeit, und die Planerin sucht die Schicht von Hand
                im Wochenraster — mit dem Ergebnis, dass sie sie nicht auflöst.
              */}
              <Link
                href={`/portal/${mandant}/dienstplan/einsatz/${u.einsatzId}`}
                className="text-warning underline decoration-warning underline-offset-4"
              >
                {u.text}
              </Link>
              . Zwei Objekte zur selben Stunde gehen nicht, und die
              Arbeitszeitprüfung fängt das nicht auf: zwei Vierstundenschichten
              sind acht Stunden.
            </li>
          ))}
        </ul>
      )}

      <h5 className="mb-s2 mt-s4 text-sm uppercase tracking-[0.08em] text-text-muted">
        Arbeitszeit
      </h5>
      {vorschau.arbzg === null ? (
        <p className="m-0 max-w-prose text-sm text-warning">
          Nicht geprüft: dafür fehlt das Recht `dienstplan.arbzg_pruefen`
          (K-06). Das ist <strong>nicht</strong> dasselbe wie „kein Befund" —
          und deshalb steht hier kein Häkchen.
        </p>
      ) : befunde.length === 0 ? (
        <p className="m-0 text-sm text-text-muted">
          Kein Befund über alle Beschäftigungen dieser Person hinweg — auch
          nicht in anderen Gesellschaften (§ 2 Abs. 1 ArbZG rechnet zusammen).
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {befunde.map((b) => (
            <li
              key={`${b.regel}:${b.kalendertag}`}
              data-cse="arbzg-befund"
              data-regel={b.regel}
              className="border-t border-line py-s2 text-sm"
            >
              <strong className={b.schwere === 'verstoss' ? 'text-danger' : 'text-warning'}>
                {b.schwere === 'verstoss' ? 'Verstoß' : 'Warnung'}
              </strong>
              {' · '}
              {REGEL_TEXT[b.regel] ?? b.regel}
              {' · '}
              <span className="tabular-nums">{b.kalendertag}</span>
              {b.ueberMandanten && ' · über Gesellschaften hinweg'}
              <span className="block text-text-muted">{b.begruendung}</span>
            </li>
          ))}
        </ul>
      )}

      {!gesperrt && darfEinteilen && (
        <form
          action={`/api/einsaetze/${einsatzId}/besetzen`}
          method="post"
          className="mt-s4 flex flex-wrap items-center gap-s3"
        >
          <input type="hidden" name="anstellung" value={anstellungId} />
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="zurueck" value={pfad} />
          {funktion !== '' && <input type="hidden" name="funktion" value={funktion} />}
          <input type="hidden" name="bestaetigt" value="1" />
          <Button
            type="submit"
            variante={uebergangen.length > 0 ? 'danger' : 'primary'}
          >
            {beschriftungKnopf}
          </Button>
          {(befunde.length > 0 || doppelt.length > 0) && (
            <span className="max-w-prose text-sm text-text-muted">
              {befunde.length > 0 && doppelt.length > 0
                ? 'Befund und Doppelbesetzung werden dabei festgeschrieben und erscheinen im '
                : befunde.length > 0
                  ? 'Der Befund wird dabei festgeschrieben und erscheint im '
                  : 'Die Doppelbesetzung wird dabei festgeschrieben und erscheint im '}
              Konflikteingang — dort ist mit Begründung zu quittieren.
            </span>
          )}
        </form>
      )}
    </div>
  );
}
