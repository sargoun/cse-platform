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
import type { NaviEintrag } from '@/server/registry/navigation';
import { Icon } from '@/components/ui/Icon';

export interface SidebarProps {
  readonly punkte: readonly NaviEintrag[];
  readonly basis: string;
  readonly aktiv: string;
  readonly eingeklappt?: boolean;
}

export function Sidebar({ punkte, basis, aktiv, eingeklappt = false }: SidebarProps) {
  const breite = eingeklappt ? 'md:w-16' : 'md:w-[248px]';

  return (
    <>
      <nav
        aria-label="Hauptnavigation"
        data-cse="sidebar"
        className={`hidden shrink-0 flex-col gap-s1 border-r border-line bg-surface p-s3
                    md:flex ${breite}`}
      >
        {punkte.map((p) => (
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
        ))}
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
