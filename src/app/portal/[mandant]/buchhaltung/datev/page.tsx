import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/buchhaltung/datev` — die erzeugten Buchungsstapel und
 * der Zustand der Verbindung (ACC-02, `04-SEITENKARTE.md` §5.15).
 *
 * **Es gibt keine Verbindung, und die Seite sagt es zuerst.** DATEV hat keine
 * offene Schnittstelle für diesen Weg; der Steuerberater bekommt eine Datei.
 * Ein Feld „Verbindungsstatus", das „bereit" zeigte, wäre eine vorgetäuschte
 * Integration. Was hier steht, ist deshalb kein Status, sondern eine Aussage:
 * die Plattform erzeugt, ein Mensch übergibt.
 *
 * **Und sie sagt, dass das Format ungeprüft ist.** Solange keine echte
 * EXTF-Musterdatei des Steuerberaters vorliegt (O-05), stammt die
 * Feldreihenfolge aus der veröffentlichten Beschreibung und nicht aus einer
 * Datei, die jemand eingelesen hat. Das gehört auf den Bildschirm und nicht
 * in einen Kommentar.
 */
export const dynamic = 'force-dynamic';

interface StapelRoh {
  readonly id: string;
  readonly von: string;
  readonly bis: string;
  readonly status: string;
  readonly zeilen: number;
  readonly summe_soll_cent: string;
  readonly erstellt_am: string;
  readonly format_ungeprueft: boolean;
  readonly dokument_id: string | null;
  readonly verwerfungsgrund: string | null;
}

interface StammRoh {
  readonly ist_platzhalter: boolean;
  readonly fehlend: number;
}

const STATUS: Readonly<Record<string, 'Bereit' | 'Abgeschlossen' | 'Abgelehnt'>> = {
  erzeugt: 'Bereit', uebergeben: 'Abgeschlossen', verworfen: 'Abgelehnt',
};

export default async function Datev(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/buchhaltung/datev`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const stapel = await kontext.abfrage<StapelRoh>(
        `select id, von::text, bis::text, status::text as status, zeilen,
                summe_soll_cent::text, format_ungeprueft, dokument_id,
                verwerfungsgrund,
                to_char(erstellt_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as erstellt_am
           from datev_export
          order by von desc, erstellt_am desc
          limit 100`);

      /*
       * Die Vollständigkeit der Stammdaten wird GEZÄHLT, nicht behauptet.
       * Eine Seite, die „eingerichtet" sagt, weil eine Zeile existiert,
       * schickt jemanden in einen Export, der dann verweigert.
       */
      const stamm = await kontext.abfrage<StammRoh>(
        `select ist_platzhalter,
                (case when berater_nummer   is null then 1 else 0 end
               + case when mandanten_nummer is null then 1 else 0 end
               + case when kontenrahmen     is null then 1 else 0 end
               + case when sachkontenlaenge is null then 1 else 0 end
               + case when wj_beginn_monat  is null then 1 else 0 end
               + case when wj_beginn_tag    is null then 1 else 0 end
               + case when versteuerungsart is null then 1 else 0 end
               + case when extf_version     is null then 1 else 0 end) as fehlend
           from datev_konfiguration`);

      return { stapel, stamm: stamm[0] ?? null };
    }))) as { stapel: readonly StapelRoh[]; stamm: StammRoh | null };

  const bereit = daten.stamm !== null
    && !daten.stamm.ist_platzhalter
    && daten.stamm.fehlend === 0;

  return (
    <PortalRahmen
      titel="DATEV-Export"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="datev"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">DATEV-Export</h1>
        {bereit ? (
          <Link
            href={`/portal/${mandant}/buchhaltung/datev/neu`}
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
          >
            Stapel erzeugen
          </Link>
        ) : (
          /*
           * Kein Knopf, der zu einer Absage führt. Wer ihn drückt und dann
           * liest, dass Stammdaten fehlen, hat einmal umsonst geklickt — und
           * beim zweiten Mal sucht er den Grund woanders.
           */
          <span
            data-cse="export-knopf-aus"
            className="min-h-11 rounded-md border border-line px-s5 py-s3 text-sm text-text-subtle"
          >
            Stapel erzeugen — Stammdaten fehlen
          </span>
        )}
      </div>

      {/* Die ehrliche Aussage über die Verbindung, ganz oben. */}
      <section
        data-cse="datev-verbindung"
        className="mb-s5 rounded-lg border border-line bg-surface p-s5"
      >
        <h2 className="text-h3 text-text">Nicht verbunden — und das bleibt so</h2>
        <p className="mt-s2 text-sm text-text-muted">
          Es gibt keine Übertragung an DATEV. Die Plattform erzeugt einen
          EXTF-Buchungsstapel als Datei; wer sie dem Steuerbüro gibt, ist ein
          Mensch, und dass es geschehen ist, vermerkt er hier. Ein Knopf „an
          DATEV senden" würde eine Schnittstelle vortäuschen, die es für
          diesen Weg nicht gibt.
        </p>
      </section>

      {/* ⚑ O-05: das Format ist spezifikationsabgeleitet. */}
      <section
        data-cse="datev-format-ungeprueft"
        className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s5"
      >
        <h2 className="text-h3 text-text">
          Format nicht gegen ein echtes Muster geprüft
        </h2>
        <p className="mt-s2 text-sm text-text-muted">
          Die Feldreihenfolge stammt aus der veröffentlichten
          DATEV-Formatbeschreibung, nicht aus einer Datei, die dieses
          Steuerbüro eingelesen hat. Bevor ein Stapel zum ersten Mal
          produktiv übergeben wird, sollte eine echte Musterdatei
          angefordert und abgeglichen werden (O-05). Bis dahin trägt jeder
          erzeugte Stapel diesen Vermerk.
        </p>
      </section>

      {daten.stamm === null || !bereit ? (
        <section className="mb-s7 rounded-lg border border-warning bg-warning-soft p-s5">
          <h2 className="text-h3 text-text">Stammdaten unvollständig (O-05)</h2>
          <p className="mt-s2 text-sm text-text-muted">
            {daten.stamm === null
              ? 'Für diese Gesellschaft ist keine DATEV-Konfiguration angelegt.'
              : `Es fehlen ${String(daten.stamm.fehlend)} Angabe(n)`
                + `${daten.stamm.ist_platzhalter
                  ? ', und die Konfiguration steht als Platzhalter.'
                  : '.'}`}
            {' '}Beraternummer, Mandantennummer, Kontenrahmen, Sachkontenlänge,
            Wirtschaftsjahresbeginn, Versteuerungsart und EXTF-Fassung kommen
            vom Steuerbüro. Solange eine davon fehlt, entsteht keine Datei —
            auch keine teilweise.
          </p>
        </section>
      ) : null}

      {daten.stapel.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Es wurde noch kein Buchungsstapel erzeugt.
        </p>
      ) : (
        <DataTable
          beschriftung="Erzeugte Buchungsstapel"
          zeilen={daten.stapel}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'zeitraum', kopf: 'Zeitraum',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/buchhaltung/datev/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.von} – {z.bis}
                </Link>
              ),
            },
            { schluessel: 'erzeugt', kopf: 'Erzeugt', zelle: (z) => z.erstellt_am },
            { schluessel: 'zeilen', kopf: 'Zeilen', numerisch: true, zelle: (z) => z.zeilen },
            {
              schluessel: 'summe', kopf: 'Summe', numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.summe_soll_cent))),
            },
            {
              schluessel: 'status', kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={STATUS[z.status] ?? 'Offen'} />
                  {z.verwerfungsgrund === null ? null : (
                    <span className="text-xs text-text-muted">{z.verwerfungsgrund}</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'archiv', kopf: 'Archivkopie',
              zelle: (z) => (z.dokument_id === null
                ? <span className="text-xs text-text-muted">keine — Speicher nicht verbunden</span>
                : <span className="text-xs text-text">abgelegt</span>),
            },
            {
              schluessel: 'format', kopf: 'Format',
              zelle: (z) => (z.format_ungeprueft
                ? <span className="text-xs text-warning">ungeprüft (O-05)</span>
                : <span className="text-xs text-text-muted">gegen Muster geprüft</span>),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
