'use client';

/**
 * Der Umschalter in der ECHTEN Kopfzeile (DESIGN §6, TEN-06, TEN-10, V-165).
 *
 * `BereichsUmschalter` meldet eine Wahl über `onWechsel`; eine Funktion lässt
 * sich aber nicht vom Server in eine Client-Komponente reichen. Diese Hülle
 * gibt ihm deshalb die eine Handlung, die ein Wechsel im Portal ist: ein
 * POST an `/api/sitzung/mandant` — derselbe Weg wie die Bereichswahl
 * (`/auth/bereich`). Kein `fetch`, kein Zustand im Browser: der Server prüft
 * die Mitgliedschaft, schreibt das Protokoll (TEN-09) und leitet auf die
 * Übersicht des neuen Bereichs (DESIGN §6 Regel 6). Die Adresse ist nie der
 * Mandantenzustand (Invariante 3).
 *
 * Ohne JavaScript bleibt der Verweis „Bereich wechseln" in der Kopfzeile
 * — der Rahmen zeigt ihn bei mehr als einem Bereich weiter.
 */
import { useRef } from 'react';
import { BereichsUmschalter } from './BereichsUmschalter';
import type { UmschalterBereich, UmschalterTexte } from './typen';

export function BereichsWechsel({
  bereiche, aktiv, gruppenansicht, gruppeSichtbar, texte, sprache,
}: {
  readonly bereiche: readonly UmschalterBereich[];
  readonly aktiv: string | null;
  readonly gruppenansicht: boolean;
  readonly gruppeSichtbar: boolean;
  readonly texte: UmschalterTexte;
  readonly sprache: string | null;
}) {
  const formular = useRef<HTMLFormElement>(null);
  const slug = useRef<HTMLInputElement>(null);
  const gruppe = useRef<HTMLInputElement>(null);

  function wechsle(mandantId: string | null): void {
    const f = formular.current;
    if (f === null || slug.current === null || gruppe.current === null) return;
    if (mandantId === null) {
      /* Schon in der Gruppenansicht: nichts zu wechseln. */
      if (gruppenansicht) return;
      slug.current.value = '';
      gruppe.current.value = 'true';
    } else {
      const ziel = bereiche.find((b) => b.id === mandantId);
      /* Der aktive Bereich noch einmal gewählt: nichts zu wechseln, nichts zu protokollieren. */
      if (ziel === undefined || (ziel.id === aktiv && !gruppenansicht)) return;
      slug.current.value = ziel.slug;
      gruppe.current.value = '';
    }
    f.requestSubmit();
  }

  return (
    <>
      <BereichsUmschalter
        bereiche={bereiche}
        aktiv={aktiv}
        gruppenansicht={gruppenansicht}
        gruppeSichtbar={gruppeSichtbar}
        onWechsel={wechsle}
        texte={texte}
        sprache={sprache}
        knapp
      />
      <form ref={formular} method="post" action="/api/sitzung/mandant" hidden
            data-cse="umschalter-formular">
        <input ref={slug} type="hidden" name="mandantSlug" defaultValue="" />
        <input ref={gruppe} type="hidden" name="gruppe" defaultValue="" />
      </form>
    </>
  );
}
