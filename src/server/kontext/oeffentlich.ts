/**
 * Der Lesekontext der oeffentlichen Website (04-SEITENKARTE §2.7, 03-AUTH §14.3).
 *
 * **Ein Besucher ist niemand — der Renderer ist jemand.** Das ist der
 * Unterschied, an dem eine naive Fassung dieser Datei gescheitert ist: eine
 * Verbindung ohne Sitzung liest `seite` und `abschnitt` anstandslos (deren
 * `t_*_oeffentlich`-Policies fragen nur nach `status = 'veroeffentlicht'`),
 * aber `mandant` traegt `t_mandant_lesen` — sichtbar ist nur, was
 * `app.sichtbare_mandanten()` nennt, und ohne Sitzung ist das die leere Menge.
 * Firma, Anschrift, Telefon: nichts. Die Seite haette gerendert und waere leer
 * gewesen, und leer sieht aus wie "noch nicht gepflegt".
 *
 * Deshalb laeuft der Renderer als der Dienstprinzipal aus §14.3 — mit
 * `benutzer_mandant`-Zeilen in den vier Bereichen und genau zwei Rechten:
 * `oeffentlich.lesen` und `gruppe.oeffentlich.lesen`.
 *
 * **Und er kann nicht schreiben.** Drei Linien, nicht eine:
 *  1. Der Rueckgabetyp ist `LeseKontext` — es gibt kein `schreibe`, das jemand
 *     aufrufen koennte. Ein Schreibversuch ist ein Compilerfehler.
 *  2. `app.readonly = 'on'`; K-03 verlangt `not app.ist_readonly()` in jeder
 *     `WITH CHECK`, also scheitert auch ein roher INSERT.
 *  3. Der Prinzipal haelt ueberhaupt kein Schreibrecht.
 *
 * Die Formularannahme (REQ-01) ist ein ANDERER Prinzipal. Zwei, nicht einer:
 * wer die Website rendert, ist die zum Internet offene Haelfte, und wer sie
 * uebernimmt, soll damit keinen Schreibpfad bekommen.
 *
 * **Gruppenansicht, nicht Mandantenansicht.** Die Startseite zeigt alle vier
 * Gesellschaften; ein aktiver Mandant haette den Renderer auf einen gesperrt —
 * und haette ihm nebenbei einen Schreibpfad gegeben, denn genau daran haengt
 * Invariante 10. `app.portal` ist die Konstante `intern` (K-20).
 */
import type { LeseKontext, Transaktion } from './index.js';

export class KeinRendererFehler extends Error {
  constructor() {
    super(
      'Kein Website-Renderer hinterlegt (plattform_einstellung '
      + '`website.renderer_benutzer`). Ohne ihn liest die öffentliche Seite '
      + 'null Gesellschaften und lieferte eine Seite ohne Firma, Anschrift und '
      + 'Telefon aus — sichtbar leer statt sichtbar kaputt. `pnpm db:seed` legt '
      + 'ihn an.',
    );
    this.name = 'KeinRendererFehler';
  }
}

export async function withOeffentlich<T>(
  tx: Transaktion,
  fn: (kontext: LeseKontext) => Promise<T>,
): Promise<T> {
  await tx.unsafe(`set local role cse_app`);
  const setze = async (name: string, wert: string): Promise<void> => {
    await tx.unsafe(`select set_config($1, $2, true)`, [name, wert]);
  };

  // `plattform_einstellung` ist fuer `cse_app` ohne Sitzung lesbar
  // (`t_plattform_lesen using (true)`) — das ist der eine Einstieg, der ohne
  // gebundenen Benutzer funktionieren MUSS, sonst gaebe es keinen ersten
  // Schritt.
  const [zeile] = (await tx.unsafe(
    `select wert #>> '{}' as benutzer_id from plattform_einstellung
      where schluessel = 'website.renderer_benutzer'`,
  )) as { benutzer_id: string | null }[];
  const benutzerId = zeile?.benutzer_id ?? null;
  if (benutzerId === null || benutzerId === '') throw new KeinRendererFehler();

  await setze('app.benutzer_id', benutzerId);

  // Welche Bereiche er sehen darf, sagt seine Mitgliedschaft — nicht diese
  // Datei. `app.switcher_mandanten()` ist SECURITY DEFINER und liest
  // `benutzer_mandant`; eine hier eingetragene Liste waere eine zweite
  // Wahrheit, die beim Anlegen des fuenften Bereichs veraltet.
  const [sichtbar] = (await tx.unsafe(
    `select app.switcher_mandanten() as ids`,
  )) as { ids: readonly string[] }[];
  const mandantIds = sichtbar?.ids ?? [];

  await setze('app.scope', 'gruppe');
  await setze('app.mandant_id', '');
  await setze('app.mandant_ids', mandantIds.join(','));
  await setze('app.person_id', '');
  await setze('app.aal', 'aal1');
  await setze('app.portal', 'intern');
  await setze('app.readonly', 'on');
  await setze('app.sitzung_id', '');
  await setze('app.akteur_typ', 'system');

  return fn({
    scope: 'gruppe',
    portal: 'intern',
    benutzerId,
    // In der Gruppenansicht per Konstruktion NULL (K-18) — und daran haengt,
    // dass es keinen Schreibpfad gibt.
    aktiverMandantId: null,
    mandantIds,
    abfrage: async <R,>(sql: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(sql, werte)) as readonly R[],
  });
}
