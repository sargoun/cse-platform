import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { leseAusgangsbuch, stimmeAb } from '@/server/services/finanz/ausgangsbuch';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { UEBERSICHT_TEXTE } from '@/lib/i18n/verwaltung/finanzen/uebersicht';

/**
 * `/portal/[mandant]/finanzen/ausgangsbuch` — die Folge der ausgestellten
 * Rechnungen (FIN-16, FIN-06, LEG-01).
 *
 * **Die Abstimmung steht OBEN, nicht unten.** Wer das Ausgangsbuch öffnet,
 * fragt zuerst: stimmt es? Drei Aussagen beantworten das — lückenlos,
 * summengleich, jedes Glied da —, und sie stehen über der Liste, damit
 * niemand sie überliest.
 *
 * **Die Summe wird zweimal gebildet.** Einmal aus der Sicht, einmal aus der
 * Belegtabelle daneben. Weichen sie ab, ist die Sicht falsch — und eine
 * Sicht mit einem falschen Join zeigt plausible Zahlen, bis jemand
 * nachrechnet. Deshalb rechnet hier immer jemand nach.
 *
 * **Entwürfe stehen nicht darin**, und das ist die Zusage, nicht die
 * Auslassung: sie haben keine Nummer und keine rechtliche Existenz.
 */
export const dynamic = 'force-dynamic';

export default async function Ausgangsbuch(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/ausgangsbuch`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * `/finanzen/rechnungen/[id]` verlangt laut Manifest `finanzen.lesen`; diese
   * Seite oeffnet mit `nummernkreis.lesen`. Wer das Buch abstimmen darf, darf
   * nicht zwangslaeufig den Beleg oeffnen — der Verweis fuehrte dann auf 404
   * und verriete, was er nicht zeigen darf (AUT-06, Copilot-Runde auf PR 16 /
   * D-581). Ohne das Recht steht die Nummer als blosser Text.
   */
  const darf = await haeltRechte(sitzung, 'finanzen.lesen');

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(UEBERSICHT_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const jahrRoh = typeof suche['jahr'] === 'string' ? suche['jahr'] : null;
  const jahr = jahrRoh !== null && /^\d{4}$/u.test(jahrRoh) ? Number(jahrRoh) : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      zeilen: await leseAusgangsbuch(kontext, { jahr }),
      abstimmung: await stimmeAb(kontext, { jahr }),
    }))) as Promise<{
      zeilen: Awaited<ReturnType<typeof leseAusgangsbuch>>;
      abstimmung: Awaited<ReturnType<typeof stimmeAb>>;
    }>);

  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel={t.ausgangsbuchTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="ausgangsbuch"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        {/*
          `min-w-0`: „Rechnungsausgangsbuch" ist ein Wort ohne Trennstelle
          und steht in einer Flex-Zeile. Am Telefon bleibt es knapp unter der
          Kante — dieselbe Lage wie `verfahrensdokumentation`, nur zwei
          Zeichen kuerzer (D-609). Ohne `min-w-0` haelt das Flex-Element die
          Mindestbreite des Wortes, bevor `overflow-wrap: anywhere` greift.
        */}
        <h1 className="min-w-0 text-h1 text-text">{t.ausgangsbuchUeberschrift}</h1>
        <form method="get" className="flex items-center gap-s3">
          <label className="text-sm text-text" htmlFor="jahr">{t.jahr}</label>
          <input
            id="jahr" name="jahr" type="number" min="2000" max="2999" step="1"
            defaultValue={jahr ?? ''} placeholder={t.jahrAlle} className={feld}
          />
          <button
            type="submit"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
          >
            {t.anzeigen}
          </button>
        </form>
      </div>

      <section aria-labelledby="abstimmung-titel" className="mb-s7">
        <h2 id="abstimmung-titel" className="mb-s3 text-h2 text-text">{t.abstimmung}</h2>
        {daten.abstimmung.kreise.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.keineRechnungImZeitraum}
          </p>
        ) : (
          <div
            data-cse="ausgangsbuch-abstimmung"
            data-ok={String(daten.abstimmung.ok)}
            className={`rounded-lg border p-s5 text-sm ${
              daten.abstimmung.ok
                ? 'border-line bg-surface text-text'
                : 'border-warning bg-warning-soft text-warning'}`}
          >
            <ul className="flex flex-col gap-s3">
              {daten.abstimmung.kreise.map((k) => (
                <li key={k.nummernkreis}>
                  <strong className="text-text">{k.nummernkreis}</strong>:{' '}
                  {`${String(k.anzahl)} ${t.belegeWort}, ${t.nummernWort} `
                    + `${String(k.ersteNummer)}–${String(k.letzteNummer)}, `
                    + `${t.summeKlein} ${formatiereGeld(k.summeBuchCent)}`}
                  {k.summeBuchCent === k.summeBelegeCent
                    ? ` ${t.buchUndBelegeStimmen}`
                    : ` ${t.abweichungVor} ${formatiereGeld(k.summeBelegeCent)}`}
                  {k.luecken.length === 0 ? '' : ` ${t.lueckeBei} ${k.luecken.join(', ')}`}
                  {k.ohneKettenglied === 0
                    ? ''
                    : ` · ${String(k.ohneKettenglied)} ${t.ohneKettenglied}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {daten.zeilen.length === 0 ? null : (
        <DataTable
          beschriftung={t.tabelleAusgangsbuch}
          zeilen={daten.zeilen}
          schluessel={(z) => z.rechnungId}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: g.nummer,
              zelle: (z) => (darf['finanzen.lesen'] !== true ? z.nummer : (
                <Link
                  href={`/portal/${mandant}/finanzen/rechnungen/${z.rechnungId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.nummer}
                </Link>
              )),
            },
            { schluessel: 'datum', kopf: g.datum, zelle: (z) => z.rechnungsdatum },
            {
              schluessel: 'kunde', kopf: t.kundeWieBeleg,
              zelle: (z) => z.kundeName ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'art', kopf: g.art,
              zelle: (z) => t.artNamen[z.rechnungsart as keyof typeof t.artNamen]
                ?? z.rechnungsart,
            },
            {
              schluessel: 'netto', kopf: t.nettoKopf, numerisch: true,
              zelle: (z) => formatiereGeld(z.nettoCent),
            },
            {
              schluessel: 'steuer', kopf: t.ustKopf, numerisch: true,
              zelle: (z) => formatiereGeld(z.steuerCent),
            },
            {
              schluessel: 'brutto', kopf: t.bruttoKopf, numerisch: true,
              zelle: (z) => formatiereGeld(z.bruttoCent),
            },
            {
              schluessel: 'kette', kopf: t.ketteKopf,
              zelle: (z) => (z.hash === null
                ? <StatusPill zustand="Fehler" sprache={zugang.sprache} />
                : (
                  <span className="font-mono text-xs text-text-muted">
                    #{z.kettePosition} · {z.hash.slice(0, 8)}
                  </span>
                )),
            },
            {
              schluessel: 'hinweis',
              kopf: t.hinweisKopf,
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  {z.storniert
                    ? <StatusPill zustand="Archiviert" sprache={zugang.sprache} />
                    : null}
                  {z.luecke ? <StatusPill zustand="Fehler" sprache={zugang.sprache} /> : null}
                  {z.storniert
                    ? <span className="text-xs text-text-muted">{t.storniertKlein}</span>
                    : null}
                  {z.luecke
                    ? <span className="text-xs text-warning">{t.lueckeDavor}</span>
                    : null}
                </span>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        {`${t.ausgangsbuchFussnote} ${t.summeKlein} `
          + `${formatiereGeld(cent(daten.zeilen.reduce((s, z) => s + z.bruttoCent, 0n)))} `
          + `${t.ueber} ${String(daten.zeilen.length)} ${t.belegeWort}.`}
      </p>
    </PortalRahmen>
  );
}
