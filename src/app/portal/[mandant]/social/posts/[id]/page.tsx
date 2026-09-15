import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  type BeitragKanalZeile, type BeitragZeile, type KanalZeile,
  kanaeleZuBeitrag, ladeBeitrag, listeKanaele,
} from '@/server/services/social/dienst';
import { PLATTFORM_NAME, type Plattform } from '@/server/services/social/port';
import {
  SCHRITT_TEXT, STATUS_TEXT, type Schritt, darfBearbeiten, moeglicheSchritte,
} from '@/server/services/social/weg';
import { mandantTor, MandantAntwort } from '../../../../unterseite';

/**
 * `/portal/[mandant]/social/posts/[id]` — der Beitrag und sein Stand
 * (SOC-03, SOC-07, SOC-08).
 *
 * **Die Knöpfe kommen aus derselben Regel wie der Dienst** (`weg.ts`). Eine
 * Oberfläche, die einen Knopf zeigt, den der Dienst abweist, ist ein
 * Fehlerbericht mit Verzögerung — und eine, die einen verschweigt, den er
 * erlaubt, lässt jemanden einen Umweg suchen, den es nicht gibt.
 *
 * **Freigeben und Ablehnen stehen NICHT hier.** Sie fallen im
 * Freigabe-Posteingang, wo die Entscheidung protokolliert und verkettet wird
 * (APR-02, K-13). Ein zweiter Knopf dafür wäre ein zweiter Weg zur selben
 * Entscheidung — und der eine ohne Kette.
 *
 * **Je Kanal steht sein Ergebnis.** „nicht verbunden" ist eine Auskunft, kein
 * Fehler; „veröffentlicht" steht nur da, wo wirklich etwas ankam (SOC-07).
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const ARTEN: readonly { readonly wert: string; readonly text: string }[] = [
  { wert: 'beitrag', text: 'Beitrag' },
  { wert: 'projektschau', text: 'Projektschau' },
  { wert: 'neuigkeit', text: 'Neuigkeit' },
  { wert: 'aktualisierung', text: 'Aktualisierung' },
];

const ERGEBNIS: Readonly<Record<string, { readonly pill: 'Aktiv' | 'Wartet' | 'Inaktiv' | 'Überfällig'; readonly text: string }>> = {
  offen: { pill: 'Wartet', text: 'wartet auf die Veröffentlichung' },
  veroeffentlicht: { pill: 'Aktiv', text: 'veröffentlicht' },
  nicht_verbunden: { pill: 'Inaktiv', text: 'nicht verbunden — nichts ging hinaus' },
  fehlgeschlagen: { pill: 'Überfällig', text: 'fehlgeschlagen' },
};

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

export default async function Beitrag(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/social/posts/[id]`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const suche = await searchParams;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      beitrag: await ladeBeitrag(kontext, id),
      kanaele: await kanaeleZuBeitrag(kontext, id),
      alle: await listeKanaele(kontext),
    }))) as Promise<{
      beitrag: BeitragZeile | null;
      kanaele: readonly BeitragKanalZeile[];
      alle: readonly KanalZeile[];
    }>);

  const b = daten.beitrag;
  if (b === null) notFound();

  const schritte = moeglicheSchritte(b.status)
    .filter((s): s is Schritt => s !== 'freigeben' && s !== 'ablehnen');
  const gewaehlt = new Set(daten.kanaele.map((k) => k.kanalId));
  const bearbeitbar = darfBearbeiten(b.status);

  return (
    <PortalRahmen
      titel={b.titel}
      wurzelTitel="Social Media"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="min-w-0 text-h1 text-text hyphens-auto">{b.titel}</h1>
        <span data-cse="beitrag-stand" data-status={b.status}
              className="text-sm text-text-muted">
          {STATUS_TEXT[b.status] ?? b.status}
        </span>
      </div>

      {suche['angelegt'] === '1' ? (
        <Hinweis art="hinweis" cse="beitrag-angelegt" className="mb-s5 max-w-prose">
          Der Entwurf steht. Er geht hinaus, nachdem ein Mensch ihn freigegeben hat.
        </Hinweis>
      ) : null}

      {b.status === 'vorgelegt' && b.freigabeId !== null ? (
        <Hinweis art="hinweis" cse="beitrag-wartet" className="mb-s5 max-w-prose">
          <strong>Er liegt im Freigabe-Posteingang.</strong> Entschieden wird dort, nicht
          hier — die Entscheidung wird protokolliert und verkettet (APR-02).{' '}
          <Link href={`/portal/${mandant}/freigaben/${b.freigabeId}`}
                className="underline underline-offset-4" data-cse="zur-freigabe">
            Zur Freigabe
          </Link>.
        </Hinweis>
      ) : null}

      {b.status === 'abgelehnt' ? (
        <Hinweis art="warnung" cse="beitrag-abgelehnt" className="mb-s5 max-w-prose">
          <strong>Abgelehnt.</strong> Über „Überarbeiten" wird er wieder Entwurf; die alte
          Freigabe fällt dabei weg, weil sie für den alten Text galt.
        </Hinweis>
      ) : null}

      {b.zurueckgezogenAm !== null ? (
        <Hinweis art="warnung" cse="beitrag-zurueckgezogen" className="mb-s5 max-w-prose">
          <strong>Zurückgezogen am {BERLIN.format(new Date(b.zurueckgezogenAm))}.</strong>{' '}
          Was auf einer fremden Plattform steht, nimmt diese Plattform nicht zurück — das
          geschieht dort, von Hand.
        </Hinweis>
      ) : null}

      <section className="mb-s6" data-cse="beitrag-inhalt">
        <h2 className="mb-s3 text-h2 text-text">Inhalt</h2>
        <form method="post" action={`/api/social/beitraege/${id}`}
              className="flex max-w-prose flex-col gap-s4">
          <FormField label="Titel" name="titel" defaultValue={b.titel} required
                     maxLength={200} disabled={!bearbeitbar} />
          <div className="flex flex-col gap-s2">
            <label htmlFor="text" className="text-xs text-text-muted">Text</label>
            <textarea id="text" name="text" required rows={8} className={FELD}
                      defaultValue={b.text} disabled={!bearbeitbar} data-cse="beitrag-text" />
          </div>
          <div className="flex flex-col gap-s2">
            <label htmlFor="art" className="text-xs text-text-muted">Art</label>
            <select id="art" name="art" className={FELD} defaultValue={b.art}
                    disabled={!bearbeitbar} data-cse="beitrag-art">
              {ARTEN.map((a) => <option key={a.wert} value={a.wert}>{a.text}</option>)}
            </select>
          </div>
          <fieldset className="flex flex-col gap-s2 border-0 p-0" disabled={!bearbeitbar}>
            <legend className="text-xs text-text-muted">Kanäle</legend>
            {daten.alle.map((k) => (
              <label key={k.id} className="flex min-h-11 items-center gap-s3 text-sm text-text">
                <input type="checkbox" name="kanal" value={k.id}
                       defaultChecked={gewaehlt.has(k.id)}
                       className="size-4 accent-[var(--brand)]" />
                <span>{PLATTFORM_NAME[k.plattform as Plattform] ?? k.anzeigename}</span>
                {k.verbunden ? null : (
                  <span className="text-xs text-warning">nicht verbunden</span>
                )}
              </label>
            ))}
          </fieldset>
          {bearbeitbar ? (
            <Button type="submit" variante="primary" data-cse="beitrag-speichern">
              Speichern
            </Button>
          ) : (
            <p className="max-w-prose text-xs text-text-subtle" data-cse="nicht-bearbeitbar">
              Bearbeitet wird nur der Entwurf. Die Freigabe hängt am Text, der vorlag — wer
              ihn danach ändert, hätte keine Freigabe mehr für das, was hinausgeht.
            </p>
          )}
        </form>
      </section>

      <section className="mb-s6" data-cse="beitrag-kanaele">
        <h2 className="mb-s3 text-h2 text-text">Wohin er geht</h2>
        <ul className="flex flex-col gap-s2">
          <li data-cse="kanal-ergebnis" data-plattform="website"
              className="flex flex-wrap items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s3">
            <span className="text-sm text-text">Eigene Gesellschaftsseite</span>
            <span className="flex items-center gap-s3">
              <span className="text-xs text-text-subtle">
                {b.status === 'veroeffentlicht' && b.zurueckgezogenAm === null
                  ? `öffentlich seit ${b.veroeffentlichtAm === null ? '—' : BERLIN.format(new Date(b.veroeffentlichtAm))}`
                  : 'noch nicht öffentlich'}
              </span>
              <StatusPill zustand={
                b.status === 'veroeffentlicht' && b.zurueckgezogenAm === null ? 'Aktiv' : 'Wartet'
              } />
            </span>
          </li>
          {daten.kanaele.map((k) => {
            const e = ERGEBNIS[k.ergebnis] ?? ERGEBNIS['offen']!;
            return (
              <li key={k.kanalId} data-cse="kanal-ergebnis" data-plattform={k.plattform}
                  data-ergebnis={k.ergebnis}
                  className="flex flex-wrap items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s3">
                <span className="min-w-0">
                  <span className="text-sm text-text">{PLATTFORM_NAME[k.plattform]}</span>
                  {k.meldung === null ? null : (
                    <span className="mt-s1 block max-w-prose text-xs text-text-subtle">
                      {k.meldung}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-s3">
                  <span className="text-xs text-text-subtle">{e.text}</span>
                  <StatusPill zustand={e.pill} />
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section data-cse="beitrag-schritte">
        <h2 className="mb-s3 text-h2 text-text">Nächster Schritt</h2>
        {schritte.length === 0 ? (
          <p className="max-w-prose text-sm text-text-muted">
            Von hier führt kein Schritt weiter. Wer denselben Text noch einmal will, legt
            einen neuen Beitrag an — und der geht seinen eigenen Weg durch die Freigabe.
          </p>
        ) : (
          <div className="flex flex-col gap-s3">
            {schritte.map((s) => (
              <form key={s} method="post" action={`/api/social/beitraege/${id}/schritt`}
                    className="flex flex-wrap items-end gap-s3">
                <input type="hidden" name="schritt" value={s} />
                {s === 'zuruecknehmen' ? (
                  <FormField label="Grund" name="grund" required className="min-w-64 flex-1"
                             hinweis="Er steht im Protokoll — jemand wird danach fragen." />
                ) : null}
                <Button type="submit" variante={s === 'vorlegen' ? 'primary' : 'secondary'}
                        data-cse={`schritt-${s}`}>
                  {SCHRITT_TEXT[s]}
                </Button>
              </form>
            ))}
            {b.status === 'freigegeben' ? (
              <Link href={`/portal/${mandant}/social/posts/${id}/planung`}
                    data-cse="zur-planung"
                    className="inline-flex min-h-11 w-fit items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
                Auf einen Zeitpunkt legen
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </PortalRahmen>
  );
}
