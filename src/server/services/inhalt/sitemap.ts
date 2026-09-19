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

import { NEUIGKEITS_ARTEN } from '../social/dienst.js';

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface SitemapEintrag {
  readonly pfad: string;
  readonly geaendert: Date;
  /** Die Sprache der Zeile — dieselbe Seite steht je Sprache einmal drin. */
  readonly sprache: string;
}

/**
 * Kein oeffentlicher Pfad beginnt so.
 *
 * **`/werbewiderspruch` fehlte, und die Karte fuehrte es als gesperrt.**
 * `04-SEITENKARTE.md` §2.5 verlangt ausdruecklich „robots.txt disallows
 * /api/, /portal/, /auth/, /check-in/ and /werbewiderspruch/"; hier standen
 * nur vier der fuenf. Die Folge war nicht theoretisch: unter
 * `/werbewiderspruch/<token>` entstehen Adressen, die einen Widerspruchslink
 * TRAGEN — ein Suchmaschinen-Crawler, der ihnen folgt, loest fremde
 * Widersprueche aus, und ein Vorschaubild-Dienst tut es noch schneller. Dass
 * der Weg heute POST verlangt, ist die zweite Linie, nicht die erste.
 * Dieselbe Konstante ist der Sitemap-Filter, also war die Flaeche als
 * gesperrt beschrieben und in beiden Richtungen offen.
 */
/*
 * **`/en/werbewiderspruch` steht MIT in der Liste.** Die englische Fassung des
 * Pflichtwegs (D-82) liegt auf demselben Pfad unter `/en/…` und traegt damit
 * denselben Grund: `istAusgeschlossen` vergleicht Praefixe, und `/en/…`
 * beginnt nicht mit `/werbewiderspruch`. Ohne diese Zeile waere die
 * Sperrflaeche in der einen Sprache beschrieben und in der anderen offen —
 * genau der Fehler, den der Absatz darueber fuer die deutsche Fassung
 * festhaelt.
 */
export const AUSGESCHLOSSEN: readonly string[] = [
  '/dev', '/api', '/portal', '/auth', '/check-in', '/werbewiderspruch',
  '/en/werbewiderspruch',
];

export function istAusgeschlossen(pfad: string): boolean {
  return AUSGESCHLOSSEN.some((p) => pfad === p || pfad.startsWith(`${p}/`));
}

/**
 * Alle veroeffentlichten Seiten — in JEDER Sprache.
 *
 * Der Filter `sprache = 'de'` stand hier, solange es nur Deutsch gab. Ihn zu
 * lassen hiesse, die englischen Seiten zu bauen und sie der Suchmaschine zu
 * verschweigen: sie waeren erreichbar, verlinkt und unauffindbar. Welche
 * Sprachen es gibt, entscheidet die Datenbank, nicht diese Abfrage.
 */
export async function sitemapEintraege(db: Abfrage): Promise<readonly SitemapEintrag[]> {
  const zeilen = (await db.unsafe(
    `select pfad, sprache, coalesce(geaendert_am, erstellt_am) as geaendert
       from seite
      where status = 'veroeffentlicht' and geloescht_am is null
      order by sprache, pfad`,
  )) as { pfad: string; sprache: string; geaendert: Date | string }[];

  return zeilen
    .filter((z) => !istAusgeschlossen(z.pfad))
    .map((z) => ({
      pfad: z.pfad,
      sprache: z.sprache,
      geaendert: z.geaendert instanceof Date ? z.geaendert : new Date(z.geaendert),
    }));
}

/**
 * Die KANONISCHEN Detailadressen — Meldungen und Projekte (PUB-10).
 *
 * **Sie fehlten, und niemand hat es gemerkt.** `04-SEITENKARTE.md` §2.5
 * verlangt in der Sitemap „every published seite, referenz, social_post, news
 * and open stelle row"; gemeldet wurden ausschliesslich `seite`-Zeilen. Ein
 * freigegebenes Kundenprojekt — die teuerste Seite, die eine Baufirma hat —
 * stand in keiner Sitemap.
 *
 * **Die kanonische Adresse und nur sie** (§2.2): `/unternehmen/<bereich>/…`.
 * Die kurzen Gruppenadressen `/news/<slug>` und `/projekte/<slug>` setzen
 * `rel=canonical` hierauf und gehoeren deshalb NICHT in die Sitemap — sonst
 * meldete sie zwei Fassungen desselben Textes.
 *
 * **Nur die Vorgabesprache.** `beitrag` und `referenz` tragen KEINE
 * `sprache`: es gibt eine Fassung, und die ist deutsch. Die englische Adresse
 * existiert und rendert denselben Text; sie mit `hreflang="en"` zu melden
 * behauptete eine Uebersetzung, die es nicht gibt — und ein falsches
 * `hreflang` ist schlechter als keines.
 *
 * `stelle` steht hier NICHT: die Karriereseiten gehoeren dem
 * Recruiting-Modul, und eine Zeile fuer eine Tabelle, deren Sichtbarkeitsregel
 * woanders gepflegt wird, waere die erste, die auseinanderlaeuft.
 */
export interface DetailEintrag {
  readonly pfad: string;
  /**
   * `null`, wo die Zeile keinen Zeitpunkt traegt.
   *
   * **Nicht „heute" als Ersatz** (R-11, Invariante 5): `lastModified` ist eine
   * AUSSAGE, und „heute" waere jeden Tag eine neue. Eine Suchmaschine liest
   * daraus, die Seite habe sich geaendert, holt sie erneut und findet dasselbe
   * — bei jedem Abruf, fuer jede Zeile ohne Zeitstempel. Fehlt der Zeitpunkt,
   * fehlt die Angabe.
   */
  readonly geaendert: Date | null;
}

export async function detailEintraege(db: Abfrage): Promise<readonly DetailEintrag[]> {
  const zeilen = (await db.unsafe(
    /*
     * **Das Segment kommt aus der ART, es wird nicht gefiltert.**
     *
     * Hier stand einmal `and b.art::text in ('neuigkeit','aktualisierung')`,
     * und damit fehlten zwei der vier Arten in JEDER Sitemap. Ein
     * veroeffentlichter Beitrag der Art `beitrag` oder `projektschau` ist
     * oeffentlich erreichbar — `oeffentlicherBeitragNachSlug` kennt gar
     * keinen Artenfilter —, er stand nur nirgends. SEITENKARTE §2.5 verlangt
     * „every published seite, referenz, social_post, news"; ein Filter, der
     * die Haelfte weglaesst, erfuellt das nicht, sondern verschweigt es.
     *
     * Die Grenze zwischen den beiden Adressen ist dieselbe wie in
     * `NEUIGKEITS_ARTEN` (§2.2, O-548): was eine Gesellschaft ANKUENDIGT,
     * steht unter `/news/`, alles andere unter `/beitraege/`. Genau EINE der
     * beiden Adressen wird gemeldet, und dieselbe setzt die Seite als
     * `canonical` — sonst erklaerte die Sitemap eine von zwei
     * ununterschiedenen Adressen zur einen.
     */
    `select '/unternehmen/' || m.slug
            || case when b.art::text = any($1::text[]) then '/news/' else '/beitraege/' end
            || b.slug as pfad,
            coalesce(b.veroeffentlicht_am, b.geaendert_am, b.erstellt_am) as geaendert
       from beitrag b
       join mandant m on m.id = b.mandant_id and m.archiviert_am is null
      where b.status = 'veroeffentlicht' and b.zurueckgezogen_am is null
        and b.slug is not null
     union all
     select '/unternehmen/' || m.slug || '/projekte/' || r.slug as pfad,
            coalesce(r.geaendert_am, r.erstellt_am) as geaendert
       from referenz r
       join mandant m on m.id = r.mandant_id and m.archiviert_am is null
      where r.status = 'veroeffentlicht' and r.geloescht_am is null
        and r.freigegeben_vom_kunden and r.slug is not null
      order by 1`,
    [NEUIGKEITS_ARTEN],
  )) as { pfad: string; geaendert: Date | string | null }[];

  return zeilen
    .filter((z) => !istAusgeschlossen(z.pfad))
    .map((z) => ({
      pfad: z.pfad,
      geaendert: z.geaendert instanceof Date ? z.geaendert
        : z.geaendert === null ? null : new Date(z.geaendert),
    }));
}
