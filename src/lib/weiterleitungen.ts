/**
 * Die 301er der Website — an EINER Stelle, ohne jede Abhaengigkeit.
 *
 * **Warum sie hier steht und nicht im Importdienst.** Sie wird von zwei
 * Seiten gelesen: vom Dienst, der beim Inhaltsimport prueft, dass kein Ziel
 * ins Leere zeigt, und von `next.config.ts`, das daraus die echten
 * Weiterleitungen baut. Die Konfiguration wird von Next nach CommonJS
 * uebersetzt und dann geladen; sie kann deshalb kein Modul ziehen, das
 * `server-only` oder einen Datenbanktreiber mitbringt. Diese Datei importiert
 * nichts.
 *
 * Jede Alt-URL geht per 301/308 auf ihr Ziel. Ein 302 waere falsch: die
 * Suchmaschine behaelt dann den alten Eintrag, und die Autoritaet der alten
 * Adresse geht nicht auf die neue ueber.
 *
 * // TODO(client): O-13 — die vollstaendige Liste der Alt-URLs kommt aus dem
 * // Export von cse-dienstleistungen.de; hier stehen die bekannten.
 */
export const WEITERLEITUNGEN: Readonly<Record<string, string>> = {
  // Die alte Website (PUB-08).
  '/index.html': '/',
  '/home': '/',
  '/leistungen.html': '/leistungen',
  '/ueber-uns.html': '/ueber-uns',
  '/kontakt.html': '/kontakt',
  '/impressum.html': '/impressum',
  '/datenschutz.html': '/datenschutz',
  '/gebaeudereinigung': '/unternehmen/reinigung',
  '/sicherheitsdienst': '/unternehmen/security',

  /**
   * Die EIGENEN abgeloesten Adressen.
   *
   * PR 16/17 lieferte `/reinigung` und `/anfrage/[bereich]`; die Angleichung
   * an `04-SEITENKARTE.md` machte daraus `/unternehmen/<slug>` und
   * `/angebot/<slug>`. Wer einen Link aus dieser Zeit gespeichert hat, bekam
   * seither 404 — von uns gebrochen, nicht von einer alten Website.
   *
   * **Ohne Sprachpraefix**, genau wie `seite.pfad`: die Sprache ist dort eine
   * Spalte und keine Silbe im Pfad. `weiterleitungenMitSprachen()` haengt den
   * `/en`-Zweig an, wo er hingehoert — in die Weiterleitungen selbst.
   */
  '/reinigung': '/unternehmen/reinigung',
  '/security': '/unternehmen/security',
  '/bau': '/unternehmen/bau',
  '/operations': '/unternehmen/operations',
  '/anfrage': '/angebot',
  '/anfrage/reinigung': '/angebot/reinigung',
  '/anfrage/security': '/angebot/security',
  '/anfrage/bau': '/angebot/bau',
  '/anfrage/operations': '/angebot/operations',
};

/**
 * Dieselben Umzuege, einmal je Sprachbaum — fuer `next.config.ts`.
 *
 * Ein englischer Besucher, der einen alten Link oeffnet, soll in der
 * ENGLISCHEN Fassung landen. Ohne diesen Zweig fiele er nach `/unternehmen/…`
 * und damit ins Deutsche: er hat die Sprache nicht gewechselt, die
 * Weiterleitung hat sie ihm genommen.
 *
 * Die `.html`-Adressen der alten Website bekommen keinen englischen Zwilling —
 * die gab es dort nie.
 */
export function weiterleitungenMitSprachen(): readonly {
  readonly quelle: string; readonly ziel: string;
}[] {
  const eintraege = Object.entries(WEITERLEITUNGEN);
  return [
    ...eintraege.map(([quelle, ziel]) => ({ quelle, ziel })),
    ...eintraege
      .filter(([quelle]) => !quelle.endsWith('.html'))
      .map(([quelle, ziel]) => ({ quelle: `/en${quelle}`, ziel: `/en${ziel}` })),
  ];
}
