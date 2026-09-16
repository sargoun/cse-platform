import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { findeRevier, ladeObjektRaeume, mitLesekontext } from '../../../daten';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/reinigung/reviere/[id]/raeume` — Räume zuordnen und die
 * Sollzeit neu rechnen (CLN-01, OPS-02).
 *
 * **Ein bereits zugeordneter Raum steht angehakt und GESPERRT da.** Das ist
 * keine Bequemlichkeit, sondern die Wahrheit über die Wirkung eines Klicks:
 * `revier_raum` steht unter Löschsperre, und kein Quelldokument beschreibt
 * einen Weg, eine Zuordnung wieder zu lösen. Ein Häkchen, das sich abwählen
 * lässt, ohne dass etwas passiert, wäre eine Lüge — und ein Formular, das die
 * Zuordnung kommentarlos behielte, wäre die schlechtere Variante davon.
 *
 * **Räume ohne Belagsart sind sichtbar und zählen nicht mit.** Sie
 * verschwinden nicht aus der Liste — sonst wäre ein Raumbuch-Import mit zehn
 * nicht zugeordneten Zeilen eine Zone, die zu billig kalkuliert ist, ohne dass
 * irgendwo etwas falsch aussieht.
 */
export const dynamic = 'force-dynamic';

export default async function RaeumeZuordnen({
  params,
}: {
  params: Promise<{ mandant: string; id: string }>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/reinigung/reviere/[id]/raeume`);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: die Zone `…/reinigung/reviere/[id]` verlangt laut Manifest
     `reinigung.lesen`, dieses Blatt nur `reinigung.schreiben` — wer nur
     zuordnen darf, sah den Rücksprung zur Zone und „Abbrechen" und bekam
     dahinter ein 404. Ein Verweis auf 404 verraet, was er nicht zeigen darf
     (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'reinigung.lesen');

  const { revier, raeume } = await mitLesekontext(sitzung, async (kontext) => {
    const r = await findeRevier(kontext, id);
    return {
      revier: r,
      raeume: r === null ? [] : await ladeObjektRaeume(kontext, r.objektId, id),
    };
  });
  if (revier === null) notFound();

  const ohneBelagsart = raeume.filter((r) => !r.hatBelagsart).length;

  return (
    <PortalRahmen
      titel="Räume zuordnen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['reinigung.lesen'] === true && (
        <nav aria-label="Zurück" className="mb-s4">
          <Link
            href={`/portal/${mandant}/reinigung/reviere/${id}`}
            className="text-sm text-text-muted underline hover:text-text"
          >
            ← {revier.bezeichnung}
          </Link>
        </nav>
      )}

      <h1 className="mb-s3 text-h1 text-text">Räume zuordnen</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Die ausgewählten Räume bilden die Zone {revier.bezeichnung} im Objekt{' '}
        {revier.objekt}. Mit dem Speichern wird die Sollzeit neu gerechnet:{' '}
        <strong className="text-text">Fläche ÷ Leistungswert je Belagsart</strong>,
        einmal gerundet, und der Kopfwert auf die Räume verteilt.
      </p>

      {ohneBelagsart > 0 && (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
          <Icon name="warnung" groesse="sm" className="mr-s2 inline-block align-[-2px] text-warning" />
          {ohneBelagsart === 1
            ? 'Ein Raum trägt keine Belagsart und geht ohne Zeitanteil ein.'
            : `${String(ohneBelagsart)} Räume tragen keine Belagsart und gehen ohne `
              + 'Zeitanteil ein.'}{' '}
          Ohne Leistungswert gibt es keine Richtzeit — der Raum wird nicht
          stillschweigend mit null Minuten verrechnet.
        </p>
      )}

      <form
        method="post"
        action={`/api/reinigung/reviere/${id}/raeume`}
        className="rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="mandant" value={mandant} />
        <input
          type="hidden"
          name="zurueck"
          value={`/portal/${mandant}/reinigung/reviere/${id}`}
        />

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-s4 text-h3 text-text">
            Räume des Objekts {revier.objekt}
          </legend>
          <ul className="m-0 list-none space-y-s2 p-0">
            {raeume.map((r) => (
              <li key={r.id} className="flex min-h-11 items-center gap-s3">
                {/*
                  `disabled`, NICHT `readOnly`: auf einem Kontrollkästchen tut
                  `readonly` nichts — der Browser lässt es trotzdem abwählen,
                  und das Formular behauptete eine Wirkung, die es nicht gibt.
                  Ein abgeschaltetes Feld wird aber auch nicht abgeschickt,
                  also trägt das versteckte Feld daneben den Wert. Zusammen
                  heisst das: sichtbar gesetzt, nicht abwählbar, und die
                  Zuordnung bleibt im Absenden erhalten.
                */}
                <input
                  type="checkbox"
                  id={`raum-${r.id}`}
                  name={r.zugeordnet ? undefined : 'raum'}
                  value={r.id}
                  defaultChecked={r.zugeordnet}
                  disabled={r.zugeordnet}
                  className="h-5 w-5"
                />
                {r.zugeordnet && <input type="hidden" name="raum" value={r.id} />}
                <label htmlFor={`raum-${r.id}`} className="text-base text-text">
                  {r.nummer ?? '—'}
                  {r.bezeichnung === null ? '' : ` · ${r.bezeichnung}`}
                  <span className="ml-s2 tabular-nums text-text-muted">
                    {r.flaecheQm.replace('.', ',')} m²
                  </span>
                  {!r.hatBelagsart && (
                    <span className="ml-s2 text-warning">ohne Belagsart</span>
                  )}
                  {r.zugeordnet && (
                    <span className="ml-s2 text-text-muted">bereits zugeordnet</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {raeume.length === 0 && (
          <p className="m-0 text-sm text-text-muted">
            Das Raumbuch dieses Objekts ist leer. Ohne Räume gibt es nichts zu
            kalkulieren.
          </p>
        )}

        <div className="mt-s5 flex flex-wrap gap-s3">
          <Button type="submit" variante="primary">
            Zuordnen und neu kalkulieren
          </Button>
          {darf['reinigung.lesen'] === true && (
            <Link
              href={`/portal/${mandant}/reinigung/reviere/${id}`}
              className="inline-flex min-h-11 items-center text-sm text-text-muted underline hover:text-text"
            >
              Abbrechen
            </Link>
          )}
        </div>
      </form>
    </PortalRahmen>
  );
}
