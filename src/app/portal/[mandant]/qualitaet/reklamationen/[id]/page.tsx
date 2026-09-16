import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mitLesekontext } from '../../../reinigung/daten';
import { findeReklamation } from '@/server/services/reinigung/reklamation';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/qualitaet/reklamationen/[id]` — Aufnahme, Ursache,
 * Abstellung, Abschluss (OPS-11).
 *
 * **„Behoben" ohne Maßnahme geht nicht** — der Dienst weist es ab und die
 * Datenbank ein zweites Mal (`rk_behoben_hat_massnahme`). Eine Beanstandung,
 * die als erledigt gilt, ohne dass jemand aufgeschrieben hat, was getan wurde,
 * ist im Wiederholungsfall wertlos: der dritte Vorfall wäre dann der erste,
 * über den etwas geschrieben steht.
 *
 * **Die Nacharbeitsschicht wird als id eingetragen, nicht als Text.** Die
 * Schicht, nicht die Person: wer nacharbeitet, kann wechseln; dass an diesem
 * Tag auf diesem Objekt nachgearbeitet wurde, bleibt.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  behoben: 'Bereit',
  abgelehnt: 'Abgelehnt',
  geschlossen: 'Abgeschlossen',
};

const ZUSTAENDE: readonly (readonly [string, string])[] = [
  ['offen', 'Offen'],
  ['in_arbeit', 'In Arbeit'],
  ['behoben', 'Behoben (Maßnahme ist Pflicht)'],
  ['abgelehnt', 'Abgelehnt'],
  ['geschlossen', 'Geschlossen'],
];

export default async function ReklamationsBlatt({
  params,
}: {
  params: Promise<{ mandant: string; id: string }>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/qualitaet/reklamationen/[id]`);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: der Nachweis `…/reinigung/leistungsnachweise/[id]` verlangt laut
     Manifest `nachweis.lesen`, die Schicht `…/dienstplan/einsatz/[id]`
     `dienstplan.lesen` — dieses Blatt nur `qualitaet.lesen`. Wer eines der
     beiden nicht hält, sah den Verweis und bekam dahinter ein 404; ein Verweis
     auf 404 verraet, was er nicht zeigen darf (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'nachweis.lesen', 'dienstplan.lesen');

  const zeile = await mitLesekontext(sitzung, async (k) => findeReklamation(k, id));
  // AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten.
  if (zeile === null) notFound();

  return (
    <PortalRahmen
      titel={zeile.nummer}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="qualitaet"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s4">
        <Link
          href={`/portal/${mandant}/qualitaet/reklamationen`}
          className="text-sm text-text-muted underline hover:text-text"
        >
          ← Alle Reklamationen
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{zeile.nummer}</h1>
        <StatusPill zustand={PILLE[zeile.status] ?? 'Offen'} />
      </div>

      <Card className="mb-s5">
        <dl className="grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">Objekt</dt>
            <dd className="m-0 text-base text-text">{zeile.objekt ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">Kunde</dt>
            <dd className="m-0 text-base text-text">{zeile.kunde ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">
              Eingang (Serverzeit, Berlin)
            </dt>
            <dd className="m-0 text-base tabular-nums text-text">{zeile.eingangAmLokal}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">Frist</dt>
            <dd className="m-0 text-base text-text">
              {zeile.faelligAmLokal ?? 'offen (O-14)'}
            </dd>
          </div>
        </dl>

        <p className="mt-s4 mb-0 max-w-prose text-base text-text">{zeile.beschreibung}</p>

        <div className="mt-s4 flex flex-wrap gap-s4 border-t border-line pt-s4 text-sm">
          <p className="m-0 text-text-muted">
            <Icon name="dokument" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
            Bestrittener Nachweis:{' '}
            {zeile.leistungsnachweisId === null ? (
              'keiner'
            ) : darf['nachweis.lesen'] === true ? (
              <Link
                href={`/portal/${mandant}/reinigung/leistungsnachweise/${zeile.leistungsnachweisId}`}
                className="underline hover:text-text"
              >
                {zeile.leistungsnachweisNummer ?? 'Nachweis öffnen'}
              </Link>
            ) : (
              zeile.leistungsnachweisNummer ?? '—'
            )}
          </p>
          <p className="m-0 text-text-muted">
            <Icon name="dienstplan" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
            Nacharbeit:{' '}
            {zeile.nacharbeitEinsatzId === null ? (
              'noch keine Schicht hinterlegt'
            ) : darf['dienstplan.lesen'] === true ? (
              <Link
                href={`/portal/${mandant}/dienstplan/einsatz/${zeile.nacharbeitEinsatzId}`}
                className="underline hover:text-text"
              >
                Schicht vom {zeile.nacharbeitDatum ?? '—'}
              </Link>
            ) : (
              `Schicht vom ${zeile.nacharbeitDatum ?? '—'}`
            )}
          </p>
        </div>
      </Card>

      <h2 className="mb-s3 text-h3 text-text">Abstellung</h2>
      <form
        method="post"
        action="/api/qualitaet/reklamationen"
        className="rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="mandant" value={mandant} />
        <input type="hidden" name="reklamation" value={id} />
        <input
          type="hidden"
          name="zurueck"
          value={`/portal/${mandant}/qualitaet/reklamationen/${id}`}
        />

        <div className="grid grid-cols-1 gap-s4 md:grid-cols-2">
          <div>
            <label htmlFor="status" className="mb-s2 block text-sm text-text">Zustand</label>
            <select
              id="status"
              name="status"
              defaultValue={zeile.status}
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            >
              {ZUSTAENDE.map(([wert, text]) => (
                <option key={wert} value={wert}>{text}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nacharbeit" className="mb-s2 block text-sm text-text">
              Nacharbeitsschicht (Einsatz-ID)
            </label>
            <input
              id="nacharbeit"
              name="nacharbeit"
              defaultValue={zeile.nacharbeitEinsatzId ?? ''}
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
        </div>

        <div className="mt-s4">
          <label htmlFor="ursache" className="mb-s2 block text-sm text-text">Ursache</label>
          <textarea
            id="ursache"
            name="ursache"
            rows={3}
            className="w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
          />
        </div>

        <div className="mt-s4">
          <label htmlFor="massnahme" className="mb-s2 block text-sm text-text">
            Abstellmaßnahme — Pflicht, sobald der Zustand „Behoben" ist
          </label>
          <textarea
            id="massnahme"
            name="massnahme"
            rows={3}
            defaultValue={zeile.massnahme ?? ''}
            className="w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
          />
        </div>

        <div className="mt-s5">
          <Button type="submit" variante="primary">Speichern</Button>
        </div>
      </form>
    </PortalRahmen>
  );
}
