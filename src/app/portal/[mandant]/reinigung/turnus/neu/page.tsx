import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { tagePlus } from '@/lib/datum/kalendertag';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { DataTable } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { WOCHENTAGE } from '@/lib/datum/rrule';
import { lesbareRegel } from '@/lib/datum/regeltext';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { rechteImKontext } from '@/server/auth/kontext-rechte';
import { ladeFeiertage } from '@/server/services/dienstplan/generator';
import {
  SerieEingabeFehlt, turnusRegel, type TurnusFrequenz,
} from '@/server/services/dienstplan/serie';
import { MAX_DAUER_MINUTEN } from '@/server/services/dienstplan/vorkommnisse';
import {
  turnusVorschau, type VorschauTermin,
} from '@/server/services/reinigung/turnusvorschau';

/**
 * `/portal/[mandant]/reinigung/turnus/neu` — eine Regel bauen und VORHER
 * sehen, was sie ergibt (CLN-02, CLN-03, TIM-02).
 *
 * **Die Vorschau ist keine Zierde, sie ist der Grund für den Umweg.** Das
 * Formular schickt sich zuerst per GET an sich selbst; erst unter der
 * fertigen Terminliste steht der Knopf, der wirklich anlegt. Damit ist
 * garantiert, dass bestätigt wird, was gezeigt wurde — und die Vorschau läuft
 * durch `turnusVorschau` mit **echten** Feiertagen aus `ladeFeiertage`. Eine
 * Vorschau mit leerer Feiertagskarte zeigte Termine am 3. Oktober, die der
 * Generator unmittelbar danach überspringt: zwei Aussagen auf demselben
 * Bildschirm, die sich widersprechen.
 *
 * **Monatlich ist eine echte Wahl und keine Attrappe.** Der Seed führt seit
 * dem ersten Tag `FREQ=MONTHLY;BYMONTHDAY=15`, `leseRegel` versteht MONTHLY —
 * nur der Regelbauer kannte ausschliesslich Wochen. Der Zweig liegt jetzt in
 * `serie.ts` (`monatsRegel`), nicht hier: eine Regel, die eine Seite
 * zusammensetzt, ist eine ungetestete Regel.
 *
 * **Anlegen braucht ZWEI Rechte, und die Seite sagt es vorher.** Der Turnus
 * selbst liegt hinter `reinigung.schreiben` (Route und RLS), die
 * Planungsserie und die Schichten hinter `dienstplan.schreiben` — nachgemessen
 * in `pg_policies`. Ohne das zweite entsteht keine Schicht; die Transaktion
 * bricht ab und legt auch den Turnus nicht an. Das erst beim Absenden zu
 * erfahren wäre die schlechtere Reihenfolge.
 */
export const dynamic = 'force-dynamic';

/** Das Vorschaufenster vor dem Anlegen: vier Wochen. */
const VORSCHAU_TAGE = 28;

const TAG_TEXT: Readonly<Record<string, string>> = {
  MO: 'Mo', TU: 'Di', WE: 'Mi', TH: 'Do', FR: 'Fr', SA: 'Sa', SU: 'So',
};

const MONATSTAGE: readonly number[] = Array.from({ length: 31 }, (_, i) => i + 1);

const VORGABE_WOCHENTAGE: readonly string[] = ['MO', 'TU', 'WE', 'TH', 'FR'];

interface RevierWahl {
  readonly id: string;
  readonly bezeichnung: string;
  /** `null` heisst: `objekt.lesen` fehlt — nicht „kein Objekt". */
  readonly objekt: string | null;
  /** `null` heisst ungeprüft; `false` heisst: der Generator überspringt es. */
  readonly hatKunde: boolean | null;
}

interface LeistungWahl {
  readonly id: string;
  readonly oz: string;
  readonly kurztext: string;
  readonly istPlatzhalter: boolean;
}

function einer(wert: string | string[] | undefined): string | null {
  if (typeof wert === 'string') return wert.trim() === '' ? null : wert.trim();
  if (Array.isArray(wert)) return einer(wert[0]);
  return null;
}

function viele(wert: string | string[] | undefined): readonly string[] {
  if (typeof wert === 'string') return [wert];
  if (Array.isArray(wert)) return wert;
  return [];
}

export default async function TurnusNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const tor = await mandantTor(`/portal/${mandant}/reinigung/turnus/neu`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* AUT-06: `/dienstplan/serien` verlangt `dienstplan.lesen`. */
  const darf = await haeltRechte(sitzung, 'dienstplan.lesen');

  const heute = await berlinHeute();
  const fehlerAusApi = einer(suche['fehler']);

  /* ---- die Eingabe, wie sie aus der Vorschaurunde zurückkommt ----------- */
  const istVorschau = einer(suche['vorschau']) !== null;
  const gewaehltesRevier = einer(suche['revier']);
  const gewaehlteLeistung = einer(suche['leistung']);
  const bezeichnung = einer(suche['bezeichnung']) ?? '';
  const frequenz: TurnusFrequenz = einer(suche['frequenz']) === 'monatlich'
    ? 'monatlich' : 'woechentlich';
  const wochentage = istVorschau ? viele(suche['wochentag']) : VORGABE_WOCHENTAGE;
  const monatstage = viele(suche['monatstag']).map(Number).filter((n) => Number.isInteger(n));
  const interval = Number(einer(suche['interval']) ?? '1');
  const beginn = einer(suche['beginn']) ?? '06:00';
  const dauerRoh = Number(einer(suche['dauer']) ?? '240');
  const dauer = Number.isFinite(dauerRoh) ? Math.trunc(dauerRoh) : 240;
  const gueltigAb = einer(suche['gueltig_ab']) ?? heute;
  const gueltigBis = einer(suche['gueltig_bis']);
  const feiertage = einer(suche['feiertage']) === 'unveraendert' ? 'unveraendert' : 'ausfall';

  /* ---- die Regel: gebaut vom Dienst, gegengelesen vom Parser ------------ */
  let rrule: string | null = null;
  let regelFehlerText: string | null = null;
  if (istVorschau) {
    try {
      rrule = turnusRegel({
        frequenz,
        wochentage,
        monatstage,
        interval: Number.isFinite(interval) ? Math.trunc(interval) : 1,
      });
    } catch (fehler) {
      if (!(fehler instanceof SerieEingabeFehlt)) throw fehler;
      regelFehlerText = fehler.message;
    }
  }

  const fenster = { vonDatum: gueltigAb > heute ? gueltigAb : heute, bisDatum: '' };
  fenster.bisDatum = tagePlus(fenster.vonDatum, VORSCHAU_TAGE);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const rechte = await rechteImKontext(
        kontext, 'objekt.lesen', 'katalog.lesen', 'dienstplan.schreiben',
      );
      /*
       * `left join objekt` und nicht `join`: `objekt` liegt hinter
       * `objekt.lesen`, diese Route hinter `reinigung.schreiben`. Ein
       * Innenverbund liesse die Reviere VERSCHWINDEN statt die Objektspalte
       * leer zu lassen — eine leere Auswahlliste, die aussieht wie „kein
       * Revier angelegt".
       */
      const reviere = await kontext.abfrage<RevierWahl>(
        `select r.id, r.bezeichnung,
                o.bezeichnung                as objekt,
                (o.kunde_id is not null)     as "hatKunde"
           from revier r
           left join objekt o on o.id = r.objekt_id and o.mandant_id = r.mandant_id
                             and o.archiviert_am is null
          where r.archiviert_am is null
          order by o.bezeichnung nulls last, r.sortierung, r.bezeichnung
          limit 300`,
      );
      const leistungen = await kontext.abfrage<LeistungWahl>(
        `select id, oz, kurztext, ist_platzhalter as "istPlatzhalter"
           from leistungskatalog_position
          where gueltig_bis is null
          order by oz, kurztext
          limit 200`,
      );
      const karte = rrule === null ? new Map<string, string>() : (await ladeFeiertage(
        { unsafe: (sql, werte) => kontext.abfrage<unknown>(sql, werte) },
        'BE', fenster.vonDatum, fenster.bisDatum,
      )).namen;
      return { rechte, reviere, leistungen, feiertagsKarte: karte };
    })) as Promise<{
      rechte: Readonly<Record<string, boolean>>;
      reviere: readonly RevierWahl[];
      leistungen: readonly LeistungWahl[];
      feiertagsKarte: ReadonlyMap<string, string>;
    }>);

  /* ---- die Vorschau, mit echten Feiertagen ----------------------------- */
  let termine: readonly VorschauTermin[] = [];
  let vorschauFehler: string | null = regelFehlerText;
  if (rrule !== null && vorschauFehler === null) {
    try {
      termine = turnusVorschau(
        {
          rrule,
          dtstartLokal: {
            datum: gueltigAb,
            stunde: Number(beginn.slice(0, 2)),
            minute: Number(beginn.slice(3, 5)),
          },
          dauerMinuten: dauer,
          feiertagsregel: feiertage,
          gueltigAb,
          gueltigBis,
        },
        [], daten.feiertagsKarte, fenster,
      );
    } catch (fehler) {
      vorschauFehler = fehler instanceof Error ? fehler.message : String(fehler);
    }
  }

  const findet = termine.filter((v) => v.ausfall === null);
  const faelltAus = termine.filter((v) => v.ausfall !== null);
  const anomalien = termine.filter((v) => v.anomalie !== 'keine');
  const darfPlanen = daten.rechte['dienstplan.schreiben'] === true;
  const kannAnlegen = rrule !== null && vorschauFehler === null && darfPlanen
    && gewaehltesRevier !== null && gewaehlteLeistung !== null && bezeichnung !== '';

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="Turnus anlegen"
      wurzelTitel="Reinigung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/reinigung/turnus`, text: 'Alle Turnusse' }}
    >
      <h1 className="mb-s2 text-h1 text-text">Turnus anlegen</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Erst die Regel, dann die Vorschau, dann das Anlegen. Der Knopf, der
        wirklich anlegt, erscheint <strong className="text-text">unter</strong> der
        Terminliste — damit bestätigt wird, was gezeigt wurde. Beim Anlegen läuft
        der Generator sofort, und die Serienliste meldet, wie viele Schichten
        entstanden sind und was er übersprungen hat.
      </p>

      {fehlerAusApi !== null && (
        <Hinweis art="warnung" cse="turnus-api-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht angelegt.</strong> {fehlerAusApi}
        </Hinweis>
      )}

      {!darfPlanen && (
        <Hinweis art="warnung" cse="turnus-kein-dienstplanrecht" className="mb-s5 max-w-prose">
          <strong>Anlegen ist hier nicht möglich — es fehlt <code>dienstplan.schreiben</code>.</strong>{' '}
          Ein Turnus ohne Planungsserie erzeugt keine Schicht, und die Serie
          sowie die Schichten liegen hinter dem Schreibrecht des Dienstplans.
          Die Anwendung legt deshalb auch den Turnus nicht an, statt ihn ohne
          Wirkung stehen zu lassen. Die Regel lässt sich unten trotzdem bauen
          und in der Vorschau prüfen.
        </Hinweis>
      )}

      {daten.rechte['katalog.lesen'] !== true && (
        <Hinweis art="warnung" cse="turnus-kein-katalogrecht" className="mb-s5 max-w-prose">
          <strong>Die Leistungsauswahl ist leer, weil <code>katalog.lesen</code> fehlt.</strong>{' '}
          Ein Turnus hängt zwingend an einer Katalogposition — ohne Leserecht auf
          den Leistungskatalog lässt sich keine auswählen. Das ist kein leerer
          Katalog.
        </Hinweis>
      )}

      {/* ---- Schritt 1: die Regel (GET auf sich selbst) ------------------- */}
      <form
        method="get"
        data-cse="turnus-formular"
        className="flex max-w-form flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="vorschau" value="1" />

        <label className="block">
          <span className="mb-s1 block text-sm text-text">Revier</span>
          <select
            name="revier"
            required
            className={feld}
            data-cse="turnus-revier"
            {...(gewaehltesRevier === null ? {} : { defaultValue: gewaehltesRevier })}
          >
            {daten.reviere.map((r) => (
              <option key={r.id} value={r.id}>
                {r.objekt ?? 'Objekt nicht prüfbar'} · {r.bezeichnung}
                {r.hatKunde === false ? ' — Objekt ohne Kunde' : ''}
              </option>
            ))}
          </select>
          {daten.reviere.length === 0 && (
            <span className="mt-s1 block text-xs text-warning">
              Kein Revier angelegt — zuerst unter Reinigung → Reviere zuschneiden.
            </span>
          )}
          {daten.rechte['objekt.lesen'] !== true && (
            <span className="mt-s1 block text-xs text-warning">
              Ohne <code>objekt.lesen</code> lässt sich nicht prüfen, ob am Objekt
              ein Kunde hängt. Der Generator überspringt Objekte ohne Kunden und
              meldet es — die Zahl der erzeugten Schichten wäre dann 0.
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-s1 block text-sm text-text">Leistung (Katalogposition)</span>
          <select
            name="leistung"
            required
            className={feld}
            data-cse="turnus-leistung"
            {...(gewaehlteLeistung === null ? {} : { defaultValue: gewaehlteLeistung })}
          >
            {daten.leistungen.map((l) => (
              <option key={l.id} value={l.id}>
                {l.oz} · {l.kurztext}{l.istPlatzhalter ? ' (Katalogwert unbestätigt)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-s1 block text-sm text-text">Bezeichnung</span>
          <input
            name="bezeichnung"
            required
            maxLength={120}
            defaultValue={bezeichnung}
            className={feld}
            placeholder="Unterhaltsreinigung früh"
          />
        </label>

        <label className="block">
          <span className="mb-s1 block text-sm text-text">Wiederkehr</span>
          <select name="frequenz" className={feld} defaultValue={frequenz} data-cse="turnus-frequenz">
            <option value="woechentlich">wöchentlich — an bestimmten Wochentagen</option>
            <option value="monatlich">monatlich — an bestimmten Monatstagen</option>
          </select>
          <span className="mt-s1 block text-xs text-text-subtle">
            Gewertet wird die Liste, die zur gewählten Wiederkehr passt: bei
            wöchentlich die Wochentage, bei monatlich die Monatstage.
          </span>
        </label>

        <fieldset className="border-0 p-0">
          <legend className="mb-s1 text-sm text-text">Wochentage (für „wöchentlich")</legend>
          <div className="flex flex-wrap gap-s3">
            {WOCHENTAGE.map((w) => (
              <label key={w} className="inline-flex min-h-11 items-center gap-s2 text-sm text-text">
                <input
                  type="checkbox"
                  name="wochentag"
                  value={w}
                  defaultChecked={wochentage.includes(w)}
                />
                {TAG_TEXT[w]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="border-0 p-0">
          <legend className="mb-s1 text-sm text-text">Monatstage (für „monatlich")</legend>
          <div className="flex flex-wrap gap-s3">
            {MONATSTAGE.map((tag) => (
              <label
                key={tag}
                className="inline-flex min-h-11 items-center gap-s2 text-sm text-text"
              >
                <input
                  type="checkbox"
                  name="monatstag"
                  value={String(tag)}
                  defaultChecked={monatstage.includes(tag)}
                />
                {tag}.
              </label>
            ))}
          </div>
          {/*
            Der 29., 30. und 31. werden NICHT auf „letzter Tag des Monats"
            umgedeutet. RFC 5545 lässt den Monat ohne diesen Tag aus, und die
            Entfaltung tut dasselbe — die Umdeutung wäre eine erfundene Regel.
          */}
          <span className="mt-s1 block text-xs text-text-subtle">
            Der 29. bis 31. entfällt in Monaten, die ihn nicht haben — er wird
            nicht auf den Monatsletzten verschoben.
          </span>
        </fieldset>

        <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-s1 block text-sm text-text">
              Jede/n wievielte Woche bzw. Monat
            </span>
            <input
              name="interval"
              type="number"
              min={1}
              max={52}
              step={1}
              defaultValue={String(Number.isFinite(interval) ? Math.trunc(interval) : 1)}
              className={feld}
            />
          </label>
          <label className="block">
            <span className="mb-s1 block text-sm text-text">
              Beginn (Berliner Wanduhrzeit)
            </span>
            <input name="beginn" type="time" required defaultValue={beginn} className={feld} />
          </label>
          <label className="block">
            <span className="mb-s1 block text-sm text-text">Solldauer (Minuten)</span>
            <input
              name="dauer"
              type="number"
              min={15}
              max={MAX_DAUER_MINUTEN}
              step={15}
              required
              defaultValue={String(dauer)}
              className={feld}
            />
            <span className="mt-s1 block text-xs text-text-subtle">
              15 bis {MAX_DAUER_MINUTEN} Minuten — eine Schicht ist kürzer als ein Tag.
            </span>
          </label>
          <label className="block">
            <span className="mb-s1 block text-sm text-text">Gültig ab</span>
            <input
              name="gueltig_ab"
              type="date"
              required
              defaultValue={gueltigAb}
              className={feld}
            />
          </label>
          <label className="block">
            <span className="mb-s1 block text-sm text-text">Gültig bis (leer = offen)</span>
            <input
              name="gueltig_bis"
              type="date"
              className={feld}
              {...(gueltigBis === null ? {} : { defaultValue: gueltigBis })}
            />
          </label>
          <label className="block">
            <span className="mb-s1 block text-sm text-text">An Berliner Feiertagen</span>
            <select name="feiertage" className={feld} defaultValue={feiertage}>
              <option value="ausfall">fällt aus</option>
              <option value="unveraendert">findet statt</option>
            </select>
          </label>
        </div>

        <div>
          <Button type="submit" variante="secondary" data-cse="turnus-vorschau">
            Vorschau der nächsten {VORSCHAU_TAGE} Tage
          </Button>
        </div>
      </form>

      {/* ---- Schritt 2: die Vorschau ------------------------------------- */}
      {istVorschau && (
        <section className="mt-s6" data-cse="turnus-vorschau-block">
          <h2 className="mb-s4 text-h3 text-text">Vorschau</h2>

          {vorschauFehler !== null ? (
            <Hinweis art="warnung" cse="turnus-regel-abgewiesen" className="max-w-prose">
              <strong>Die Regel wurde abgewiesen und wird nicht gespeichert.</strong>{' '}
              {vorschauFehler}
            </Hinweis>
          ) : (
            <>
              <p className="mb-s4 max-w-prose text-sm text-text-muted">
                Regel: <code className="text-text">{rrule}</code> —{' '}
                {rrule === null ? '' : lesbareRegel(rrule)}
                {' · '}
                {findet.length} Termin(e) im Fenster
                {faelltAus.length > 0 && `, ${String(faelltAus.length)} fallen aus`}
              </p>

              {anomalien.length > 0 && (
                <Hinweis art="warnung" cse="turnus-vorschau-dst" className="mb-s4 max-w-prose">
                  <strong>Die Zeitumstellung fällt in dieses Fenster.</strong>{' '}
                  {anomalien.length} Termin(e) liegen auf einer Uhrzeit, die es an
                  dem Tag nicht oder zweimal gibt. Die Spalte „Dauer wirklich"
                  zeigt, was daraus folgt; wie die Nacht vergütet wird, ist offen
                  (O-163).
                </Hinweis>
              )}

              {termine.length === 0 ? (
                <p className="rounded-lg border border-warning bg-warning-soft p-s5 text-sm text-warning">
                  Diese Regel ergibt im Fenster{' '}
                  <span className="tabular-nums">{fenster.vonDatum}</span> bis{' '}
                  <span className="tabular-nums">{fenster.bisDatum}</span> keinen
                  einzigen Termin. Bei einem monatlichen Turnus kann das richtig
                  sein; bei einem wöchentlichen ist es ein Hinweis auf den
                  Geltungszeitraum.
                </p>
              ) : (
                <DataTable<VorschauTermin>
                  beschriftung="Termine, die diese Regel im Fenster ergibt"
                  zeilen={termine}
                  schluessel={(v) => `${v.planDatum}-${v.beginnLokal}`}
                  spalten={[
                    {
                      schluessel: 'datum',
                      kopf: 'Plandatum (Berlin)',
                      zelle: (v) => (
                        <span
                          className={v.ausfall === null
                            ? 'tabular-nums' : 'tabular-nums text-text-muted line-through'}
                        >
                          {v.planDatum}
                        </span>
                      ),
                    },
                    {
                      schluessel: 'zeit',
                      kopf: 'Ortszeit',
                      zelle: (v) => (
                        <span className="tabular-nums">
                          {v.beginnLokal} – {v.endeLokal}
                          {v.endetAmFolgetag && (
                            <span className="ml-s2 text-text-muted">(Folgetag)</span>
                          )}
                        </span>
                      ),
                    },
                    {
                      schluessel: 'dauer',
                      kopf: 'Dauer wirklich',
                      numerisch: true,
                      zelle: (v) => (v.dauerInstant === null ? '—' : (
                        <span
                          className={`tabular-nums ${v.dauerInstant === v.dauerNominal ? '' : 'text-warning'}`}
                        >
                          {stundenAusMinuten(v.dauerInstant)}
                          {v.dauerInstant !== v.dauerNominal
                            && ` (Soll ${stundenAusMinuten(v.dauerNominal)})`}
                        </span>
                      )),
                    },
                    {
                      schluessel: 'befund',
                      kopf: 'Befund',
                      zelle: (v) => {
                        if (v.ausfall === 'feiertag') {
                          return (
                            <span className="text-warning">
                              fällt aus — {v.feiertag ?? 'Feiertag'}
                            </span>
                          );
                        }
                        if (v.ausfall === 'ausserhalb_gueltigkeit') {
                          return <span className="text-text-muted">ausserhalb der Geltung</span>;
                        }
                        if (v.anomalie !== 'keine') {
                          return (
                            <span className="text-warning" data-anomalie={v.anomalie}>
                              <Icon
                                name="warnung"
                                groesse="sm"
                                className="mr-s2 inline-block align-[-2px]"
                              />
                              {v.anomalie === 'dst_luecke'
                                ? 'Uhrzeit gibt es an dem Tag nicht'
                                : 'Uhrzeit gibt es an dem Tag zweimal'}
                            </span>
                          );
                        }
                        if (v.feiertag !== null) {
                          return (
                            <span className="text-text-muted">
                              Feiertag ({v.feiertag}) — findet statt
                            </span>
                          );
                        }
                        return <span className="text-success">findet statt</span>;
                      },
                    },
                  ]}
                />
              )}

              {/* ---- Schritt 3: anlegen ------------------------------------ */}
              <form
                method="post"
                action="/api/reinigung/turnus"
                data-cse="turnus-anlegen-formular"
                className="mt-s5 rounded-lg border border-line bg-surface p-s5"
              >
                <input type="hidden" name="mandant" value={mandant} />
                <input type="hidden" name="art" value="turnus" />
                <input type="hidden" name="revier" value={gewaehltesRevier ?? ''} />
                <input type="hidden" name="leistung" value={gewaehlteLeistung ?? ''} />
                <input type="hidden" name="bezeichnung" value={bezeichnung} />
                <input type="hidden" name="frequenz" value={frequenz} />
                {wochentage.map((w) => (
                  <input key={w} type="hidden" name="wochentag" value={w} />
                ))}
                {monatstage.map((m) => (
                  <input key={m} type="hidden" name="monatstag" value={String(m)} />
                ))}
                <input
                  type="hidden"
                  name="interval"
                  value={String(Number.isFinite(interval) ? Math.trunc(interval) : 1)}
                />
                <input type="hidden" name="beginn" value={beginn} />
                <input type="hidden" name="dauer" value={String(dauer)} />
                <input type="hidden" name="gueltig_ab" value={gueltigAb} />
                <input type="hidden" name="gueltig_bis" value={gueltigBis ?? ''} />
                <input type="hidden" name="feiertage" value={feiertage} />
                <p className="m-0 mb-s4 max-w-prose text-sm text-text-muted">
                  Angelegt wird genau die Regel <code className="text-text">{rrule}</code> mit
                  Beginn <span className="tabular-nums">{beginn}</span> und Solldauer{' '}
                  {stundenAusMinuten(dauer)}. Der Generator läuft unmittelbar
                  danach; die Serienliste meldet die Zahl der erzeugten Schichten
                  und was er übersprungen hat.
                </p>
                <Button
                  type="submit"
                  variante="primary"
                  data-cse="turnus-anlegen"
                  disabled={!kannAnlegen}
                >
                  Turnus anlegen und Schichten erzeugen
                </Button>
                {!kannAnlegen && (
                  <p className="m-0 mt-s3 text-xs text-warning">
                    {darfPlanen
                      ? 'Revier, Leistung und Bezeichnung sind Pflicht.'
                      : 'Es fehlt das Recht dienstplan.schreiben — siehe oben.'}
                  </p>
                )}
              </form>
            </>
          )}
        </section>
      )}

      {darf['dienstplan.lesen'] === true && (
        <Hinweis art="hinweis" cse="turnus-serienhinweis" className="mt-s6 max-w-prose">
          Postenserien der Sicherheit und alle Turnusse zusammen stehen unter{' '}
          <Link
            href={`/portal/${mandant}/dienstplan/serien`}
            className="underline underline-offset-2"
          >
            Dienstplan → Serien
          </Link>
          .
        </Hinweis>
      )}
    </PortalRahmen>
  );
}
