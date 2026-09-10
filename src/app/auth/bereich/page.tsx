import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { bindeAnfrage } from '@/server/kontext/index';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../portal/Anmeldung';

/**
 * `/auth/bereich` — die Bereichswahl (03-AUTH §4.4, SEITENKARTE §11.3).
 *
 * **Jede Zeile ist ein eigenes Formular mit Absendeknopf, kein Link.** Genau
 * das verlangt §11.3, und aus demselben Grund wie ueberall: koennte ein GET
 * den aktiven Bereich aendern, WAERE die URL der Mandantenzustand. Enter auf
 * einer Zeile loest damit eine Formularuebermittlung aus und keine Navigation.
 *
 * **Nichts ist vorausgewaehlt.** §4.4 sagt es woertlich: bei mehr als einer
 * Mitgliedschaft wird nichts automatisch gewaehlt. `ist_standard` ist ein
 * Hinweis auf die Reihenfolge, nie eine Wahl.
 */
export const dynamic = 'force-dynamic';

interface Bereich {
  slug: string;
  name: string;
  ist_standard: boolean;
}

interface Wahl {
  readonly bereiche: readonly Bereich[];
  readonly gruppe: boolean;
}

async function wahl(sitzung: Parameters<typeof bindeAnfrage>[1]): Promise<Wahl> {
  return db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    /**
     * `switcher_mandanten()` und nicht `sichtbare_mandanten()` (B14): ein
     * archivierter Bereich bleibt lesbar, wird aber nicht mehr als
     * Arbeitskontext angeboten. Die Funktion ist `security definer` — die
     * Zeilen selbst kommen ueber sie und nicht ueber die RLS-Sicht auf
     * `mandant`, die im mandant-Scope nur den aktiven zeigt.
     */
    const bereiche = (await tx.unsafe(
      `select slug, name, ist_standard from app.switcher_bereiche()`,
    )) as Bereich[];
    const [g] = (await tx.unsafe(
      `select app.darf_gruppenansicht() as ok`,
    )) as { ok: boolean }[];
    return { bereiche, gruppe: g?.ok === true };
  }) as Promise<Wahl>;
}

export default async function Bereichswahl() {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return <AnmeldungNoetig />;
  const { bereiche, gruppe } = await wahl(sitzung);

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s5 p-s6">
      <h1 className="text-h1 text-text">Bereich wählen</h1>
      {bereiche.length === 0 ? (
        <p data-cse="kein-bereich" className="max-w-[72ch] text-base text-text-muted">
          Diesem Konto ist kein Bereich zugewiesen. Das ist kein Fehler der
          Anmeldung: die Zuweisung erfolgt in der Benutzerverwaltung.
        </p>
      ) : (
        <ul data-cse="bereichswahl" className="flex flex-col gap-s3">
          {bereiche.map((b) => (
            <li key={b.slug}>
              <form method="post" action="/api/sitzung/mandant">
                <input type="hidden" name="mandantSlug" value={b.slug} />
                <Button type="submit" variante="secondary" data-bereich={b.slug}
                        className="w-full justify-start">
                  {b.name}
                </Button>
              </form>
            </li>
          ))}
          {gruppe && (
            <li>
              <form method="post" action="/api/sitzung/mandant">
                <input type="hidden" name="gruppe" value="true" />
                <Button type="submit" variante="secondary" data-bereich="gruppe"
                        className="w-full justify-start">
                  Gruppenübersicht (nur lesen)
                </Button>
              </form>
            </li>
          )}
        </ul>
      )}
      <p className="max-w-[72ch] text-sm text-text-subtle">
        Nichts ist vorausgewählt — der Wechsel geschieht erst mit dem Klick und
        wird protokolliert.
      </p>
    </main>
  );
}
