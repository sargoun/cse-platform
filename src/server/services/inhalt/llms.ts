/**
 * `/llms.txt` (PUB-12) — dieselbe NAP-Quelle wie Impressum und JSON-LD.
 *
 * **Warum generiert und nicht gepflegt.** PUB-12 verlangt einen ueber alle
 * Verzeichnisse hinweg konsistenten NAP-Block. Eine von Hand gepflegte Datei
 * ist genau die Stelle, an der eine Adressaenderung nicht ankommt — und zwei
 * Schreibweisen derselben Adresse sind fuer eine Maschine zwei Unternehmen.
 * Diese Datei entsteht deshalb aus `mandant`, wie `napAus()` sie formatiert.
 *
 * Es steht nur drin, was gepflegt ist. Kein Werbetext, keine erfundene
 * Leistungsliste: was ein Sprachmodell hier liest, gibt es weiter, und eine
 * ausgedachte Zeile wird so zu einer Aussage des Unternehmens.
 */
import { napAus, type NapQuelle } from './nap.js';

export interface LlmsBereich {
  readonly slug: string;
  readonly mandant: NapQuelle;
  /** `unternehmensprofil.kurzbeschreibung`, wenn gepflegt. */
  readonly kurzbeschreibung: string | null;
}

export interface LlmsSeite {
  readonly pfad: string;
  readonly titel: string;
}

/**
 * Die Datei traegt den AUFTRITTSNAMEN der Gruppe, nicht die erste Gesellschaft.
 *
 * Ein frueher Entwurf nahm `bereiche[0]` als Gruppe. Das Ergebnis las sich als
 * "CSE Dienstleistungen GmbH ist die Gruppe" — mitsamt deren Anschrift und
 * Telefonnummer als Gruppendaten. Fuer ein Sprachmodell, das genau solche
 * Dateien als Fakten uebernimmt, ist das keine Ungenauigkeit, sondern eine
 * falsche Aussage ueber die Firmenstruktur.
 *
 * Eine Gruppenanschrift steht nur da, wenn die Gruppe als Rechtstraeger
 * gepflegt ist (O-206). Bis dahin: der Name, und darunter die vier
 * Gesellschaften mit ihren eigenen, vollstaendigen Angaben.
 */
export function llmsTxt(
  gruppeName: string,
  gruppeNap: NapQuelle | null,
  bereiche: readonly LlmsBereich[],
  seiten: readonly LlmsSeite[],
  basis: string,
): string {
  const zeilen: string[] = [];

  zeilen.push(`# ${gruppeName}`);
  zeilen.push('');
  zeilen.push(
    '> Unternehmensgruppe in Berlin mit eigenständigen Gesellschaften für '
    + 'Gebäudereinigung, Sicherheitsdienste und Bau.',
  );
  zeilen.push('');
  if (gruppeNap !== null) {
    const g = napAus(gruppeNap);
    zeilen.push(`${g.strasse}, ${g.ort}`);
    zeilen.push(`Telefon: ${g.telefon}`);
    if (g.email !== '') zeilen.push(`E-Mail: ${g.email}`);
    zeilen.push('');
  }

  zeilen.push('## Gesellschaften');
  zeilen.push('');
  for (const b of bereiche) {
    const nap = napAus(b.mandant);
    // Der Name steht ZEICHENGLEICH so, wie er im Impressum und im
    // LocalBusiness-Block steht. Eine zweite Schreibweise wäre ein zweites
    // Unternehmen.
    zeilen.push(`- [${nap.name}](${basis}/${b.slug}): ${nap.strasse}, ${nap.ort}, `
      + `Telefon ${nap.telefon}`
      + (b.kurzbeschreibung === null ? '' : ` — ${b.kurzbeschreibung}`));
  }
  zeilen.push('');

  if (seiten.length > 0) {
    zeilen.push('## Seiten');
    zeilen.push('');
    for (const s of seiten) zeilen.push(`- [${s.titel}](${basis}${s.pfad})`);
    zeilen.push('');
  }

  return zeilen.join('\n');
}
