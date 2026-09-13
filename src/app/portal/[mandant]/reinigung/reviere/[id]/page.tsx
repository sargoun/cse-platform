import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  findeRevier, ladeZugeordneteRaeume, mitLesekontext, type RevierRaumZeile,
} from '../../daten';

/**
 * `/portal/[mandant]/reinigung/reviere/[id]` — eine Zone und ihr Rechenweg
 * (CLN-01, OPS-03, OPS-07, K-16(c)).
 *
 * **Die Seite zeigt den Rechenweg, nicht nur das Ergebnis.** Je Raum stehen
 * die Fläche und der Leistungswert, mit denen gerechnet wurde — beides
 * SCHNAPPSCHÜSSE vom Kalkulationszeitpunkt, nicht der heutige Katalogwert. Nur
 * so lässt sich ein abgegebenes Angebot Monate später nachrechnen; ein
 * nachgezogener Wert machte genau das unmöglich, und zwar rückwirkend und
 * lautlos.
 *
 * **Die Zeile „Summe" unten ist die Probe.** Sie muss exakt die Sollzeit des
 * Kopfes ergeben. Tut sie es nicht, ist zwischen den beiden Trägern zweimal
 * gerundet worden — ein Fehler, der keine Ausnahme wirft und sich nur so
 * zeigt.
 */
export const dynamic = 'force-dynamic';

function deutsch(wert: string | null): string {
  return wert === null ? '—' : wert.replace('.', ',');
}

export default async function RevierBlatt({
  params,
}: {
  params: Promise<{ mandant: string; id: string }>;
}) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/reinigung/reviere/[id]`);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const { revier, raeume } = await mitLesekontext(sitzung, async (kontext) => ({
    revier: await findeRevier(kontext, id),
    raeume: await ladeZugeordneteRaeume(kontext, id),
  }));
  // AUT-06: eine fremde Zone ist nicht vorhanden, nicht verboten.
  if (revier === null) notFound();

  const stimmt = revier.summeRaeume === null
    ? raeume.length === 0
    : revier.summeRaeume === revier.sollzeitMinuten;

  return (
    <PortalRahmen
      titel={revier.bezeichnung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s4">
        <Link
          href={`/portal/${mandant}/reinigung/reviere`}
          className="text-sm text-text-muted underline hover:text-text"
        >
          ← Alle Reviere
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{revier.bezeichnung}</h1>
        <p className="m-0 text-sm text-text-muted">
          {revier.objekt}
          {revier.kurzzeichen !== null && ` · ${revier.kurzzeichen}`}
        </p>
      </div>

      <div className="mb-s5 grid grid-cols-1 gap-s4 md:grid-cols-2">
        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Sollzeit je Durchgang — berechneter Zielwert
          </div>
          <div className="mt-s1 text-h2 tabular-nums text-text">
            {deutsch(revier.sollzeitMinuten)} Min.
          </div>
          <p className="mt-s3 m-0 text-sm text-text-muted">
            Aus Fläche ÷ Leistungswert. <strong className="text-text">Keine gemessene
            Dauer</strong> — gearbeitete Minuten sind ganzzahlig und stehen im
            Zeitbereich.
          </p>
        </Card>
        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Summe der Räume
          </div>
          <div
            className={`mt-s1 text-h2 tabular-nums ${stimmt ? 'text-text' : 'text-danger'}`}
          >
            {deutsch(revier.summeRaeume)} Min.
          </div>
          <p className="mt-s3 m-0 text-sm text-text-muted">
            {stimmt ? (
              <>
                <Icon
                  name="ok"
                  groesse="sm"
                  className="mr-s2 inline-block align-[-2px] text-success"
                />
                Stimmt mit dem Kopf überein — zwischen beiden wurde nicht zweimal
                gerundet.
              </>
            ) : (
              <>
                <Icon
                  name="warnung"
                  groesse="sm"
                  className="mr-s2 inline-block align-[-2px] text-danger"
                />
                Weicht vom Kopf ab. Die Zone bitte neu kalkulieren — die Zahlen
                stammen aus zwei verschiedenen Läufen.
              </>
            )}
          </p>
        </Card>
      </div>

      <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
        <h2 className="m-0 text-h3 text-text">Räume</h2>
        <Link href={`/portal/${mandant}/reinigung/reviere/${id}/raeume`} className="text-sm underline hover:text-text">
          Räume zuordnen und neu kalkulieren
        </Link>
      </div>

      {raeume.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Dieser Zone ist noch kein Raum zugeordnet. Bis dahin ist die Sollzeit
          oben ein gesetzter, kein gerechneter Wert.
        </p>
      ) : (
        <DataTable<RevierRaumZeile>
          beschriftung="Räume der Zone mit Fläche, Leistungswert und Zeitanteil"
          zeilen={raeume}
          schluessel={(r) => r.raumId}
          spalten={[
            {
              schluessel: 'raum',
              kopf: 'Raum',
              zelle: (r) => `${r.raumnummer ?? '—'}${r.bezeichnung === null ? '' : ` · ${r.bezeichnung}`}`,
            },
            { schluessel: 'etage', kopf: 'Etage', zelle: (r) => r.etage ?? '—' },
            {
              schluessel: 'flaeche',
              kopf: 'Fläche (m², Stand Kalkulation)',
              numerisch: true,
              zelle: (r) => deutsch(r.flaecheQm),
            },
            {
              schluessel: 'lw',
              kopf: 'Leistungswert (m²/h, Stand Kalkulation)',
              numerisch: true,
              zelle: (r) => deutsch(r.leistungswert),
            },
            {
              schluessel: 'anteil',
              kopf: 'Zeitanteil (Min.)',
              numerisch: true,
              zelle: (r) => deutsch(r.sollzeitMinuten),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
