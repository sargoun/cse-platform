import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  leseSchluessel, SCHLUESSEL_ZUSTAENDE, ZUSTAND_TEXT,
  type SchluesselZeile, type SchluesselZustand,
} from '@/server/services/security/schluessel';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';

/**
 * `/portal/[mandant]/security/schluessel` — der Bestand und wer ihn hält
 * (SEC-07).
 *
 * **Die Seitenkarte kennt hier kein `/neu`** (§5.8: `schluessel`, `/[id]` und
 * `/[id]/quittung`), und das ist die maßgebliche Quelle für Seitenpfade.
 * Deshalb steht das Anlegen als Formular AUF dieser Seite und nicht hinter
 * einer vierten Adresse, die es laut Karte nicht gibt.
 *
 * **Der Zustand kommt aus dem Journal.** `status` und
 * `aktueller_besitzer_text` sind ein Zwischenspeicher über
 * `schluessel_quittung` (0079 §6) — hier wird nichts gerechnet und nichts
 * behauptet, was nicht gebucht wurde.
 *
 * **„Überfällig" entscheidet die Datenbank.** Der Vergleich läuft gegen den
 * Berliner Kalendertag in SQL; ein Vergleich im Node-Prozess wäre zwischen
 * Mitternacht und 02:00 um einen Tag daneben (K-11, Invariante 5).
 */
export const dynamic = 'force-dynamic';

interface Objektzeile { readonly id: string; readonly bezeichnung: string }
interface Artzeile { readonly id: string; readonly bezeichnung: string }

function pille(s: SchluesselZeile): PillZustand {
  if (s.archiviert) return 'Archiviert';
  if (s.status === 'verloren') return 'Fehler';
  if (s.status === 'gesperrt') return 'Abgelehnt';
  if (s.status === 'vernichtet') return 'Archiviert';
  if (s.status === 'ausgegeben') return s.ueberfaellig ? 'Überfällig' : 'In Arbeit';
  return 'Bereit';
}

export default async function Schluesselbestand(
  {
    params, searchParams,
  }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/security/schluessel`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const einzeln = (feldName: string): string | null => {
    const wert = suche[feldName];
    return typeof wert === 'string' && wert !== '' ? wert : null;
  };
  const objektFilter = einzeln('objekt');
  const statusRoh = einzeln('status');
  const statusFilter = (SCHLUESSEL_ZUSTAENDE as readonly string[]).includes(statusRoh ?? '')
    ? (statusRoh as SchluesselZustand) : null;

  const { schluessel, objekte, arten } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        schluessel: await leseSchluessel(kontext, {
          objektId: objektFilter, status: statusFilter,
        }),
        objekte: await kontext.abfrage<Objektzeile>(
          `select id, bezeichnung from objekt
            where archiviert_am is null order by bezeichnung`,
        ),
        arten: await kontext.abfrage<Artzeile>(
          `select id, bezeichnung from schluesselart
            where archiviert_am is null order by sortierung, bezeichnung`,
        ),
      }))) as Promise<{
        schluessel: readonly SchluesselZeile[];
        objekte: readonly Objektzeile[];
        arten: readonly Artzeile[];
      }>);

  /**
   * Die Filterpille als LINK, nicht als Knopf — dieselbe Entscheidung wie im
   * Wachbuch: die Seite rendert auf dem Server, und ihre Filter stehen in der
   * Adresse. Die Klassen sind wörtlich die von `components/ui/FilterPill`
   * (DESIGN §5), damit ein anderes Element nicht ein anderes Aussehen wird.
   */
  const pilleKlasse = (aktiv: boolean): string => [
    'inline-flex min-h-11 shrink-0 items-center rounded-full px-s4 text-sm no-underline',
    aktiv ? 'bg-white text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
  ].join(' ');

  const feld = 'mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted';
  const eingabe = 'min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Schlüssel"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">Schlüssel</h1>

      <nav aria-label="Filter" className="mb-s5 flex flex-wrap items-center gap-s2">
        <Link
          href={`/portal/${mandant}/security/schluessel`}
          className={pilleKlasse(statusFilter === null && objektFilter === null)}
        >
          Alles
        </Link>
        {SCHLUESSEL_ZUSTAENDE.map((z) => (
          <Link
            key={z}
            href={`/portal/${mandant}/security/schluessel?status=${z}${objektFilter === null ? '' : `&objekt=${objektFilter}`}`}
            className={pilleKlasse(statusFilter === z)}
          >
            {ZUSTAND_TEXT[z]}
          </Link>
        ))}
        {objekte.map((o) => (
          <Link
            key={o.id}
            href={`/portal/${mandant}/security/schluessel?objekt=${o.id}${statusFilter === null ? '' : `&status=${statusFilter}`}`}
            className={pilleKlasse(objektFilter === o.id)}
          >
            {o.bezeichnung}
          </Link>
        ))}
      </nav>

      {schluessel.length === 0 ? (
        <p className="mb-s6 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Schlüssel in diesem Ausschnitt. Das heisst: es wurde keiner
          erfasst — nicht, dass keiner unterwegs ist.
        </p>
      ) : (
        <ul className="m-0 mb-s6 list-none p-0">
          {schluessel.map((s) => (
            <li
              key={s.id}
              data-cse="schluessel"
              data-schluessel={s.id}
              data-status={s.status}
              className="mb-s3 rounded-lg border border-line bg-surface p-s4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-s3">
                <Link
                  href={`/portal/${mandant}/security/schluessel/${s.id}`}
                  className="text-base text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {s.bezeichnung}
                  {s.nummer !== null && (
                    <> · <span className="cse-zahl">{s.nummer}</span></>
                  )}
                </Link>
                <StatusPill zustand={pille(s)} />
              </div>
              <p className="m-0 mt-s2 text-sm text-text-muted">
                {s.objekt}
                {' · '}
                {ZUSTAND_TEXT[s.status]}
                {s.besitzer !== null && ` · bei ${s.besitzer}`}
                {s.letzteBewegungLokal !== null && (
                  <> · zuletzt <span className="cse-zahl">{s.letzteBewegungLokal}</span></>
                )}
              </p>
              {s.ueberfaellig && (
                <p className="m-0 mt-s2 text-sm text-danger" data-cse="ueberfaellig">
                  Rückgabe war für{' '}
                  <span className="cse-zahl">{s.geplanteRueckgabe}</span> zugesagt.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-s2 text-h2 text-text">Schlüssel erfassen</h2>
      <p className="mb-s4 max-w-prose text-sm text-text-muted">
        Der Zustand lässt sich hier nicht setzen — er wird gebucht. Ein neuer
        Schlüssel liegt im Depot, weil sein Journal leer ist.
      </p>

      {objekte.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In dieser Gesellschaft ist noch kein Objekt angelegt. Ein Schlüssel
          gehört immer zu einem Objekt.
        </p>
      ) : (
        <form
          action="/api/sicherheit/schluessel"
          method="post"
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="mandant" value={mandant} />

          <label className="mb-s4 block">
            <span className={feld}>Objekt</span>
            <select
              name="objekt" required className={eingabe}
              defaultValue={objektFilter ?? undefined}
            >
              {objekte.map((o) => (
                <option key={o.id} value={o.id}>{o.bezeichnung}</option>
              ))}
            </select>
          </label>

          <label className="mb-s4 block">
            <span className={feld}>Bezeichnung</span>
            <input
              name="bezeichnung" required maxLength={120} className={eingabe}
              placeholder="Generalschlüssel Haupthaus"
            />
          </label>

          <div className="mb-s4 grid gap-s4 sm:grid-cols-2">
            <label className="block">
              <span className={feld}>Nummer</span>
              <input name="nummer" maxLength={60} className={eingabe} />
            </label>
            <label className="block">
              <span className={feld}>Schliessanlage</span>
              <input name="schliessanlage" maxLength={120} className={eingabe} />
            </label>
          </div>

          <label className="mb-s4 block">
            <span className={feld}>Sicherungskarte</span>
            <input name="sicherungskarte" maxLength={60} className={eingabe} />
          </label>

          <label className="mb-s5 block">
            <span className={feld}>Schlüsselart</span>
            {arten.length === 0 ? (
              /*
               * Der Katalog wird LEER ausgeliefert (O-148). Hier steht das,
               * statt eine plausible Liste zu zeigen, die niemand bestätigt
               * hat (K-17) — und das Feld bleibt benutzbar.
               */
              <span
                className="block text-sm text-text-muted"
                data-cse="schluesselarten-leer"
              >
                Keine Schlüsselarten hinterlegt. Welche Arten geführt werden
                (mechanisch, Transponder, Chipkarte, Zylindercode) ist offen —
                der Schlüssel lässt sich auch ohne Art erfassen.
              </span>
            ) : (
              <select name="schluesselart" className={eingabe}>
                <option value="">— keine —</option>
                {arten.map((a) => (
                  <option key={a.id} value={a.id}>{a.bezeichnung}</option>
                ))}
              </select>
            )}
          </label>

          <Button type="submit" variante="primary">Schlüssel erfassen</Button>
        </form>
      )}
    </PortalRahmen>
  );
}
