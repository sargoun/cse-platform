import Link from 'next/link';
import type { Metadata } from 'next';
import { Hinweis } from '@/components/ui/Hinweis';
import { bereiche, offeneStellen } from './daten';
import { bewerbungsMeldung } from './meldung';

/**
 * `/karriere` — die offenen Stellen der Gruppe (REC-03).
 *
 * **Vier Gesellschaften, eine Seite.** Wer Arbeit sucht, sucht Arbeit und
 * nicht eine Rechtsform: die Liste zeigt jede offene Stelle aller vier
 * Bereiche und nennt an jeder Zeile, welche Gesellschaft einstellt — die
 * Angabe zählt, weil der Arbeitsvertrag mit ihr zustande kommt (D-09).
 *
 * **Was hier NICHT steht, ist die halbe Zusage.** Ein Entwurf ist auf dieser
 * Seite null Zeilen; die Policy `t_stelle_oeffentlich` (0166) lässt
 * ausschliesslich veröffentlichte, nicht geschlossene Stellen durch. Eine
 * Anzeige, die versehentlich öffentlich wurde, holt niemand zurück.
 *
 * **Keine offene Stelle ist eine Auskunft**, kein leerer Bildschirm: die
 * Initiativbewerbung steht deshalb immer da, und nicht nur dann, wenn nichts
 * ausgeschrieben ist.
 *
 * **Der Bereichsfilter steht in der Adresse** (`?bereich=<slug>`, V-364): ein
 * Verweis je Gesellschaft, kein Skript — die Auswahl lässt sich teilen und
 * zurückblättern. Ein unbekannter Bereich zeigt alle Stellen, eine leere
 * Auswahl sagt es in einem Satz.
 *
 * TODO(client, O-38): Voreinstellung — eine Karriereseite der Gruppe mit
 * Bereichsfilter (SEITENKARTE); gebaut mit V-364, jede Karte nennt weiter die
 * Gesellschaft. D-797, D-806.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Karriere — CSE Gruppe',
  description:
    'Offene Stellen in Gebäudereinigung, Sicherheitsdienst, Bau und '
    + 'Digital Operations. Bewerbung direkt über die Seite.',
};

export default async function KarriereSeite(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const gesellschaften = await bereiche();
  const gewaehlt = typeof suche['bereich'] === 'string'
    ? gesellschaften.find((g) => g.slug === suche['bereich']) ?? null : null;
  const stellen = await offeneStellen(gewaehlt?.slug ?? null);
  const filterKlasse = 'inline-flex min-h-11 items-center rounded-md border border-line px-s4 '
    + 'text-sm text-text hover:bg-surface-3';
  /*
   * V-158: eine Bewerbung auf eine Stelle, die inzwischen geschlossen ist,
   * landet hier — mit einem Satz, statt `{"fehler":"nicht_gefunden"}` auf
   * weissem Grund. Das Stellenblatt selbst wäre dafür der falsche Ort: es
   * antwortet für eine geschlossene Stelle mit 404.
   */
  const meldung = bewerbungsMeldung((await searchParams)['fehler']);

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s6 px-s5 py-s7">
      <header className="flex flex-col gap-s3">
        <h1 className="m-0 text-display text-text">Karriere</h1>
        <p className="m-0 max-w-prose text-base text-text-muted">
          Vier Gesellschaften, ein Bewerbungsweg. An jeder Stelle steht, welche
          Gesellschaft einstellt — mit ihr kommt der Arbeitsvertrag zustande.
        </p>
      </header>

      {meldung !== undefined && (
        <Hinweis art="warnung" rolle="alert" cse="bewerbung-meldung" className="max-w-[72ch]">
          {meldung}
        </Hinweis>
      )}

      <nav aria-label="Stellen nach Gesellschaft" data-cse="bereichsfilter">
        <ul className="m-0 flex list-none flex-wrap gap-s2 p-0">
          <li>
            <Link href="/karriere" data-cse="bereich-filter" data-bereich=""
                  aria-current={gewaehlt === null ? 'page' : undefined}
                  className={`${filterKlasse}${gewaehlt === null ? ' bg-surface-3 font-semibold' : ''}`}>
              Alle Gesellschaften
            </Link>
          </li>
          {gesellschaften.map((g) => (
            <li key={g.slug}>
              <Link href={`/karriere?bereich=${g.slug}`} data-cse="bereich-filter" data-bereich={g.slug}
                    aria-current={gewaehlt?.slug === g.slug ? 'page' : undefined}
                    className={`${filterKlasse}${gewaehlt?.slug === g.slug ? ' bg-surface-3 font-semibold' : ''}`}>
                {g.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section className="flex flex-col gap-s4">
        <h2 className="m-0 text-h2 text-text">
          {stellen.length === 1 ? 'Eine offene Stelle' : `${String(stellen.length)} offene Stellen`}
        </h2>

        {stellen.length === 0 ? (
          <p
            data-cse="keine-stellen"
            className="m-0 max-w-prose rounded-lg border border-line bg-surface p-s5 text-base text-text-muted"
          >
            {gewaehlt === null
              ? 'Zurzeit ist nichts ausgeschrieben. Das heisst nicht, dass wir niemanden '
                + 'suchen — schicken Sie uns eine Initiativbewerbung.'
              : `Bei ${gewaehlt.name} ist zurzeit nichts ausgeschrieben. Die übrigen `
                + 'Gesellschaften stehen unter „Alle Gesellschaften", und eine '
                + 'Initiativbewerbung nehmen wir jederzeit entgegen.'}
          </p>
        ) : (
          <ul data-cse="stellenliste" className="m-0 grid list-none grid-cols-1 gap-s4 p-0 md:grid-cols-2">
            {stellen.map((s) => (
              <li
                key={s.id}
                data-cse="stelle"
                data-bereich={s.mandantSlug}
                className="flex flex-col gap-s2 rounded-lg border border-line bg-surface p-s5"
              >
                <span className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                  {s.mandantName}
                </span>
                <h3 className="m-0 text-h3 text-text">
                  <Link href={`/karriere/${s.id}`} className="underline-offset-2 hover:underline">
                    {s.titel}
                  </Link>
                </h3>
                <p className="m-0 text-sm text-text-muted">
                  {[s.einsatzort, s.wochenstunden === null ? null
                    : `${s.wochenstunden.replace('.', ',')} h/Woche`]
                    .filter((t) => t !== null).join(' · ') || 'Ort und Umfang nach Absprache'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
        <h2 className="m-0 text-h3 text-text">Nichts Passendes dabei?</h2>
        <p className="m-0 max-w-prose text-base text-text-muted">
          Wir nehmen Initiativbewerbungen entgegen und melden uns, wenn eine
          Stelle dazu passt.
        </p>
        <Link
          href="/karriere/initiativbewerbung"
          data-cse="zu-initiativ"
          className="inline-flex min-h-11 w-fit items-center rounded-md bg-brand px-s5 text-base text-white hover:bg-brand-hover"
        >
          Initiativ bewerben
        </Link>
      </section>
    </main>
  );
}
