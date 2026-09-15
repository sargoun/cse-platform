import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  type KanalZeile, type Quellen, listeKanaele, quellenFuerBeitrag,
} from '@/server/services/social/dienst';
import { PLATTFORM_NAME, type Plattform } from '@/server/services/social/port';
import { mandantTor, MandantAntwort } from '../../../../unterseite';

/**
 * `/portal/[mandant]/social/posts/neu` — der Entwurf (SOC-02, SOC-04).
 *
 * **Er entsteht als Entwurf, immer.** Auf diesem Bildschirm gibt es keinen
 * Knopf, der veröffentlicht, und kein Feld, das die Freigabe überspringt: das
 * Formular kennt nur `POST /api/social/beitraege`, und die Route legt nur
 * Entwürfe an (SOC-08).
 *
 * **Die Quellen sind echt** (SOC-04). Projekte dieser Gesellschaft und
 * Referenzen mit Kundenfreigabe (PRO-05) — nichts Erfundenes, und Referenzen
 * ohne Freigabe stehen gar nicht erst zur Wahl.
 *
 * **Die Kanäle stehen mit ihrem Stand da.** Wer einen nicht verbundenen
 * auswählt, darf das — der Beitrag wartet dort dann sichtbar, statt still zu
 * verschwinden. Was er nicht darf, ist es nicht zu wissen.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Neuer Beitrag — Social Media' };

const ARTEN: readonly { readonly wert: string; readonly text: string }[] = [
  { wert: 'beitrag', text: 'Beitrag' },
  { wert: 'projektschau', text: 'Projektschau' },
  { wert: 'neuigkeit', text: 'Neuigkeit' },
  { wert: 'aktualisierung', text: 'Aktualisierung' },
];

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

export default async function NeuerBeitrag(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/social/posts/neu`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      quellen: await quellenFuerBeitrag(kontext),
      kanaele: await listeKanaele(kontext),
    }))) as Promise<{ quellen: Quellen; kanaele: readonly KanalZeile[] }>);

  return (
    <PortalRahmen
      titel="Neuer Beitrag"
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
        <h1 className="text-h1 text-text">Neuer Beitrag</h1>
        <Link href={`/portal/${mandant}/social/posts`}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
          Zurück zur Liste
        </Link>
      </div>

      <Hinweis art="hinweis" cse="neu-hinweis" className="mb-s5 max-w-prose">
        Der Beitrag entsteht als <strong>Entwurf</strong>. Er geht erst hinaus, nachdem ein
        Mensch ihn freigegeben hat — auf diesem Bildschirm gibt es dafür keinen Knopf,
        und das ist Absicht (SOC-08).
      </Hinweis>

      <form method="post" action="/api/social/beitraege" data-cse="beitrag-formular"
            className="flex max-w-prose flex-col gap-s4">
        <FormField label="Titel" name="titel" required maxLength={200}
                   hinweis="Er steht im Freigabe-Posteingang und auf der Gesellschaftsseite." />

        <div className="flex flex-col gap-s2">
          <label htmlFor="text" className="text-xs text-text-muted">Text</label>
          <textarea id="text" name="text" required rows={8} className={FELD}
                    data-cse="beitrag-text" />
          <p className="text-xs text-text-subtle">
            Was hier steht, geht so hinaus — unverändert und ohne Nachbearbeitung durch
            die Plattform.
          </p>
        </div>

        <div className="flex flex-col gap-s2">
          <label htmlFor="art" className="text-xs text-text-muted">Art</label>
          <select id="art" name="art" className={FELD} data-cse="beitrag-art">
            {ARTEN.map((a) => <option key={a.wert} value={a.wert}>{a.text}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-s2">
          <label htmlFor="projekt" className="text-xs text-text-muted">
            Aus einem Projekt (optional)
          </label>
          <select id="projekt" name="projekt_id" className={FELD} data-cse="beitrag-projekt">
            <option value="">— kein Projektbezug —</option>
            {daten.quellen.projekte.map((p) => (
              <option key={p.id} value={p.id}>{p.titel}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-s2">
          <label htmlFor="referenz" className="text-xs text-text-muted">
            Aus einer Referenz (optional)
          </label>
          <select id="referenz" name="referenz_id" className={FELD} data-cse="beitrag-referenz">
            <option value="">— kein Referenzbezug —</option>
            {daten.quellen.referenzen.map((r) => (
              <option key={r.id} value={r.id}>
                {r.titel}{r.hinweis === null ? '' : ` — ${r.hinweis}`}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-subtle">
            {daten.quellen.referenzen.length === 0
              ? 'Keine Referenz mit Kundenfreigabe. Ohne schriftliche Freigabe des Kunden '
                + 'steht hier keine zur Wahl — ein Kundenname auf einer Website ohne '
                + 'Zustimmung macht man durch Löschen nicht ungeschehen (PRO-05).'
              : 'Zur Wahl stehen nur Referenzen mit schriftlicher Kundenfreigabe (PRO-05).'}
          </p>
        </div>

        <fieldset className="flex flex-col gap-s2 border-0 p-0">
          <legend className="text-xs text-text-muted">Kanäle</legend>
          <p className="text-xs text-text-subtle">
            Die eigene Gesellschaftsseite ist immer dabei — sie ist kein Anschluss,
            sondern diese Plattform selbst (SOC-05).
          </p>
          {daten.kanaele.map((k) => (
            <label key={k.id} data-cse="kanal-wahl" data-verbunden={k.verbunden ? '1' : '0'}
                   className="flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="kanal" value={k.id}
                     className="size-4 accent-[var(--brand)]" />
              <span>{PLATTFORM_NAME[k.plattform as Plattform] ?? k.anzeigename}</span>
              {k.verbunden ? null : (
                <span className="text-xs text-warning">nicht verbunden</span>
              )}
            </label>
          ))}
        </fieldset>

        <Button type="submit" variante="primary" data-cse="beitrag-anlegen">
          Entwurf anlegen
        </Button>
      </form>
    </PortalRahmen>
  );
}
