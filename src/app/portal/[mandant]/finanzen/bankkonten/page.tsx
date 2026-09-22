import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { BANKKONTEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/bankkonten';
import { bankkonten } from '@/server/services/finanz/zahlung/index';

/**
 * `/portal/[mandant]/finanzen/bankkonten` — die Konten dieser Gesellschaft
 * (V-007, FIN-15, ACC-04).
 *
 * **Der Befund: „Eingegangen auf" kannte nur Seed-Konten.** `legeBankkontoAn`
 * gibt es seit `0121`, mit Prüfzifferprüfung und eigener Policy; aufgerufen
 * wurde sie von keiner Seite und keiner Route — nur von Tests. Eine
 * Gesellschaft ohne Demodaten hatte damit kein Konto, das eine Rechnung
 * nennen oder ein Zahlungseingang treffen könnte.
 *
 * **Das Formular steht UNTER der Liste, nicht auf einer eigenen Seite.** Ein
 * Bankkonto hat fünf Felder; ein eigener Weg dafür wäre ein Klick mehr für
 * etwas, das man zweimal im Jahr tut — und die Liste daneben zeigt sofort,
 * ob es das Konto schon gibt.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'zahlung.schreiben';
const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

export const metadata = { title: 'Bankkonten' };

export default async function Bankkonten(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/finanzen/bankkonten`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(BANKKONTEN_TEXTE, zugang.sprache);

  const darf = await haeltRechte(zugang.sitzung, RECHT, 'zahlung.lesen');
  const suche = await searchParams;
  const hinweis = typeof suche['hinweis'] === 'string' ? suche['hinweis'] : null;

  const konten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => bankkonten(kontext))
  ) as Promise<Awaited<ReturnType<typeof bankkonten>>>);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['zahlung.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/finanzen/zahlungen`,
                     text: t.zurueckZahlungen } }
        : {})}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      {hinweis === 'bankkonto' && (
        <Hinweis art="erfolg" cse="bankkonto-angelegt" className="mb-s5 max-w-prose">
          {t.angelegt}
        </Hinweis>
      )}

      {konten.length === 0 ? (
        <Hinweis art="warnung" cse="keine-bankkonten" className="mb-s6 max-w-prose">
          <strong className="block">{t.keine}</strong>
          {t.keineErklaerung}
        </Hinweis>
      ) : (
        <div className="mb-s6">
          <DataTable
            beschriftung={t.titel}
            zeilen={konten}
            schluessel={(k) => k.id}
            spalten={[
              {
                schluessel: 'bezeichnung', kopf: t.bezeichnung,
                zelle: (k) => (
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    {k.bezeichnung}
                    {k.istStandard && (
                      <StatusPill zustand="Aktiv" sprache={zugang.sprache} />
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'iban', kopf: t.iban,
                /* Die IBAN steht als EINE Zeichenkette — nie gruppiert. */
                zelle: (k) => <span className="font-mono text-xs">{k.iban}</span>,
              },
              { schluessel: 'bic', kopf: t.bic, zelle: (k) => k.bic ?? '—' },
              {
                schluessel: 'inhaber', kopf: t.kontoinhaber,
                zelle: (k) => k.kontoinhaber,
              },
            ]}
          />
        </div>
      )}

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht}{' '}
          <code className="font-mono">{RECHT}</code>.
        </Hinweis>
      ) : (
        <Card>
          <h2 className="mb-s4 mt-0 text-h3 text-text">{t.anlegenTitel}</h2>
          <form
            method="post"
            action={`/api/finanzen/zahlungen?mandant=${mandant}`}
            data-cse="bankkonto-formular"
            className="flex max-w-[56ch] flex-col gap-s4"
          >
            <input type="hidden" name="aktion" value="bankkonto" />
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.bezeichnung}
              <input type="text" name="bezeichnung" required maxLength={120}
                     className={FELD} placeholder={t.bezeichnungBeispiel}
                     data-cse="bankkonto-bezeichnung" />
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.iban}
              <input type="text" name="iban" required maxLength={40} className={FELD}
                     data-cse="bankkonto-iban" />
              <span className="text-xs text-text-muted">{t.ibanErklaerung}</span>
            </label>
            <div className="flex flex-wrap gap-s4">
              <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                {t.bic} <span className="text-text-muted">{t.freiwillig}</span>
                <input type="text" name="bic" maxLength={11} className={FELD} />
              </label>
              <label className="flex flex-[2] flex-col gap-s2 text-sm text-text">
                {t.kontoinhaber}
                <input type="text" name="kontoinhaber" required maxLength={200}
                       className={FELD} data-cse="bankkonto-inhaber" />
              </label>
            </div>
            <span className="text-xs text-text-muted">{t.kontoinhaberErklaerung}</span>
            <label className="flex min-h-11 items-center gap-s2 text-sm text-text">
              <input type="checkbox" name="ist_standard" value="ja"
                     className="h-4 w-4 accent-[var(--farbe-brand)]"
                     data-cse="bankkonto-standard" />
              {t.istStandard}
            </label>
            <span className="text-xs text-text-muted">{t.istStandardErklaerung}</span>
            <div>
              <Button type="submit" variante="primary" data-cse="bankkonto-speichern">
                {t.anlegen}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}
