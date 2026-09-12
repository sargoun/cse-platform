import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { monatsErster, monatVerschieben, monatsName } from '@/lib/datum/kalendertag';
import { stundenMinutenText } from '@/lib/datum/stunden';
import { leseMonatsliste, type KontoZeile } from '../daten';

/**
 * `/portal/[mandant]/personal/stundenkonten/abschluss` — einen Monat schliessen
 * (EMP-04, LEG-01, § 12.2).
 *
 * **Der Abschluss ist einseitig.** Was gesperrt ist, wird nicht neu gerechnet;
 * eine spaetere Korrektur erscheint als Ausgleichsbuchung im ersten offenen
 * Monat. Diese Seite sagt das VOR dem Knopf und nicht danach — ein Hinweis
 * hinter einer unumkehrbaren Handlung ist eine Entschuldigung, keine Warnung.
 *
 * **Was blockiert, steht in der Zeile.** Ein Monat mit nicht freigegebenen
 * Zeiten laesst sich nicht schliessen (`UnfreigegebeneZeitenFehler`), denn nach
 * der Sperre nimmt er keine Buchung mehr an — die Minuten waeren aus dem
 * Lohnmonat verschwunden, ohne Fehler und mit einer plausiblen Zahl. Statt
 * eines Knopfes, der scheitert, steht dort der Grund.
 *
 * **Der Knopf ist ein Formular, kein Skript.** Ein Bildschirm, den die
 * Personalstelle am Monatsende bedient, muss ohne JavaScript funktionieren.
 */
export const dynamic = 'force-dynamic';

export default async function Monatsabschluss({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/stundenkonten/abschluss`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const roh = typeof frage['monat'] === 'string' ? frage['monat'] : null;
  const heute = await berlinHeute();
  /**
   * Voreingestellt ist der VORMONAT.
   *
   * Der laufende Monat ist noch nicht vorbei; wer ihn schliesst, sperrt die
   * Schichten, die erst noch kommen. Die Voreinstellung ist deshalb der Monat,
   * den man am Monatsende tatsaechlich abschliesst.
   */
  const monat = roh !== null && /^\d{4}-\d{2}(-\d{2})?$/u.test(roh)
    ? monatsErster(`${roh.slice(0, 7)}-01`)
    : monatVerschieben(monatsErster(heute), -1);
  const laufend = monat === monatsErster(heute);

  const fehler = typeof frage['fehler'] === 'string' ? frage['fehler'] : null;
  const geschlossen = typeof frage['geschlossen'] === 'string' ? frage['geschlossen'] : null;

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, (kontext) => leseMonatsliste(kontext, monat)),
  ) as Promise<readonly KontoZeile[]>);

  const offen = zeilen.filter((z) => z.kontoId !== null && z.status !== 'gesperrt');
  const gesperrt = zeilen.filter((z) => z.status === 'gesperrt');
  const bereit = offen.filter((z) => z.offeneZeiten === 0);

  return (
    <PortalRahmen
      titel="Monatsabschluss"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Monatsabschluss</h1>
        <p className="m-0 text-sm text-text-muted">{monatsName(monat)}</p>
      </div>

      <nav aria-label="Monat wechseln" className="mb-s5 flex flex-wrap items-center gap-s2">
        <Sprung mandant={mandant} ziel={monatVerschieben(monat, -1)} text="← Vormonat" />
        <Sprung mandant={mandant} ziel={monatVerschieben(monat, 1)} text="Folgemonat →" />
        <Link
          href={`/portal/${mandant}/personal/stundenkonten?monat=${monat}`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Zu den Konten
        </Link>
      </nav>

      {geschlossen !== null && (
        <p
          data-cse="abschluss-erfolg"
          className="mb-s5 rounded-lg border border-success bg-success-soft p-s4 text-sm text-success"
        >
          {monatsName(monat)} ist für diese Beschäftigung abgeschlossen. Der
          § 17-Nachweis wurde dabei geprägt — er wird ab jetzt vorgelegt und
          nicht neu berechnet.
        </p>
      )}

      {fehler !== null && (
        <p
          data-cse="abschluss-fehler"
          className="mb-s5 rounded-lg border border-danger bg-danger-soft p-s4 text-sm text-danger"
        >
          {fehler}
        </p>
      )}

      {laufend && (
        <p className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          Das ist der laufende Monat. Ihn zu schließen sperrt auch die Schichten,
          die erst noch kommen — möglich ist es, sinnvoll selten.
        </p>
      )}

      <p className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
        Ein Abschluss ist <strong className="text-text">nicht umkehrbar</strong>.
        Danach nimmt der Monat keine Buchung mehr an; eine spätere Korrektur
        erscheint als Ausgleichsbuchung im ersten offenen Monat und trägt den
        Verweis auf diesen hier. Ein Wiederöffnen gibt es nicht — nicht, weil
        es schwer wäre, sondern weil die Plattform sonst andere Zahlen zeigte
        als der Nachweis, den der Mensch in der Hand hält.
      </p>

      <p className="mb-s3 text-sm text-text-muted">
        {String(bereit.length)} von {String(offen.length)} offenen Konten sind
        abschlussbereit
        {gesperrt.length > 0 && ` · ${String(gesperrt.length)} bereits abgeschlossen`}
      </p>

      {offen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für {monatsName(monat)} ist kein Konto offen. Entweder ist der Monat
          fertig — oder es gibt für ihn noch gar keine Konten.
        </p>
      ) : (
        <DataTable
          beschriftung={`Offene Konten ${monatsName(monat)}`}
          zeilen={offen}
          schluessel={(z) => z.anstellungId}
          spalten={[
            {
              schluessel: 'name',
              kopf: 'Beschäftigung',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/personal/stundenkonten/${z.anstellungId}?monat=${monat}`}
                  className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                >
                  {z.name}
                </Link>
              ),
            },
            {
              schluessel: 'ist',
              kopf: 'Ist',
              numerisch: true,
              zelle: (z) => stundenMinutenText(z.istMinuten),
            },
            {
              schluessel: 'zeiten',
              kopf: 'Zeiten',
              numerisch: true,
              zelle: (z) => <span className="tabular-nums">{String(z.zeiten)}</span>,
            },
            {
              schluessel: 'abschluss',
              kopf: 'Abschluss',
              zelle: (z) => (z.offeneZeiten > 0 ? (
                <span className="text-warning">
                  {z.offeneZeiten === 1
                    ? '1 Zeiteintrag ist nicht freigegeben'
                    : `${String(z.offeneZeiten)} Zeiteinträge sind nicht freigegeben`}
                </span>
              ) : (
                <form
                  method="post"
                  action={`/api/stundenkonto/${z.kontoId ?? ''}/monat-abschliessen`}
                >
                  <input type="hidden" name="mandant" value={mandant} />
                  <input type="hidden" name="monat" value={monat} />
                  {/* `secondary`: DESIGN §5 laesst EINE primaere Handlung je
                      Ansicht zu, und eine Tabelle mit vierzehn roten Knoepfen
                      hat keine. */}
                  <Button type="submit" variante="secondary">
                    Abschließen
                  </Button>
                </form>
              )),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}

function Sprung(
  { mandant, ziel, text }: { mandant: string; ziel: string; text: string },
) {
  return (
    <Link
      href={`/portal/${mandant}/personal/stundenkonten/abschluss?monat=${ziel}`}
      className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
    >
      {text}
    </Link>
  );
}
