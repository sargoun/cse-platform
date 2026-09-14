import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { alleAbrechnungsarten } from '@/server/services/finanz/abrechnungsart/index';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/einstellungen/abrechnungsarten` — die fünf
 * Abrechnungsarten und ihre Parameter (FIN-01, O-04).
 *
 * **Jede Art trägt hier die Marke „provisorisch", und das ist der Kern der
 * Seite.** Die fünf NAMEN stehen in SPEC FIN-01; ihre REGELN — Rundung,
 * Teilmonat, Teilfertigstellung, abrechenbare Aufmaßzustände, Mindestabruf —
 * hat niemand bestätigt. Eine Liste ohne diese Marke behauptete, jemand hätte
 * sie bestätigt, und die nächste Person übernähme sie als gegeben.
 *
 * Die Seite ist eine ÜBERSICHT und kein Formular: die Regeln werden nicht
 * global gesetzt, sondern je Vertrag, weil sie je Vertrag verhandelt werden.
 * Der Weg dorthin steht daneben.
 *
 * // TODO(client, O-04): sind dies exakt die fünf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestätigen.
 */
export const dynamic = 'force-dynamic';

export default async function Abrechnungsarten(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/einstellungen/abrechnungsarten`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  if (zugang.sitzung.aktiverMandantId === null) notFound();

  const arten = alleAbrechnungsarten();

  return (
    <PortalRahmen
      titel="Abrechnungsarten"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Abrechnungsarten</h1>

      {/*
        * Die offene Frage steht VOR der Liste und nicht als Fussnote: wer die
        * fuenf Arten hier liest, soll wissen, dass ihre Regeln unbestaetigt
        * sind, bevor er sie einem Vertrag zuordnet.
        */}
      <p className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
        Unbestätigter Wert: die fünf Namen stammen aus der Leistungs­beschreibung,
        ihre Regeln sind noch nicht bestätigt (O-04). Jede Art rechnet erst,
        wenn der zugehörige Parameter im Vertrag hinterlegt ist — bis dahin
        weist die Abrechnung mit benanntem Grund ab und rät nichts.
      </p>

      <div className="grid grid-cols-1 gap-s4 lg:grid-cols-2">
        {arten.map((art) => (
          <section
            key={art.schluessel}
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <div className="mb-s2 flex flex-wrap items-baseline justify-between gap-s2">
              <h2 className="text-h3 text-text">{art.bezeichnung}</h2>
              {/*
                * Die Pille traegt das FESTE Vokabular aus DESIGN §5 — „provi'
                * sorisch" steht nicht darin und wird hier nicht erfunden. Das
                * Wort steht als Text daneben, wo es hingehoert.
                */}
              {art.istProvisorisch ? (
                <span className="flex items-center gap-s2">
                  <StatusPill zustand="Entwurf" />
                  <span className="text-xs text-warning">provisorisch (O-04)</span>
                </span>
              ) : null}
            </div>
            <p className="mb-s4 text-xs text-text-subtle">
              <code>{art.schluessel}</code>
            </p>

            {art.offeneParameter.length === 0 ? (
              <p className="text-sm text-text-muted">
                Ohne offene Parameter.
              </p>
            ) : (
              <dl className="space-y-s3">
                {art.offeneParameter.map((p) => (
                  <div key={p.schluessel}>
                    <dt className="text-sm text-text">
                      <code>{p.schluessel}</code>
                      <span className="ml-s2 text-xs text-text-subtle">{p.offeneFrage}</span>
                    </dt>
                    <dd className="text-sm text-text-muted">
                      {p.frage}
                      {p.werte === null ? null : (
                        <span className="block text-xs text-text-subtle">
                          zulässig: {p.werte.join(' · ')}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        ))}
      </div>

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Die Abrechnungsart wird je Auftrag gesetzt und gilt für einen Zeitraum —
        ein Vertrag, der zum 1. Januar von Stundenlohn auf Monatspauschale
        wechselt, bekommt eine zweite Zeile und keine überschriebene. Der Weg
        dorthin führt über den{' '}
        <Link
          href={`/portal/${mandant}/auftraege`}
          className="text-text underline-offset-2 hover:text-brand hover:underline"
        >
          Auftrag
        </Link>
        .
      </p>
    </PortalRahmen>
  );
}
