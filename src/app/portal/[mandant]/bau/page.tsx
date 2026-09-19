import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { KachelRaster, type KachelAnzeige } from '@/components/portal/KachelRaster';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  NACHTRAG_WACHFRIST_TAGE, listeNachtraege, type NachtragZeile,
} from '@/server/services/bau/nachtrag';
import {
  GRUND_TEXT, listeBehinderungen, type BehinderungZeile,
} from '@/server/services/bau/behinderung';
import { listeBautage, type BautagKopfZeile } from '@/server/services/bau/bautagebuch';
import { listeAufmasse, type AufmassKopfZeile } from '@/server/services/bau/aufmass';
import { ladeAusserhalbLv, type AusserhalbLvWarnung }
  from '@/server/services/bau/ausserhalb-lv';
import {
  BAUTAGEBUCH_LUECKE_TAGE, ladeBauKennzahlen, tageOhneBautagebuch,
  type BauKennzahlen, type FehlenderBautag,
} from '@/server/services/bau/uebersicht';
import { NACHTRAG_PILLE, NACHTRAG_STATUS_TEXT } from './nachtrag-anzeige';
import { AUFMASS_PILLE, AUFMASS_STATUS_TEXT } from './aufmass-anzeige';
import { AusserhalbLvWarnungen } from './AusserhalbLvWarnungen';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { haeltRechte } from '@/app/portal/rechte';
import { slugTor } from '../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau` — die Moduluebersicht Bau (BAU-04, BAU-06, BAU-07,
 * Seitenkarte §5.9).
 *
 * **Sie beantwortet drei Fragen, die auf Projektebene nicht zu stellen sind**
 * — und zwar genau die drei, die die Seitenkarte dieser Adresse zuweist:
 *
 *  1. **Welcher Nachtrag liegt angemeldet und nicht eingereicht?** (BAU-04)
 *     Das ist Geld, das nicht faellig wird, und nach
 *     {@link NACHTRAG_WACHFRIST_TAGE} Tagen meldet es die SPEC-§14-Wache
 *     EINMAL. Diese Seite zeigt es, solange es offen ist.
 *  2. **Welche Behinderung laeuft ohne dokumentierten Wegfall?** (BAU-06)
 *     § 6 Abs. 3 VOB/B verlangt die Anzeige des Wegfalls; ohne sie laeuft die
 *     Behinderung weiter, auch wenn auf der Baustelle langst wieder gearbeitet
 *     wird.
 *  3. **Welcher Bautag fehlt?** (BAU-07) Der Tag ohne Eintrag ist genau der,
 *     um den im Bauzeitstreit gestritten wird — eine Liste der vorhandenen
 *     Tage zeigt ihn nie.
 *
 * Dazu die Aufmassblaetter, die auf Gegenzeichnung warten (BAU-03), und die
 * Warnung „Leistung ausserhalb des Leistungsverzeichnisses" (BAU-05).
 *
 * **Die Seite rechnet nichts.** Sie zaehlt und filtert; die Zahlen kommen
 * fertig aus `bau/uebersicht.ts`, die Zeilen aus den Diensten, die schon da
 * sind. Kein Betrag steht auf dieser Seite — die Einheitspreise haengen an
 * `bau.preis_lesen`, und eine Uebersicht, die dafuer ein zweites Tor
 * aufmachte, waere ein zweiter Ort, an dem es vergessen wird.
 */
export const dynamic = 'force-dynamic';

/**
 * Wie viele Zeilen ein Abschnitt dieser Uebersicht hoechstens zeigt.
 *
 * Eine TECHNISCHE Grenze und keine fachliche: die vollstaendigen Listen
 * stehen einen Verweis weiter (`.../bau/aufmass`, `.../bau/nachtraege`). Die
 * Zahl in der Kachel kommt aus `ladeBauKennzahlen` und ist UNBESCHNITTEN —
 * gezaehlt wird alles, gezeigt wird ein Ausschnitt.
 */
const UEBERSICHT_GRENZE = 50;

export default async function BauUebersicht(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/bau`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  /**
   * **Ein Verweis auf ein 404 ist schlechter als keiner** (AUT-06).
   *
   * Diese Seite traegt `bau.lesen`; der EINZELNE Bautag
   * (`.../bautagebuch/[datum]`) verlangt `bau.schreiben` — dort wird er
   * geschrieben, nicht bloss gelesen. Wer nur lesen darf, bekam hier
   * anklickbare Tage und landete auf einer nicht vorhandenen Seite. Dasselbe
   * Muster steht in `bau/bautagebuch/page.tsx` und auf der
   * Aufmassdetailseite.
   */
  const darf = await haeltRechte(sitzung, 'bau.schreiben');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      zahlen: await ladeBauKennzahlen(kontext),
      nachtraege: await listeNachtraege(kontext, { nurOffen: true }),
      behinderungen: await listeBehinderungen(kontext, { nurLaufend: true }),
      bautageEntwurf: await listeBautage(kontext, { nurOffene: true, grenze: 10 }),
      luecken: await tageOhneBautagebuch(kontext),
      /*
       * Gefiltert in SQL und begrenzt: vorher lud diese Zeile JEDES lebende
       * Blatt des Mandanten — vierzehn Spalten und zwei Unterabfragen je
       * Blatt —, um danach in TypeScript auf `vorgelegt` zu filtern. Genau
       * das Muster, gegen dessen Kosten `bau/uebersicht.ts` im Dateikopf
       * argumentiert.
       */
      aufmasse: await listeAufmasse(kontext, { status: 'vorgelegt', grenze: UEBERSICHT_GRENZE }),
      warnungen: await ladeAusserhalbLv(kontext, { grenze: UEBERSICHT_GRENZE }),
    })),
  ) as Promise<{
    zahlen: BauKennzahlen;
    nachtraege: readonly NachtragZeile[];
    behinderungen: readonly BehinderungZeile[];
    bautageEntwurf: readonly BautagKopfZeile[];
    luecken: readonly FehlenderBautag[];
    aufmasse: readonly AufmassKopfZeile[];
    warnungen: readonly AusserhalbLvWarnung[];
  }>);

  const { zahlen } = daten;

  const kacheln: readonly KachelAnzeige[] = [
    {
      schluessel: 'bau-projekte',
      label: 'Laufende Projekte',
      wert: zahlen.projekte_laufend,
      ton: 'info',
      ziel: `/portal/${mandant}/bau/projekte`,
    },
    {
      schluessel: 'bau-nachtraege-offen',
      label: 'Nachträge angemeldet, nicht eingereicht',
      wert: zahlen.nachtraege_offen,
      // Die Farbe folgt dem Befund, nicht der Kachel: überfällig ist rot,
      // offen ist gelb, keiner ist grün (DESIGN §1, semantische Töne).
      ton: zahlen.nachtraege_ueberfaellig > 0
        ? 'danger'
        : zahlen.nachtraege_offen > 0 ? 'warning' : 'success',
      ziel: `/portal/${mandant}/bau/nachtraege?offen=1`,
    },
    {
      schluessel: 'bau-behinderungen',
      label: 'Laufende Behinderungen',
      wert: zahlen.behinderungen_laufend,
      ton: zahlen.behinderungen_laufend > 0 ? 'warning' : 'success',
      ziel: `/portal/${mandant}/bau/behinderungen`,
    },
    {
      schluessel: 'bau-aufmasse-vorgelegt',
      label: 'Aufmaße warten auf Gegenzeichnung',
      wert: zahlen.aufmasse_vorgelegt,
      ton: zahlen.aufmasse_vorgelegt > 0 ? 'warning' : 'success',
      ziel: `/portal/${mandant}/bau/aufmass`,
    },
    {
      /*
       * `ladeBauKennzahlen` zaehlt die Abnahmen mit; ohne diese Kachel war
       * das eine mitgelesene Spalte ohne Leser — die naechste, die jemand
       * fuer vorhanden haelt. Das Ziel ist die PROJEKTLISTE und nicht ein
       * Protokoll: `…/projekte/[id]/abnahme` traegt `bau.schreiben`, diese
       * Seite `bau.lesen` (AUT-06).
       */
      schluessel: 'bau-abnahmen',
      label: 'Abnahmeprotokolle (§ 12 VOB/B)',
      wert: zahlen.abnahmen,
      ton: 'info',
      ziel: `/portal/${mandant}/bau/projekte`,
    },
  ];

  return (
    <PortalRahmen
      titel="Bau"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Bau</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Was auf einer Baustelle Geld kostet, ist selten die Arbeit — es ist der
        Vorgang daneben, der nicht geführt wurde: der angekündigte Nachtrag ohne
        Kalkulation, die Behinderung ohne angezeigten Wegfall, der Bautag ohne
        Eintrag. Diese Seite zeigt genau diese drei.
      </p>

      <section className="mb-s6">
        <h2 className="sr-only">Kennzahlen</h2>
        <KachelRaster kacheln={kacheln} />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BAU-05: Leistung ausserhalb des LV — über alle Projekte.            */}
      {/* ------------------------------------------------------------------ */}
      <AusserhalbLvWarnungen
        warnungen={daten.warnungen}
        mandant={mandant}
        projektId={null}
        beschnitten={daten.warnungen.length >= UEBERSICHT_GRENZE}
      />

      {/* ------------------------------------------------------------------ */}
      {/* BAU-04: angemeldet und nicht eingereicht.                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6" data-cse="offene-nachtraege">
        <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">
            Nachträge: angemeldet, nicht eingereicht
          </h2>
          <Link
            href={`/portal/${mandant}/bau/nachtraege`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Alle Nachträge
          </Link>
        </div>
        {daten.nachtraege.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Kein Nachtrag ist angemeldet und noch nicht eingereicht. Solange die
            Kalkulation fehlt, wird nichts fällig — hier steht dann nichts, und
            das ist der gute Fall.
          </p>
        ) : (
          <DataTable
            beschriftung="Angemeldete, nicht eingereichte Nachträge"
            zeilen={daten.nachtraege}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'projekt',
                kopf: 'Projekt',
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${z.projekt_id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.projekt}
                  </Link>
                ),
              },
              { schluessel: 'nummer', kopf: 'Nr.', zelle: (z) => z.nummer },
              {
                schluessel: 'titel',
                kopf: 'Titel',
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/nachtraege/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.titel}
                  </Link>
                ),
              },
              {
                schluessel: 'grundlage',
                kopf: 'Grundlage',
                zelle: (z) => z.grundlage_fundstelle,
              },
              {
                schluessel: 'offen',
                kopf: 'Offen seit',
                numerisch: true,
                zelle: (z) => (
                  <span className={z.ueberfaellig ? 'text-danger' : 'text-text-muted'}>
                    {z.offen_seit_tagen === null
                      ? '—'
                      : `${String(z.offen_seit_tagen)} Tage`}
                  </span>
                ),
              },
              {
                schluessel: 'status',
                kopf: 'Status',
                zelle: (z) => (
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    <StatusPill
                      zustand={z.ueberfaellig
                        ? 'Überfällig'
                        : NACHTRAG_PILLE[z.status] ?? 'Offen'}
                    />
                    <span className="text-xs text-text-muted">
                      {NACHTRAG_STATUS_TEXT[z.status] ?? z.status}
                    </span>
                  </span>
                ),
              },
            ]}
          />
        )}
        {zahlen.nachtraege_ueberfaellig > 0 && (
          <p className="mt-s3 text-sm text-danger">
            {String(zahlen.nachtraege_ueberfaellig)} davon liegen länger als{' '}
            {String(NACHTRAG_WACHFRIST_TAGE)} Tage. Die Ankündigung nach § 2
            Abs. 6 Nr. 1 VOB/B ist erfolgt, die Kalkulation fehlt — bis dahin
            wird nichts fällig.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BAU-06: laufend, ohne dokumentierten Wegfall.                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6" data-cse="laufende-behinderungen">
        <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">
            Behinderungen ohne angezeigten Wegfall
          </h2>
          <Link
            href={`/portal/${mandant}/bau/behinderungen`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Alle Behinderungen
          </Link>
        </div>
        {daten.behinderungen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Keine Behinderung läuft. Eine angezeigte Behinderung endet erst mit
            der Anzeige ihres Wegfalls (§ 6 Abs. 3 VOB/B) — nicht damit, dass
            wieder gearbeitet wird.
            {zahlen.behinderungen_entwurf > 0 && (
              <>
                {' '}
                <strong className="text-warning">
                  {String(zahlen.behinderungen_entwurf)} Entwurf/Entwürfe
                </strong>{' '}
                sind erfasst, aber nicht angezeigt — ein Entwurf hemmt keine
                Frist.
              </>
            )}
          </p>
        ) : (
          <DataTable
            beschriftung="Laufende Behinderungen ohne angezeigten Wegfall"
            zeilen={daten.behinderungen}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'projekt',
                kopf: 'Projekt',
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${z.projekt_id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.projekt}
                  </Link>
                ),
              },
              { schluessel: 'nummer', kopf: 'Nr.', zelle: (z) => z.nummer },
              {
                schluessel: 'ursache',
                kopf: 'Ursache',
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/behinderungen/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.ursache}
                  </Link>
                ),
              },
              {
                schluessel: 'grund',
                kopf: 'Risikosphäre',
                zelle: (z) => GRUND_TEXT[z.grund_kategorie] ?? z.grund_kategorie,
              },
              { schluessel: 'beginn', kopf: 'Beginn', zelle: (z) => z.beginn_lokal },
              {
                schluessel: 'angezeigt',
                kopf: 'Angezeigt',
                zelle: (z) => z.angezeigt_lokal ?? (
                  <span className="text-warning">noch nicht angezeigt</span>
                ),
              },
              {
                schluessel: 'tage',
                kopf: 'Auswirkung (Tage)',
                numerisch: true,
                zelle: (z) => (z.auswirkung_tage === null
                  ? <span className="text-text-subtle">offen</span>
                  : String(z.auswirkung_tage)),
              },
            ]}
          />
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BAU-07: Entwürfe und Lücken.                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6" data-cse="bautagebuch-stand">
        <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">Bautagebuch</h2>
          <Link
            href={`/portal/${mandant}/bau/bautagebuch`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Alle Bautage
          </Link>
        </div>

        {daten.bautageEntwurf.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Kein Bautag steht im Entwurf.
          </p>
        ) : (
          <DataTable
            beschriftung="Bautage im Entwurf"
            zeilen={daten.bautageEntwurf}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'projekt',
                kopf: 'Projekt',
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/bautagebuch`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.projekt}
                  </Link>
                ),
              },
              {
                schluessel: 'datum',
                kopf: 'Tag',
                /*
                 * Verlinkt nur mit `bau.schreiben` — der einzelne Bautag
                 * traegt dieses Recht an der Tuer, und ohne es endet der
                 * Aufruf in `notFound()`. Dasselbe Muster wie in
                 * `bau/bautagebuch/page.tsx`.
                 */
                zelle: (z) => (darf['bau.schreiben'] === true ? (
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/bautagebuch/${z.datum}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.datum_lokal}
                  </Link>
                ) : z.datum_lokal),
              },
              {
                schluessel: 'mannstunden',
                kopf: 'Mannstunden-Zeilen',
                numerisch: true,
                zelle: (z) => String(z.mannstunden_zeilen),
              },
              {
                schluessel: 'fotos',
                kopf: 'Fotos',
                numerisch: true,
                zelle: (z) => String(z.fotos),
              },
              {
                schluessel: 'status',
                kopf: 'Status',
                zelle: () => <StatusPill zustand="Entwurf" />,
              },
            ]}
          />
        )}

        <h3 className="mb-s2 mt-s5 text-base font-semibold text-text">
          Tage ohne Eintrag (letzte {String(BAUTAGEBUCH_LUECKE_TAGE)} Tage)
        </h3>
        {daten.luecken.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für jeden Tag der letzten Woche gibt es auf jedem laufenden Projekt
            einen Eintrag.
          </p>
        ) : (
          <ul className="m-0 list-none p-0" data-cse="bautag-luecken">
            {daten.luecken.map((l) => (
              <li
                key={`${l.projekt_id}-${l.datum}`}
                className="mb-s2 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted"
              >
                {darf['bau.schreiben'] === true ? (
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${l.projekt_id}/bautagebuch/${l.datum}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {l.wochentag}, {l.datum_lokal}
                  </Link>
                ) : (
                  <span className="text-text">{l.wochentag}, {l.datum_lokal}</span>
                )}
                {' · '}{l.projekt_nummer} · {l.projekt}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-s2 max-w-prose text-xs text-text-subtle">
          {/*
            * Regel 1: die Erwartung ist offen, also steht sie hier als offene
            * Frage und nicht als stille Filterung auf „Werktage".
            */}
          Gezählt wird jeder Kalendertag im Projektzeitraum — auch Samstag,
          Sonntag und Feiertag. An welchen Tagen ein Eintrag erwartet wird, ist
          <strong> offen (O-630)</strong>: jeder Kalendertag, jeder Werktag oder
          nach Bauzeitenplan. Bis zur Antwort nennt diese Liste zu viel und
          nichts zu wenig.
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BAU-03: vorgelegt, wartet auf Gegenzeichnung.                       */}
      {/* ------------------------------------------------------------------ */}
      <section data-cse="aufmasse-vorgelegt">
        <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">
            Aufmaße, die auf Gegenzeichnung warten
          </h2>
          <Link
            href={`/portal/${mandant}/bau/aufmass`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Alle Aufmaße
          </Link>
        </div>
        {daten.aufmasse.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Kein Blatt ist vorgelegt und wartet auf die Gegenzeichnung des
            Auftraggebers.
          </p>
        ) : (
          <DataTable
            beschriftung="Vorgelegte Aufmaßblätter"
            zeilen={daten.aufmasse}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'projekt',
                kopf: 'Projekt',
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/aufmass`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.projekt}
                  </Link>
                ),
              },
              {
                schluessel: 'nummer',
                kopf: 'Blatt',
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${z.projekt_id}/aufmass/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.nummer} · {z.bezeichnung}
                  </Link>
                ),
              },
              { schluessel: 'messdatum', kopf: 'Messdatum', zelle: (z) => z.messdatum_lokal },
              {
                schluessel: 'zeilen',
                kopf: 'Zeilen',
                numerisch: true,
                zelle: (z) => String(z.zeilen),
              },
              {
                schluessel: 'fotos',
                kopf: 'Messfotos',
                numerisch: true,
                zelle: (z) => (z.fotos === 0
                  ? <span className="text-warning">0</span>
                  : String(z.fotos)),
              },
              {
                schluessel: 'status',
                kopf: 'Status',
                zelle: (z) => (
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    <StatusPill zustand={AUFMASS_PILLE[z.status] ?? 'Wartet'} />
                    <span className="text-xs text-text-muted">
                      {AUFMASS_STATUS_TEXT[z.status] ?? z.status}
                    </span>
                  </span>
                ),
              },
            ]}
          />
        )}
        {daten.aufmasse.length >= UEBERSICHT_GRENZE && (
          /*
           * Die Kachel oben zählt ALLE vorgelegten Blätter; diese Tabelle zeigt
           * höchstens {UEBERSICHT_GRENZE}. Ohne diesen Satz widersprächen sich
           * die beiden Zahlen auf derselben Seite.
           */
          <p className="mt-s3 text-sm text-text-muted">
            Gezeigt sind die ersten {String(UEBERSICHT_GRENZE)} von{' '}
            {String(zahlen.aufmasse_vorgelegt)} vorgelegten Blättern. Die
            vollständige Liste steht unter „Alle Aufmaße".
          </p>
        )}
      </section>
    </PortalRahmen>
  );
}
