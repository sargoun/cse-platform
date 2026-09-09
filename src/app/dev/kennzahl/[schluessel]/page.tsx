import { notFound } from 'next/navigation';
import type postgres from 'postgres';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withDevAdmin } from '@/server/kontext/dev';
import { registriereBerichtKacheln } from '@/server/services/bericht/kacheln';
import { kachelWert, kachelZeilen } from '@/server/services/bericht/dashboard';
import { findeKachel, kacheln } from '@/server/registry/kennzahlen';

/**
 * Die Zeilen HINTER einer Kachel (DSH-04).
 *
 * **Eine Seite fuer alle Kacheln, nicht eine je Kachel.** Sie rendert
 * `kachel.zeilen` — dasselbe Praedikat, aus dem auch die Zahl entsteht.
 * Damit stimmt die Zeilenzahl mit der Kachelzahl *per Konstruktion*: sie
 * koennen gar nicht auseinanderlaufen, weil es nur eine Bedingung gibt.
 *
 * Modulspezifische Listen mit Filtern und Sortierung kommen mit ihren
 * Modulen; diese hier beantwortet die eine Frage, die eine Kachel aufwirft —
 * WELCHE vierzehn?
 */
export const dynamic = 'force-dynamic';

let registriert = false;
function stelleSicherRegistriert(): void {
  if (registriert || kacheln().length > 0) { registriert = true; return; }
  registriereBerichtKacheln();
  registriert = true;
}

/** Was in einer Zelle steht — ohne `any`, und ohne `[object Object]`. */
function zelle(wert: unknown): string {
  if (wert === null || wert === undefined) return '—';
  if (wert instanceof Date) {
    // Invariante 2: gespeichert UTC, angezeigt Europe/Berlin.
    return wert.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  }
  if (typeof wert === 'object') return JSON.stringify(wert);
  return String(wert);
}

export default async function KennzahlSeite(
  { params, searchParams }: {
    params: Promise<{ schluessel: string }>;
    searchParams: Promise<Record<string, string | undefined>>;
  },
) {
  if (!devFlaechenAn()) notFound();
  stelleSicherRegistriert();

  const { schluessel } = await params;
  const kachel = findeKachel(schluessel);
  // Ein unbekannter Schlüssel ist 404 und keine leere Tabelle: eine leere
  // Tabelle sähe aus wie "es gibt nichts".
  if (kachel === undefined) notFound();

  const { bereich } = await searchParams;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) => {
    const bereiche = (await tx.unsafe(
      `select id, slug, name from mandant where archiviert_am is null`,
    )) as { id: string; slug: string; name: string }[];
    const gewaehlt = bereich === undefined || bereich === 'gruppe'
      ? null
      : bereiche.find((b) => b.slug === bereich || b.id === bereich)?.id ?? null;

    return withDevAdmin(tx, gewaehlt, async (kontext) => {
      const kontextWerte = { mandantId: gewaehlt, mandantIds: kontext.mandantIds };
      return {
        wert: await kachelWert(kontext, kachel, kontextWerte),
        zeilen: await kachelZeilen(kontext, kachel, kontextWerte),
        name: bereiche.find((b) => b.id === gewaehlt)?.name ?? 'Alle Bereiche',
      };
    });
  }) as Promise<{ wert: number; zeilen: readonly Record<string, unknown>[]; name: string }>);

  const spalten = daten.zeilen[0] === undefined ? [] : Object.keys(daten.zeilen[0]);

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s5 p-s6">
      <p className="text-sm text-text-muted">
        <a href="/dev/dashboard" className="underline">← Übersicht</a>
      </p>
      <h1 className="text-h1 text-text">{kachel.label}</h1>
      <p className="text-sm text-text-muted">
        {daten.name} · <span data-cse="kennzahl-wert">{daten.wert}</span> Einträge
      </p>

      {daten.zeilen.length === 0 ? (
        <p className="text-base text-text-muted">Keine Einträge.</p>
      ) : (
        <div className="overflow-x-auto">
          <table data-cse="kennzahl-tabelle" className="w-full text-left text-sm">
            <caption className="sr-only">{kachel.label}</caption>
            <thead>
              <tr className="text-text-subtle">
                {spalten.map((s) => (
                  <th key={s} scope="col" className="p-s3">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {daten.zeilen.map((z, i) => (
                <tr key={String(z['id'] ?? i)} data-cse="kennzahl-zeile"
                    className="border-t border-line">
                  {spalten.map((s) => (
                    <td key={s} className="p-s3 text-text-muted">{zelle(z[s])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
