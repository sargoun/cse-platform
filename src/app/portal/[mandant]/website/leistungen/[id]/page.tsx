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
  ladeLeistungsAbschnitt, type LeistungsAbschnitt,
} from '@/server/services/inhalt/redaktion';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { WebsiteSpruenge } from '../../spruenge';

/**
 * `/portal/[mandant]/website/leistungen/[id]` — die Leistungseinträge EINES
 * Abschnitts (PRO-02, PUB-07, PUB-11).
 *
 * **`[id]` ist die Abschnittskennung, nicht die der Seite.** Ein
 * `leistungen`-Abschnitt gehört zu genau einer Sprachfassung; die deutsche und
 * die englische Liste sind zwei Abschnitte mit zwei Einträgemengen (D-82).
 *
 * **Ohne JavaScript.** Alle Zeilen stehen in EINEM Formular: eine Liste von
 * Einträgen ist eine geordnete Reihe, und ihre Reihenfolge ist die
 * Dokumentreihenfolge der Felder. Zeilenweise Formulare wie in der Galerie
 * gingen hier nicht — der Dienst schreibt die Liste als Ganzes, weil `daten`
 * eine Spalte ist und nicht eine Tabelle.
 *
 * **Die Einträge sind zugleich die strukturierten Daten.** `jsonld.ts` baut
 * daraus den `Service`-Block; ein Eintrag ohne Namen fällt dort heraus, und
 * deshalb weist der Dienst ihn hier ab, statt ihn als unsichtbaren Geist
 * mitzuspeichern.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Leistungen bearbeiten' };

const SPRACHE_TEXT: Readonly<Record<string, string>> = {
  de: 'Deutsch', en: 'Englisch', ar: 'Arabisch', tr: 'Türkisch',
};

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

const FEHLER: Readonly<Record<string, string>> = {
  nicht_gefunden: 'Diesen Abschnitt gibt es hier nicht.',
  eintraege_ungueltig: 'Die Einsendung ist unlesbar — zu jedem Namen gehört genau ein '
    + 'Beschreibungsfeld. Laden Sie die Seite neu.',
  name_fehlt: 'Ein Eintrag ohne Namen ist keine Leistung. Zum Entfernen gibt es den '
    + 'Knopf daneben — ein leeres Feld löscht nichts.',
  name_doppelt: 'Zwei Einträge tragen denselben Namen. Die öffentliche Liste und die '
    + 'strukturierten Daten führen jede Leistung einmal.',
  nicht_geaendert: 'Die Leistungen wurden nicht geändert. Der Abschnitt gehört nicht zur '
    + 'Profilseite dieser Gesellschaft, oder dieser Sitzung fehlt das Schreibrecht.',
  unbekannte_handlung: 'Diese Handlung kennt die Route nicht.',
};

export default async function WebsiteLeistungsAbschnitt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const abschnittId = kennungOder404(id);
  const pfad = `/portal/${mandant}/website/leistungen/${abschnittId}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(zugang.sitzung, 'referenz.schreiben');
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const schreibt = darf['referenz.schreiben'] === true && !nurLesen;

  const a = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeLeistungsAbschnitt(kontext, abschnittId))
  ) as Promise<LeistungsAbschnitt | null>);

  /*
   * 404 und nicht 403. Eine Abschnittskennung, die zur Profilseite einer
   * ANDEREN Gesellschaft gehört, darf nicht daran erkennbar sein, dass die
   * Antwort eine andere ist (AUT-06) — und `abschnitt` hat keine
   * `mandant_id`, die RLS das abnehmen könnte (O-49).
   */
  if (a === null) notFound();

  const suche = await searchParams;
  const abgewiesen = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const gespeichert = suche['gespeichert'] === '1';

  const oeffentlich = a.sprache === 'de'
    ? `/unternehmen/${mandant}/leistungen`
    : `/en/unternehmen/${mandant}/leistungen`;

  return (
    <PortalRahmen
      titel={`Leistungen — ${SPRACHE_TEXT[a.sprache] ?? a.sprache}`}
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
      <p className="mb-s3 text-sm">
        <Link href={`/portal/${mandant}/website/leistungen`}
              className="text-text-muted underline-offset-2 hover:underline">
          ← Leistungen
        </Link>
      </p>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">
          {SPRACHE_TEXT[a.sprache] ?? a.sprache}
        </h1>
        <span className="inline-flex flex-wrap items-center gap-s2">
          <StatusPill zustand={a.seiteStatus === 'veroeffentlicht' ? 'Aktiv' : 'Entwurf'} />
          <span className="font-mono text-xs text-text-muted">{oeffentlich}</span>
        </span>
      </div>

      <Hinweis art="hinweis" cse="leistungen-sind-jsonld" className="mb-s5 max-w-prose">
        <strong className="block">
          Diese Einträge sind zugleich die strukturierten Daten für Suchmaschinen.
        </strong>
        Was hier steht, gibt <code className="font-mono">jsonld.ts</code> als{' '}
        <code className="font-mono">Service</code>-Block der Gesellschaft aus (PUB-11) —
        es ist eine Aussage des Unternehmens, nicht nur ein Text auf einer Seite.
      </Hinweis>

      {abgewiesen === null ? null : (
        <Hinweis art="warnung" cse="leistungen-fehler" className="mb-s5 max-w-prose">
          {FEHLER[abgewiesen] ?? 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      )}
      {gespeichert && (
        <Hinweis art="erfolg" cse="leistungen-gespeichert" className="mb-s5 max-w-prose">
          Gespeichert. Die öffentliche Seite zeigt es beim nächsten Aufruf — der Inhalt
          kommt aus der Datenbank, nicht aus dem Bau.
        </Hinweis>
      )}
      {a.datenUnlesbar && (
        <Hinweis art="warnung" cse="daten-unlesbar" className="mb-s5 max-w-prose">
          <strong className="block">
            In diesem Abschnitt stehen Einträge, die die öffentliche Seite nicht liest.
          </strong>
          Ein Eintrag ohne Namen fällt beim Lesen heraus — er steht im Feld und erscheint
          nirgends. Speichern Sie die Liste einmal, dann ist sie bereinigt.
        </Hinweis>
      )}

      <Card>
        <h2 className="mb-s3 mt-0 text-h3 text-text">
          {`Einträge (${String(a.eintraege.length)})`}
        </h2>

        {!schreibt ? (
          a.eintraege.length === 0 ? (
            <Hinweis art="hinweis" cse="keine-leistungen" className="max-w-prose">
              Für diese Sprachfassung ist keine Leistung hinterlegt. Die öffentliche Seite
              sagt das auch so.
            </Hinweis>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-s3 p-0" data-cse="leistungen-lesen">
              {a.eintraege.map((e) => (
                <li key={e.name} className="rounded-lg border border-line bg-surface p-s3">
                  <p className="m-0 text-sm font-medium text-text">{e.name}</p>
                  {e.beschreibung === undefined ? null : (
                    <p className="m-0 mt-s1 text-sm text-text-muted">{e.beschreibung}</p>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : (
          <form method="post" action="/api/website/leistungen"
                className="flex flex-col gap-s4" data-cse="leistungen-formular">
            <input type="hidden" name="handlung" value="setzen" />
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="zurueck" value={pfad} />

            {a.eintraege.length === 0 && (
              <p className="m-0 max-w-prose text-sm text-text-muted"
                 data-cse="leistungen-leer">
                Noch kein Eintrag. Die öffentliche Leistungsseite dieser Sprachfassung ist
                damit leer — und auf der Profilseite steht ein leerer Block.
              </p>
            )}

            {a.eintraege.map((e, i) => (
              <fieldset key={e.name}
                        className="m-0 flex flex-col gap-s2 rounded-lg border border-line p-s3"
                        data-cse="leistung-zeile">
                <legend className="px-s2 text-xs text-text-muted">
                  {`Eintrag ${String(i + 1)}`}
                </legend>
                <label htmlFor={`n-${String(i)}`} className="text-xs text-text-muted">
                  Name
                </label>
                <input id={`n-${String(i)}`} name="name" defaultValue={e.name}
                       maxLength={200} className={FELD} data-cse="leistung-name" />
                <label htmlFor={`b-${String(i)}`} className="text-xs text-text-muted">
                  Beschreibung
                </label>
                <textarea id={`b-${String(i)}`} name="beschreibung" rows={2}
                          className={FELD} defaultValue={e.beschreibung ?? ''} />
                {/*
                  * „Entfernen" schickt die NUMMER der Zeile mit. Ein leeres
                  * Namensfeld als Löschbefehl zu lesen wäre die teuerste
                  * Bedienung: wer versehentlich einen Namen löscht und
                  * speichert, hätte die Leistung entfernt und läse
                  * „gespeichert".
                  */}
                <Button type="submit" name="weg" value={String(i)} variante="ghost"
                        className="self-start" data-cse="leistung-entfernen">
                  Diesen Eintrag entfernen
                </Button>
              </fieldset>
            ))}

            <fieldset className="m-0 flex flex-col gap-s2 rounded-lg border border-dashed border-line p-s3"
                      data-cse="leistung-neu">
              <legend className="px-s2 text-xs text-text-muted">Anhängen</legend>
              <label htmlFor="n-neu" className="text-xs text-text-muted">Name</label>
              <input id="n-neu" name="name" defaultValue="" maxLength={200}
                     className={FELD} />
              <label htmlFor="b-neu" className="text-xs text-text-muted">
                Beschreibung
              </label>
              <textarea id="b-neu" name="beschreibung" rows={2} className={FELD}
                        defaultValue="" />
              <p className="m-0 text-xs text-text-subtle">
                Bleibt beides leer, wird nichts angehängt.
              </p>
            </fieldset>

            <Button type="submit" variante="primary" className="self-start"
                    data-cse="leistungen-speichern">
              Leistungen speichern
            </Button>
          </form>
        )}
      </Card>

      <p className="mt-s5 max-w-prose text-xs text-text-subtle">
        Die Reihenfolge der Einträge ist die Reihenfolge auf der öffentlichen Seite. Zwei
        Einträge dürfen nicht denselben Namen tragen — die öffentliche Liste nimmt ihn als
        Schlüssel.
      </p>
    </PortalRahmen>
  );
}
