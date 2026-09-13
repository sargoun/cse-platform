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
 * `/portal/[mandant]/finanzen/eingangsrechnungen/neu` — erfassen (FIN-14,
 * ACC-03, ACC-05).
 *
 * **Zwei Wege zum Beleg, und beide sind echt.** Eine Rechnung kommt als PDF
 * per Mail (dann wird sie hier hochgeladen) oder sie liegt bereits im Archiv,
 * weil sie über Scan oder Postfach hereinkam (dann wird sie ausgewählt).
 * ACC-05 nennt vier Eingangswege; die Maske erfindet keinen fünften und
 * verschweigt keinen der vorhandenen.
 *
 * **Ohne Belegspeicher wird NICHTS gespeichert.** Ist kein Speicher
 * konfiguriert, sagt die Route das und legt keine Zeile an — eine
 * Eingangsrechnung ohne ihr Dokument wäre nach ACC-03 kein Beleg, sondern
 * eine Behauptung.
 *
 * **Die Dublettenwarnung kommt vor dem Speichern.** Die Route prüft
 * (Lieferant, Nummer, Jahr) und weist mit der vorhandenen Belegnummer ab,
 * statt eine zweite Zahlung entstehen zu lassen. Es gibt kein „trotzdem":
 * dieselbe Rechnung zweimal zu bezahlen ist genau der Schaden, den der Riegel
 * verhindert.
 */
export const dynamic = 'force-dynamic';

interface Auswahl { readonly id: string; readonly name: string }
interface BelegAuswahl { readonly id: string; readonly bezeichnung: string }
interface GruppeAuswahl { readonly schluessel: string; readonly bezeichnung: string }

export default async function NeueEingangsrechnung(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/eingangsrechnungen/neu`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      lieferanten: await kontext.abfrage<Auswahl>(
        `select id, name from lieferant where archiviert_am is null order by name`),
      /*
       * Nur Belege, an denen noch keine Eingangsrechnung hängt: ein Beleg,
       * der schon einer gehört, ein zweites Mal angeboten, ist die Einladung
       * zur Doppelerfassung.
       */
      belege: await kontext.abfrage<BelegAuswahl>(
        `select b.id,
                coalesce(b.belegnummer, to_char(b.eingegangen_am, 'DD.MM.YYYY'))
                  || ' · ' || b.typ::text as bezeichnung
           from beleg b
          where b.typ = 'eingangsrechnung'
            and not exists (select 1 from eingangsrechnung er
                             where er.beleg_id = b.id and er.mandant_id = b.mandant_id)
          order by b.eingegangen_am desc
          limit 50`),
      gruppen: await kontext.abfrage<GruppeAuswahl>(
        `select schluessel, bezeichnung from steuersatz_gruppe
          where gueltig_bis is null order by satz_bp desc, schluessel`),
    }))) as Promise<{
      lieferanten: readonly Auswahl[]; belege: readonly BelegAuswahl[];
      gruppen: readonly GruppeAuswahl[];
    }>);

  const hinweis = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="Eingangsrechnung erfassen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/eingangsrechnungen`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Eingangsrechnungen
        </Link>
      </nav>

      <h1 className="mb-s5 text-h1 text-text">Eingangsrechnung erfassen</h1>

      {hinweis === null ? null : (
        <p
          role="alert"
          data-cse="eingang-hinweis"
          className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          {meldung ?? hinweis}
        </p>
      )}

      {daten.lieferanten.length === 0 ? (
        <p className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          Für diese Gesellschaft ist noch kein Lieferant angelegt. Ohne
          Lieferant lässt sich eine Rechnung weder prüfen noch zuordnen.
        </p>
      ) : null}

      <form
        method="post"
        action={`/api/finanzen/eingangsrechnungen?mandant=${mandant}`}
        encType="multipart/form-data"
        className="max-w-prose rounded-lg border border-line bg-surface p-s5"
      >
        <fieldset className="border-0 p-0">
          <legend className="text-sm font-semibold text-text">Der Beleg (ACC-03)</legend>

          <label className="mt-s3 block text-sm text-text" htmlFor="datei">
            PDF hochladen
          </label>
          <input
            id="datei" name="datei" type="file" accept="application/pdf" className={feld}
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="belegId">
            … oder einen bereits abgelegten Beleg wählen
          </label>
          <select id="belegId" name="belegId" className={feld}>
            <option value="">— keiner —</option>
            {daten.belege.map((b) => (
              <option key={b.id} value={b.id}>{b.bezeichnung}</option>
            ))}
          </select>
          <p className="mt-s1 text-xs text-text-muted">
            Eines von beidem ist Pflicht. Ohne Dokument entsteht keine
            Eingangsrechnung.
          </p>
        </fieldset>

        <hr className="my-s5 border-line" />

        <label className="block text-sm text-text" htmlFor="lieferantId">Lieferant</label>
        <select id="lieferantId" name="lieferantId" required className={feld}>
          {daten.lieferanten.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <div>
            <label className="block text-sm text-text" htmlFor="rechnungsnummer">
              Rechnungsnummer des Lieferanten
            </label>
            <input id="rechnungsnummer" name="rechnungsnummer" type="text" required
              className={feld} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="rechnungsdatum">
              Rechnungsdatum
            </label>
            <input id="rechnungsdatum" name="rechnungsdatum" type="date" required
              className={feld} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="leistungsdatum">
              Leistungsdatum
            </label>
            <input id="leistungsdatum" name="leistungsdatum" type="date" className={feld} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="faelligAm">
              Fällig am
            </label>
            <input id="faelligAm" name="faelligAm" type="date" className={feld} />
          </div>
        </div>

        <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-3">
          <div>
            <label className="block text-sm text-text" htmlFor="netto">Netto in Euro</label>
            <input id="netto" name="netto" type="text" inputMode="decimal" required
              placeholder="1000,00" className={feld} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="steuer">
              Umsatzsteuer in Euro
            </label>
            <input id="steuer" name="steuer" type="text" inputMode="decimal" required
              placeholder="190,00" className={feld} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="steuergruppe">Steuersatz</label>
            {/*
              * Die Schlüssel kommen aus `steuersatz_gruppe` und werden hier
              * NICHT erfunden: `ust_0_13b_bau` und `ust_0_13b_reinigung` sind
              * zwei verschiedene Fälle des §13b (Abs. 2 Nr. 4 gegen Nr. 8),
              * und eine Maske, die sie zu „§13b" zusammenzieht, liesse den
              * Erfassenden den falschen wählen.
              */}
            <select id="steuergruppe" name="steuergruppe" required className={feld}>
              {daten.gruppen.map((g) => (
                <option key={g.schluessel} value={g.schluessel}>{g.bezeichnung}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-s1 max-w-prose text-xs text-text-muted">
          Das Brutto wird aus Netto + Steuer gerechnet, nicht eingegeben — ein
          eingetipptes Brutto, das nicht aufgeht, ist ein Beleg, der sich nicht
          buchen lässt.
        </p>

        <button
          type="submit"
          className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
        >
          Erfassen
        </button>
      </form>
    </PortalRahmen>
  );
}
