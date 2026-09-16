import Link from 'next/link';
import { KachelRaster } from '@/components/portal/KachelRaster';
import { Hinweis } from '@/components/ui/Hinweis';
import { listeStellen, listeBewerbungen, aufbewahrungTage } from '@/server/services/recruiting/dienst';
import { RecruitingSeite, leseImMandanten } from './rahmen';

/**
 * `/portal/[mandant]/recruiting` — die Übersicht (REC-01).
 *
 * **Vier Zahlen und ein Satz, der eine Frist nennt.** Die Zahlen sind Bestand,
 * kein Urteil: „12 offene Bewerbungen" sagt, wie viel Arbeit liegt, und nicht,
 * wie gut jemand ist. Die Frist steht hier, weil sie die einzige Zahl auf
 * dieser Seite ist, die etwas LÖSCHT (REC-07) — und weil sie ein Platzhalter
 * ist (O-373), steht das daneben.
 */
export const dynamic = 'force-dynamic';

export default async function Uebersicht(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad=""
      titel="Recruiting"
      kinder={async (zugang) => {
        const d = await leseImMandanten(zugang, async (kontext) => ({
          stellen: await listeStellen(kontext),
          bewerbungen: await listeBewerbungen(kontext),
          tage: await aufbewahrungTage(kontext),
        }));
        const offen = d.bewerbungen.filter(
          (b) => b.status === 'eingegangen' || b.status === 'in_pruefung');
        const veroeffentlicht = d.stellen.filter((s) => s.status === 'veroeffentlicht');
        const entwuerfe = d.stellen.filter((s) => s.status === 'entwurf');
        const entschieden = d.bewerbungen.filter((b) => b.entschiedenAm !== null);

        return (
          <>
            <h1 className="mb-s5 text-h1 text-text">Recruiting</h1>
            <KachelRaster
              kacheln={[
                { schluessel: 'veroeffentlicht', label: 'Veröffentlichte Stellen',
                  wert: veroeffentlicht.length, ton: 'info', icon: 'dokument',
                  ziel: `/portal/${mandant}/recruiting/stellen` },
                { schluessel: 'entwuerfe', label: 'Stellenentwürfe',
                  wert: entwuerfe.length, ton: 'muted', icon: 'stift',
                  ziel: `/portal/${mandant}/recruiting/stellen` },
                { schluessel: 'offen', label: 'Offene Bewerbungen',
                  wert: offen.length, ton: offen.length > 0 ? 'warning' : 'muted',
                  icon: 'person',
                  ziel: `/portal/${mandant}/recruiting/bewerbungen` },
                { schluessel: 'entschieden', label: 'Entschieden',
                  wert: entschieden.length, ton: 'success', icon: 'ok',
                  ziel: `/portal/${mandant}/recruiting/kandidaten` },
              ]}
            />

            <h2 className="mb-s3 mt-s6 text-h3 text-text">Zuletzt eingegangen</h2>
            {offen.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Keine offene Bewerbung. Was über das Karriereformular eingeht,
                erscheint hier — ohne Vorsortierung durch eine Maschine
                (LEG-12).
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-s2 p-0">
                {offen.slice(0, 8).map((b) => (
                  <li key={b.id}
                      className="rounded-lg border border-line bg-surface p-s4">
                    <Link
                      href={`/portal/${mandant}/recruiting/bewerbungen/${b.id}`}
                      className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                    >
                      {b.name}
                    </Link>
                    <span className="ml-s3 text-sm text-text-muted">
                      {b.stelleTitel ?? 'Initiativbewerbung'}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <Hinweis art="hinweis" cse="rec-frist" className="mt-s6 max-w-prose">
              <strong>Aufbewahrung: {String(d.tage)} Tage ab Eingang.</strong>{' '}
              Danach löscht der Nachtlauf die Bewerbung endgültig (REC-07).
              Die Zahl ist ein <strong>Platzhalter</strong> und steht als O-373
              offen — sie ist über eine Zeile änderbar, ohne Code.{' '}
              <Link
                href={`/portal/${mandant}/recruiting/datenschutz`}
                className="underline decoration-line underline-offset-4 hover:decoration-current"
              >
                Was wann fällig wird
              </Link>
            </Hinweis>
          </>
        );
      }}
    />
  );
}
