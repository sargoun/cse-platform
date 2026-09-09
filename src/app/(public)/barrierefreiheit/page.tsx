import type { Metadata } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { bereicheLesen, oeffentlichLesen } from '@/server/inhalt/lesen';

/**
 * Die Barrierefreiheitserklaerung (LEG-07, PUB-09).
 *
 * **Warum diese Seite Code ist und kein `seite`-Datensatz.** Sie ist keine
 * Werbeseite, sondern eine rechtlich verlangte Erklaerung. Als
 * CMS-Inhalt liesse sie sich ohne Pruefung aendern oder loeschen — und eine
 * geloeschte Barrierefreiheitserklaerung faellt niemandem auf, bis sie
 * gebraucht wird.
 *
 * **Was hier NICHT steht: eine Konformitaetsaussage.** "Vollstaendig
 * konform", "teilweise konform" — das ist eine rechtliche Erklaerung des
 * Betreibers, die eine tatsaechliche Pruefung voraussetzt. Sie zu erfinden
 * waere schlimmer als sie wegzulassen: eine falsche Konformitaetsaussage ist
 * eine falsche Zusage an genau die Menschen, die sich darauf verlassen. Der
 * Abschnitt ist deshalb sichtbar als offen gekennzeichnet.
 *
 * // TODO(client): O-205 — Konformitätsstatus (vollständig / teilweise /
 * // nicht konform), benannte Stelle für Feedback und Durchsetzungsverfahren,
 * // sowie das Datum der Erstprüfung. Ohne diese drei Angaben ist die
 * // Erklärung nach BFSG unvollständig.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  return {
    title: 'Barrierefreiheit',
    description: 'Erklärung zur Barrierefreiheit dieser Website.',
    alternates: { canonical: `${basis}/barrierefreiheit` },
  };
}

export default async function Barrierefreiheit() {
  const bereiche = await oeffentlichLesen(bereicheLesen);
  const kontakt = bereiche.find((b) => b.email !== null && b.email !== '');

  return (
    <article className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s6">
      <h1 className="text-h1 text-text">Erklärung zur Barrierefreiheit</h1>

      <section className="flex flex-col gap-s2">
        <h2 className="text-h2 text-text">Angestrebter Standard</h2>
        <p className="text-base text-text-muted">
          Diese Website wird nach den Web Content Accessibility Guidelines 2.1
          auf Stufe AA entwickelt. Das ist der Maßstab, den das
          Barrierefreiheitsstärkungsgesetz für verbraucherorientierte Angebote
          anlegt.
        </p>
      </section>

      <section className="flex flex-col gap-s2">
        <h2 className="text-h2 text-text">Wie geprüft wird</h2>
        <p className="text-base text-text-muted">
          Jede öffentliche Seite wird bei jeder Änderung automatisiert gegen die
          Regeln von axe-core geprüft; ein Verstoß hält die Auslieferung an.
          Zusätzlich wird jede Seite ausschließlich mit der Tastatur bedient und
          dabei geprüft, ob jedes bedienbare Element erreichbar ist und einen
          sichtbaren Fokusrahmen zeigt.
        </p>
        <p className="text-base text-text-muted">
          Automatisierte Prüfungen finden nicht alles. Sie ersetzen keine
          Prüfung durch Menschen, die auf Hilfsmittel angewiesen sind.
        </p>
      </section>

      {/* Sichtbar offen, nicht stillschweigend erfunden. */}
      <section
        data-cse="offener-punkt"
        className="flex flex-col gap-s2 rounded-lg border border-warning bg-warning-soft p-s5"
      >
        <h2 className="text-h2 text-text">Noch nicht abgegeben</h2>
        <p className="text-base text-text">
          Die verbindliche Angabe zum Konformitätsstatus, die Benennung der
          zuständigen Durchsetzungsstelle und das Datum der Erstprüfung stehen
          noch aus. Sie werden ergänzt, sobald die Prüfung abgeschlossen ist.
          Bis dahin steht hier bewusst keine Aussage, die noch nicht belegt ist.
        </p>
      </section>

      <section className="flex flex-col gap-s2">
        <h2 className="text-h2 text-text">Barriere melden</h2>
        <p className="text-base text-text-muted">
          Wenn Ihnen eine Barriere auffällt, melden Sie sie bitte — auch
          formlos. Wir antworten und beheben, was wir beheben können.
        </p>
        {kontakt === undefined ? (
          <p className="text-base text-text">
            Ein Meldeweg ist derzeit nicht hinterlegt.
          </p>
        ) : (
          <p className="text-base text-text">
            <a className="underline" href={`mailto:${kontakt.email ?? ''}`}>
              {kontakt.email}
            </a>
            {kontakt.telefon !== null && <> · Telefon {kontakt.telefon}</>}
          </p>
        )}
      </section>
    </article>
  );
}
