/**
 * `sichtbar_fuer_mitarbeiter` — die Freigabe eines Dokuments für die
 * Belegschaft, in BEIDE Richtungen (DOC-04, EMP-11, V-219, D-712).
 *
 * **Der Befund.** Gesetzt wurde die Spalte genau einmal: beim Ablegen, über
 * ein Kästchen im Uploadformular (`ablage.ts`). Danach gab es keinen Weg
 * zurück. Nach `t_person` (0009) sieht jede Sitzung im Mitarbeiterportal der
 * Gesellschaft ein freigegebenes Dokument — und die meisten Kategorien tragen
 * eine Löschsperre (0009), ein versehentlich freigegebenes Dokument liess
 * sich also auch nicht löschen. Es blieb dauerhaft für die ganze Belegschaft
 * sichtbar. O-851 verliess sich darauf, dass eine falsche Freigabe „auffällt";
 * nach dem Auffallen gab es keinen Rückweg.
 *
 * **Dasselbe Recht wie beim Ablegen: `dokument.schreiben`.** Wer das Kästchen
 * beim Ablegen setzen darf, darf es auch wieder lösen — ein zweites, engeres
 * Recht nur für die Rücknahme hiesse, dass der Fehler leichter zu machen ist
 * als zu beheben. Die zweite Linie hält `t_mandant` (0009): ein UPDATE
 * verlangt LESEND `dokument.lesen` und schreibend `dokument.schreiben`. Die
 * Rolle `mitarbeiter` hält das erste nicht und trifft damit null Zeilen — sie
 * legt Nachweise ab, sie schaltet nichts um.
 *
 * **Immer mit Grund, und der Grund steht im Prüfprotokoll** — wie bei der
 * Kundenfreigabe (`kundenfreigabe.ts`), aus demselben Grund: `dokument` hat
 * keine Spalte dafür, und eine zu erfinden wäre eine Schemaänderung für
 * etwas, das ins Audit gehört. Die Kategorie wird mitprotokolliert, weil
 * O-851 offen ist (welche Kategorien überhaupt freigegeben werden dürfen).
 *
 * **Was die Rücknahme NICHT kann:** eine Datei zurückholen, die schon
 * geholt wurde. Das Zugriffsprotokoll (`dokument_zugriff`) steht deshalb auf
 * dem Dokumentblatt neben dem Schalter.
 */
import { DokumentfreigabeFehler, type Abfrage } from './kundenfreigabe.js';

export interface Mitarbeiterfreigabe {
  readonly titel: string;
  readonly sichtbar: boolean;
}

export async function setzeMitarbeiterfreigabe(
  db: Abfrage, dokumentId: string,
  eingabe: { readonly sichtbar: boolean; readonly grund: string },
): Promise<Mitarbeiterfreigabe> {
  const grund = eingabe.grund.trim();
  if (grund === '') {
    throw new DokumentfreigabeFehler(
      'Eine Freigabe für die Belegschaft — und ihre Rücknahme — nennt ihren Grund. Er '
      + 'steht im Prüfprotokoll, nicht in der Zeile.', 'ohne_grund');
  }
  /*
   * **Erst sperren, dann prüfen, dann schreiben.** Zwei gleichzeitige
   * Anfragen — die eine gibt frei, die andere nimmt zurück — lasen sonst
   * beide den alten Stand, und das Protokoll trüge zwei Übergänge, von denen
   * einer nie stattfand.
   *
   * Die Mandantenbedingung steht HIER und nicht nur in `t_mandant`
   * (Invariante 3): RLS ist die zweite Linie, nie die einzige.
   */
  const [vorher] = await db.abfrage<{
    titel: string; kategorie: string; sichtbar_fuer_mitarbeiter: boolean;
    geloescht_am: Date | null;
  }>(
    `select titel, kategorie::text as kategorie, sichtbar_fuer_mitarbeiter, geloescht_am
       from dokument
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      for update`, [dokumentId]);
  if (vorher === undefined) {
    throw new DokumentfreigabeFehler('Dokument nicht gefunden', 'nicht_gefunden');
  }
  if (vorher.geloescht_am !== null) {
    throw new DokumentfreigabeFehler(
      'Dieses Dokument ist gelöscht — es wird weder freigegeben noch zurückgenommen.',
      'geloescht');
  }
  if (vorher.sichtbar_fuer_mitarbeiter === eingabe.sichtbar) {
    throw new DokumentfreigabeFehler(
      eingabe.sichtbar
        ? 'Dieses Dokument ist bereits für die Belegschaft freigegeben.'
        : 'Dieses Dokument ist für die Belegschaft nicht freigegeben.',
      'schon_so');
  }

  /*
   * `returning id`: ohne `dokument.schreiben` trifft das UPDATE still null
   * Zeilen (`t_mandant`). Ohne diese Prüfung ginge es danach weiter — mit
   * einer Protokollzeile für eine Änderung, die nicht stattfand.
   */
  const geschrieben = await db.abfrage<{ id: string }>(
    `update dokument set sichtbar_fuer_mitarbeiter = $2
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and geloescht_am is null
      returning id`,
    [dokumentId, eingabe.sichtbar]);
  if (geschrieben.length === 0) {
    throw new DokumentfreigabeFehler(
      'Die Freigabe für die Belegschaft ändert, wer Dokumente ablegen darf '
      + '(dokument.schreiben).', 'kein_recht');
  }

  /* Die jsonb-Werte als OBJEKT, nicht als Zeichenkette — siehe `kundenfreigabe.ts`. */
  await db.abfrage(
    `select app.protokolliere($1, 'dokument', $2, $3::jsonb, $4::jsonb,
                              app.aktiver_mandant())`,
    [eingabe.sichtbar
      ? 'dokument.mitarbeiter_freigegeben' : 'dokument.mitarbeiterfreigabe_zurueckgenommen',
    dokumentId,
    { sichtbar_fuer_mitarbeiter: vorher.sichtbar_fuer_mitarbeiter },
    {
      sichtbar_fuer_mitarbeiter: eingabe.sichtbar,
      kategorie: vorher.kategorie,
      grund,
    }]);

  return { titel: vorher.titel, sichtbar: eingabe.sichtbar };
}
