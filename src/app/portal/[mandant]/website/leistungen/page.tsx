import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { listeProfilseiten, type ProfilseiteZeile } from '@/server/services/inhalt/redaktion';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { WebsiteSpruenge } from '../spruenge';

/**
 * `/portal/[mandant]/website/leistungen` — die Leistungen dieser Gesellschaft
 * (PRO-02, PUB-07, PUB-11, OPS-06).
 *
 * **Es gibt bewusst keine Tabelle `leistung`.** Die Einträge leben in
 * `abschnitt.daten->'leistungen'` der Art `leistungen`, und von dort baut
 * `jsonld.ts` den `Service`-Block der strukturierten Daten. Eine zweite
 * Pflegestelle liefe den Daten davon: dann stünde in der Suche etwas anderes
 * als auf der Seite, und niemand wüsste, welche der beiden stimmt (siehe
 * `_profil/seiten.tsx`).
 *
 * **Je Sprache eine eigene Zeile** (D-82). Die englische Profilseite ist eine
 * eigene `seite`-Zeile, ihr Leistungsabschnitt ein eigener Abschnitt mit
 * eigenen Einträgen. Wer nur die deutsche pflegt, lässt
 * `/en/unternehmen/<slug>/leistungen` hinterherlaufen — hier stehen beide
 * untereinander, damit das auffällt.
 *
 * **Wo der Abschnitt fehlt, entsteht er hier.** CSE Operations hat auf seiner
 * Profilseite keinen Leistungsabschnitt; ohne einen Anlegeweg wäre genau der
 * Bereich, der die Pflege am nötigsten braucht, nicht erreichbar.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Leistungen' };

const SPRACHE_TEXT: Readonly<Record<string, string>> = {
  de: 'Deutsch', en: 'Englisch', ar: 'Arabisch', tr: 'Türkisch',
};

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

const FEHLER: Readonly<Record<string, string>> = {
  nicht_gefunden: 'Diese Seite gehört nicht zu dieser Gesellschaft.',
  name_fehlt: 'Der erste Eintrag braucht einen Namen — ein Abschnitt ohne Eintrag '
    + 'erscheint auf der öffentlichen Seite als leerer Block.',
  nicht_angelegt: 'Der Abschnitt wurde nicht angelegt. Die Seite gehört nicht zu dieser '
    + 'Gesellschaft, sie hat schon einen Leistungsabschnitt, oder dieser Sitzung fehlt '
    + 'das Schreibrecht.',
  unbekannte_handlung: 'Diese Handlung kennt die Route nicht.',
};

export default async function WebsiteLeistungen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/website/leistungen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(zugang.sitzung, 'referenz.schreiben');
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const schreibt = darf['referenz.schreiben'] === true && !nurLesen;

  const seiten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => listeProfilseiten(kontext))
  ) as Promise<readonly ProfilseiteZeile[]>);

  const suche = await searchParams;
  const abgewiesen = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const neu = typeof suche['neu'] === 'string' ? suche['neu'] : null;

  return (
    <PortalRahmen
      titel="Leistungen"
      wurzelTitel="Website"
      bereich={mandant as BereichSchluessel}
      nurLesen={nurLesen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="leistungen"
                       sitzung={zugang.sitzung} />
      <h1 className="mb-s4 text-h1 text-text">Leistungen</h1>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Was hier steht, erscheint auf{' '}
        <code className="font-mono">/unternehmen/{mandant}/leistungen</code> — und
        zugleich als <code className="font-mono">Service</code>-Block in den
        strukturierten Daten für Suchmaschinen (PUB-11). Es ist EINE Quelle: eine
        zweite Pflegestelle liefe dieser davon.
      </p>

      {abgewiesen === null ? null : (
        <Hinweis art="warnung" cse="leistungen-fehler" className="mb-s5 max-w-prose">
          {FEHLER[abgewiesen] ?? 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      )}
      {neu === null ? null : (
        <Hinweis art="erfolg" cse="abschnitt-angelegt" className="mb-s5 max-w-prose">
          Der Leistungsabschnitt steht.{' '}
          <Link href={`/portal/${mandant}/website/leistungen/${neu}`}
                className="underline underline-offset-4" data-cse="zum-neuen-abschnitt">
            Weitere Einträge pflegen
          </Link>.
        </Hinweis>
      )}

      {seiten.length === 0 ? (
        <Hinweis art="warnung" cse="keine-profilseite" className="max-w-prose">
          <strong className="block">
            Für diese Gesellschaft gibt es keine Bereichsprofilseite.
          </strong>
          Erwartet wird <code className="font-mono">/unternehmen/{mandant}</code>, je
          Sprache eine Zeile. Der Erstbestand entsteht über{' '}
          <code className="font-mono">pnpm content:import</code>.
        </Hinweis>
      ) : (
        <div className="flex flex-col gap-s5">
          {seiten.map((s) => (
            <Card key={s.id}>
              <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
                <h2 className="m-0 text-h3 text-text" data-cse="sprachfassung"
                    data-sprache={s.sprache}>
                  {SPRACHE_TEXT[s.sprache] ?? s.sprache}
                </h2>
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill
                    zustand={s.status === 'veroeffentlicht' ? 'Aktiv' : 'Entwurf'} />
                  <span className="font-mono text-xs text-text-muted">
                    {s.sprache === 'de' ? s.pfad : `/en${s.pfad}`}
                  </span>
                </span>
              </div>

              {s.leistungsAbschnittId === null ? (
                <>
                  <Hinweis art="warnung" cse="ohne-abschnitt" className="mb-s4 max-w-prose">
                    <strong className="block">
                      Diese Sprachfassung hat keinen Leistungsabschnitt.
                    </strong>
                    Die öffentliche Seite antwortet deshalb mit „noch keine Leistungen
                    hinterlegt", und der <code className="font-mono">Service</code>-Block
                    der strukturierten Daten fehlt ganz — kein Block ist besser als ein
                    leerer.
                  </Hinweis>
                  {schreibt ? (
                    <form method="post" action="/api/website/leistungen"
                          className="flex max-w-prose flex-col gap-s3"
                          data-cse="abschnitt-anlegen">
                      <input type="hidden" name="handlung" value="anlegen" />
                      <input type="hidden" name="seiteId" value={s.id} />
                      <input type="hidden" name="zurueck" value={pfad} />
                      <FormField
                        label="Erste Leistung — der Name" name="name" required
                        maxLength={200}
                        hinweis="Ein Abschnitt ohne Eintrag erscheint öffentlich als leerer Block."
                      />
                      <div className="flex flex-col gap-s2">
                        <label htmlFor={`b-${s.id}`} className="text-xs text-text-muted">
                          Beschreibung (freiwillig)
                        </label>
                        <textarea id={`b-${s.id}`} name="beschreibung" rows={3}
                                  className={FELD} />
                      </div>
                      <Button type="submit" variante="secondary" className="self-start"
                              data-cse="abschnitt-anlegen-knopf">
                        Leistungsabschnitt anlegen
                      </Button>
                    </form>
                  ) : (
                    <p className="m-0 text-xs text-text-subtle">
                      Anlegen darf, wer die Website pflegt (referenz.schreiben).
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="m-0 mb-s3 text-sm text-text-muted">
                    {s.eintraege === 0
                      ? 'Der Abschnitt steht, aber ohne Eintrag — die öffentliche '
                        + 'Leistungsseite dieser Sprachfassung ist damit leer.'
                      : `${String(s.eintraege)} gepflegte Leistungen.`}
                    {s.ueberschrift === null
                      ? '' : ` Überschrift: „${s.ueberschrift}".`}
                  </p>
                  <Link
                    href={`/portal/${mandant}/website/leistungen/${s.leistungsAbschnittId}`}
                    data-cse="zum-abschnitt"
                    className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2"
                  >
                    {s.eintraege === 0 ? 'Ersten Eintrag pflegen' : 'Einträge pflegen'}
                  </Link>
                </>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-subtle">
        Wem die Bereichsprofilseiten gehören, ist offen (O-49): heute tragen alle{' '}
        <code className="font-mono">seite</code>-Zeilen kein{' '}
        <code className="font-mono">mandant_id</code>, und die Zuordnung läuft über den
        Pfad <code className="font-mono">/unternehmen/{mandant}</code>. Diese Seite zeigt
        und ändert deshalb ausschliesslich Abschnitte dieser Adresse — Gruppenseiten
        (Startseite, Impressum) werden unter „Seiten" gepflegt.
      </p>
    </PortalRahmen>
  );
}
