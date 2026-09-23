import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { WEBSITE_REFERENZ_TEXTE } from '@/lib/i18n/verwaltung/website-referenz';
import { istUuid } from '@/lib/uuid';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  freigabeGilt, ladeFreigabestand, type Freigabestand,
} from '@/server/services/auftrag/kundenfreigabe';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { WebsiteSpruenge } from '../../spruenge';

/**
 * `/portal/[mandant]/website/referenzen/neu` — eine Referenz anlegen
 * (PRO-05, V-154).
 *
 * **Der Befund.** Die Kundenfreigabe am Auftrag versprach „die öffentliche
 * Referenz legt danach ein Mensch unter `/website/referenzen` an" — und dort
 * gab es keinen Weg dazu. Ohne Seed stand auf der Liste „Für diese
 * Gesellschaft ist noch kein Projekt erfasst." und nichts daneben.
 *
 * **Die Seite legt einen ENTWURF an, sonst nichts.** Keine Kundenfreigabe,
 * kein Veröffentlichen: beides sind eigene Handlungen auf dem Blatt der neuen
 * Zeile, mit eigenem Beleg und eigenem Recht. Nach dem Anlegen führt die Route
 * dorthin, weil dort der nächste Schritt steht.
 *
 * **Aus einem Auftrag (`?auftrag=<id>`).** Die SEITENKARTE (§5.21) sagt
 * „created from an `auftrag` whose customer release is on file". Kommt der
 * Mensch von der Kundenfreigabe eines Auftrags, sind Titel und Kundenname
 * vorbelegt — aber nur, wenn die Freigabe dort GILT (`freigabeGilt`: erteilt
 * und nicht widerrufen), und nur diese zwei Felder: nie Auftragswert,
 * Ansprechpartner oder Vertragsinhalte (PRO-05). `referenz` bekommt dadurch
 * keinen Fremdschlüssel auf `auftrag` — die öffentliche Zeile ist eine
 * Neuschöpfung, und ein Kunde heisst öffentlich manchmal anders als in der
 * Kundenakte. Die Kennung des Auftrags reist nur als Hinweis mit, damit das
 * Blatt danach Datum und Beleg der Freigabe VORSCHLAGEN kann.
 *
 * **Zwei Rechte.** Das Tor verlangt `referenz.schreiben` (Manifest);
 * `t_referenz_pflege` verlangt für das `insert` zusätzlich
 * `referenz.kundenfreigabe_erfassen`. Ohne das zweite steht hier kein
 * Formular, sondern der Satz, welches Recht fehlt.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Neue Referenz' };

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

export default async function NeueReferenzSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/website/referenzen/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(WEBSITE_REFERENZ_TEXTE, zugang.sprache);
  const basis = verwaltungTexte(zugang.sprache);

  const darf = await haeltRechte(
    zugang.sitzung, 'referenz.schreiben', 'referenz.kundenfreigabe_erfassen',
    'auftrag.lesen');
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const schreibt = !nurLesen && darf['referenz.schreiben'] === true
    && darf['referenz.kundenfreigabe_erfassen'] === true;

  const suche = await searchParams;
  const abgewiesen = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const auftragId = istUuid(suche['auftrag']) ? suche['auftrag'] : null;

  /*
   * Der Auftrag wird nur gelesen, wenn die Sitzung ihn lesen darf. Ohne
   * `auftrag.lesen` antwortet die Policy mit nichts — und „nichts vorbelegt"
   * ist dann die richtige Antwort, keine Aussage über den Auftrag.
   */
  const stand = auftragId === null || darf['auftrag.lesen'] !== true
    ? null
    : await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, (kontext) => ladeFreigabestand(kontext, auftragId)),
    ) as Promise<Freigabestand | null>);
  const vorlage = stand !== null && freigabeGilt(stand) ? stand : null;

  const liste = `/portal/${mandant}/website/referenzen`;
  const zurueck = auftragId === null ? pfad : `${pfad}?auftrag=${auftragId}`;

  return (
    <PortalRahmen
      zurueck={{ ziel: liste, text: t.zurListe }}
      titel={t.anlegenTitel}
      wurzelTitel={t.wurzelTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={nurLesen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="referenzen" sitzung={zugang.sitzung} />
      <h1 className="mb-s4 mt-0 text-h1 text-text">{t.anlegenTitel}</h1>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">{t.anlegenEinleitung}</p>

      {abgewiesen === null ? null : (
        <Hinweis art="warnung" cse="referenz-anlegen-fehler" className="mb-s5 max-w-prose">
          <strong className="block">{t.nichtAngelegt}</strong>
          {t.fehler[abgewiesen] ?? t.fehlerSonst}
        </Hinweis>
      )}

      {vorlage !== null && (
        <Hinweis art="hinweis" cse="aus-auftrag" className="mb-s5 max-w-prose">
          <strong className="block">{t.ausAuftragTitel(vorlage.auftragsnummer)}</strong>
          {t.ausAuftragText}
          {darf['referenz.kundenfreigabe_erfassen'] === true && (
            <span className="mt-s2 block">
              <Link
                href={`/portal/${mandant}/auftraege/${vorlage.auftrag_id}/kundenfreigabe`}
                className="text-text underline underline-offset-2 hover:text-brand"
              >
                {t.zurKundenfreigabe}
              </Link>
            </span>
          )}
        </Hinweis>
      )}
      {auftragId !== null && vorlage === null && (
        <Hinweis art="warnung" cse="auftrag-ohne-freigabe" className="mb-s5 max-w-prose">
          {t.auftragOhneFreigabe}
        </Hinweis>
      )}

      {nurLesen && (
        <Hinweis art="hinweis" cse="gruppe-nur-lesen" className="mb-s5 max-w-prose">
          {basis.gruppeNurLesen}
        </Hinweis>
      )}

      {!schreibt && !nurLesen ? (
        <Hinweis art="warnung" cse="ohne-anlegerecht" className="mb-s5 max-w-prose">
          <strong className="block">{t.nurLesbarTitel}</strong>
          {t.nurLesbarText}{' '}
          <Recht schluessel="referenz.schreiben" sprache={zugang.sprache} />,{' '}
          <Recht schluessel="referenz.kundenfreigabe_erfassen" sprache={zugang.sprache} />.
        </Hinweis>
      ) : null}

      {schreibt && (
        <Card>
          <form method="post" action="/api/website/referenz"
                className="flex max-w-prose flex-col gap-s4" data-cse="referenz-anlegen">
            <input type="hidden" name="handlung" value="anlegen" />
            <input type="hidden" name="zurueck" value={zurueck} />
            {auftragId !== null && vorlage !== null && (
              <input type="hidden" name="auftrag" value={auftragId} />
            )}

            <FormField label={t.feldTitel} name="titel" required maxLength={200}
                       defaultValue={vorlage?.bezeichnung ?? ''} />
            <FormField label={t.feldSlug} name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*"
                       maxLength={120} hinweis={t.slugHinweis} />
            <FormField label={t.feldKunde} name="kundeName" maxLength={200}
                       defaultValue={vorlage?.kunde ?? ''} hinweis={t.kundeHinweis} />
            <div className="flex flex-col gap-s2">
              <label htmlFor="beschreibung" className="text-xs text-text-muted">
                {t.feldBeschreibung}
              </label>
              <textarea id="beschreibung" name="beschreibung" rows={6} className={FELD}
                        aria-describedby="beschreibung-hinweis" />
              <p id="beschreibung-hinweis" className="m-0 text-xs text-text-subtle">
                {t.beschreibungHinweis}
              </p>
            </div>
            <FormField label={t.feldJahr} name="jahr" type="number" min={1990} max={2100}
                       step={1} />

            <div className="flex flex-wrap items-center gap-s3">
              <Button type="submit" variante="primary" data-cse="referenz-anlegen-knopf">
                {t.anlegen}
              </Button>
              <Link href={liste}
                    className="inline-flex min-h-11 items-center rounded-md px-s4 py-s3 text-sm text-text-muted hover:bg-surface-2 hover:text-text">
                {t.abbrechen}
              </Link>
            </div>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}
