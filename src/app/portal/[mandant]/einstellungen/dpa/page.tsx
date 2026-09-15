import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { AUFTRAGSVERARBEITER } from '@/server/registry/auftragsverarbeiter';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/dpa` — das Verzeichnis der
 * Auftragsverarbeiter (LEG-09, D-04): Dienst, Zweck, Region, Vertrag.
 *
 * Was hier steht, steht in `registry/auftragsverarbeiter.ts` und nirgends
 * sonst; ein Vertragsdatum, das niemand eingetragen hat, ist „nicht
 * hinterlegt" — kein Platzhalter, der wie ein Datum aussieht. Art. 30 DSGVO
 * verlangt das Verzeichnis; diese Seite ist seine lesbare Form, die
 * Entscheidung steht in D-04.
 */
export const dynamic = 'force-dynamic';

export default async function Auftragsverarbeiter(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/dpa`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const ohneVertrag = AUFTRAGSVERARBEITER.filter((v) => v.vertragAm === null).length;

  return (
    <PortalRahmen
      titel="Auftragsverarbeiter"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Auftragsverarbeiter</h1>
      <p data-cse="dpa-zaehler" data-ohne-vertrag={ohneVertrag}
         className={`mb-s5 max-w-prose rounded-lg border p-s4 text-sm ${ohneVertrag > 0
           ? 'border-warning bg-warning-soft text-warning' : 'border-line bg-surface text-text-muted'}`}>
        {ohneVertrag > 0
          ? `${String(ohneVertrag)} von ${String(AUFTRAGSVERARBEITER.length)} Diensten ohne hinterlegtes Vertragsdatum. Die Plattform hält Zeiterfassung, Abwesenheiten und Finanzdaten dreier Gesellschaften — jeder Dienst braucht EU-Region und Vertrag (D-04), und das Datum trägt die Geschäftsführung ein, nicht die Software.`
          : 'Alle Dienste mit Vertrag und EU-Region.'}
      </p>
      <div data-cse="dpa-register">
        <DataTable
          beschriftung="Verzeichnis der Auftragsverarbeiter"
          zeilen={AUFTRAGSVERARBEITER}
          schluessel={(v) => v.schluessel}
          spalten={[
            { schluessel: 'dienst', kopf: 'Dienst', zelle: (v) => v.dienst },
            { schluessel: 'zweck', kopf: 'Zweck', zelle: (v) => v.zweck },
            { schluessel: 'daten', kopf: 'Datenkategorien', zelle: (v) => v.daten },
            { schluessel: 'region', kopf: 'Region', zelle: (v) => v.region },
            { schluessel: 'vertrag', kopf: 'Vertrag',
              zelle: (v) => (v.vertragAm === null
                ? <span className="text-warning">nicht hinterlegt</span>
                : v.vertragAm) },
            { schluessel: 'quelle', kopf: 'Grundlage', zelle: (v) => v.grundlage },
          ]}
        />
      </div>
      <p className="mt-s5 max-w-[72ch] text-sm text-text-subtle">
        Dienste, die noch nicht gewählt sind (SMS, E-Mail, OCR, Karten, Überwachung),
        stehen unter Integrationen mit ihrer offenen Frage — sie kommen hierher, sobald
        ein Vertrag vorliegt.
      </p>
    </PortalRahmen>
  );
}
