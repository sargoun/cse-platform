import type postgres from 'postgres';

/**
 * Demokennwörter — damit `/auth/login` in einer Vorführung wirklich benutzbar
 * ist (D-501).
 *
 * **Es überschreibt nie ein bestehendes Kennwort.** `app.demo_kennwort_setzen`
 * trägt `on conflict do nothing`; ein zweiter Seed-Lauf auf einer benutzten
 * Fläche wäre sonst eine stille Übernahme aller Konten.
 *
 * **Und es läuft nur auf einer Entwicklungsfläche.** Ein Kennwort, das in der
 * Quelle steht, ist kein Kennwort — in einer Auslieferung legt der Seed gar
 * keines an, und die Konten kommen über eine Einladung (AUT-04) zu ihrem
 * eigenen.
 *
 * Die Mitarbeiterkonten bleiben ausgenommen: EMP-01 sagt „phone number + SMS
 * code, no password". Ein Kennwort daneben wäre ein zweiter Eingang zu
 * demselben Portal.
 */

/**
 * Für alle Demokonten dasselbe, und zwar sichtbar als das, was es ist.
 *
 * Zwölf Zeichen, weil `auth.kennwort_mindestlaenge` zwölf verlangt und ein
 * Seed, der an der eigenen Prüfung vorbeischreibt, die Prüfung wertlos macht.
 */
export const DEMO_KENNWORT = 'demo-cse-2026';

export interface ZugangErgebnis {
  readonly gesetzt: number;
  readonly vorhanden: number;
  readonly uebersprungen: boolean;
}

export async function seedZugangsdaten(
  sql: postgres.Sql,
  devFlaechen: boolean,
): Promise<ZugangErgebnis> {
  if (!devFlaechen) return { gesetzt: 0, vorhanden: 0, uebersprungen: true };

  const konten = await sql<{ id: string }[]>`
    select b.id
      from benutzer b
      left join rolle gr on gr.id = b.globale_rolle_id
      left join benutzer_mandant bm
             on bm.benutzer_id = b.id and bm.entzogen_am is null and bm.ist_standard
      left join rolle r on r.id = bm.rolle_id
     where b.deaktiviert_am is null
       and not b.ist_dienstkonto
       and b.email is not null
       and coalesce(gr.schluessel, r.schluessel) is distinct from 'mitarbeiter'`;

  let gesetzt = 0;
  for (const k of konten) {
    const [zeile] = await sql<{ neu: boolean }[]>`
      select app.demo_kennwort_setzen(${k.id}::uuid, ${DEMO_KENNWORT}) as neu`;
    if (zeile?.neu === true) gesetzt += 1;
  }
  return { gesetzt, vorhanden: konten.length - gesetzt, uebersprungen: false };
}
