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
import {
  bilderZurWahl, listeProfile, type GaleriePflegeZeile, type ProfilZeile,
} from '@/server/services/inhalt/redaktion';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { WebsiteSpruenge } from '../spruenge';

/**
 * `/portal/[mandant]/website/profil` — das öffentliche Profil dieser
 * Gesellschaft (PRO-01, PRO-02, TEN-07).
 *
 * **Zwei Karten, weil es zwei Zeilen sind.** `unternehmensprofil_uk` ist
 * `unique (mandant_id, sprache) where geloescht_am is null`: die deutsche und
 * die englische Fassung sind eigene Zeilen (D-82), werden getrennt gespeichert
 * und getrennt veröffentlicht. Eine Seite, die stillschweigend nur die
 * deutsche pflegte, liesse `/en/unternehmen/<slug>` hinterherlaufen — und der
 * öffentliche Leser fällt dann auf Deutsch zurück, ohne dass es auffällt.
 *
 * **Logo und Coverbild sind hier NICHT wählbar, und das ist keine Lücke,
 * sondern der ehrliche Stand.** Es gibt im Portal keinen Weg, eine Datei
 * entgegenzunehmen: `medien`-Zeilen entstehen über
 * `pnpm content:import`, und diese Gesellschaft hat genau EINE — ein
 * Platzhalterbild. Eine Auswahlliste mit einem Platzhalter darin wäre keine
 * Wahl: Logo und Cover wären zwangsläufig dieselbe Datei, und beide falsch.
 * Deshalb steht dort ein benannter Platzhalterblock, wie bei einer nicht
 * verbundenen Integration — kein Auswahlfeld, das nichts kann.
 *
 * **Die Route verlangt ZWEI Rechte, UND-verknüpft** (`referenz.schreiben` und
 * `system.identitaet_verwalten`, Manifest): das zweite hält nur `super_admin`.
 * Für `admin` und `leitung` ist diese Adresse damit heute ein 404. Das ist
 * eine Entscheidung der Seitenkarte und nicht dieser Datei — sie steht hier,
 * damit sie nicht in Vergessenheit gerät.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Profil' };

const SPRACHE_TEXT: Readonly<Record<string, string>> = {
  de: 'Deutsch', en: 'Englisch', ar: 'Arabisch', tr: 'Türkisch',
};

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

const FEHLER: Readonly<Record<string, string>> = {
  nicht_gefunden: 'Dieses Profil gibt es hier nicht.',
  kurzbeschreibung_fehlt: 'Ohne Kurzbeschreibung steht die Markenkarte dieser '
    + 'Gesellschaft leer da — sie liest sich dann wie „über diese Gesellschaft gibt es '
    + 'nichts zu sagen".',
  gruendung_ungueltig: 'Das Gründungsjahr liegt zwischen 1900 und 2100 — oder es bleibt leer.',
  mitarbeiter_ungueltig: 'Die Mitarbeiterzahl ist eine ganze Zahl ab null — oder sie '
    + 'bleibt leer.',
  nicht_geaendert: 'Der Schreibvorgang ging nicht durch. Das Profil gehört nicht zu '
    + 'dieser Gesellschaft, oder dieser Sitzung fehlt das Schreibrecht.',
  unbekannte_handlung: 'Diese Handlung kennt die Route nicht.',
};

export default async function WebsiteProfil(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/website/profil`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(zugang.sitzung, 'referenz.schreiben');
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const schreibt = darf['referenz.schreiben'] === true && !nurLesen;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      profile: await listeProfile(kontext),
      bilder: await bilderZurWahl(kontext),
    }))) as Promise<{
      profile: readonly ProfilZeile[]; bilder: readonly GaleriePflegeZeile[];
    }>);

  const suche = await searchParams;
  const abgewiesen = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const gespeichert = typeof suche['gespeichert'] === 'string'
    ? suche['gespeichert'] : null;

  const echteBilder = daten.bilder.filter((b) => !b.platzhalter);

  return (
    <PortalRahmen
      titel="Profil"
      wurzelTitel="Website"
      bereich={mandant as BereichSchluessel}
      nurLesen={nurLesen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="profil"
                       sitzung={zugang.sitzung} />
      <h1 className="mb-s4 text-h1 text-text">Profil</h1>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Der Kurztext steht auf der Markenkarte der Gruppe, die lange Fassung auf{' '}
        <code className="font-mono">/unternehmen/{mandant}</code>. Deutsch und Englisch
        sind zwei Zeilen und werden getrennt veröffentlicht — eine englische Fassung
        geht erst hinaus, wenn jemand sie gelesen hat.
      </p>

      {abgewiesen === null ? null : (
        <Hinweis art="warnung" cse="profil-fehler" className="mb-s5 max-w-prose">
          {FEHLER[abgewiesen] ?? 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      )}
      {gespeichert === null ? null : (
        <Hinweis art="erfolg" cse="profil-gespeichert" className="mb-s5 max-w-prose">
          Gespeichert.
        </Hinweis>
      )}

      {daten.profile.length === 0 ? (
        <Hinweis art="warnung" cse="kein-profil" className="max-w-prose">
          <strong className="block">
            Für diese Gesellschaft ist kein Profil angelegt.
          </strong>
          Erwartet wird je Sprache eine Zeile in{' '}
          <code className="font-mono">unternehmensprofil</code>. Ohne sie zeigt die
          Markenkarte der Gruppe keinen Kurztext, und{' '}
          <code className="font-mono">/unternehmen/{mandant}</code> fällt auf die
          Angaben aus <code className="font-mono">mandant</code> zurück. Der
          Erstbestand entsteht über <code className="font-mono">pnpm db:seed</code>.
        </Hinweis>
      ) : (
        <div className="grid grid-cols-1 gap-s5 lg:grid-cols-2">
          {daten.profile.map((p) => {
            const veroeffentlicht = p.status === 'veroeffentlicht';
            return (
              <Card key={p.id}>
                <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
                  <h2 className="m-0 text-h3 text-text" data-cse="profil-sprache"
                      data-sprache={p.sprache}>
                    {SPRACHE_TEXT[p.sprache] ?? p.sprache}
                  </h2>
                  <StatusPill zustand={veroeffentlicht ? 'Aktiv' : 'Entwurf'} />
                </div>

                {schreibt ? (
                  <form method="post" action="/api/website/profil"
                        className="flex flex-col gap-s4" data-cse="profil-formular">
                    <input type="hidden" name="handlung" value="texte" />
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="zurueck" value={pfad} />

                    <div className="flex flex-col gap-s2">
                      <label htmlFor={`k-${p.id}`} className="text-xs text-text-muted">
                        Kurzbeschreibung — ein Satz für die Markenkarte
                      </label>
                      <textarea id={`k-${p.id}`} name="kurzbeschreibung" rows={2}
                                required className={FELD}
                                defaultValue={p.kurzbeschreibung} />
                    </div>
                    <div className="flex flex-col gap-s2">
                      <label htmlFor={`b-${p.id}`} className="text-xs text-text-muted">
                        Beschreibung — der Text auf der Profilseite
                      </label>
                      <textarea id={`b-${p.id}`} name="beschreibung" rows={6}
                                className={FELD} defaultValue={p.beschreibung ?? ''} />
                    </div>
                    <FormField
                      label="Gründungsjahr" name="gruendung" type="number"
                      min={1900} max={2100} step={1}
                      defaultValue={p.gruendung === null ? '' : String(p.gruendung)}
                    />
                    <FormField
                      label="Mitarbeiterzahl" name="mitarbeiterZahl" type="number"
                      min={0} step={1}
                      defaultValue={
                        p.mitarbeiterZahl === null ? '' : String(p.mitarbeiterZahl)}
                      hinweis="Eine Zahl, die öffentlich steht — sie wird verglichen."
                    />
                    <Button type="submit" variante="secondary" className="self-start"
                            data-cse="profil-speichern">
                      Speichern
                    </Button>
                  </form>
                ) : (
                  <div className="flex flex-col gap-s3">
                    <p className="m-0 text-sm font-medium text-text">
                      {p.kurzbeschreibung}
                    </p>
                    <p className="m-0 whitespace-pre-line text-sm text-text-muted">
                      {p.beschreibung ?? '—'}
                    </p>
                    <p className="m-0 text-xs text-text-subtle">
                      {`Gegründet ${p.gruendung === null ? '—' : String(p.gruendung)} · `}
                      {`${p.mitarbeiterZahl === null ? '—' : String(p.mitarbeiterZahl)} Mitarbeitende`}
                    </p>
                  </div>
                )}

                {schreibt && (
                  <form method="post" action="/api/website/profil"
                        className="mt-s5 border-0 border-t border-line pt-s4">
                    <input type="hidden" name="handlung" value="status" />
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="veroeffentlicht"
                           value={veroeffentlicht ? '0' : '1'} />
                    <input type="hidden" name="zurueck" value={pfad} />
                    <p className="mb-s3 mt-0 max-w-prose text-xs text-text-muted">
                      {veroeffentlicht
                        ? 'Diese Sprachfassung steht öffentlich. Zurückgezogen fällt der '
                          + 'öffentliche Leser auf die deutsche Fassung zurück — bei der '
                          + 'deutschen auf die Angaben aus der Gesellschaft.'
                        : 'Diese Sprachfassung ist ein Entwurf und für niemanden ausser '
                          + 'dieser Ansicht sichtbar.'}
                    </p>
                    <Button type="submit"
                            variante={veroeffentlicht ? 'secondary' : 'primary'}
                            data-cse="profil-status">
                      {veroeffentlicht ? 'Zurückziehen' : 'Veröffentlichen'}
                    </Button>
                  </form>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Bilder: ein benannter Platzhalter, kein Auswahlfeld ─────────── */}
      <Card className="mt-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">Logo und Coverbild</h2>
        <Hinweis art="warnung" cse="bilder-nicht-verbunden" className="mb-s4 max-w-prose">
          <strong className="block">Nicht gebaut — und zwar mit Absicht.</strong>
          Es gibt im Portal keinen Weg, eine Datei entgegenzunehmen:{' '}
          <code className="font-mono">medien</code>-Zeilen entstehen über{' '}
          <code className="font-mono">pnpm content:import</code>. Diese Gesellschaft
          führt{' '}
          {daten.bilder.length === 1
            ? 'genau ein Bild' : `${String(daten.bilder.length)} Bilder`}
          {echteBilder.length === 0
            ? ' — und das ist ein Platzhalter (O-13: echtes Bildmaterial mit Freigaben '
              + 'fehlt). Eine Auswahl zwischen einem Platzhalter und nichts ist keine '
              + 'Wahl; Logo und Cover wären zwangsläufig dieselbe Datei.'
            : `, davon ${String(echteBilder.length)} ohne Platzhaltermarke.`}
        </Hinweis>
        <dl className="grid grid-cols-1 gap-s3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-text-muted">Logo</dt>
            <dd className="m-0 text-sm text-text-subtle" data-cse="logo-stand">
              {daten.profile.every((p) => p.logoMedienId === null)
                ? 'nicht gesetzt' : 'gesetzt'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">
              Coverbild — Seitenverhältnis 3:1 (DESIGN §4.5)
            </dt>
            <dd className="m-0 text-sm text-text-subtle" data-cse="cover-stand">
              {daten.profile.every((p) => p.coverMedienId === null)
                ? 'nicht gesetzt' : 'gesetzt'}
            </dd>
          </div>
        </dl>
        <p className="mb-0 mt-s4 max-w-prose text-xs text-text-subtle">
          Welche Bilder es überhaupt gibt, steht unter{' '}
          <Link href={`/portal/${mandant}/website/galerie`}
                className="underline underline-offset-2 hover:text-brand"
                data-cse="zur-galerie">
            Galerie
          </Link>
          . Dort ist auch zu sehen, welche als Platzhalter markiert sind — bis O-13
          beantwortet ist, sind es alle.
        </p>
      </Card>
    </PortalRahmen>
  );
}
