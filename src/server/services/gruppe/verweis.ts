import type { LeseKontext } from '../../kontext/index.js';
import { familie, findeRoute, leserechte } from '../../registry/routen.js';

/**
 * Darf eine Seite einer Gesellschaft auf diese Seite der Gruppensicht
 * verweisen? (AUT-06, D-581, V-243, D-737, V-253, D-745)
 *
 * **Der Befund.** `/buchhaltung/monatszahlen` verwies unbedingt auf
 * `/portal/gruppe/finanzen`; eine Administration der Reinigung ohne
 * Gruppenrecht klickte ins Nichts (V-243). Die Bedingung, die das behob,
 * stand in der Seite selbst — zwei Abfragen, ein fest geschriebener
 * Rechteschlüssel — und hatte keinen Test: hätte jemand den Satz für jede
 * Rolle ausgeblendet, wäre das niemandem aufgefallen.
 *
 * **Die Regel: dieselben zwei Fragen, die das Ziel selbst stellt**, wenn
 * es aus einer Sitzung in einer Gesellschaft aufgerufen wird:
 *
 *  1. Die Leserechte der Zielroute aus dem Manifest, gefragt im AKTIVEN
 *     Mandanten — genau so fragt `pruefeZugang` in einer Mandantensitzung
 *     (`src/server/auth/zugang.ts`). Der Schlüssel steht deshalb nicht hier,
 *     sondern kommt aus der Route: ändert das Manifest ihn, folgt der
 *     Verweis, statt still auf 404 zu zeigen.
 *  2. `app.darf_gruppenansicht()` — ohne sie antwortet `gruppenTor` mit
 *     404 statt mit dem Wechselblatt (03-AUTH §4.5).
 *
 * Verlangt die Route den zweiten Faktor (`aal2`), gehört er dazu. Eine
 * Adresse, die keine Gruppenroute ist oder die das Manifest nicht kennt,
 * bekommt nie einen Verweis — lieber keiner als einer auf 404.
 *
 * **Lesend** und ohne Schreibweg: die Funktion fragt nur Prädikate ab, und
 * ihr Ergebnis öffnet den VERWEIS, nicht die Zeilen dahinter.
 */
export async function gruppenverweisOffen(
  db: Pick<LeseKontext, 'abfrage'>, ziel: string,
): Promise<boolean> {
  const route = findeRoute(ziel);
  if (route === undefined || familie(route.pfad) !== 'gruppe') return false;
  if (route.bewachung.art === 'infrastruktur') return false;
  const zweiterFaktor = route.bewachung.art === 'recht' && route.bewachung.aal2;

  const [z] = await db.abfrage<{ ok: boolean }>(
    `select app.darf_gruppenansicht()
            and (not $2::boolean or app.aal() = 'aal2')
            and coalesce((select bool_and(app.hat_recht(r, app.aktiver_mandant()))
                            from unnest($1::text[]) as r), true) as ok`,
    [[...leserechte(route)], zweiterFaktor],
  );
  return z?.ok === true;
}
