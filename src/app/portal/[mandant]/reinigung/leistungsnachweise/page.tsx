import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mitLesekontext } from '../daten';
import { listeNachweise, type NachweisKopf }
  from '@/server/services/reinigung/leistungsnachweis';

/**
 * `/portal/[mandant]/reinigung/leistungsnachweise` — die Nachweise (CLN-04).
 *
 * **Die Pille kommt aus dem geschlossenen Vokabular von DESIGN §5**, und zwei
 * Zustände finden darin kein eigenes Wort: `signiert` steht als
 * „Abgeschlossen" und `storniert` als „Archiviert". Das ist bewusst und nicht
 * schön: `02-datenmodell/03-GEWERKE.md` §3.5 beantragt für beide eine eigene
 * Zeile in DESIGN §5 (plus „Behoben", „Geschlossen" und „Unbestätigter
 * Wert"). Solange der Antrag offen ist, wird hier auf das vorhandene
 * Vokabular abgebildet statt ein Wort zu erfinden, das die Plattform sonst
 * nirgends kennt — eine Pille mit freiem Text wäre genau die Öffnung, die §5
 * verschliesst.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  vorgelegt: 'Wartet',
  signiert: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
  storniert: 'Archiviert',
};

export default async function NachweisListe({
  params,
}: {
  params: Promise<{ mandant: string }>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/reinigung/leistungsnachweise`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const nachweise = await mitLesekontext(sitzung, async (k) => listeNachweise(k));
  const offen = nachweise.filter((n) => n.status === 'vorgelegt').length;
  const signiert = nachweise.filter((n) => n.status === 'signiert').length;

  return (
    <PortalRahmen
      titel="Leistungsnachweise"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Leistungsnachweise</h1>
        <Link href={`/portal/${mandant}/reinigung/leistungsnachweise/neu`} className="text-sm underline hover:text-text">
          Neuen Nachweis anlegen
        </Link>
      </div>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <KpiStat label="Nachweise" wert={String(nachweise.length)} icon="dokument" ton="info" />
        <KpiStat
          label="Beim Kunden"
          wert={String(offen)}
          icon="uhr"
          ton={offen === 0 ? 'muted' : 'warning'}
        />
        <KpiStat label="Unterschrieben" wert={String(signiert)} icon="ok" ton="success" />
      </div>

      {nachweise.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Nachweis erfasst. Der Nachweis ist das Dokument, das der Kunde
          vor Ort unterschreibt — und aus dem später eine Rechnung abgeleitet wird.
        </p>
      ) : (
        <DataTable<NachweisKopf>
          beschriftung="Leistungsnachweise mit Zeitraum, Kunde und Zustand"
          zeilen={nachweise}
          schluessel={(n) => n.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (n) => (
                <Link href={`/portal/${mandant}/reinigung/leistungsnachweise/${n.id}`} className="underline hover:text-text">
                  {n.nummer ?? 'ohne Nummer'}
                </Link>
              ),
            },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (n) => n.kunde },
            { schluessel: 'objekt', kopf: 'Objekt', zelle: (n) => n.objekt ?? '—' },
            {
              schluessel: 'zeitraum',
              kopf: 'Leistungszeitraum',
              zelle: (n) => `${n.leistungszeitraumVon} – ${n.leistungszeitraumBis}`,
            },
            {
              schluessel: 'status',
              kopf: 'Zustand',
              zelle: (n) => <StatusPill zustand={PILLE[n.status] ?? 'Entwurf'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
