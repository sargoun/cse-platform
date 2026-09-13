import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/buchhaltung/datev/neu` — Zeitraum wählen, Stapel
 * erzeugen (ACC-02).
 *
 * **Die Vorschau kommt VOR dem Knopf.** Wer einen Monat wählt, sieht, wie
 * viele Zeilen darin stehen und wie viele davon noch keinen Beleg haben —
 * bevor er etwas auslöst. Ein Knopf, der erst nach dem Drücken sagt, dass
 * vierzehn Zeilen unvollständig sind, ist ein Knopf, den man zweimal drückt.
 *
 * **Ein Formular ohne JavaScript.** Es setzt ab auf `/api/buchhaltung/datev`,
 * und die Route prüft alles noch einmal: dieselbe Begründung wie überall —
 * ein ausgegrauter Knopf ist eine Bitte, kein Riegel.
 */
export const dynamic = 'force-dynamic';

interface VorschauRoh {
  readonly zeilen: string;
  readonly offen: string;
  readonly summe_soll_cent: string;
  readonly schon_exportiert: string;
}

export default async function DatevNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/buchhaltung/datev/neu`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const ISO = /^\d{4}-\d{2}-\d{2}$/u;
  const feldWert = (name: string): string | null => {
    const w = suche[name];
    return typeof w === 'string' && ISO.test(w) ? w : null;
  };
  const von = feldWert('von');
  const bis = feldWert('bis');
  const gewaehlt = von !== null && bis !== null && bis >= von;

  const vorschau = !gewaehlt ? null : await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const [z] = await kontext.abfrage<VorschauRoh>(
        `select count(*)::text as zeilen,
                count(*) filter (
                  where herkunft <> 'manuell'
                    and (beleg_id is null or konto is null))::text as offen,
                coalesce(sum(umsatz_cent) filter (where soll_haben = 'soll'), 0)::text
                  as summe_soll_cent,
                count(*) filter (where datev_export_id is not null)::text
                  as schon_exportiert
           from buchungssatz
          where belegdatum between $1::date and $2::date`,
        [von, bis]);
      return z ?? null;
    }))) as VorschauRoh | null;

  const offen = Number(vorschau?.offen ?? '0');
  const zeilen = Number(vorschau?.zeilen ?? '0');
  const erneut = Number(vorschau?.schon_exportiert ?? '0');
  const kannErzeugen = gewaehlt && zeilen > 0 && offen === 0;

  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 p-s3 text-sm text-text';
  const knopf = 'min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel="Stapel erzeugen"
      wurzelTitel="DATEV-Export"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="datev"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Buchungsstapel erzeugen</h1>
        <Link href={`/portal/${mandant}/buchhaltung/datev`} className={knopf}>
          Zurück
        </Link>
      </div>

      <form method="get" className="mb-s7 flex flex-wrap items-end gap-s4">
        <div className="flex flex-col gap-s2">
          <label className="text-sm text-text" htmlFor="von">Von</label>
          <input id="von" name="von" type="date" defaultValue={von ?? ''}
            required className={feld} />
        </div>
        <div className="flex flex-col gap-s2">
          <label className="text-sm text-text" htmlFor="bis">Bis</label>
          <input id="bis" name="bis" type="date" defaultValue={bis ?? ''}
            required className={feld} />
        </div>
        <button type="submit" className={knopf}>Vorschau</button>
      </form>

      {!gewaehlt ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Wählen Sie einen Zeitraum. Die Vorschau sagt, wie viele Zeilen darin
          stehen und ob eine davon den Export sperrt — bevor etwas entsteht.
        </p>
      ) : (
        <>
          <section
            data-cse="datev-vorschau"
            data-offen={String(offen)}
            className={`mb-s5 rounded-lg border p-s5 ${
              kannErzeugen
                ? 'border-line bg-surface text-text'
                : 'border-warning bg-warning-soft text-warning'}`}
          >
            <h2 className="text-h3 text-text">
              {String(zeilen)} Buchungszeile(n) im Zeitraum
            </h2>
            <ul className="mt-s3 flex flex-col gap-s2 text-sm">
              {zeilen === 0 ? (
                <li>
                  Keine Zeile — es entsteht keine Datei. Eine leere EXTF-Datei
                  sieht aus wie ein Monat ohne Geschäft.
                </li>
              ) : null}
              {offen > 0 ? (
                <li>
                  <strong className="text-text">{String(offen)}</strong> davon
                  ohne archivierten Beleg oder ohne Konto. Solange eine davon
                  offen ist, entsteht keine Datei — auch keine teilweise.
                  {' '}
                  <Link
                    href={`/portal/${mandant}/buchhaltung/buchungen?offen=1`}
                    className="underline underline-offset-2"
                  >
                    Die Liste ansehen
                  </Link>
                </li>
              ) : null}
              {erneut > 0 ? (
                <li>
                  <strong className="text-text">{String(erneut)}</strong> Zeile(n)
                  wurden bereits in einem früheren Stapel exportiert. Sie werden
                  kein zweites Mal gestempelt; die Datei enthält sie trotzdem,
                  denn der Zeitraum ist derselbe.
                </li>
              ) : null}
              {kannErzeugen ? <li>Der Zeitraum ist exportfähig.</li> : null}
            </ul>
          </section>

          <form method="post" action="/api/buchhaltung/datev">
            <input type="hidden" name="von" value={von} />
            <input type="hidden" name="bis" value={bis} />
            <button
              type="submit"
              disabled={!kannErzeugen}
              data-cse="datev-erzeugen"
              className={`${knopf} disabled:cursor-not-allowed disabled:border-line disabled:text-text-subtle`}
            >
              EXTF-Stapel erzeugen
            </button>
          </form>

          <p className="mt-s4 text-sm text-text-muted">
            Die Datei entsteht in Windows-1252 mit Komma als Dezimaltrenner —
            so liest DATEV sie. Sie wird archiviert, und der Stapel merkt sich
            Summen, Zeilenzahl und Prüfwert. Übergeben wird sie von einem
            Menschen; es gibt keine Übertragung.
          </p>
        </>
      )}
    </PortalRahmen>
  );
}
