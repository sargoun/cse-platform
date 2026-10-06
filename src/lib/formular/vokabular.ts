/**
 * Das Vokabular der Gebäudetypen — EINE Liste für das Anfrageformular
 * (REQ-02, `db/seed/formulare.ts`) und das Objektformular (OPS-01,
 * `objekte/ObjektFormular.tsx`).
 *
 * TODO(client, O-69): Voreinstellung — die sieben Gebäudetypen des
 * Anfrageformulars sind das kontrollierte Vokabular; `objekt.gebaeudetyp`
 * bleibt Freitext (`text`, 0021) und bietet sie als Vorschläge an
 * (`<datalist>`), damit ein Flughafen oder eine Baustelle erfassbar bleibt,
 * ohne dass die Liste wächst, bevor sie jemand bestätigt. D-792.
 * TODO(client, O-62): Voreinstellung — dieselbe Liste ist die Auswahlliste
 * des Formulars für Gebäudereinigung; wer sie ändert, ändert sie hier. D-792.
 *
 * Gespeichert wird im Formular der Schlüssel (`buero`), im Objekt der
 * Klartext (`Bürogebäude`) — so steht es seit dem Seed in beiden Tabellen,
 * und die Auswertung nach Objektart liest den Klartext.
 */
export const GEBAEUDETYPEN: readonly (readonly [string, string])[] = [
  ['buero', 'Bürogebäude'],
  ['wohnanlage', 'Wohnanlage'],
  ['praxis', 'Praxis oder Klinik'],
  ['einzelhandel', 'Einzelhandel'],
  ['industrie', 'Industrie oder Lager'],
  ['bildung', 'Schule oder Kita'],
  ['hotel', 'Hotel oder Gastronomie'],
];
