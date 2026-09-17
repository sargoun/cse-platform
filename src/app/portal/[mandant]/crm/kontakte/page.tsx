import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import {
  leseGrundlagenListe, type GrundlageListenZeile,
} from '@/server/services/crm/kontakt-grundlage';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/crm/kontakte` — alle Ansprechpartner dieser Gesellschaft,
 * über die Kunden hinweg (CRM-01, CRM-03, CRM-08, LEG-08).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Einstufung kommt NICHT aus der Spalte — sie ist `cse_app` entzogen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ansprechpartner.rechtsgrundlage` und der ganze Nachweisblock haben für
 * `cse_app` nur INSERT und UPDATE (K-05). Ein `select rechtsgrundlage`
 * scheitert mit `42501` — und ein `where rechtsgrundlage = 'keine'` ebenso.
 * Gelesen wird deshalb über `app.kontakt_rechtsgrundlage_liste()` (0247):
 * **ein Abruf, EINE Protokollzeile**. Die naheliegende Fassung —
 * `app.rechtsgrundlage_lesen` je Zeile — hätte bei sechzig Kontakten sechzig
 * LEG-08-Einträge pro Seitenaufruf erzeugt, und genau darin verschwindet der
 * eine Abruf, auf den es ankommt.
 *
 * **Deshalb filtert diese Seite im Server und nicht in SQL.** Ein `where` auf
 * einer entzogenen Spalte ist genauso gesperrt wie ein `select`. Die Liste
 * einer Gesellschaft ist klein genug (Hunderte, nicht Millionen), dass das
 * kein Kompromiss ist, sondern die einzige richtige Fassung.
 *
 * Die Spalte „Werbung per E-Mail" ist die Antwort des TORES —
 * `app.darf_kontaktiert_werden`, dieselbe Funktion, die auch der Sendepfad
 * fragt. Keine zweite Formulierung der Regel (CRM-08).
 */
export const dynamic = 'force-dynamic';

const GRUNDLAGE_PILLE: Readonly<Record<string, PillZustand>> = {
  einwilligung: 'Aktiv',
  bestandskunde: 'Bereit',
  anfrage: 'In Prüfung',
  keine: 'Fehler',
};

const GRUNDLAGE_TEXT: Readonly<Record<string, string>> = {
  einwilligung: 'Einwilligung',
  bestandskunde: 'Bestandskunde',
  anfrage: 'Anfrage',
  keine: 'keine',
};

interface KontaktZeile {
  readonly id: string;
  readonly name: string;
  readonly position: string | null;
  readonly abteilung: string | null;
  readonly kunde_id: string | null;
  readonly kunde_name: string | null;
  readonly email: string | null;
  readonly telefon: string | null;
  readonly ist_hauptkontakt: boolean;
  readonly darf_email: boolean;
}

/** Was die Filterleiste anbietet — `alle` ist die Vorgabe. */
const FILTER = ['alle', 'einwilligung', 'bestandskunde', 'anfrage', 'keine',
  'widerspruch'] as const;
type Filter = (typeof FILTER)[number];

const FILTER_TEXT: Readonly<Record<Filter, string>> = {
  alle: 'Alle',
  einwilligung: 'Einwilligung',
  bestandskunde: 'Bestandskunde',
  anfrage: 'Anfrage',
  keine: 'Ohne Grundlage',
  widerspruch: 'Nur Widerspruch',
};

export default async function Kontaktliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<{ grundlage?: string; q?: string }>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const filter: Filter = FILTER.find((f) => f === suche.grundlage) ?? 'alle';
  const frage = (suche.q ?? '').trim();

  const pfad = `/portal/${mandant}/crm/kontakte`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      /*
       * Die Namensuche läuft in SQL — `nachname`, `vorname` und `email` sind
       * lesbar. Nur der Nachweisblock ist es nicht.
       */
      const zeilen = await kontext.abfrage<KontaktZeile>(
        `select ap.id,
                btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) as name,
                ap.position, ap.abteilung, ap.kunde_id, k.name as kunde_name,
                ap.email, ap.telefon, ap.ist_hauptkontakt,
                app.darf_kontaktiert_werden(ap.id, 'email', 'werbung') as darf_email
           from ansprechpartner ap
           left join kunde k on k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
          where ap.mandant_id = app.aktiver_mandant()
            and ap.archiviert_am is null
            and ($1::text = ''
                 or ap.nachname ilike '%' || $1 || '%'
                 or coalesce(ap.vorname, '') ilike '%' || $1 || '%'
                 or coalesce(ap.email, '') ilike '%' || $1 || '%')
          order by ap.nachname, ap.vorname`, [frage]);

      /*
       * Das ENGERE Recht trägt den Nachweisblock (0247, O-661). Fehlt es,
       * wird die Funktion NICHT gerufen — sie würde werfen, und ein
       * abgefangener Fehler wäre hier nicht von „keine Grundlage" zu
       * unterscheiden.
       */
      const [recht] = await kontext.abfrage<{ darf: boolean }>(
        `select app.hat_recht('crm.rechtsgrundlage_lesen', app.aktiver_mandant())
                  as darf`);
      const grundlagen: readonly GrundlageListenZeile[] = recht?.darf === true
        ? await leseGrundlagenListe(kontext)
        : [];
      return { zeilen, grundlagen, darfGrundlage: recht?.darf === true };
    })) as Promise<{
      zeilen: readonly KontaktZeile[];
      grundlagen: readonly GrundlageListenZeile[];
      darfGrundlage: boolean;
    }>);

  const karte = new Map(daten.grundlagen.map((g) => [g.ansprechpartner_id, g]));
  const gefiltert = daten.zeilen.filter((z) => {
    if (filter === 'alle') return true;
    const g = karte.get(z.id);
    // Ohne Einstufung gibt es keinen Filter — und eine Zeile, die der Filter
    // nicht beurteilen kann, wird nicht weggelassen, sondern der Filter ist
    // dann gar nicht sichtbar (siehe unten).
    if (g === undefined) return false;
    if (filter === 'widerspruch') {
      return g.werbewiderspruch_am !== null || g.widerspruch_am !== null;
    }
    return g.rechtsgrundlage === filter;
  });

  const ziel = (f: Filter): string => {
    const teile: string[] = [];
    if (f !== 'alle') teile.push(`grundlage=${f}`);
    if (frage !== '') teile.push(`q=${encodeURIComponent(frage)}`);
    return teile.length === 0 ? pfad : `${pfad}?${teile.join('&')}`;
  };

  const feld = 'min-h-11 rounded-md border border-line bg-surface px-s3 py-s2 '
    + 'text-sm text-text';

  return (
    <PortalRahmen
      titel="Ansprechpartner"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dashboard"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Ansprechpartner</h1>
        <p className="m-0 text-sm text-text-muted" data-cse="kontakte-anzahl">
          {gefiltert.length === daten.zeilen.length
            ? gefiltert.length === 1 ? '1 Kontakt' : `${String(gefiltert.length)} Kontakte`
            : `${String(gefiltert.length)} von ${String(daten.zeilen.length)}`}
        </p>
      </div>

      <form method="get" action={pfad} className="mb-s4 flex flex-wrap items-end gap-s3">
        <label className="flex flex-col gap-s2 text-sm text-text">
          Name oder E-Mail
          <input name="q" defaultValue={frage} className={feld} data-cse="kontakte-suche" />
        </label>
        {filter === 'alle' ? null : (
          <input type="hidden" name="grundlage" value={filter} />
        )}
        <button
          type="submit"
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Suchen
        </button>
      </form>

      {/*
        * Die Filter laufen als GET-Verweise und nicht über JavaScript — wie
        * bei den Nachträgen: eine Liste, die erst nach einem Skriptdownload
        * filtert, filtert auf einem Baustellentelefon gar nicht.
        *
        * Sie erscheinen NUR mit `crm.rechtsgrundlage_lesen`. Ohne das Recht
        * gibt es keine Einstufung, und ein Filter, der jede Zeile
        * wegfiltert, sähe aus wie „keiner hat eine Einwilligung".
        */}
      {daten.darfGrundlage ? (
        <p className="mb-s5 flex flex-wrap gap-s3 text-sm" data-cse="kontakte-filter">
          {FILTER.map((f) => (
            <Link
              key={f}
              href={ziel(f)}
              aria-current={filter === f ? 'page' : undefined}
              data-cse={`filter-${f}`}
              className={filter === f
                ? 'font-semibold text-text'
                : 'text-text-muted underline-offset-2 hover:text-text hover:underline'}
            >
              {FILTER_TEXT[f]}
            </Link>
          ))}
        </p>
      ) : (
        <Hinweis art="hinweis" cse="kontakte-grundlage-verdeckt" className="mb-s5 max-w-prose">
          <strong>Die Einstufung nach § 7 UWG ist Ihnen nicht sichtbar.</strong> Dafür
          fehlt <code className="text-text">crm.rechtsgrundlage_lesen</code>. Das heisst
          nicht, dass keine hinterlegt ist — die Spalte und die Filter danach fehlen
          deshalb ganz, statt leer zu erscheinen. Die Antwort des Sendetores steht
          weiterhin in der letzten Spalte.
        </Hinweis>
      )}

      {daten.zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {frage === ''
            ? 'Noch kein Ansprechpartner erfasst. Ein Ansprechpartner gehört zu einem '
              + 'Kunden und wird auf dem Kundenblatt angelegt.'
            : `Kein Ansprechpartner passt zu „${frage}".`}
        </p>
      ) : gefiltert.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
           data-cse="kontakte-filter-leer">
          Kein Ansprechpartner mit dieser Einstufung. Das ist eine Aussage über den
          Filter, nicht über den Bestand — {String(daten.zeilen.length)} Kontakte
          stehen in der Liste.
        </p>
      ) : (
        <DataTable
          beschriftung="Ansprechpartner dieser Gesellschaft mit Einstufung und Sendetor"
          zeilen={gefiltert}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'name',
              kopf: 'Name',
              zelle: (z) => (
                <span>
                  <Link
                    href={`/portal/${mandant}/crm/kontakte/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.name}
                  </Link>
                  {z.position === null ? null : (
                    <span className="block text-xs text-text-muted">{z.position}</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'kunde',
              kopf: 'Kunde',
              zelle: (z) => (z.kunde_id === null ? '—' : (
                <Link
                  href={`/portal/${mandant}/crm/kunden/${z.kunde_id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.kunde_name ?? 'Kunde'}
                </Link>
              )),
            },
            { schluessel: 'email', kopf: 'E-Mail', zelle: (z) => z.email ?? '—' },
            { schluessel: 'telefon', kopf: 'Telefon', zelle: (z) => z.telefon ?? '—' },
            ...(daten.darfGrundlage ? [{
              schluessel: 'grundlage',
              kopf: 'Grundlage',
              zelle: (z: KontaktZeile) => {
                const g = karte.get(z.id);
                if (g === undefined) return <span className="text-text-subtle">—</span>;
                const widerspruch = g.widerspruch_am !== null
                  || g.werbewiderspruch_am !== null;
                return (
                  <span className="inline-flex flex-wrap items-center gap-s2"
                        data-cse="kontakt-grundlage">
                    <StatusPill zustand={widerspruch
                      ? 'Abgelehnt'
                      : GRUNDLAGE_PILLE[g.rechtsgrundlage] ?? 'Fehler'} />
                    <span className="text-xs text-text-muted">
                      {widerspruch
                        ? g.widerspruch_am !== null ? 'Widerspruch (Art. 21)' : 'Werbewiderspruch'
                        : GRUNDLAGE_TEXT[g.rechtsgrundlage] ?? g.rechtsgrundlage}
                    </span>
                  </span>
                );
              },
            }] : []),
            {
              schluessel: 'werbung',
              kopf: 'Werbung per E-Mail',
              zelle: (z) => (
                <span data-cse="werbetor" data-erlaubt={String(z.darf_email)}>
                  <StatusPill zustand={z.darf_email ? 'Bereit' : 'Abgelehnt'} />
                </span>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        § 7 UWG: elektronische Werbung braucht eine vorherige ausdrückliche
        Einwilligung — auch gegenüber Unternehmen. Die Spalte „Werbung per E-Mail" ist
        die Antwort von <code className="text-text">app.darf_kontaktiert_werden</code>,
        derselben Funktion, die der Sendepfad fragt; sie ist keine zweite Formulierung
        der Regel. Ein Widerspruch nach Art. 21 DSGVO schliesst jede Werbung aus,
        unabhängig von der Grundlage — Rechnungen und Terminbestätigungen gehen weiter.
      </p>
    </PortalRahmen>
  );
}
