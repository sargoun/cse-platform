import Link from 'next/link';
import type { Metadata } from 'next';
import { offeneStellen } from './daten';

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
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Karriere — CSE Gruppe',
  description:
    'Offene Stellen in Gebäudereinigung, Sicherheitsdienst, Bau und '
    + 'Digital Operations. Bewerbung direkt über die Seite.',
};

export default async function KarriereSeite() {
  const stellen = await offeneStellen();

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s6 px-s5 py-s7">
      <header className="flex flex-col gap-s3">
        <h1 className="m-0 text-display text-text">Karriere</h1>
        <p className="m-0 max-w-prose text-base text-text-muted">
          Vier Gesellschaften, ein Bewerbungsweg. An jeder Stelle steht, welche
          Gesellschaft einstellt — mit ihr kommt der Arbeitsvertrag zustande.
        </p>
      </header>

      <section className="flex flex-col gap-s4">
        <h2 className="m-0 text-h2 text-text">
          {stellen.length === 1 ? 'Eine offene Stelle' : `${String(stellen.length)} offene Stellen`}
        </h2>

        {stellen.length === 0 ? (
          <p
            data-cse="keine-stellen"
            className="m-0 max-w-prose rounded-lg border border-line bg-surface p-s5 text-base text-text-muted"
          >
            Zurzeit ist nichts ausgeschrieben. Das heisst nicht, dass wir
            niemanden suchen — schicken Sie uns eine Initiativbewerbung.
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
