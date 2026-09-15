import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';
import { leseMappe, lesePlattformwahl, type MappenBlick } from '../daten';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/radar/[id]/mappe/einreichung` — festhalten, dass ein
 * Mensch eingereicht hat (RAD-07, D-07, REP-06).
 *
 * **Diese Seite reicht nichts ein.** Sie ist ein Protokoll. Die deutschen
 * Vergabeplattformen bieten keine Schnittstelle für eine Abgabe an; eine
 * Automatik zu bauen, hiesse sie zu erfinden, und ein Knopf „jetzt
 * einreichen" wäre eine Lüge mit Folgen — jemand würde sich darauf verlassen
 * und die Frist verpassen.
 *
 * **Wer eingereicht hat, steht nicht im Formular.** Die Person kommt aus der
 * Sitzung. Ein Feld „eingereicht von" liesse jemanden für einen Kollegen
 * unterschreiben; die Datenbank weist das zurück
 * (`kern.unterschrift_ist_die_eigene`), und das Formular fragt erst gar nicht
 * danach.
 *
 * **Der Zeitpunkt kommt aus der Datenbank** (Invariante 5). Ein Rechner, der
 * zwei Stunden falsch geht, würde sonst eine Abgabe vor der Frist bezeugen,
 * die nach ihr lag.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short',
});

const FEHLER_TEXT: Readonly<Record<string, string>> = {
  plattform: 'Zu einer Einreichung gehört die Plattform, über die sie lief — aus dem Katalog oder im Klartext.',
  stand: 'Diese Mappe lässt sich nicht als eingereicht erfassen: sie ist bereits erfasst oder verworfen.',
  recht: 'Dafür fehlt das Recht vergabe.einreichung_erfassen.',
};

export default async function Einreichung(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/radar/${id}/mappe/einreichung`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const mappe = await leseMappe(kontext, id);
      if (mappe === null) return null;
      return { mappe, plattformen: await lesePlattformwahl(kontext) };
    })) as Promise<{
      mappe: MappenBlick;
      plattformen: readonly { readonly id: string; readonly name: string }[];
    } | null>);

  if (daten === null) notFound();
  const { mappe: m, plattformen } = daten;
  const offen = m.pflichtGesamt - m.pflichtErledigt;

  return (
    <PortalRahmen
      titel="Einreichung erfassen"
      wurzelTitel="Radar"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="text-h1 text-text">Einreichung erfassen</h1>
          <p className="mt-s2 max-w-prose text-sm text-text-muted">{m.titel}</p>
        </div>
        <Link href={`/portal/${mandant}/radar/${id}/mappe`}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
          Zur Mappe
        </Link>
      </div>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="einreichung-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht erfasst.</strong> {FEHLER_TEXT[fehler] ?? 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      ) : null}

      {m.eingereichtAm !== null ? (
        <Hinweis art="erfolg" cse="einreichung-bereits" className="mb-s5 max-w-prose">
          <strong>Bereits erfasst</strong> am {BERLIN.format(m.eingereichtAm)} von{' '}
          {m.eingereichtVon ?? 'unbekannt'}. Eine zweite Erfassung würde die erste überschreiben
          und ist gesperrt.
        </Hinweis>
      ) : (
        <>
          <Hinweis art="hinweis" cse="einreichung-d07" className="mb-s5 max-w-prose">
            <strong>Diese Seite reicht nichts ein.</strong> Hochgeladen wird auf der Plattform
            selbst, von Hand — eine Schnittstelle dafür bietet keine der deutschen
            Vergabeplattformen an (D-07). Was hier entsteht, ist der Nachweis: wer, wann, wo.
          </Hinweis>

          {offen > 0 ? (
            <Hinweis art="warnung" cse="einreichung-luecke" className="mb-s5 max-w-prose">
              <strong>
                {offen} Pflichtposition{offen === 1 ? '' : 'en'} {offen === 1 ? 'ist' : 'sind'} noch
                nicht geprüft.
              </strong>{' '}
              Die Erfassung wird trotzdem angenommen — was abgegeben wurde, wurde abgegeben. Die
              Lücke bleibt in der Mappe sichtbar.
            </Hinweis>
          ) : null}

          <form method="post" action="/api/vergabe/einreichung" data-cse="einreichung-formular"
                className="max-w-prose rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="ausschreibung" value={id} />
            <input type="hidden" name="mappe" value={m.mappeId} />

            <div className="flex flex-col gap-s4">
              {plattformen.length > 0 ? (
                <label className="flex flex-col gap-s2 text-xs text-text-muted">
                  Plattform aus dem Katalog
                  <select name="plattform"
                          className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text">
                    <option value="">— keine Auswahl —</option>
                    {plattformen.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-sm text-text-muted" data-cse="einreichung-katalog-leer">
                  Der Plattformkatalog ist leer: auf welchen Plattformen diese Gruppe registriert
                  ist, hat noch niemand hinterlegt (O-07). Tragen Sie die Plattform so lange im
                  Klartext ein.
                </p>
              )}

              <label className="flex flex-col gap-s2 text-xs text-text-muted">
                Plattform im Klartext {plattformen.length > 0 ? '(wenn nicht im Katalog)' : ''}
                <input type="text" name="plattform_text" maxLength={200}
                       placeholder="z. B. Vergabemarktplatz Berlin"
                       className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text" />
              </label>

              <label className="flex flex-col gap-s2 text-xs text-text-muted">
                Kennzeichen der Eingangsbestätigung
                <input type="text" name="kennzeichen" maxLength={120}
                       className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text" />
              </label>

              <p className="text-sm text-text-muted" data-cse="einreichung-wer">
                Erfasst wird die angemeldete Person und der Zeitpunkt der Datenbank. Beides lässt
                sich hier nicht eingeben — eine Unterschrift, die man für andere leisten kann, ist
                keine.
              </p>

              <div>
                <Button type="submit" variante="primary" data-cse="einreichung-speichern">
                  Einreichung erfassen
                </Button>
              </div>
            </div>
          </form>
        </>
      )}
    </PortalRahmen>
  );
}
