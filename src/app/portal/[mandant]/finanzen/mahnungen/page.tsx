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
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

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
      titel="Mahnungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mahnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">Mahnungen</h1>

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
          <h2 id="vorschlag-titel" className="text-h2 text-text">Vorschläge des Laufs</h2>
          <p className="text-sm text-text-muted">
            Summe:{' '}
            <strong className="text-text">{formatiereGeld(cent(summeVorschlag))}</strong>
          </p>
        </div>

        {daten.lage.vorschlaege.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Kein Vorschlag. Entweder ist nichts überfällig — oder alles
            Überfällige steht unten unter „Übergangen“, mit Grund.
          </p>
        ) : (
          <>
            <DataTable
              beschriftung="Mahnvorschläge mit Kunde, Stufe, Forderung, Gebühr, Zins und Summe"
              zeilen={[...daten.lage.vorschlaege]}
              schluessel={(v) => `${v.kundeId}:${String(v.stufe)}`}
              spalten={[
                { schluessel: 'kunde', kopf: 'Kunde', zelle: (v) => v.kundeName },
                {
                  schluessel: 'stufe', kopf: 'Stufe',
                  zelle: (v) => `${String(v.stufe)} · ${v.bezeichnung}`,
                },
                {
                  schluessel: 'forderung', kopf: 'Forderung', numerisch: true,
                  zelle: (v) => formatiereGeld(v.forderungCent),
                },
                {
                  schluessel: 'gebuehr', kopf: 'Gebühr', numerisch: true,
                  zelle: (v) => formatiereGeld(v.gebuehrCent),
                },
                {
                  schluessel: 'zins', kopf: 'Verzugszins', numerisch: true,
                  zelle: (v) => formatiereGeld(v.zinsenCent),
                },
                {
                  schluessel: 'gesamt', kopf: 'Summe', numerisch: true,
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
                Entwürfe anlegen
              </button>
            </form>
            <p className="mt-s3 max-w-prose text-xs text-text-muted">
              Ein Entwurf trägt keine Nummer und geht nirgendwohin. Die Nummer
              entsteht mit der Freigabe, der Versand ist ein Schritt danach.
            </p>
          </>
        )}
      </section>

      {daten.lage.uebergangen.length === 0 ? null : (
        <section aria-labelledby="uebergangen-titel" className="mb-s7">
          <h2 id="uebergangen-titel" className="mb-s3 text-h2 text-text">
            Übergangen — und warum
          </h2>
          <DataTable
            beschriftung="Überfällige Forderungen, die nicht gemahnt werden, mit Grund"
            zeilen={[...daten.lage.uebergangen]}
            schluessel={(u) => u.offenerPostenId}
            spalten={[
              {
                schluessel: 'rechnung', kopf: 'Rechnung',
                zelle: (u) => u.rechnungsnummer ?? '—',
              },
              { schluessel: 'kunde', kopf: 'Kunde', zelle: (u) => u.kundeName },
              { schluessel: 'grund', kopf: 'Grund', zelle: (u) => u.grund },
            ]}
          />
        </section>
      )}

      <section aria-labelledby="briefe-titel">
        <h2 id="briefe-titel" className="mb-s3 text-h2 text-text">Mahnungen</h2>
        {daten.briefe.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Es liegt keine Mahnung vor.
          </p>
        ) : (
          <DataTable
            beschriftung="Mahnungen mit Nummer, Kunde, Stufe, Summe und Zustand"
            zeilen={[...daten.briefe]}
            schluessel={(m) => m.id}
            spalten={[
              {
                schluessel: 'nummer', kopf: 'Nummer',
                zelle: (m) => (
                  <Link
                    href={`/portal/${mandant}/finanzen/mahnungen/${m.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {m.nummer ?? 'Entwurf'}
                  </Link>
                ),
              },
              { schluessel: 'kunde', kopf: 'Kunde', zelle: (m) => m.kundeName },
              { schluessel: 'stufe', kopf: 'Stufe', zelle: (m) => String(m.stufe) },
              { schluessel: 'datum', kopf: 'Datum', zelle: (m) => m.mahndatum },
              {
                schluessel: 'gesamt', kopf: 'Summe', numerisch: true,
                zelle: (m) => formatiereGeld(m.gesamtCent),
              },
              {
                schluessel: 'zustand', kopf: 'Zustand',
                zelle: (m) => <StatusPill zustand={PILLE[m.status]} />,
              },
            ]}
          />
        )}
      </section>
    </PortalRahmen>
  );
}
