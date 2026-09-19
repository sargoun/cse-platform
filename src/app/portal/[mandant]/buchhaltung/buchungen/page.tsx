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
 * `/portal/[mandant]/buchhaltung/buchungen` — die Buchungszeilen und ihre
 * Belege (ACC-01, ACC-03, `04-SEITENKARTE.md` §5.15).
 *
 * **Die Unvollständigkeit steht OBEN.** Wer diese Seite öffnet, will
 * meistens exportieren, und die einzige Frage, die vorher zu beantworten
 * ist, lautet: geht das überhaupt? Eine Zeile ohne archivierten Beleg oder
 * ohne Konto sperrt den Zeitraum, und das gehört über die Liste — nicht in
 * eine Spalte, die man erst nach dem Scrollen sieht.
 *
 * **Der Beleg ist ein Link, kein Häkchen.** Ein Häkchen behauptet, dass ein
 * Dokument da ist; ein Link beweist es, weil er sich öffnen lässt. Er führt
 * über `/api/buchhaltung/buchungen/[id]/beleg`, das eine signierte URL
 * ausstellt und nach fünfzehn Minuten ablaufen lässt (DOC-03) — es gibt
 * keinen Pfad, unter dem die Datei ohne Signatur erreichbar wäre.
 *
 * **Nichts wird hier gerechnet.** Beträge stehen als Cent auf der Zeile,
 * seit der Buchungsdienst sie geschrieben hat; die Seite formatiert
 * (Invariante 1).
 */
export const dynamic = 'force-dynamic';

interface ZeileRoh {
  readonly id: string;
  readonly buchung_id: string;
  readonly belegdatum: string;
  readonly konto: string | null;
  readonly gegenkonto: string | null;
  readonly soll_haben: string;
  readonly umsatz_cent: string;
  readonly buchungstext: string | null;
  readonly belegfeld1: string | null;
  readonly herkunft: string;
  readonly festgeschrieben: boolean;
  readonly beleg_id: string | null;
  readonly belegnummer: string | null;
  readonly pruefhinweis: string | null;
}

interface OffenRoh {
  readonly grund: string;
  readonly anzahl: string;
}

const HERKUNFT: Readonly<Record<string, string>> = {
  rechnung: 'Ausgangsrechnung', eingangsrechnung: 'Eingangsrechnung',
  zahlung: 'Zahlung', ausgabe: 'Ausgabe', kassenbewegung: 'Kasse',
  manuell: 'Manuell',
};

export default async function Buchungen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/buchhaltung/buchungen`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * Der Monat kommt aus der Adresse oder gar nicht. Ein Vorgabemonat aus der
   * Uhr des SERVERS zeigte im Januar den Dezember an und im Dezember den
   * Dezember — dieselbe Seite mit zwei Bedeutungen. Ohne Angabe stehen die
   * jüngsten Zeilen.
   */
  const monatRoh = typeof suche['monat'] === 'string' ? suche['monat'] : null;
  const monat = monatRoh !== null && /^\d{4}-\d{2}$/u.test(monatRoh) ? monatRoh : null;
  const nurOffen = suche['offen'] === '1';

  const daten = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const zeilen = await kontext.abfrage<ZeileRoh>(
        `select bs.id, bs.buchung_id, bs.belegdatum::text as belegdatum,
                bs.konto, bs.gegenkonto, bs.soll_haben::text as soll_haben,
                bs.umsatz_cent::text, bs.buchungstext, bs.belegfeld1,
                bs.herkunft::text as herkunft, bs.festgeschrieben,
                bs.beleg_id, b.belegnummer, bs.pruefhinweis
           from buchungssatz bs
           left join beleg b on b.id = bs.beleg_id and b.mandant_id = bs.mandant_id
          where ($1::text is null
                 or to_char(bs.belegdatum, 'YYYY-MM') = $1)
            and (not $2::boolean
                 or (bs.herkunft <> 'manuell'
                     and (bs.beleg_id is null or bs.konto is null)))
          order by bs.belegdatum desc, bs.buchung_id, bs.soll_haben, bs.id
          limit 500`,
        [monat, nurOffen]);

      const offen = await kontext.abfrage<OffenRoh>(
        `select grund, count(*)::text as anzahl
           from buchungssatz_unvollstaendig
          where $1::text is null or to_char(belegdatum, 'YYYY-MM') = $1
          group by grund
          order by grund`,
        [monat]);

      return { zeilen, offen };
    }))) as { zeilen: readonly ZeileRoh[]; offen: readonly OffenRoh[] };

  const offenGesamt = daten.offen.reduce((s, o) => s + Number(o.anzahl), 0);
  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="Buchungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="buchungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Buchungen</h1>
        <form method="get" className="flex flex-wrap items-center gap-s3">
          <label className="text-sm text-text" htmlFor="monat">Monat</label>
          <input
            id="monat" name="monat" type="month" defaultValue={monat ?? ''}
            className={feld}
          />
          <label className="flex items-center gap-s2 text-sm text-text">
            <input
              type="checkbox" name="offen" value="1" defaultChecked={nurOffen}
              className="h-4 w-4"
            />
            Nur unvollständige
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
          >
            Anzeigen
          </button>
        </form>
      </div>

      {/*
        * Der Exportzustand, bevor jemand auf „exportieren" klickt. Die Sperre
        * selbst sitzt in der Datenbank (`app.export_sperre_pruefen`); dies ist
        * ihre Ansage — damit niemand die Absage erst nach dem Klick liest.
        */}
      <section
        data-cse="export-bereitschaft"
        data-offen={String(offenGesamt)}
        className={`mb-s7 rounded-lg border p-s5 ${
          offenGesamt === 0
            ? 'border-line bg-surface text-text'
            : 'border-warning bg-warning-soft text-warning'}`}
      >
        <h2 className="text-h3 text-text">
          {offenGesamt === 0 ? 'Exportfähig' : `${String(offenGesamt)} Zeile(n) unvollständig`}
        </h2>
        {offenGesamt === 0 ? (
          <p className="mt-s2 text-sm text-text-muted">
            Jede Buchungszeile in diesem Zeitraum löst genau ein archiviertes
            Dokument auf und trägt ein Konto. Der DATEV-Export ist damit nicht
            gesperrt.
          </p>
        ) : (
          <>
            <p className="mt-s2 text-sm text-text-muted">
              Solange eine dieser Zeilen offen ist, entsteht keine
              Exportdatei — auch keine teilweise. Eine Datei, die die offenen
              Zeilen wegließe, hätte eine Summe, die mit keiner Bilanz
              übereinstimmt, und man sähe es ihr nicht an.
            </p>
            <ul className="mt-s3 flex flex-col gap-s2 text-sm">
              {daten.offen.map((o) => (
                <li key={o.grund}>
                  <strong className="text-text">{o.anzahl}</strong>
                  {' × '}{o.grund}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {daten.zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diesen Zeitraum steht keine Buchungszeile.
        </p>
      ) : (
        <DataTable
          beschriftung="Buchungszeilen mit ihrem archivierten Beleg"
          zeilen={daten.zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'datum', kopf: 'Beleg­datum',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/buchhaltung/buchungen/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.belegdatum}
                </Link>
              ),
            },
            {
              schluessel: 'konto', kopf: 'Konto',
              zelle: (z) => (z.konto === null
                ? <StatusPill zustand="Fehler" />
                : <span className="font-mono text-sm text-text">{z.konto}</span>),
            },
            {
              schluessel: 'sh', kopf: 'S/H',
              zelle: (z) => (z.soll_haben === 'soll' ? 'Soll' : 'Haben'),
            },
            {
              schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.umsatz_cent))),
            },
            {
              schluessel: 'text', kopf: 'Buchungstext',
              zelle: (z) => z.buchungstext ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'herkunft', kopf: 'Herkunft',
              zelle: (z) => HERKUNFT[z.herkunft] ?? z.herkunft,
            },
            {
              schluessel: 'beleg', kopf: 'Beleg',
              zelle: (z) => {
                if (z.herkunft === 'manuell' && z.beleg_id === null) {
                  return <span className="text-xs text-text-muted">ohne Beleg, mit Hinweis</span>;
                }
                if (z.beleg_id === null) {
                  return (
                    <span className="inline-flex flex-wrap items-center gap-s2">
                      <StatusPill zustand="Fehler" />
                      <span className="text-xs text-warning">nicht archiviert</span>
                    </span>
                  );
                }
                return (
                  <a
                    href={`/api/buchhaltung/buchungen/${z.id}/beleg`}
                    className="text-text underline underline-offset-2 hover:text-brand"
                  >
                    {z.belegnummer ?? 'Dokument'}
                  </a>
                );
              },
            },
            {
              schluessel: 'stand', kopf: 'Stand',
              /*
               * `Abgeschlossen` und nicht ein neues Kennzeichen
               * „Festgeschrieben": DESIGN.md §5 fuehrt eine geschlossene
               * Liste, und der gemeinte Zustand — fertig, unveraenderlich,
               * gedaempft — ist genau der. Ein zusaetzliches Kennzeichen
               * fuer denselben Zustand haette zwei Woerter fuer eine Sache
               * ergeben, und das naechste Modul waehlte das andere.
               */
              zelle: (z) => (z.festgeschrieben
                ? <StatusPill zustand="Abgeschlossen" />
                : <StatusPill zustand="Entwurf" />),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
