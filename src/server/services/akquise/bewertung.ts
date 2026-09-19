import 'server-only';
import {
  BRANCHE_JE_BEREICH_PLATZHALTER, GEWICHTE_PLATZHALTER, NAHBEREICH_PLZ_PLATZHALTER,
  SKALA_MAX_PLATZHALTER, UMLAND_PLZ_PLATZHALTER,
} from './gewichte.platzhalter.js';

/**
 * Die Bewertung eines recherchierten Ziels — **reine Rechnung, nie ein Modell**
 * (§12 der Auftragsbeschreibung, Invariante 6).
 *
 * **Warum hier kein Sprachmodell rechnet, obwohl §12 „the AI should analyze
 * the company" sagt.** Invariante 6 dieses Hauses: die KI liest, extrahiert,
 * klassifiziert und entwirft — jede ZAHL geht durch eine getestete Funktion.
 * Eine Punktzahl aus einem Modell wäre bei derselben Firma morgen eine andere,
 * ohne dass sich etwas geändert hätte; ein Vertrieb, der danach seine Woche
 * plant, plant nach Rauschen. Und niemand könnte sagen, WARUM eine Firma
 * achtzig bekommen hat.
 *
 * Hier bekommt jede Firma dieselbe Punktzahl, solange dieselben Daten
 * dastehen — und die Begründung nennt jedes Kriterium, das beigetragen hat.
 * Das ist zugleich das, was §12 wirklich verlangt: „Reason for relevance".
 *
 * **Was ein Modell später beitragen kann**, ohne diese Regel zu brechen: den
 * Text der Erstansprache entwerfen (`entwurf.ts`) und aus einer Website
 * herauslesen, welche Branche dort steht — also klassifizieren, nicht rechnen.
 */

export interface ZielDaten {
  readonly firmenname: string;
  readonly branche: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly website: string | null;
  readonly allgemeineEmail: string | null;
  readonly telefon: string | null;
}

export interface Bewertung {
  readonly punktzahl: number;
  readonly begruendung: string;
  /** Der Slug des passenden Bereichs — `null` heisst „kein eindeutiger Treffer". */
  readonly passenderBereich: string | null;
  readonly bedarfVermutung: string | null;
}

/** Klein, ohne Umlaute, damit „Bürogebäude" und „Buerogebaeude" dasselbe treffen. */
function normal(wert: string): string {
  return wert
    .toLowerCase()
    .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss');
}

/**
 * Welcher Bereich passt — und warum.
 *
 * **Bei zwei gleich starken Treffern gewinnt keiner.** `null` ist hier eine
 * Antwort: „diese Firma passt zu zweien, entscheide du." Einen davon zu
 * würfeln hiesse, dem Vertrieb eine Zuordnung zu geben, die er für begründet
 * hält.
 */
export function bereichFuer(
  daten: ZielDaten,
  zuordnung: Readonly<Record<string, readonly string[]>> = BRANCHE_JE_BEREICH_PLATZHALTER,
): { readonly bereich: string | null; readonly treffer: readonly string[] } {
  const heuhaufen = normal(`${daten.firmenname} ${daten.branche ?? ''}`);
  const je: { bereich: string; treffer: string[] }[] = [];

  for (const [bereich, woerter] of Object.entries(zuordnung)) {
    const treffer = woerter.filter((w) => heuhaufen.includes(normal(w)));
    if (treffer.length > 0) je.push({ bereich, treffer });
  }
  if (je.length === 0) return { bereich: null, treffer: [] };

  je.sort((a, b) => b.treffer.length - a.treffer.length);
  const bester = je[0]!;
  const zweiter = je[1];
  /* Gleichstand: keine Zuordnung, aber die Wörter nennen wir trotzdem. */
  if (zweiter !== undefined && zweiter.treffer.length === bester.treffer.length) {
    return { bereich: null, treffer: [...bester.treffer, ...zweiter.treffer] };
  }
  return { bereich: bester.bereich, treffer: bester.treffer };
}

/**
 * Die Punktzahl auf der Skala 0…`SKALA_MAX_PLATZHALTER`.
 *
 * Vier Kriterien, jedes mit seinem Höchstbeitrag aus der Platzhalterdatei.
 * Die Begründung ist kein Schmuck: §12 verlangt ausdrücklich einen „Reason for
 * relevance", und eine Punktzahl ohne Grund ist eine Zahl, der man glauben
 * soll.
 */
export function bewerte(
  daten: ZielDaten,
  zuordnung: Readonly<Record<string, readonly string[]>> = BRANCHE_JE_BEREICH_PLATZHALTER,
): Bewertung {
  const teile: string[] = [];
  let punkte = 0;

  // ─── Branche ───
  const { bereich, treffer } = bereichFuer(daten, zuordnung);
  if (bereich !== null) {
    punkte += GEWICHTE_PLATZHALTER.branche;
    teile.push(
      `Branche passt zu ${bereich} (${treffer.join(', ')}): `
      + `+${String(GEWICHTE_PLATZHALTER.branche)}`);
  } else if (treffer.length > 0) {
    /*
     * Gleichstand zwischen zwei Bereichen: die halbe Punktzahl. Die Firma ist
     * interessant, nur ist unklar, für wen — und das steht auch so da.
     */
    const halb = Math.round(GEWICHTE_PLATZHALTER.branche / 2);
    punkte += halb;
    teile.push(
      `Branchenwörter treffen mehrere Bereiche (${treffer.join(', ')}) — `
      + `keine eindeutige Zuordnung: +${String(halb)}`);
  } else {
    teile.push('Keine Branchenwörter getroffen: +0');
  }

  // ─── Entfernung ───
  const plz2 = (daten.plz ?? '').trim().slice(0, 2);
  if ((NAHBEREICH_PLZ_PLATZHALTER as readonly string[]).includes(plz2)) {
    punkte += GEWICHTE_PLATZHALTER.entfernung;
    teile.push(`Berlin (PLZ ${plz2}xxx): +${String(GEWICHTE_PLATZHALTER.entfernung)}`);
  } else if ((UMLAND_PLZ_PLATZHALTER as readonly string[]).includes(plz2)) {
    const halb = Math.round(GEWICHTE_PLATZHALTER.entfernung / 2);
    punkte += halb;
    teile.push(`Umland (PLZ ${plz2}xxx): +${String(halb)}`);
  } else if (daten.plz === null) {
    teile.push('Keine Postleitzahl hinterlegt: +0');
  } else {
    teile.push(`Ausserhalb des Einzugsgebiets (PLZ ${plz2}xxx): +0`);
  }

  // ─── Stichwort im Namen ───
  const name = normal(daten.firmenname);
  /*
   * `new Set`, weil ein Wort in zwei Bereichslisten stehen kann — „wohnungsbau"
   * gehoert zur Reinigung UND zum Bau. Ohne die Entdopplung stuende es zweimal
   * in der Begruendung, und ein Leser haelt eine doppelte Nennung fuer einen
   * doppelten Treffer.
   */
  const nameTrifft = [...new Set(Object.values(zuordnung).flat()
    .filter((w) => name.includes(normal(w)))
    .map((w) => normal(w)))];
  if (nameTrifft.length > 0) {
    punkte += GEWICHTE_PLATZHALTER.stichwort;
    teile.push(
      `Stichwort im Firmennamen (${nameTrifft.join(', ')}): `
      + `+${String(GEWICHTE_PLATZHALTER.stichwort)}`);
  } else {
    teile.push('Kein Stichwort im Firmennamen: +0');
  }

  // ─── Erreichbarkeit ───
  const wege = [
    daten.website === null ? null : 'Website',
    daten.allgemeineEmail === null ? null : 'allgemeine E-Mail',
    daten.telefon === null ? null : 'Telefon',
  ].filter((w): w is string => w !== null);
  if (wege.length > 0) {
    punkte += GEWICHTE_PLATZHALTER.erreichbar;
    teile.push(`Erreichbar über ${wege.join(', ')}: +${String(GEWICHTE_PLATZHALTER.erreichbar)}`);
  } else {
    teile.push('Kein Weg hinterlegt — nicht ansprechbar: +0');
  }

  const punktzahl = Math.max(0, Math.min(SKALA_MAX_PLATZHALTER, punkte));

  return {
    punktzahl,
    begruendung:
      `${String(punktzahl)} von ${String(SKALA_MAX_PLATZHALTER)} — `
      + `${teile.join(' · ')}. `
      + 'Die Gewichte sind PLATZHALTER (O-15) und von niemandem bestätigt.',
    passenderBereich: bereich,
    bedarfVermutung: bereich === null ? null : bedarfSatz(bereich, treffer),
  };
}

/**
 * Ein Satz, was diese Firma vermutlich braucht — für die Spalte „Reason for
 * relevance" aus §12.
 *
 * **„Vermutlich" steht wörtlich darin**, und das ist die Aussage: es ist eine
 * Ableitung aus einem Branchenwort, kein Wissen über diese Firma. Wer den
 * Satz liest, soll ihn als Vermutung lesen und nicht als Rechercheergebnis.
 */
function bedarfSatz(bereich: string, treffer: readonly string[]): string {
  const woerter = treffer.length === 0 ? 'die Branchenangabe' : `„${treffer.join('\", \"')}"`;
  const leistung: Record<string, string> = {
    reinigung: 'Unterhalts- oder Glasreinigung',
    security: 'Objektschutz oder Veranstaltungsdienst',
    bau: 'Ausbau-, Rückbau- oder Sanierungsleistungen',
    operations: 'digitale Betriebsunterstützung',
  };
  return `Vermutlich Bedarf an ${leistung[bereich] ?? 'unseren Leistungen'} — `
    + `abgeleitet aus ${woerter}. Nicht geprüft.`;
}
