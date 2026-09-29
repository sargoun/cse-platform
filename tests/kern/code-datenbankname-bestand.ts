/**
 * Der EINGEFRORENE Bestand: wie viele Datenbanknamen jede Seite heute noch als
 * Code zeigt (V-251, D-742).
 *
 * **Die Liste darf schrumpfen, nie wachsen.** Das Kontaktblatt und die
 * Rechtsgrundlagen-Seite stehen nicht mehr darin — ihre Regeln sind Sätze an
 * den Menschen, der sie liest. Die übrigen Seiten sind der Stand beim
 * Einfrieren (99 Namen auf 46 Seiten); wer eine davon umschreibt, setzt ihre
 * Zahl herunter oder streicht die Zeile. Eine Seite, die NEU einen Namen der
 * Datenbank zeigt, bricht die Prüfung — ebenso eine Zahl hier, die grösser ist
 * als der Baum: ein Bestand, der stehen bleibt, nachdem die Arbeit getan ist,
 * sieht beim nächsten Rückfall nichts mehr.
 *
 * Gezählt wird mit `hilfen/code-datenbankname.ts`.
 */
export const CODE_DATENBANKNAMEN_BESTAND: Readonly<Record<string, number>> = {
  'src/app/portal/[mandant]/agenten/[agent]/start/page.tsx': 1,
  'src/app/portal/[mandant]/angebote/[id]/annahme/page.tsx': 1,
  'src/app/portal/[mandant]/angebote/[id]/versand/page.tsx': 1,
  'src/app/portal/[mandant]/auftraege/[id]/abschluss/page.tsx': 3,
  'src/app/portal/[mandant]/auftraege/[id]/kundenfreigabe/page.tsx': 3,
  'src/app/portal/[mandant]/crm/kontakte/page.tsx': 1,
  'src/app/portal/[mandant]/crm/kunden/[id]/konditionen/page.tsx': 4,
  'src/app/portal/[mandant]/crm/kunden/[id]/steuer/page.tsx': 1,
  'src/app/portal/[mandant]/crm/kunden/[id]/zugang/page.tsx': 3,
  'src/app/portal/[mandant]/crm/kunden/neu/page.tsx': 1,
  'src/app/portal/[mandant]/datenschutz/[id]/page.tsx': 4,
  'src/app/portal/[mandant]/datenschutz/widersprueche/page.tsx': 3,
  'src/app/portal/[mandant]/dienstplan/konflikte/[id]/uebersteuern/page.tsx': 1,
  'src/app/portal/[mandant]/dokumente/[id]/kundenfreigabe/page.tsx': 2,
  'src/app/portal/[mandant]/einstellungen/arbeitszeit/page.tsx': 1,
  'src/app/portal/[mandant]/einstellungen/protokoll/export/page.tsx': 1,
  'src/app/portal/[mandant]/finanzen/ausgaben/[id]/page.tsx': 2,
  'src/app/portal/[mandant]/finanzen/belege/[id]/page.tsx': 3,
  'src/app/portal/[mandant]/finanzen/belege/page.tsx': 1,
  'src/app/portal/[mandant]/finanzen/eingangsrechnungen/[id]/steuer/page.tsx': 3,
  'src/app/portal/[mandant]/finanzen/hashkette/page.tsx': 1,
  'src/app/portal/[mandant]/finanzen/nummernkreise/page.tsx': 6,
  'src/app/portal/[mandant]/finanzen/pruefungen/page.tsx': 4,
  'src/app/portal/[mandant]/finanzen/rechnungen/[id]/festschreiben/page.tsx': 1,
  'src/app/portal/[mandant]/finanzen/rechnungen/[id]/storno/page.tsx': 1,
  'src/app/portal/[mandant]/finanzen/rechnungen/[id]/versand/page.tsx': 1,
  'src/app/portal/[mandant]/freigaben/[id]/rueckgaengig/page.tsx': 1,
  'src/app/portal/[mandant]/leistungskatalog/[id]/PositionsFelder.tsx': 3,
  'src/app/portal/[mandant]/leistungskatalog/[id]/page.tsx': 5,
  'src/app/portal/[mandant]/leistungskatalog/page.tsx': 1,
  'src/app/portal/[mandant]/objekte/[id]/raumbuch/[raumId]/page.tsx': 3,
  'src/app/portal/[mandant]/personal/anstellungen/[id]/vertrag/page.tsx': 1,
  'src/app/portal/[mandant]/personal/zusammenfuehren/page.tsx': 4,
  'src/app/portal/[mandant]/qualitaet/pruefungen/[id]/page.tsx': 2,
  'src/app/portal/[mandant]/qualitaet/pruefungen/neu/page.tsx': 2,
  'src/app/portal/[mandant]/reinigung/sonderleistungen/page.tsx': 3,
  'src/app/portal/[mandant]/security/bewacherregister/page.tsx': 3,
  'src/app/portal/[mandant]/security/page.tsx': 2,
  'src/app/portal/[mandant]/stammdaten/qualifikationen/page.tsx': 1,
  'src/app/portal/[mandant]/stammdaten/reinigungsklassen/page.tsx': 1,
  'src/app/portal/[mandant]/website/leistungen/page.tsx': 2,
  'src/app/portal/[mandant]/website/news/[id]/page.tsx': 3,
  'src/app/portal/[mandant]/website/news/page.tsx': 3,
  'src/app/portal/[mandant]/website/profil/page.tsx': 3,
  'src/app/portal/[mandant]/zeiten/[id]/page.tsx': 1,
  'src/app/portal/[mandant]/zeiten/freigabe/page.tsx': 1,
};
