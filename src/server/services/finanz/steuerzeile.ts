/**
 * **Gehört diese Steuerzeile auf den Beleg?** (V-356, D-831) — als SQL-Bedingung
 * über den Alias einer `rechnung_steuer`-Zeile.
 *
 * Verlässt die einzige Position einer Steuergruppe den Entwurf, schreibt
 * `schreibeSummen` deren Zeile auf null Netto und null Steuer — gelöscht wird
 * nichts (Invariante 8). Eine solche Gruppe gehört weder in die Nutzlast noch
 * auf PDF, XRechnung oder Kundenportal: sie hat nichts aufzuschlüsseln.
 * Bleiben darf eine Zeile ohne Betrag nur, wenn noch etwas auf dem Beleg sie
 * trägt — eine lebende Position oder ein Zu- oder Abschlag dieser Gruppe
 * (etwa eine Zeile über null Euro). Für jeden Beleg vor V-356 ist das dieselbe
 * Menge wie ohne Bedingung.
 */
export function steuerzeileAufDemBeleg(s: string): string {
  return `(${s}.netto_cent <> 0 or ${s}.steuer_cent <> 0
          or exists (select 1 from rechnungsposition lp
                      where lp.rechnung_id = ${s}.rechnung_id
                        and lp.steuersatz_gruppe_id = ${s}.steuersatz_gruppe_id
                        and lp.positionsart = 'leistung' and lp.entfernt_am is null)
          or exists (select 1 from rechnung_zuschlag lz
                      where lz.rechnung_id = ${s}.rechnung_id
                        and lz.steuersatz_gruppe_id = ${s}.steuersatz_gruppe_id))`;
}
