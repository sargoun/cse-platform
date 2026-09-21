'use client';

/**
 * Die Sidebar — DESIGN §6/§8: 248px, eingeklappt 64px, am Telefon eine
 * Tab-Leiste am unteren Rand.
 *
 * Beide Formen stehen im Markup und werden per Media Query getauscht, wie
 * `DataTable` es tut: kein Layout hängt an JavaScript, und der Nutzer bekommt
 * nicht erst die falsche Form zu sehen.
 *
 * Die Punkte kommen aus dem Navigationsregister und tragen ihr Recht. Was der
 * Benutzer nicht darf, erscheint gar nicht — ein Menüpunkt, der auf einen 404
 * führt, verrät die Existenz dessen, was er nicht zeigen darf (AUT-06).
 */
import { NAVI_GRUPPEN, type NaviEintrag } from '@/server/registry/navigation';
import { Icon } from '@/components/ui/Icon';

export interface SidebarProps {
  readonly punkte: readonly NaviEintrag[];
  readonly basis: string;
  readonly aktiv: string;
  readonly eingeklappt?: boolean;
  /**
   * Je Gruppenschluessel die Ueberschrift (`leiste.heute` …), uebersetzt.
   *
   * Fehlt sie, rendert die Leiste FLACH — genau so wie vorher. Das ist der
   * Zustand der Gruppen- und der Kundenleiste, die keine Gruppen tragen
   * (18 und 11 Punkte), und es ist der richtige Rueckfall: eine Leiste ohne
   * Ueberschriften ist unuebersichtlich, eine mit leeren Ueberschriften ist
   * kaputt.
   */
  readonly gruppenNamen?: Readonly<Record<string, string>>;
}

/**
 * Eine Zeile der Leiste — EINE Stelle, an der sie aussieht, wie sie aussieht.
 *
 * Sie stand vorher inline und wird jetzt aus zwei Zweigen gerufen (gegliedert
 * und flach). Zweimal geschrieben waere sie zweimal zu aendern, und beim
 * zweiten Mal saehe eine der beiden Leisten anders aus als die andere.
 */
function punktZeile(
  p: NaviEintrag, basis: string, aktiv: string, eingeklappt: boolean,
) {
  return (
    <a
      key={p.schluessel}
      href={`${basis}${p.pfad === '' ? '' : `/${p.pfad}`}`}
      aria-current={p.schluessel === aktiv ? 'page' : undefined}
      className={`flex items-center gap-s3 rounded-md px-s3 py-s2 text-sm
        ${p.schluessel === aktiv ? 'bg-surface-3 text-text' : 'text-text-muted hover:bg-surface-2'}`}
    >
      <Icon name={p.icon} groesse="md" className="shrink-0" />
      {/* Eingeklappt bleibt das Label für Screenreader da: 64px sind eine
          visuelle Entscheidung, keine inhaltliche. */}
      <span className={eingeklappt ? 'sr-only' : ''}>{p.label}</span>
    </a>
  );
}

export function Sidebar({
  punkte, basis, aktiv, eingeklappt = false, gruppenNamen,
}: SidebarProps) {
  const breite = eingeklappt ? 'md:w-16' : 'md:w-[248px]';

  /**
   * Die Punkte in ihre Gruppen, in der Reihenfolge des Registers
   * (DESIGN-PLAN §4, D-616).
   *
   * **Gefiltert wird VORHER, gruppiert wird hier.** `punkte` enthaelt nur,
   * was der Benutzer sehen darf (AUT-06); eine Gruppe, von der nichts uebrig
   * bleibt, faellt deshalb ganz weg — eine Ueberschrift ohne Punkte verriete
   * genau das, was der Filter verbirgt.
   */
  const gruppiert = NAVI_GRUPPEN
    .map((g) => ({ gruppe: g, eintraege: punkte.filter((p) => p.gruppe === g) }))
    .filter((g) => g.eintraege.length > 0);
  /* Punkte ohne Gruppe (Gruppen- und Kundenleiste) stehen unten und ohne
     Ueberschrift — nicht verloren, nur ungegliedert. */
  const ohneGruppe = punkte.filter((p) => p.gruppe === undefined);
  const gliedern = gruppenNamen !== undefined && gruppiert.length > 0;

  return (
    <>
      <nav
        aria-label="Hauptnavigation"
        data-cse="sidebar"
        className={`hidden shrink-0 flex-col gap-s1 border-r border-line bg-surface p-s3
                    md:flex ${breite}`}
      >
        {gliedern
          ? gruppiert.map((g) => (
            <div key={g.gruppe} className="flex flex-col gap-s1">
              {/*
                * Eingeklappt (64px) steht die Ueberschrift nur noch fuer den
                * Screenreader: bei 64px ist fuer ein Wort kein Platz, und ein
                * abgeschnittenes „Aussenauft…" ist schlechter als keines. Die
                * Gliederung bleibt damit hoerbar, auch wo sie unsichtbar ist.
                */}
              <h2 className={`px-s3 pt-s3 text-micro font-semibold uppercase
                              tracking-widest text-text-subtle
                              ${eingeklappt ? 'sr-only' : ''}`}>
                {gruppenNamen[`leiste.${g.gruppe}`] ?? g.gruppe}
              </h2>
              {g.eintraege.map((p) => punktZeile(p, basis, aktiv, eingeklappt))}
            </div>
          ))
          : punkte.map((p) => punktZeile(p, basis, aktiv, eingeklappt))}
        {gliedern && ohneGruppe.map((p) => punktZeile(p, basis, aktiv, eingeklappt))}
      </nav>

      <nav
        aria-label="Hauptnavigation"
        data-cse="tableiste"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-line
                   bg-surface px-s2 py-s1 md:hidden"
      >
        {punkte.slice(0, 5).map((p) => (
          <a
            key={p.schluessel}
            href={`${basis}${p.pfad === '' ? '' : `/${p.pfad}`}`}
            aria-current={p.schluessel === aktiv ? 'page' : undefined}
            // §8: Tap-Ziele mindestens 44×44px.
            className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-s1
              rounded-md px-s2 text-micro
              ${p.schluessel === aktiv ? 'text-text' : 'text-text-muted'}`}
          >
            <Icon name={p.icon} groesse="md" />
            {p.label}
          </a>
        ))}
      </nav>
    </>
  );
}
