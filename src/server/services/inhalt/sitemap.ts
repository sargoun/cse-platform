/**
 * Die Sitemap (PUB-10, PUB-12) — aus der Datenbank, nicht aus einer Liste.
 *
 * **Warum nicht aus `OEFFENTLICHE_ROUTEN`.** Diese Liste sagt, welche Routen
 * es geben soll; die Sitemap muss sagen, welche Seiten es gibt. Eine Route,
 * deren `seite`-Zeile noch `entwurf` ist, rendert 404 — sie in die Sitemap zu
 * schreiben, meldet der Suchmaschine eine Seite, die sie nicht findet, und das
 * kostet Vertrauen fuer die ganze Domain.
 *
 * Ausgeschlossen ist alles unter `/dev/` — Entwicklungsflaechen sind nicht
 * Teil des Angebots. Die Pruefung steht als Zusicherung im Code und nicht nur
 * in `robots.txt`: `Disallow` ist eine Bitte, eine fehlende Zeile in der
 * Sitemap ist eine Tatsache.
 */

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface SitemapEintrag {
  readonly pfad: string;
  readonly geaendert: Date;
}

/** Kein oeffentlicher Pfad beginnt so. */
export const AUSGESCHLOSSEN: readonly string[] = ['/dev', '/api', '/portal', '/auth', '/check-in'];

export function istAusgeschlossen(pfad: string): boolean {
  return AUSGESCHLOSSEN.some((p) => pfad === p || pfad.startsWith(`${p}/`));
}

export async function sitemapEintraege(db: Abfrage): Promise<readonly SitemapEintrag[]> {
  const zeilen = (await db.unsafe(
    `select pfad, coalesce(geaendert_am, erstellt_am) as geaendert
       from seite
      where status = 'veroeffentlicht' and geloescht_am is null and sprache = 'de'
      order by pfad`,
  )) as { pfad: string; geaendert: Date | string }[];

  return zeilen
    .filter((z) => !istAusgeschlossen(z.pfad))
    .map((z) => ({
      pfad: z.pfad,
      geaendert: z.geaendert instanceof Date ? z.geaendert : new Date(z.geaendert),
    }));
}
