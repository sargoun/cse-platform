import { internSprache, type InternSprache } from '@/lib/i18n/intern';
import { PORTAL_BCP47, type PortalSprache } from '@/lib/i18n/texte';
import { inhaltFolgtSitzung } from '@/server/registry/seitensprache';

/**
 * Welche Sprache `PortalRahmen` seinen Teilen ansagt (WCAG 3.1.1, 3.1.2;
 * D-767, V-257).
 *
 * **Der Befund.** Jede Seite der Verwaltung trug nur `<html lang="de-DE">` —
 * auch in einer englischen Sitzung. Ein Screenreader las die englische
 * Kopfzeile, die englische Leiste und den Inhalt der übersetzten Seiten mit
 * deutscher Aussprache.
 *
 * **Warum hier und nicht am `<html>`.** Das Wurzel-Layout kennt die Adresse
 * (Middleware-Kopf), nicht die Sitzung: deren Sprache steht in der Datenbank
 * und ist erst bekannt, wenn die Pforte (`portalZugang`) die Sitzung gebunden
 * hat — sie legt sie für diese Anfrage ab (`merkeHuelle`). Sie im Layout ein
 * zweites Mal aufzulösen kostete jede Portalseite eine weitere Transaktion
 * samt Schreibzugriff (`letzte_aktivitaet_am`) und wüsste trotzdem nicht, ob
 * der Inhalt der Seite übersetzt ist. `PortalRahmen` umschliesst den ganzen
 * sichtbaren Inhalt; dort steht die Angabe.
 *
 * **Zwei Angaben, nicht eine.**
 *
 *  - `huelle` — die Sprache der Kopfzeile, der Leisten und des abgeleiteten
 *    Rückwegs: `INTERN_BESCHRIFTUNGEN` in der Sprache der Sitzung (de/en,
 *    D-592).
 *  - `inhalt` — die Sprache von Titel und Seiteninhalt: die der Sitzung, wo
 *    die Seite umgestellt ist, sonst Deutsch (`inhaltFolgtSitzung`).
 *
 * **`null` heisst: hier sagt der Rahmen nichts.** Zwei Fälle:
 *
 *  - Der Aufrufer bringt seine eigenen Beschriftungen (`MeinRahmen`, die
 *    Kontoseiten einer Beschäftigten): er spricht vier Sprachen und setzt
 *    `lang` und `dir` selbst, um den Rahmen herum. Ein `lang` aus
 *    `internSprache` darunter machte aus Arabisch Deutsch.
 *  - Keine Pforte ist gelaufen (`pfad` fehlt): die Kontoseiten binden ihre
 *    Sitzung selbst und setzen `lang` um ihren Inhalt, die Vorschau unter
 *    `/dev/portal` hat keine Sitzung. Der Rahmen weiss dann nicht, welche
 *    Seite er trägt.
 */
export interface RahmenSprachen {
  /** Die Sprache der Hülle — Kopfzeile, Leisten, abgeleiteter Rückweg. */
  readonly huelle: InternSprache;
  /** Die Sprache von Titel und Inhalt der Seite. */
  readonly inhalt: InternSprache;
  /** `huelle` als BCP 47, für `lang`. */
  readonly huelleLang: string;
  /** `inhalt` als BCP 47, für `lang`. */
  readonly inhaltLang: string;
}

export function rahmenSprachen(
  stand: { readonly sprache: PortalSprache | null; readonly pfad: string | null },
  eigeneBeschriftungen: boolean,
): RahmenSprachen | null {
  if (eigeneBeschriftungen || stand.pfad === null) return null;
  const huelle = internSprache(stand.sprache);
  const inhalt: InternSprache = inhaltFolgtSitzung(stand.pfad) ? huelle : 'de';
  return {
    huelle, inhalt, huelleLang: PORTAL_BCP47[huelle], inhaltLang: PORTAL_BCP47[inhalt],
  };
}
