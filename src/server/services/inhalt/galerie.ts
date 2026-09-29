import type { LeseKontext } from '@/server/kontext';

/**
 * Die öffentliche Galerie einer Gesellschaft (PRO-02, PUB-04, 0170).
 *
 * **Warum es diesen Dienst gibt und keine Abfrage in der Seite.**
 * `t_medien_oeffentlich` liest `medien` mit `using (true)` — JEDE Zeile ist
 * öffentlich lesbar, auch der Schnappschuss aus einem Wachbuch und der Scan
 * eines Belegs. Eine Seite, die `medien` selbst abfragt, ist eine vergessene
 * `where`-Bedingung von einem Datenschutzvorfall entfernt. Hier steht die
 * Bedingung an EINER Stelle, und sie ist positiv formuliert: gezeigt wird, was
 * ausdrücklich einen `galerie_rang` trägt, nicht „alles ausser…".
 *
 * Und nur der Bildbestand der Website: ein hochgeladenes Bild eines
 * Social-Beitrags (`objekt_schluessel`, V-225) trägt nie einen Rang
 * (`medien_beitragsbild_nicht_in_galerie`, 0487, V-268) — die Bedingung steht
 * trotzdem hier, weil diese Seite ohne Sitzung liest.
 */
export interface GalerieBildZeile {
  readonly id: string;
  readonly pfad: string;
  readonly alt: string;
  readonly platzhalter: boolean;
  readonly rang: number;
}

export async function galerieDerGesellschaft(
  kontext: LeseKontext, mandantId: string, grenze = 60,
): Promise<readonly GalerieBildZeile[]> {
  return kontext.abfrage<GalerieBildZeile>(
    `select m.id, m.pfad, m.alt_text as alt,
            m.ist_platzhalter as platzhalter, m.galerie_rang as rang
       from medien m
      where m.mandant_id = $1::uuid
        and m.galerie_rang is not null
        and m.objekt_schluessel is null
      order by m.galerie_rang, m.erstellt_am, m.id
      limit $2::int`,
    [mandantId, grenze]);
}
