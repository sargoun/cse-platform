/**
 * Wo auf dem Schirm etwas als CODE stehen MUSS — und warum (V-251, D-742).
 *
 * Jeder feste Inhalt eines `<code>` oder eines `font-mono`-Elements steht
 * hier mit seinem Grund, oder er ist ein Satz geworden. Code bleibt nur, wo
 * der Mensch genau diese Zeichen braucht: weil er sie tippt (ein
 * Eingabebeispiel, ein Schema, ein Rechenzeichen), weil er sie so
 * wiederfindet (ein Dateiname im Paket, ein Kennzeichen im Kontoauszug, ein
 * Zeichen in der Tabelle darüber) oder weil sie eine Adresse sind, die er
 * aufruft. Ein Wert, der erst zur Laufzeit entsteht (eine Prüfsumme, eine
 * IBAN, eine Kennung, `/unternehmen/{mandant}`), steht nicht hier: er ist
 * Anzeige eines Datums, kein Quelltext.
 *
 * **Die Liste ist genau.** Ein Eintrag, dessen Code es nicht mehr gibt,
 * bricht die Prüfung ebenso wie ein Code, der hier fehlt — wer eine Stelle
 * zum Satz macht, streicht ihren Eintrag. Ein neuer Eintrag braucht einen
 * Grund, der für den Menschen am Schirm gilt, nicht für den Quelltext.
 */
export interface CodeAusnahme {
  /** Eine Datei, oder ein Verzeichnis mit `/` am Ende. */
  readonly datei: string;
  /** Die erlaubten Inhalte — `'*'` für jeden. */
  readonly inhalt: readonly string[] | '*';
  readonly grund: string;
}

const P = 'src/app/portal/[mandant]/';

export const CODE_AUSNAHMEN: readonly CodeAusnahme[] = [
  {
    datei: 'src/app/dev/', inhalt: '*',
    grund: 'Entwicklungsflächen: nur mit eingeschaltetem Schalter für die Entwicklung sichtbar '
      + '(devFlaechenAn), kein Teil des Produkts.',
  },
  {
    datei: 'src/app/auth/passwort-neu/page.tsx', inhalt: ['Sommer2024!'],
    grund: 'Beispiel eines Kennworts, wie Menschen es unter den alten Regeln wählen — so '
      + 'geschrieben, wie man es tippt.',
  },
  {
    datei: 'src/app/portal/Anmeldung.tsx', inhalt: ['https://'],
    grund: 'Der Anfang der Adresse, die der Mensch eintippen soll.',
  },
  {
    datei: `${P}agenten/wissen/page.tsx`, inhalt: ['text-embedding-3-small'],
    grund: 'Der Name des Einbettungsmodells, wie ihn der Anbieter führt — so steht er im '
      + 'Vertrag und in der Auftragsverarbeitung.',
  },
  {
    datei: `${P}auftraege/[id]/abrechnung/page.tsx`, inhalt: ['schluessel=wert', '189000'],
    grund: 'Eingabeform und Eingabebeispiel für die Felder darüber: eine Regel je Zeile in '
      + 'dieser Form, Beträge in ganzen Cent.',
  },
  {
    datei: `${P}bau/projekte/[id]/aufmass/neu/page.tsx`, inhalt: ['+', '−', '×', 'x', '*'],
    grund: 'Die Rechenzeichen, die das Feld für den Rechenansatz annimmt — so werden sie getippt.',
  },
  {
    datei: `${P}buchhaltung/bank/import/page.tsx`, inhalt: ['PDNG'],
    grund: 'Das Kennzeichen einer Vormerkung, wie es in der Datei der Bank steht (ISO 20022).',
  },
  {
    datei: `${P}buchhaltung/z3-export/page.tsx`, inhalt: ['index.xml', 'konten.csv'],
    grund: 'Dateinamen im Paket, wie der Prüfer sie vorfindet (§ 147 Abs. 6 AO).',
  },
  {
    datei: `${P}crm/kunden/[id]/steuer/page.tsx`, inhalt: ['0204', 'EM', '0088'],
    grund: 'Die Schemakennungen der elektronischen Adresse (EN 16931), die genau so in das Feld '
      + 'darüber getippt werden.',
  },
  {
    datei: `${P}einstellungen/rollen/[rolle]/page.tsx`, inhalt: ['✔', '○'],
    grund: 'Die Zeichen der Rechtematrix, die derselbe Mensch auf dieser Seite wiederfindet.',
  },
  {
    datei: `${P}leistungskatalog/[id]/PositionsFelder.tsx`, inhalt: ['12,5', '12.50'],
    grund: 'Eingabebeispiele für eine Zahl — die eine richtig, die andere mehrdeutig.',
  },
  {
    datei: `${P}objekte/[id]/raumbuch/[raumId]/page.tsx`, inhalt: ['12,5', '1.234,5'],
    grund: 'Eingabebeispiele für eine Fläche mit Dezimalkomma und Tausenderpunkt.',
  },
  {
    datei: `${P}radar/page.tsx`, inhalt: ['RADAR_OEFFENTLICHEVERGABE_URL', 'RADAR_TED_URL'],
    grund: 'Die Namen der beiden Umgebungsvariablen, in die der Betreiber die Abfrage-Adresse '
      + 'der Radarquelle einträgt — er tippt sie Buchstabe für Buchstabe (O-366, D-786).',
  },
  {
    datei: `${P}radar/profile/[id]/page.tsx`, inhalt: ['radar-v1', '45000000'],
    grund: 'Die Kennung der Bewertungsregel, mit der jede Bewertung gespeichert wird, und ein '
      + 'CPV-Code als Eingabebeispiel.',
  },
  {
    datei: `${P}radar/profile/page.tsx`, inhalt: ['radar-v1'],
    grund: 'Die Kennung der Bewertungsregel, mit der jede Bewertung gespeichert wird.',
  },
  {
    datei: `${P}website/formulare/[id]/page.tsx`, inhalt: ['/angebot', '/en/angebot'],
    grund: 'Adressen der öffentlichen Website, deren Formular diese Seite pflegt.',
  },
  {
    datei: `${P}website/formulare/page.tsx`, inhalt: ['/angebot'],
    grund: 'Die Adresse der öffentlichen Website, deren Formular diese Seite pflegt.',
  },
  {
    datei: `${P}zeiten/freigabe/page.tsx`, inhalt: ['+1'],
    grund: 'Das Zeichen, das in der Spalte „Zeit" steht, wenn eine Schicht über Mitternacht ging.',
  },
];
