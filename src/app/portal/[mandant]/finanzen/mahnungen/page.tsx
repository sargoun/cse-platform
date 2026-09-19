import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { ermittleVorschlaege } from '@/server/services/finanz/mahnung/lauf';
import { mahnungen, type MahnungStatus } from '@/server/services/finanz/mahnung/index';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { MAHNUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/mahnungen';

/**
 * `/portal/[mandant]/finanzen/mahnungen` — was überfällig ist, und was
 * deswegen vorgeschlagen wird (FIN-15, SPEC §14).
 *
 * **Die Seite zeigt zuerst, was der Lauf VORSCHLÄGT — und was er übergangen
 * hat, mit Grund.** Eine Mahnliste, die nur zeigt, was gemahnt wird,
 * verschweigt den teureren Teil: die Forderung, die niemand anmahnt, weil
 * eine Sperre steht oder weil keine bestätigte Stufe hinterlegt ist (O-19).
 * Beides steht hier nebeneinander.
 *
 * **Kein Knopf sendet etwas.** Aus dieser Liste entstehen Entwürfe. Der
 * Versand ist ein eigener Schritt auf dem Detailbildschirm, hinter einer
 * Freigabe (Invariante 7).
 *
 * **Kein Betrag wird hier gerechnet.** Gebühr, Zins und Summe stehen auf dem
 * Vorschlag, seit `ermittleVorschlaege` sie aus bestätigten Werten gebildet
 * hat; die Seite formatiert (Invariante 1, Invariante 6).
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<MahnungStatus, PillZustand>> = {
  entwurf: 'Entwurf',
  freigegeben: 'Bereit',
  versendet: 'Abgeschlossen',
  erledigt: 'Abgeschlossen',
  verworfen: 'Abgelehnt',
};

export default async function Mahnungen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/mahnungen`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(MAHNUNGEN_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      lage: await ermittleVorschlaege(kontext),
      briefe: await mahnungen(kontext),
    }))) as Promise<{
      lage: Awaited<ReturnType<typeof ermittleVorschlaege>>;
      briefe: Awaited<ReturnType<typeof mahnungen>>;
    }>);

  const summeVorschlag = daten.lage.vorschlaege.reduce((s, v) => s + v.gesamtCent, 0n);

  return (
    <PortalRahmen
      titel={t.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mahnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">{t.titel}</h1>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p
          data-cse="mahn-hinweis"
          className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text"
        >
          {hinweis}
        </p>
      ) : null}

      <section aria-labelledby="vorschlag-titel" className="mb-s7">
        <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 id="vorschlag-titel" className="text-h2 text-text">{t.vorschlaegeTitel}</h2>
          <p className="text-sm text-text-muted">
            {g.summe}:{' '}
            <strong className="text-text">{formatiereGeld(cent(summeVorschlag))}</strong>
          </p>
        </div>

        {daten.lage.vorschlaege.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.keinVorschlag}
          </p>
        ) : (
          <>
            <DataTable
              beschriftung={t.tabelleVorschlaege}
              zeilen={[...daten.lage.vorschlaege]}
              schluessel={(v) => `${v.kundeId}:${String(v.stufe)}`}
              spalten={[
                { schluessel: 'kunde', kopf: g.kunde, zelle: (v) => v.kundeName },
                {
                  schluessel: 'stufe', kopf: t.stufe,
                  zelle: (v) => `${String(v.stufe)} · ${v.bezeichnung}`,
                },
                {
                  schluessel: 'forderung', kopf: t.forderung, numerisch: true,
                  zelle: (v) => formatiereGeld(v.forderungCent),
                },
                {
                  schluessel: 'gebuehr', kopf: t.gebuehr, numerisch: true,
                  zelle: (v) => formatiereGeld(v.gebuehrCent),
                },
                {
                  schluessel: 'zins', kopf: t.verzugszins, numerisch: true,
                  zelle: (v) => formatiereGeld(v.zinsenCent),
                },
                {
                  schluessel: 'gesamt', kopf: g.summe, numerisch: true,
                  zelle: (v) => <strong>{formatiereGeld(v.gesamtCent)}</strong>,
                },
              ]}
            />
            {daten.lage.vorschlaege.some((v) => v.hinweise.length > 0) ? (
              <ul className="mt-s3 max-w-prose list-disc pl-s5 text-xs text-text-muted">
                {[...new Set(daten.lage.vorschlaege.flatMap((v) => v.hinweise))].map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            ) : null}
            <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
              <input type="hidden" name="aktion" value="entwuerfe" />
              <button
                type="submit"
                className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
              >
                {t.entwuerfeAnlegen}
              </button>
            </form>
            <p className="mt-s3 max-w-prose text-xs text-text-muted">
              {t.entwurfOhneNummer}
            </p>
          </>
        )}
      </section>

      {daten.lage.uebergangen.length === 0 ? null : (
        <section aria-labelledby="uebergangen-titel" className="mb-s7">
          <h2 id="uebergangen-titel" className="mb-s3 text-h2 text-text">
            {t.uebergangenTitel}
          </h2>
          <DataTable
            beschriftung={t.tabelleUebergangen}
            zeilen={[...daten.lage.uebergangen]}
            schluessel={(u) => u.offenerPostenId}
            spalten={[
              {
                schluessel: 'rechnung', kopf: t.rechnung,
                zelle: (u) => u.rechnungsnummer ?? '—',
              },
              { schluessel: 'kunde', kopf: g.kunde, zelle: (u) => u.kundeName },
              { schluessel: 'grund', kopf: t.grund, zelle: (u) => u.grund },
            ]}
          />
        </section>
      )}

      <section aria-labelledby="briefe-titel">
        <h2 id="briefe-titel" className="mb-s3 text-h2 text-text">{t.briefeTitel}</h2>
        {daten.briefe.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.keineMahnung}
          </p>
        ) : (
          <DataTable
            beschriftung={t.tabelleBriefe}
            zeilen={[...daten.briefe]}
            schluessel={(m) => m.id}
            spalten={[
              {
                schluessel: 'nummer', kopf: g.nummer,
                zelle: (m) => (
                  <Link
                    href={`/portal/${mandant}/finanzen/mahnungen/${m.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {m.nummer ?? t.entwurf}
                  </Link>
                ),
              },
              { schluessel: 'kunde', kopf: g.kunde, zelle: (m) => m.kundeName },
              { schluessel: 'stufe', kopf: t.stufe, zelle: (m) => String(m.stufe) },
              { schluessel: 'datum', kopf: g.datum, zelle: (m) => m.mahndatum },
              {
                schluessel: 'gesamt', kopf: g.summe, numerisch: true,
                zelle: (m) => formatiereGeld(m.gesamtCent),
              },
              {
                schluessel: 'zustand', kopf: g.zustand,
                zelle: (m) => <StatusPill zustand={PILLE[m.status]} sprache={zugang.sprache} />,
              },
            ]}
          />
        )}
      </section>
    </PortalRahmen>
  );
}
