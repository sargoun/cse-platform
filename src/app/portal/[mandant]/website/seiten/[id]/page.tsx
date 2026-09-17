import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  ladeSeiteZurPflege, type SeiteMitAbschnitten,
} from '@/server/services/inhalt/redaktion';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { mandantTor, MandantAntwort } from '../../../../unterseite';

/**
 * `/portal/[mandant]/website/seiten/[id]` — eine Seite bearbeiten (PUB-07,
 * PUB-08).
 *
 * **Warum diese Datei nachgereicht wurde.** Die Liste daneben verwies seit
 * ihrem ersten Tag hierher, und dieses Verzeichnis gab es nicht: der Klick
 * landete im Auffangpfad und zeigte die Tafel „noch nicht gebaut". Ein
 * Bearbeitungsverweis, der auf einen Bauzustandshinweis führt, ist schlechter
 * als gar keiner — er verspricht etwas.
 *
 * **Schreiben und Veröffentlichen sind zwei Rechte.** Einen Text ändern darf,
 * wer die Website pflegt; ihn auf die öffentliche Seite stellen darf, wer
 * veröffentlichen darf. Wer nur das erste hält, sieht die Formulare und keinen
 * Veröffentlichungsknopf — und nicht umgekehrt einen Knopf, der 403 gibt.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Seite bearbeiten' };

const ART_TEXT: Readonly<Record<string, string>> = {
  hero: 'Aufmacher',
  text: 'Textabschnitt',
  leistungen: 'Leistungen',
  referenzen: 'Referenzen',
  kontakt: 'Kontakt',
  cta: 'Handlungsaufruf',
};

export default async function WebsiteSeite(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const seiteId = kennungOder404(id);
  const pfad = `/portal/${mandant}/website/seiten/${seiteId}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(
    zugang.sitzung, 'referenz.schreiben', 'referenz.veroeffentlichen');

  const d = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeSeiteZurPflege(kontext, seiteId))
  ) as Promise<SeiteMitAbschnitten | null>);

  /*
   * 404 und nicht 403: eine Seiten-Kennung aus einer fremden Gesellschaft darf
   * nicht daran erkennbar sein, dass die Antwort eine andere ist (AUT-06).
   */
  if (d === null) notFound();
  const { seite, abschnitte } = d;
  const veroeffentlicht = seite.status === 'veroeffentlicht';

  return (
    <PortalRahmen
      titel={seite.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <p className="mb-s3 text-sm">
        <Link href={`/portal/${mandant}/website/seiten`}
              className="text-text-muted underline-offset-2 hover:underline">
          ← Seiten
        </Link>
      </p>
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{seite.titel}</h1>
        <span>
          <StatusPill zustand={veroeffentlicht ? 'Abgeschlossen' : 'Offen'} />
          <span className="ml-s2 font-mono text-xs text-text-muted">{seite.pfad}</span>
        </span>
      </div>

      {seite.bereichSlug === null && (
        <Hinweis art="warnung" cse="gruppenseite" className="mb-s5 max-w-prose">
          <strong className="block">Diese Seite gehört der Gruppe, nicht dieser Gesellschaft.</strong>
          Was hier geändert wird, gilt für alle vier — Startseite, Impressum und
          Datenschutz stehen nur einmal.
        </Hinweis>
      )}

      {abschnitte.length === 0 ? (
        <Hinweis art="hinweis" cse="keine-abschnitte" className="max-w-prose">
          Diese Seite hat keine Abschnitte. Der Erstbestand entsteht über
          <code className="mx-s1 font-mono">pnpm content:import</code>; danach wird
          hier gepflegt.
        </Hinweis>
      ) : (
        <div className="flex flex-col gap-s5">
          {abschnitte.map((a) => (
            <Card key={a.id}>
              <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
                <h2 className="m-0 text-h3 text-text">
                  {ART_TEXT[a.art] ?? a.art}
                </h2>
                <span className="font-mono text-xs text-text-muted">
                  {`Reihenfolge ${String(a.reihenfolge)}`}
                </span>
              </div>

              {darf['referenz.schreiben'] === true ? (
                <form method="post" action="/api/website/seite" data-cse="abschnitt-formular"
                      className="flex max-w-prose flex-col gap-s3">
                  <input type="hidden" name="handlung" value="abschnitt" />
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="zurueck" value={pfad} />

                  <label htmlFor={`u-${a.id}`} className="text-xs text-text-muted">
                    Überschrift
                  </label>
                  <input id={`u-${a.id}`} name="ueberschrift" defaultValue={a.ueberschrift ?? ''}
                         className="rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text" />

                  <label htmlFor={`a-${a.id}`} className="text-xs text-text-muted">
                    Akzentwort — das eine Wort, das rot steht (DESIGN §1)
                  </label>
                  <input id={`a-${a.id}`} name="akzentWort" defaultValue={a.akzentWort ?? ''}
                         className="rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text" />

                  <label htmlFor={`t-${a.id}`} className="text-xs text-text-muted">
                    Text
                  </label>
                  <textarea id={`t-${a.id}`} name="text" rows={6} defaultValue={a.text ?? ''}
                            className="rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text" />

                  <Button type="submit" variante="secondary" className="self-start"
                          data-cse="abschnitt-speichern">
                    Abschnitt speichern
                  </Button>
                </form>
              ) : (
                <>
                  {a.ueberschrift === null ? null : (
                    <p className="m-0 mb-s2 text-sm font-medium text-text">{a.ueberschrift}</p>
                  )}
                  <p className="m-0 whitespace-pre-line text-sm text-text-muted">
                    {a.text ?? '—'}
                  </p>
                </>
              )}
            </Card>
          ))}
        </div>
      )}

      {darf['referenz.veroeffentlichen'] === true && (
        <Card className="mt-s5">
          <h2 className="mb-s3 mt-0 text-h3 text-text">
            {veroeffentlicht ? 'Zurückziehen' : 'Veröffentlichen'}
          </h2>
          <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
            {veroeffentlicht
              ? 'Die Seite ist öffentlich erreichbar. Zurückgezogen antwortet ihre '
                + 'Adresse mit 404 — ein eingehender Verweis bricht damit.'
              : 'Die Seite ist ein Entwurf und für niemanden ausser dieser Ansicht '
                + 'sichtbar.'}
          </p>
          <form method="post" action="/api/website/seite">
            <input type="hidden" name="handlung" value="status" />
            <input type="hidden" name="id" value={seite.id} />
            <input type="hidden" name="veroeffentlicht" value={veroeffentlicht ? '0' : '1'} />
            <input type="hidden" name="zurueck" value={pfad} />
            <Button type="submit" variante={veroeffentlicht ? 'secondary' : 'primary'}
                    data-cse="seite-status">
              {veroeffentlicht ? 'Zurückziehen' : 'Veröffentlichen'}
            </Button>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}
