import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { tagePlus } from '@/lib/datum/kalendertag';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  postenUebersicht, unterbesetzung,
  type PostenZeile, type Unterbesetzung,
} from '@/server/services/security/posten';

/**
 * `/portal/[mandant]/security/posten` — die Posten und ihre Abdeckung
 * (SEC-01, SEC-04, TIM-04).
 *
 * **Die Unterbesetzung steht OBEN und nicht als Spalte in der Liste.** Sie ist
 * die eine Auskunft, wegen der jemand diese Seite um 17:00 aufmacht: welche
 * Nacht ist nicht besetzt. Eine Zahl in einer Tabellenzeile beantwortet das
 * erst, nachdem man alle Zeilen gelesen hat.
 *
 * Die Zahlen kommen aus derselben Quelle wie der Wächter und wie das Tor vor
 * der Veröffentlichung — der Sicht `posten_unterbesetzung` (0069). Zwei
 * Abfragen für eine Aussage laufen auseinander, und dann meldet der Wächter
 * etwas anderes als der Bildschirm.
 */
export const dynamic = 'force-dynamic';

/** Das Fenster der Abdeckung: heute plus vier Wochen. */
const FENSTER_TAGE = 28;

export default async function PostenListe(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/security/posten`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  // „Heute" kommt aus der DATENBANK, nicht aus der Prozessuhr: zwischen
  // Mitternacht und 02:00 Berliner Zeit ist der UTC-Tag noch der gestrige.
  const heute = await berlinHeute();
  const bis = tagePlus(heute, FENSTER_TAGE);

  const { posten, luecken } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        posten: await postenUebersicht(kontext, { von: heute, bis }),
        luecken: await unterbesetzung(kontext, { von: heute, bis }),
      }))) as Promise<{
        posten: readonly PostenZeile[]; luecken: readonly Unterbesetzung[];
      }>);

  return (
    <PortalRahmen
      titel="Posten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Posten</h1>
        <Link href={`/portal/${mandant}/security/posten/neu`} className="no-underline">
          <Button variante="primary">Posten anlegen</Button>
        </Link>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Abdeckung der nächsten {FENSTER_TAGE} Tage. Ein Posten unter seiner
        Mindestbesetzung bleibt planbar — er lässt sich nur nicht als besetzt
        veröffentlichen, und er steht hier oben.
      </p>

      {luecken.length > 0 && (
        <section
          data-cse="posten-unterbesetzung"
          className="mb-s6 rounded-lg border border-line bg-surface p-s5"
        >
          <h2 className="mb-s2 text-h3 text-text">
            {/* §9: das WORT trägt die Bedeutung, nicht die Farbe. */}
            <span className="text-warning">Unterbesetzt</span>
            {' · '}
            {luecken.length} Schicht(en)
          </h2>
          <p className="mb-s4 max-w-prose text-sm text-text-muted">
            Diese Schichten liegen unter der zugesagten Mindeststärke. Solange
            eine davon offen ist, wird der Zeitraum nicht als besetzt
            veröffentlicht.
          </p>
          <ul className="m-0 list-none p-0">
            {luecken.map((l) => (
              <li
                key={l.einsatzId}
                data-cse="unterbesetzt"
                data-einsatz={l.einsatzId}
                className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3
                           border-b border-line pb-s2 text-sm last:border-0"
              >
                <span className="text-text">
                  {l.postenBezeichnung}
                  {' · '}
                  <span className="tabular-nums text-text-muted">
                    {l.beginnLokal} – {l.endeLokal}
                  </span>
                </span>
                <span className="tabular-nums text-warning">
                  {l.besetztAnzahl} von {l.minBesetzung} — es fehlen {l.fehlend}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {posten.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Posten angelegt. Ein Posten ist die zu besetzende Position an
          einem Objekt — mit Mindestbesetzung, Sollbesetzung und den
          Qualifikationen, die dort verlangt sind.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {posten.map((p) => (
            <li
              key={p.id}
              data-cse="posten"
              data-posten={p.id}
              className="mb-s3 rounded-lg border border-line bg-surface p-s4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-s3">
                <Link
                  href={`/portal/${mandant}/security/posten/${p.id}`}
                  className="text-base text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {p.bezeichnung}
                  {p.kurzzeichen !== null && ` (${p.kurzzeichen})`}
                </Link>
                <span className="text-sm tabular-nums text-text-muted">
                  Soll {p.sollBesetzung} · Minimum {p.minBesetzung}
                </span>
              </div>
              <p className="m-0 mt-s2 text-sm text-text-muted">
                {p.objekt}
                {p.art !== null && ` · ${p.art}`}
                {/**
                  * Eine unbestätigte Katalogzeile sagt das (§1.16) — als WORT
                  * und nicht als Pille. `docs/DESIGN.md` §5 führt ein
                  * geschlossenes Pillenvokabular, und „Unbestätigter Wert"
                  * steht noch nicht darin; `03-GEWERKE.md` §2.3 Nr. 5 verlangt
                  * die Ergänzung, und bis sie da ist, wäre eine selbstgebaute
                  * Pille genau die erfundene Komponente, die CLAUDE.md
                  * ausschliesst. Die Farbe trägt die Bedeutung ohnehin nicht
                  * allein (DESIGN §9).
                  */}
                {p.artIstPlatzhalter && (
                  <span className="ml-s2 text-warning">· Art unbestätigt (O-148)</span>
                )}
              </p>
              <p className="m-0 mt-s2 text-sm text-text-muted">
                {p.abdeckungRrule === null
                  ? 'Durchgehend besetzt'
                  : `Abdeckung: ${p.abdeckungRrule}`}
                {' · '}
                {p.anforderungen === 0
                  ? 'keine Qualifikationsanforderung hinterlegt'
                  : `${p.anforderungen} Qualifikationsanforderung(en)`}
                {' · '}
                <span className={p.unterbesetzt > 0 ? 'text-warning' : undefined}>
                  {p.schichten} Schicht(en), davon {p.unterbesetzt} unterbesetzt
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </PortalRahmen>
  );
}
