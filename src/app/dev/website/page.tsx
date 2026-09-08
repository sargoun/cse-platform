import { devFlaechenAn } from '@/lib/dev-flaechen';
import { notFound } from 'next/navigation';
import { OeffentlicheShell } from '@/components/oeffentlich/OeffentlicheShell';
import { Hero } from '@/components/oeffentlich/Hero';
import { MarkenKarte } from '@/components/oeffentlich/MarkenKarte';
import { PLATZHALTER_BILD } from '@/lib/placeholder-assets';

/**
 * Die oeffentliche Startseite zum Anfassen.
 *
 * Die Inhalte kommen hier aus festen Beispielwerten; in der Anwendung liest
 * `ladeSeite()` sie aus `seite`/`abschnitt` (PUB-07) — eine Textaenderung ist
 * dort ein UPDATE, kein Deployment.
 */
export const dynamic = 'force-static';

const BEREICHE = [
  { slug: 'reinigung', name: 'CSE Dienstleistung', bereich: 'reinigung' as const,
    anspruch: 'Gebäudereinigung in Berlin — Unterhalt, Glas, Bauendreinigung.' },
  { slug: 'security', name: 'SSE Security', bereich: 'security' as const,
    anspruch: 'Objektschutz, Veranstaltungen, Empfang — nach § 34a GewO.' },
  { slug: 'bau', name: 'REALTIME Service', bereich: 'bau' as const,
    anspruch: 'Hochbau, Ausbau, Rückbau — vom Aufmaß bis zur Abnahme.' },
  { slug: 'operations', name: 'CSE Operations', bereich: 'operations' as const,
    anspruch: 'Digitale Abläufe, Auswertung und Gruppensteuerung.' },
];

export default function WebsiteSeite() {
  if (!devFlaechenAn()) notFound();

  return (
    <OeffentlicheShell bereiche={BEREICHE}>
      <Hero
        ueberschrift="Vier Gewerke, eine"
        akzentWort="Gruppe"
        text="Reinigung, Sicherheit und Bau in Berlin — als eigenständige Gesellschaften geführt, auf einer Plattform gesteuert."
        bild={PLATZHALTER_BILD}
      />

      <section className="mx-auto grid max-w-content grid-cols-1 gap-s4 p-s6 sm:grid-cols-2 xl:grid-cols-4">
        {BEREICHE.map((b) => (
          <MarkenKarte
            key={b.slug}
            bereich={b.bereich}
            titel={b.name}
            anspruch={b.anspruch}
            href={`/${b.slug}`}
            bild={PLATZHALTER_BILD}
          />
        ))}
      </section>
    </OeffentlicheShell>
  );
}
