import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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
  bilderZurWahl, ladeReferenzZurPflege,
  type GaleriePflegeZeile, type ReferenzDetail,
} from '@/server/services/inhalt/redaktion';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { WebsiteSpruenge } from '../../spruenge';

/**
 * `/portal/[mandant]/website/referenzen/[id]` — eine Referenz bearbeiten
 * (PRO-05).
 *
 * **Die Kundenfreigabe steht in einem EIGENEN Block, nicht zwischen Titel und
 * Jahr.** Ein Kundenname auf einer Website ohne dessen Zustimmung ist nichts,
 * was man durch Löschen ungeschehen macht — er steht dann im Cache einer
 * Suchmaschine, und der Kunde ruft an. Die Zustimmung ist deshalb keine
 * Formatierungsfrage, sondern die Bedingung, unter der diese Zeile überhaupt
 * öffentlich werden darf; `referenz_freigabe_belegt` lässt sie ohne Datum gar
 * nicht in die Tabelle.
 *
 * **Zwei Rechte, und sie sind nicht dieselben.** Die Seite trägt
 * `referenz.schreiben` (Manifest); `t_referenz_pflege` verlangt für JEDEN
 * Schreibvorgang `referenz.kundenfreigabe_erfassen`. Wer nur das erste hält,
 * sähe Formulare, die nichts ändern — deshalb stehen die Knöpfe nur, wo beide
 * Rechte da sind, und der Satz daneben sagt, welches fehlt.
 *
 * **Die Quelle ist heute diese Zeile und nicht der Auftrag.** Später soll eine
 * Referenz aus abgeschlossenen `auftrag`-Zeilen mit Kundenfreigabe entstehen
 * (TODO am Ende von `services/inhalt/referenz.ts`, O-13). Bis dahin ist das
 * hier Handarbeit, und diese Seite tut nicht so, als käme sie aus dem Auftrag.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Referenz bearbeiten' };

const BERLIN_TAG = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium',
});

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

const FEHLER: Readonly<Record<string, string>> = {
  nicht_gefunden: 'Diese Referenz gibt es hier nicht.',
  kein_freigaberecht: 'Jede Änderung an einer Referenz verlangt das Recht, '
    + 'Kundenfreigaben zu erfassen (referenz.kundenfreigabe_erfassen). An der Referenz '
    + 'hat sich nichts geändert.',
  titel_fehlt: 'Eine Referenz ohne Titel hat keine Überschrift.',
  slug_form: 'Der Slug besteht aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen '
    + '— er ist Teil der öffentlichen Adresse.',
  slug_vergeben: 'Diese Adresse trägt in dieser Gesellschaft schon eine andere Referenz '
    + '— auch eine gelöschte hält ihren Slug weiter (Invariante 8). Trag einen anderen '
    + 'Slug ein; das leere Feld schlägt den aus dem Titel vor, und der ist hier gerade '
    + 'der belegte.',
  jahr_ungueltig: 'Das Jahr liegt zwischen 1990 und 2100 — oder es bleibt leer.',
  sortierung_ungueltig: 'Die Sortierung ist eine ganze Zahl ab null.',
  bild_fremd: 'Dieses Bild gehört nicht zu dieser Gesellschaft.',
  freigabe_ohne_datum: 'Eine Kundenfreigabe braucht ein Datum. Ohne Datum lässt die '
    + 'Datenbank sie nicht zu — und beim Anruf des Kunden ist das Datum die Frage.',
  freigabe_datum_form: 'Das Freigabedatum steht als Jahr-Monat-Tag, etwa 2026-03-29 — '
    + 'und muss ein Tag sein, den es gibt.',
  freigabe_ohne_beleg: 'Woraus geht die Zustimmung hervor? E-Mail, Vertragsklausel, '
    + 'unterschriebenes Blatt — ein Satz genügt, aber er muss dastehen.',
  nicht_geaendert: 'Der Schreibvorgang ging nicht durch. Die Referenz gehört nicht zu '
    + 'dieser Gesellschaft, oder dieser Sitzung fehlt das Recht.',
  unbekannte_handlung: 'Diese Handlung kennt die Route nicht.',
};

/** `YYYY-MM-DD` in Europe/Berlin — der Wert, den ein `<input type="date">` will. */
function berlinTag(iso: string | null): string {
  if (iso === null) return '';
  const teile = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
  return teile;
}

export default async function WebsiteReferenz(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const referenzId = kennungOder404(id);
  const pfad = `/portal/${mandant}/website/referenzen/${referenzId}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(
    zugang.sitzung, 'referenz.schreiben', 'referenz.kundenfreigabe_erfassen',
    'referenz.veroeffentlichen');
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const schreibt = darf['referenz.schreiben'] === true
    && darf['referenz.kundenfreigabe_erfassen'] === true && !nurLesen;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      referenz: await ladeReferenzZurPflege(kontext, referenzId),
      bilder: await bilderZurWahl(kontext),
    }))) as Promise<{
      referenz: ReferenzDetail | null; bilder: readonly GaleriePflegeZeile[];
    }>);

  // 404 und nicht 403 (AUT-06).
  if (daten.referenz === null) notFound();
  const r = daten.referenz;

  const suche = await searchParams;
  const abgewiesen = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const gespeichert = typeof suche['gespeichert'] === 'string'
    ? suche['gespeichert'] : null;

  const oeffentlich = `/unternehmen/${mandant}/projekte/${r.slug}`;
  const draussen = r.status === 'veroeffentlicht';

  return (
    <PortalRahmen
      titel={r.titel}
      wurzelTitel="Website"
      bereich={mandant as BereichSchluessel}
      nurLesen={nurLesen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="referenzen"
                       sitzung={zugang.sitzung} />
      <p className="mb-s3 text-sm">
        <Link href={`/portal/${mandant}/website/referenzen`}
              className="text-text-muted underline-offset-2 hover:underline">
          ← Referenzen
        </Link>
      </p>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 min-w-0 text-h1 text-text">{r.titel}</h1>
        <span className="inline-flex flex-wrap items-center gap-s2">
          <StatusPill zustand={draussen ? 'Aktiv' : 'Entwurf'} />
          <StatusPill zustand={r.freigegeben ? 'Bereit' : 'Wartet'} />
        </span>
      </div>

      {abgewiesen === null ? null : (
        <Hinweis art="warnung" cse="referenz-fehler" className="mb-s5 max-w-prose">
          {FEHLER[abgewiesen] ?? 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      )}
      {gespeichert === null ? null : (
        <Hinweis art="erfolg" cse="referenz-gespeichert" className="mb-s5 max-w-prose">
          Gespeichert.
        </Hinweis>
      )}
      {!schreibt && !nurLesen && (
        <Hinweis art="warnung" cse="ohne-schreibrecht" className="mb-s5 max-w-prose">
          <strong className="block">Diese Seite ist hier nur lesbar.</strong>
          Eine Änderung an einer Referenz verlangt{' '}
          <code className="font-mono">referenz.schreiben</code> UND{' '}
          <code className="font-mono">referenz.kundenfreigabe_erfassen</code> — das
          zweite steht in der Policy <code className="font-mono">t_referenz_pflege</code>{' '}
          für jeden Schreibvorgang auf dieser Tabelle, nicht nur für das Häkchen.
          Formulare, die nichts ändern, stehen deshalb hier nicht.
        </Hinweis>
      )}

      {/* ── Die öffentliche Adresse ─────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">Öffentliche Adresse</h2>
        <p className="m-0" data-cse="kanonische-adresse">
          {draussen && r.freigegeben ? (
            <a href={oeffentlich}
               className="font-mono text-sm text-text underline underline-offset-4 hover:text-brand">
              {oeffentlich}
            </a>
          ) : (
            <span className="font-mono text-sm text-text-muted">{oeffentlich}</span>
          )}
        </p>
        <p className="mb-0 mt-s3 max-w-prose text-xs text-text-subtle">
          {draussen && r.freigegeben
            ? 'Ein geänderter Slug bricht jeden eingehenden Verweis und jeden Eintrag im '
              + 'Index einer Suchmaschine. Die alte Adresse antwortet danach mit 404.'
            : 'Diese Adresse antwortet heute mit 404: öffentlich ist eine Referenz nur '
              + 'mit Kundenfreigabe UND veröffentlichtem Zustand — beides prüft die '
              + 'Policy t_referenz_oeffentlich.'}
        </p>
      </Card>

      {/* ── Felder ──────────────────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">Projekt</h2>
        {schreibt ? (
          <form method="post" action="/api/website/referenz"
                className="flex max-w-prose flex-col gap-s4" data-cse="referenz-formular">
            <input type="hidden" name="handlung" value="felder" />
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <FormField label="Titel" name="titel" defaultValue={r.titel} required
                       maxLength={200} />
            <FormField
              label="Slug — der letzte Teil der Adresse" name="slug"
              defaultValue={r.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*"
              hinweis="Leer lassen schlägt einen aus dem Titel vor (app.slug_aus_titel) — dieselbe Funktion, die beim Anlegen greift."
            />
            <FormField
              label="Kundenname" name="kundeName" defaultValue={r.kundeName ?? ''}
              maxLength={200}
              hinweis="Er geht nur mit Kundenfreigabe hinaus — der Block darunter."
            />
            <div className="flex flex-col gap-s2">
              <label htmlFor="beschreibung" className="text-xs text-text-muted">
                Beschreibung
              </label>
              <textarea id="beschreibung" name="beschreibung" rows={6} className={FELD}
                        defaultValue={r.beschreibung ?? ''} />
            </div>
            <FormField label="Jahr" name="jahr" type="number" min={1990} max={2100}
                       step={1} defaultValue={r.jahr === null ? '' : String(r.jahr)} />
            <FormField label="Sortierung" name="sortierung" type="number" min={0} step={1}
                       defaultValue={String(r.sortierung)}
                       hinweis="Kleinere Zahlen stehen auf der Projektliste oben." />

            <div className="flex flex-col gap-s2">
              <label htmlFor="medienId" className="text-xs text-text-muted">
                Bild — aus den Bildern dieser Gesellschaft
              </label>
              <select id="medienId" name="medienId" className={FELD}
                      defaultValue={r.medienId ?? ''} data-cse="bild-wahl">
                <option value="">kein Bild</option>
                {daten.bilder.map((b) => (
                  <option key={b.id} value={b.id}>
                    {`${b.alt}${b.platzhalter ? ' (Platzhalter)' : ''}`}
                  </option>
                ))}
              </select>
              <p className="m-0 text-xs text-text-subtle">
                {daten.bilder.length === 0
                  ? 'Für diese Gesellschaft ist kein Bild erfasst. medien-Zeilen '
                    + 'entstehen über pnpm content:import; einen Upload gibt es im '
                    + 'Portal nicht.'
                  : 'Echtes Bildmaterial mit Freigaben fehlt noch (O-13) — was hier als '
                    + 'Platzhalter markiert ist, gehört nicht auf eine Kundenreferenz.'}
              </p>
            </div>

            <Button type="submit" variante="secondary" className="self-start"
                    data-cse="referenz-speichern">
              Speichern
            </Button>
          </form>
        ) : (
          <dl className="grid grid-cols-1 gap-s3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-muted">Kunde</dt>
              <dd className="m-0 text-sm text-text">{r.kundeName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Jahr</dt>
              <dd className="m-0 text-sm text-text">
                {r.jahr === null ? '—' : String(r.jahr)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-muted">Beschreibung</dt>
              <dd className="m-0 whitespace-pre-line text-sm text-text-muted">
                {r.beschreibung ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Bild</dt>
              <dd className="m-0 text-sm text-text-muted">
                {r.medienAlt ?? 'kein Bild'}
                {r.medienPlatzhalter === true ? ' (Platzhalter)' : ''}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      {/* ── Kundenfreigabe ──────────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">Kundenfreigabe</h2>
        <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
          Ohne schriftliche Zustimmung des Kunden geht sein Name nicht auf die Website.
          Die Datenbank lässt eine Freigabe <strong>ohne Datum</strong> gar nicht zu
          (<code className="font-mono">referenz_freigabe_belegt</code>) — und der Beleg
          steht dabei, weil beim Anruf des Kunden genau danach gefragt wird.
        </p>

        <dl className="mb-s4 grid grid-cols-1 gap-s3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-text-muted">Stand</dt>
            <dd className="m-0" data-cse="kundenfreigabe"
                data-freigegeben={r.freigegeben ? 'ja' : 'nein'}>
              <StatusPill zustand={r.freigegeben ? 'Bereit' : 'Wartet'} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Erteilt am</dt>
            <dd className="m-0 text-sm text-text">
              {r.freigabeAm === null ? '—' : BERLIN_TAG.format(new Date(r.freigabeAm))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Beleg</dt>
            <dd className="m-0 text-sm text-text-muted">{r.freigabeBeleg ?? '—'}</dd>
          </div>
        </dl>

        {schreibt && (
          <form method="post" action="/api/website/referenz"
                className="flex max-w-prose flex-col gap-s4" data-cse="freigabe-formular">
            <input type="hidden" name="handlung" value="freigabe" />
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <label className="flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="freigegeben" value="1"
                     defaultChecked={r.freigegeben}
                     className="size-4 accent-[var(--brand)]" data-cse="freigabe-haken" />
              <span>Der Kunde hat schriftlich zugestimmt.</span>
            </label>
            <FormField label="Datum der Zustimmung" name="freigabeAm" type="date"
                       defaultValue={berlinTag(r.freigabeAm)} />
            <div className="flex flex-col gap-s2">
              <label htmlFor="freigabeBeleg" className="text-xs text-text-muted">
                Beleg — woraus geht die Zustimmung hervor?
              </label>
              <textarea id="freigabeBeleg" name="freigabeBeleg" rows={3} className={FELD}
                        defaultValue={r.freigabeBeleg ?? ''} />
            </div>
            <Button type="submit" variante="secondary" className="self-start"
                    data-cse="freigabe-speichern">
              Freigabe speichern
            </Button>
          </form>
        )}
      </Card>

      {/* ── Weg zur Veröffentlichung ────────────────────────────────────── */}
      {darf['referenz.veroeffentlichen'] === true ? (
        <Card>
          <h2 className="mb-s3 mt-0 text-h3 text-text">Veröffentlichung</h2>
          <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
            Auf die Website stellen ist eine eigene Entscheidung mit einem eigenen Recht
            (<code className="font-mono">referenz.veroeffentlichen</code>). Die
            ausführliche Fassung zeigt vorher, was öffentlich würde.
          </p>
          <Link href={`/portal/${mandant}/website/referenzen/${referenzId}/veroeffentlichen`}
                data-cse="zur-veroeffentlichung"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            Zur Veröffentlichung
          </Link>
        </Card>
      ) : (
        <p className="max-w-prose text-xs text-text-subtle">
          Auf die Website stellen darf, wer{' '}
          <code className="font-mono">referenz.veroeffentlichen</code> hält — heute nur
          die Super-Administration. Diese Sitzung pflegt die Angaben; die Entscheidung
          fällt anderswo.
        </p>
      )}
    </PortalRahmen>
  );
}
