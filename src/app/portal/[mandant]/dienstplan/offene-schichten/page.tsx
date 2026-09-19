import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { tagePlus } from '@/lib/datum/kalendertag';
import { berlinHeute } from '@/server/db/heute';
import {
  dringlichkeit, leseOffeneSchichten, objekteMitLuecke, type OffeneSchicht,
} from '@/server/services/dienstplan/besetzungsluecke';

/**
 * `/portal/[mandant]/dienstplan/offene-schichten` — TIM-05, REC-01.
 *
 * **Gewerkeuebergreifend, nicht nur Sicherheit.** Die Postensicht
 * `posten_unterbesetzung` zeigt ausschliesslich Wachschichten; eine
 * Reinigungskolonne, der zwei Leute fehlen, stand nirgends.
 *
 * **Zwei Zahlen, zwei Beschriftungen — und keine dritte Definition.** Vor
 * dieser Seite gab es DREI Antworten auf „welche Schicht ist unbesetzt?":
 * die Postensicht (`besetzt_anzahl < min_besetzung`, nur Posten), die Kachel
 * (`besetzt_anzahl < soll_besetzung`, sieben Tage) und `bedarf()` fuer REC-01
 * (ZUSAGEN gegen `min_besetzung`, N Wochen). Eine vierte daneben waere die
 * schlimmste Antwort. Die Tabelle zeigt deshalb `eingeteilt` UND `zugesagt`
 * nebeneinander und sagt, welche Zahl welche ist: `eingeteilt` ist die
 * gefuehrte Zahl lebender Zuordnungen, `zugesagt` sind die, die morgens
 * tatsaechlich erscheinen.
 *
 * **Diese Seite schreibt nichts.** Besetzt wird auf
 * `/dienstplan/einsatz/[id]`; hier stehen die Zahlen. Und sie leitet keinen
 * Personalbedarf ab — aus „14 unbesetzte Schichten" folgt keine Zahl an
 * Einzustellenden. `/recruiting/bedarf` aggregiert dieselbe Grundmenge je
 * Objekt; die Stelle schreibt ein Mensch.
 *
 * **O-210 begrenzt, was hier behauptet werden darf.** Ob bei einer
 * Veranstaltung die vereinbarte Staerke zugleich die Mindestbesetzung ist, ist
 * offen — `posten` traegt beide getrennt, die Eventschicht bekommt den
 * Spaltenvorgabewert 1. Die Dringlichkeit kommt deshalb nur aus
 * `min_besetzung`, wie es in der Zeile steht; die Luecke gegen `soll` steht
 * daneben als blosse Differenz.
 *
 * **O-170 steht sichtbar daneben.** Ob eine Absage die Besetzung sofort
 * mindert, ist unbeantwortet — deshalb sind es zwei Spalten und nicht eine.
 */
export const dynamic = 'force-dynamic';

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
const VORGABE_TAGE = 14;

const QUELLE_TEXT: Readonly<Record<string, string>> = {
  turnus: 'Turnus',
  posten: 'Posten',
  veranstaltung: 'Veranstaltung',
  sonderleistung: 'Sonderleistung',
  projekt: 'Projekt',
  manuell: 'manuell',
};

const ANOMALIE_TEXT: Readonly<Record<string, string>> = {
  dst_luecke: 'Zeitumstellung vorwärts — diese Stunde gibt es nicht',
  dst_doppelt: 'Zeitumstellung zurück — diese Stunde gibt es zweimal',
};

export default async function OffeneSchichten(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/dienstplan/offene-schichten`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const einWert = (schluessel: string): string | null => {
    const wert = frage[schluessel];
    return typeof wert === 'string' && wert !== '' ? wert : null;
  };
  /**
   * „Heute" kommt aus der DATENBANK und nicht aus der Uhr dieses Prozesses:
   * `new Date()` läse zwischen Mitternacht und 02:00 Berliner Zeit noch den
   * gestrigen UTC-Tag — und die Liste begänne dann einen Tag zu früh
   * (Invariante 2 und 5).
   */
  const heute = await berlinHeute();
  const rohVon = einWert('von');
  const rohBis = einWert('bis');
  const von = rohVon !== null && DATUM.test(rohVon) ? rohVon : heute;
  const bis = rohBis !== null && DATUM.test(rohBis) && rohBis >= von
    ? rohBis
    : tagePlus(von, VORGABE_TAGE - 1);
  const objektFilter = einWert('objekt');
  const nurMindest = frage['mindest'] === '1';

  const darf = await haeltRechte(sitzung, 'recruiting.bewerbung_lesen');

  const { zeilen, objekte } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        zeilen: await leseOffeneSchichten(kontext, {
          von,
          bis,
          objektId: objektFilter,
          nurUnterMindest: nurMindest,
        }),
        objekte: await objekteMitLuecke(kontext, { von, bis }),
      })),
  ) as Promise<{
    zeilen: readonly OffeneSchicht[];
    objekte: readonly { id: string; bezeichnung: string }[];
  }>);

  const unterMindest = zeilen.filter((z) => dringlichkeit(z) === 'unter_mindest').length;

  return (
    <PortalRahmen
      titel="Offene Schichten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Offene Schichten</h1>
        <div className="flex flex-wrap gap-s2">
          <Link
            href={`/portal/${mandant}/dienstplan/woche?woche=${von}`}
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted hover:border-line-strong hover:text-text"
          >
            Zum Dienstplan
          </Link>
          {darf['recruiting.bewerbung_lesen'] === true && (
            <Link
              href={`/portal/${mandant}/recruiting/bedarf`}
              data-cse="zum-bedarf"
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted hover:border-line-strong hover:text-text"
            >
              Zum Personalbedarf
            </Link>
          )}
        </div>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Eine Schicht steht hier, wenn ihr Leute fehlen — nach einer der beiden
        Zählungen, die es gibt: <strong>eingeteilt</strong> sind die lebenden
        Zuordnungen, <strong>zugesagt</strong> sind die, die morgens tatsächlich
        erscheinen. Ob eine Absage die Besetzung sofort mindert, ist{' '}
        <strong>offen (O-170)</strong>; deshalb stehen beide Zahlen da und nicht
        eine. Eine Nachtschicht steht an dem Abend, an dem sie beginnt.
      </p>

      <form
        method="get"
        data-cse="filter"
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
            Bis
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
            Objekt
          </span>
          <select
            name="objekt"
            defaultValue={objektFilter ?? ''}
            className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
          >
            <option value="">alle Objekte</option>
            {objekte.map((o) => (
              <option key={o.id} value={o.id}>{o.bezeichnung}</option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-s2 text-sm text-text">
          <input type="checkbox" name="mindest" value="1" defaultChecked={nurMindest} />
          nur unter Mindestbesetzung
        </label>
        <Button type="submit" variante="secondary">Filtern</Button>
      </form>

      <p className="mb-s4 text-sm text-text-muted">
        {zeilen.length === 0
          ? 'keine offene Schicht im Zeitraum'
          : `${String(zeilen.length)} Schicht(en) · ${String(unterMindest)} unter Mindestbesetzung`}
        {' · '}
        <span className="tabular-nums">{von}</span> bis <span className="tabular-nums">{bis}</span>
      </p>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine offene Schicht in diesem Zeitraum. Das heißt: jede geplante
          Schicht hat ihre Leute — nicht, dass keine Schichten geplant wären.
          Der Plan selbst steht im{' '}
          <Link
            href={`/portal/${mandant}/dienstplan/woche?woche=${von}`}
            className="text-text underline-offset-2 hover:text-brand hover:underline"
          >
            Dienstplan
          </Link>.
        </p>
      ) : (
        <DataTable
          beschriftung="Schichten mit Besetzungslücke im gewählten Zeitraum, dringendste zuerst"
          zeilen={zeilen}
          schluessel={(z) => z.einsatzId}
          spalten={[
            {
              schluessel: 'zeit',
              kopf: 'Schicht',
              zelle: (z) => (
                <span>
                  <span className="block tabular-nums text-text">
                    {z.tagLokal} · {z.beginnLokal}–{z.endeLokal}
                    {z.endetAmFolgetag ? ' (+1)' : ''}
                  </span>
                  <span className="block text-micro text-text-muted">
                    {stundenAusMinuten(z.dauerMinuten)}
                    {z.zeitanomalie !== 'keine'
                      ? ` · ${ANOMALIE_TEXT[z.zeitanomalie] ?? z.zeitanomalie}`
                      : ''}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'ort',
              kopf: 'Objekt',
              zelle: (z) => (
                <span>
                  <span className="block text-text">{z.objekt}</span>
                  <span className="block text-micro text-text-muted">
                    {z.kunde ?? 'ohne Kunden'}
                    {z.posten !== null ? ` · ${z.posten}` : ''}
                    {z.revier !== null ? ` · ${z.revier}` : ''}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'quelle',
              kopf: 'Quelle',
              zelle: (z) => QUELLE_TEXT[z.quelle] ?? z.quelle,
            },
            {
              schluessel: 'eingeteilt',
              kopf: 'Eingeteilt / Soll',
              numerisch: true,
              zelle: (z) => `${String(z.eingeteilt)} / ${String(z.sollBesetzung)}`,
            },
            {
              schluessel: 'zugesagt',
              kopf: 'Zugesagt / Mindestens',
              numerisch: true,
              zelle: (z) => (
                <span className={z.zugesagt < z.minBesetzung ? 'text-danger' : ''}>
                  {String(z.zugesagt)} / {String(z.minBesetzung)}
                </span>
              ),
            },
            {
              schluessel: 'fehlt',
              kopf: 'Differenz zum Soll',
              numerisch: true,
              zelle: (z) => String(Math.max(0, z.sollBesetzung - z.eingeteilt)),
            },
            {
              schluessel: 'stand',
              kopf: 'Stand',
              zelle: (z) => (
                /* DESIGN §9: das Wort traegt die Bedeutung, nicht die Farbe. */
                dringlichkeit(z) === 'unter_mindest'
                  ? <StatusPill zustand="Überfällig" />
                  : <StatusPill zustand="Offen" />
              ),
            },
            {
              schluessel: 'weg',
              kopf: 'Besetzen',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/dienstplan/einsatz/${z.einsatzId}`}
                  data-cse="zur-schicht"
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  Zur Schicht
                </Link>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s6 max-w-prose text-sm text-text-muted">
        <strong>Was diese Seite nicht tut.</strong> Sie leitet keinen
        Personalbedarf ab. Aus einer Zahl unbesetzter Schichten folgt keine Zahl
        an Einzustellenden — dafür bräuchte es Vertragsmodelle, Ausfallquoten und
        ArbZG-Grenzen je Person. Bei einer Veranstaltung ist ausserdem{' '}
        <strong>offen (O-210)</strong>, ob die vereinbarte Stärke zugleich die
        Mindestbesetzung ist; die Dringlichkeit oben kommt deshalb nur aus dem
        gespeicherten Mindestwert.
      </p>
    </PortalRahmen>
  );
}
