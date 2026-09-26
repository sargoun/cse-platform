/**
 * **Das Löschkonzept — abgeleitet, nicht geschrieben** (LEG-09, Phase 10).
 *
 * Ein Löschkonzept beantwortet zwei Fragen, und beide sind unangenehm:
 * *Was wird gelöscht, wann und wodurch?* und *Was wird NICHT gelöscht, und
 * mit welcher Begründung?* Die zweite ist die wichtigere — vor einer Aufsicht
 * ist „wir behalten das" ohne Grund dasselbe wie „wir wissen es nicht".
 *
 * **Warum es hier entsteht und nicht in einem Ordner liegt.** Die Antworten
 * stehen bereits im System, an drei Stellen:
 *
 *  - `rls.ts.KEIN_HARD_DELETE` — welche Tabelle nie hart gelöscht wird, in
 *    welcher Art (`soft`, `archiv`, `append`) und **mit welchem Grund**
 *    (K-16). Das ist die Liste der Ausnahmen von Art. 17, und sie ist
 *    bereits begründet, weil ein Prüfer sie liest.
 *  - Die Aufbewahrungsregeln der Gesellschaft (`aufbewahrungsregel`,
 *    `dokument/aufbewahrung.ts`) — die Fristen je Dokumentklasse, mit ihren
 *    gesetzlichen Untergrenzen aus § 147 AO und § 257 HGB.
 *  - Die Läufe, die wirklich löschen (`jobs/registry.ts`) — wer nachts
 *    anonymisiert, und gegen welche Frist.
 *
 * Ein Dokument daneben wäre eine vierte Wahrheit, die beim ersten Umbau
 * falsch wird. Dieses hier ist beim Abruf richtig oder es ist kaputt — und
 * `loeschkonzept.test.ts` merkt das Zweite.
 *
 * **Es löscht nichts.** Es beschreibt, was gelöscht WIRD. Der Weg für einen
 * Antrag nach Art. 17 ist `/portal/[mandant]/datenschutz/[id]/loeschung` und
 * erzeugt eine Entscheidung, keine Löschung (04-SEITENKARTE §5.25).
 */
import { createHash } from 'node:crypto';
import { KEIN_HARD_DELETE, type Loeschart } from '@/server/db/schema/rls';
import { UNTERGRENZE, liesAufbewahrung } from '@/server/services/dokument/aufbewahrung';
import { KATEGORIEN, type Kategorie } from '@/server/services/dokument/kategorie';
import type { JobDefinition } from '@/server/jobs/registry';
import { markdownZelle } from '@/lib/markdown';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  readonly aktiverMandantId: string;
}

export const LOESCHART_LABEL: Readonly<Record<Loeschart, string>> = {
  soft: 'Weich: die Zeile bleibt für die Rekonstruktion, Finder blenden sie aus',
  archiv: 'Zustand: die Zeile bleibt, ihr Status endet (archiviert, storniert, geschlossen)',
  append: 'Nur Anfügen: nichts beendet eine Zeile, es gibt keine Spalte dafür',
};

/** Eine Klasse von Daten mit ihrer Frist und dem, was die Frist auslöst. */
export interface Fristzeile {
  readonly klasse: string;
  readonly frist: string;
  readonly grundlage: string;
  readonly ausloeser: string;
  /** `true`, wenn die Gesellschaft hier noch nichts entschieden hat. */
  readonly offen: boolean;
}

/** Ein Lauf, der wirklich löscht oder anonymisiert. */
export interface Loeschlauf {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly zeitplan: string;
  readonly wirkung: string;
}

export interface Loeschkonzept {
  readonly mandantId: string;
  readonly firma: string;
  readonly fristen: readonly Fristzeile[];
  readonly laeufe: readonly Loeschlauf[];
  /** Die Tabellen, die nie hart gelöscht werden — je Art gebündelt. */
  readonly sperren: readonly {
    readonly art: Loeschart;
    readonly tabellen: readonly { readonly tabelle: string; readonly grund: string }[];
  }[];
  readonly offen: readonly string[];
  readonly sha256: string;
  readonly abgerufenAm: string;
}

/**
 * **Welche Läufe wirklich löschen.**
 *
 * Aus dem Jobregister gelesen und hier benannt: ein Lauf, der „aufräumt",
 * ist für ein Löschkonzept nur dann einer, wenn er personenbezogene Daten
 * entfernt oder anonymisiert. Die Zuordnung steht als Liste und nicht als
 * Namensmuster — `*_loeschung` hätte `loeschsperre_pruefung` mitgenommen,
 * einen Lauf, der gerade NICHT löscht.
 */
const LOESCHENDE_LAEUFE: Readonly<Record<string, string>> = {
  dokument_aufbewahrung:
    'Löscht Dokumente, deren Aufbewahrungsfrist abgelaufen ist: die Zeile weich '
    + 'mit Grund und Datum, die Datei im Speicher ganz (DOC-07, LEG-01). Er erreicht '
    + 'heute die Klassen „Angebot“ und „Kunde“ (je sechs Jahre, § 257 HGB) — die vier '
    + 'GoBD-Klassen und die drei offenen tragen eine Löschsperre und fallen aus dem '
    + 'Lauf heraus, er sieht sie nicht (O-894, O-25). Ebenso ein Dokument, auf das '
    + 'sich eine Buchungszeile beruft.',
  bewerber_loeschung:
    'Anonymisiert abgelaufene Bewerbungen: Bewertungen, Kandidatendaten und '
    + 'Gesprächsnotizen werden gelöscht, die Bewerbung bleibt als Gerippe ohne '
    + 'Namen (REC-07). Eingestellte und gesperrte bleiben zurück.',
};

function fristen(
  regeln: readonly { readonly kategorie: Kategorie; readonly jahre: number | null;
    readonly grundlage: string; readonly istPlatzhalter: boolean }[],
  tageBewerbung: number | null,
): readonly Fristzeile[] {
  const zeilen: Fristzeile[] = KATEGORIEN.map((k) => {
    const regel = regeln.find((r) => r.kategorie === k);
    const grenze = UNTERGRENZE[k];
    if (regel === undefined || regel.jahre === null) {
      return {
        klasse: `Dokumente: ${k}`,
        frist: grenze === null
          ? 'nicht gesetzt — und kein Gesetz nennt hier eine Zahl (O-25)'
          : `nicht gesetzt — die gesetzliche Untergrenze sind ${String(grenze)} Jahre`,
        grundlage: grenze === null ? '—' : '§ 147 AO / § 257 HGB',
        ausloeser: 'Entstehungsdatum des Dokuments',
        offen: true,
      };
    }
    return {
      klasse: `Dokumente: ${k}`,
      frist: `${String(regel.jahre)} Jahre${regel.istPlatzhalter ? ' (Platzhalter)' : ''}`,
      grundlage: regel.grundlage,
      ausloeser: 'Entstehungsdatum des Dokuments',
      offen: regel.istPlatzhalter,
    };
  });
  zeilen.push({
    klasse: 'Bewerbungen',
    frist: tageBewerbung === null
      ? 'nicht gesetzt (O-373)'
      : `${String(tageBewerbung)} Tage ab Eingang`,
    grundlage: 'Einstellung recruiting.aufbewahrung_tage; die Karriereseite sagt die Frist zu',
    ausloeser: 'Eingang der Bewerbung; der Nachtlauf prüft gegen den Berliner Kalendertag',
    offen: tageBewerbung === null,
  });
  zeilen.push({
    klasse: 'Arbeitszeitaufzeichnungen',
    frist: '2 Jahre ab Aufzeichnung',
    grundlage: '§ 17 Abs. 2 MiLoG',
    ausloeser: 'Beginn des Zeiteintrags',
    offen: false,
  });
  zeilen.push({
    klasse: 'Personalakte, Konten, Agentenläufe',
    frist: 'noch nicht entschieden — O-514',
    grundlage: 'Personalaktenpraxis der Gesellschaft; § 147 AO deckt die Belege, nicht die Akte',
    ausloeser: 'Austritt bzw. Ende des Kontos',
    offen: true,
  });
  return zeilen;
}

/** Kanonische Form: stabile Reihenfolge, keine Uhr. */
function kanonisch(k: Omit<Loeschkonzept, 'sha256' | 'abgerufenAm' | 'mandantId' | 'firma'>): string {
  return JSON.stringify({ fristen: k.fristen, laeufe: k.laeufe, sperren: k.sperren });
}

export async function erstelleLoeschkonzept(
  db: Abfrage, jobs: readonly JobDefinition[], jetzt: Date,
): Promise<Loeschkonzept> {
  const mandantId = db.aktiverMandantId;
  const [m] = await db.abfrage<{ firma: string }>(
    `select firma from mandant where id = $1::uuid`, [mandantId]);
  if (m === undefined) throw new Error('Die Gesellschaft ist nicht lesbar.');

  const regeln = await liesAufbewahrung(db);
  const [einstellung] = await db.abfrage<{ tage: number | null }>(
    `select (app.plattform_einstellung('recruiting.aufbewahrung_tage') #>> '{}')::int as tage`);
  const tageBewerbung = einstellung?.tage ?? null;

  const zeilen = fristen(regeln, tageBewerbung);

  /*
   * **Aus dem Register, nicht aus einer Liste hier.** Fällt ein Lauf weg oder
   * ändert er seinen Zeitplan, ändert sich das Konzept mit — und ein Lauf,
   * der in `LOESCHENDE_LAEUFE` steht und im Register fehlt, taucht gar nicht
   * erst auf, statt eine Löschung zu behaupten, die niemand ausführt.
   */
  const laeufe: Loeschlauf[] = jobs
    .filter((j) => LOESCHENDE_LAEUFE[j.schluessel] !== undefined)
    .map((j) => ({
      schluessel: j.schluessel,
      bezeichnung: j.bezeichnung,
      zeitplan: j.zeitplan,
      wirkung: LOESCHENDE_LAEUFE[j.schluessel] ?? '',
    }));

  const arten: Loeschart[] = ['append', 'archiv', 'soft'];
  const sperren = arten.map((art) => ({
    art,
    tabellen: KEIN_HARD_DELETE
      .filter((s) => s.art === art)
      .map((s) => ({ tabelle: s.tabelle, grund: s.grund }))
      .sort((a, b) => a.tabelle.localeCompare(b.tabelle)),
  })).filter((g) => g.tabellen.length > 0);

  const offen = [
    ...(zeilen.some((z) => z.offen && z.klasse.startsWith('Dokumente'))
      ? ['O-25 — Aufbewahrungsfristen je Dokumentklasse sind teilweise nicht gesetzt'] : []),
    ...(tageBewerbung === null ? ['O-373 — Aufbewahrungsfrist für Bewerberdaten'] : []),
    'O-514 — Fristen für Personalakte, Konten und Agentenläufe',
    'O-376 — Wie lange bleiben die Unterlagen eines EINGESTELLTEN Bewerbers?',
  ];

  const roh = { fristen: zeilen, laeufe, sperren, offen };
  const sha256 = createHash('sha256').update(kanonisch(roh), 'utf8').digest('hex');
  const abgerufenAm = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Berlin', timeZoneName: 'short',
  }).format(jetzt);

  return { mandantId, firma: m.firma, ...roh, sha256, abgerufenAm };
}

/** Das Konzept als Markdown — zum Ausdrucken und Weitergeben. */
export function alsMarkdown(k: Loeschkonzept): string {
  const z: string[] = [
    `# Löschkonzept — ${k.firma}`,
    '',
    'Abgeleitet aus den Aufbewahrungsregeln dieser Gesellschaft, den Löschläufen '
    + 'und dem Register der Löschsperren. Es beschreibt, was gelöscht wird — es '
    + 'löscht nichts.',
    '',
    `Abgerufen: ${k.abgerufenAm} · Prüfsumme des Inhalts: \`${k.sha256}\``,
    '',
    '## 1. Fristen', '',
    '| Klasse | Frist | Grundlage | Auslöser |',
    '|---|---|---|---|',
    ...k.fristen.map((f) => `| ${markdownZelle(f.klasse)} | ${markdownZelle(f.frist)} `
      + `| ${markdownZelle(f.grundlage)} | ${markdownZelle(f.ausloeser)} |`),
    '',
    '## 2. Was wirklich löscht', '',
  ];
  if (k.laeufe.length === 0) {
    z.push('*Kein Lauf dieser Plattform löscht personenbezogene Daten.*', '');
  } else {
    z.push('| Lauf | Zeitplan (UTC) | Wirkung |', '|---|---|---|',
      ...k.laeufe.map((l) => `| ${markdownZelle(l.bezeichnung)} | \`${l.zeitplan}\` `
        + `| ${markdownZelle(l.wirkung)} |`), '');
  }
  z.push('## 3. Was NICHT gelöscht wird — und warum', '');
  for (const g of k.sperren) {
    z.push(`### ${LOESCHART_LABEL[g.art]}`, '', '| Tabelle | Grund |', '|---|---|',
      ...g.tabellen.map((t) => `| \`${t.tabelle}\` | ${markdownZelle(t.grund)} |`), '');
  }
  z.push('## 4. Offen', '', ...k.offen.map((o) => `- ${o}`), '');
  return z.join('\n');
}
