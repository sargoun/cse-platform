/*
 * Methodensyntax wie ueberall im Baum: TypeScript prueft Methoden bivariant
 * und Funktionseigenschaften streng kontravariant — mit `unsafe: (…) => …`
 * laesst sich `postgres.Sql` gar nicht uebergeben.
 */
export interface Abfrage {
  unsafe(anweisung: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

/**
 * ALLE nicht archivierten Gesellschaften — aus der Datenbank, nicht aus einer
 * Liste im Code.
 *
 * Eine Liste im Code waere die stille Variante: eine fuenfte Gesellschaft
 * entstuende, und ihr Dienstplan bliebe leer, ohne dass irgendwo etwas rot
 * wird.
 *
 * **`archiviert_am is null` und nicht `aktiv = true`.** Der erste Entwurf
 * schrieb `aktiv`, und diese Spalte gibt es nicht — `mandant` fuehrt seit
 * 0001 `archiviert_am timestamptz`, NULL heisst „in Betrieb". Der Fehler
 * waere erst beim ersten Nachtlauf aufgefallen, mit
 * „column aktiv does not exist", und zwar um drei Uhr morgens. Deshalb steht
 * die Abfrage in einer eigenen Funktion und wird geprueft
 * (`tests/isolation/jobs-mandanten.test.ts`) statt geglaubt.
 */
export async function aktiveMandanten(db: Abfrage): Promise<readonly string[]> {
  const zeilen = (await db.unsafe(
    `select id::text as id from mandant where archiviert_am is null order by sortierung, slug`,
  )) as readonly { id: string }[];
  return zeilen.map((m) => m.id);
}
