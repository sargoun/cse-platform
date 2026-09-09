/**
 * Der SCHREIBENDE Prinzipal der oeffentlichen Formularannahme (03-AUTH §14.3).
 *
 * Zwei Prinzipale und nicht einer: der Renderer laeuft mit
 * `app.readonly = 'on'` und koennte nichts speichern; ihm das Schreiben zu
 * geben hiesse, dass eine Uebernahme der Leseflaeche einen Schreibweg
 * mitliefert. Dieser hier haelt `formular.schreiben`, `dokument.schreiben` und
 * `crm.schreiben` — und ausdruecklich **nicht** `formular.lesen`: er nimmt
 * Einsendungen entgegen und kann keine zurueckholen.
 *
 * **Er laeuft in `mandant`-Scope mit genau einem Mandanten.** Das ist der
 * Unterschied zum Renderer und der Grund, warum er ueberhaupt schreiben kann:
 * K-03s `WITH CHECK` verlangt `mandant_id = app.aktiver_mandant()`, und in der
 * Gruppenansicht ist der NULL (Invariante 10). Welcher Bereich es ist, sagt
 * das Formular, das der Besucher abgeschickt hat — nicht ein URL-Parameter.
 *
 * **`app.portal` ist `intern`.** Nicht aus Bequemlichkeit: die
 * `p_intern_*`-Decken auf `lead` und `formular_zustaendigkeit` sind
 * restriktiv, und ein anderes Portal haette hier null Zeilen gesehen — die
 * Annahme koennte keinen Lead anlegen. Gefaehrlich ist das nicht, weil die
 * Rechte des Prinzipals die Grenze sind und nicht das Portal: er hat kein
 * `formular.lesen` und kein `personal.*`.
 */
import type { SchreibKontext, Transaktion } from './index.js';

export class KeinEingangFehler extends Error {
  constructor() {
    super(
      'Kein Formular-Eingangsprinzipal hinterlegt (plattform_einstellung '
      + '`website.eingang_benutzer`). Ohne ihn nähme das Formular eine Anfrage '
      + 'entgegen und speicherte nichts — die schlechteste aller Antworten. '
      + '`pnpm db:seed` legt ihn an.',
    );
    this.name = 'KeinEingangFehler';
  }
}

export async function withEingang<T>(
  tx: Transaktion,
  mandantId: string,
  fn: (kontext: SchreibKontext) => Promise<T>,
): Promise<T> {
  await tx.unsafe(`set local role cse_app`);
  const setze = async (name: string, wert: string): Promise<void> => {
    await tx.unsafe(`select set_config($1, $2, true)`, [name, wert]);
  };

  const [zeile] = (await tx.unsafe(
    `select wert #>> '{}' as benutzer_id from plattform_einstellung
      where schluessel = 'website.eingang_benutzer'`,
  )) as { benutzer_id: string | null }[];
  const benutzerId = zeile?.benutzer_id ?? null;
  if (benutzerId === null || benutzerId === '') throw new KeinEingangFehler();

  await setze('app.scope', 'mandant');
  await setze('app.mandant_id', mandantId);
  await setze('app.mandant_ids', mandantId);
  await setze('app.benutzer_id', benutzerId);
  await setze('app.person_id', '');
  await setze('app.aal', 'aal1');
  await setze('app.portal', 'intern');
  await setze('app.readonly', 'off');
  await setze('app.sitzung_id', '');
  // SEC-A9: was hier entsteht, entsteht ohne Menschen. Das Protokoll sagt das.
  await setze('app.akteur_typ', 'system');

  const abfrage = async <R,>(sql: string, werte: readonly unknown[] = []) =>
    (await tx.unsafe(sql, werte)) as readonly R[];

  return fn({
    scope: 'mandant',
    portal: 'intern',
    benutzerId,
    aktiverMandantId: mandantId,
    mandantIds: [mandantId],
    abfrage,
    schreibe: abfrage,
  });
}
