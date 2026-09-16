import type postgres from 'postgres';

/**
 * Recruiting für die Vorführung (REC-01…REC-09).
 *
 * **Nur mit `CSE_DEV_FLAECHEN`.** Anders als die Social-Kanäle ist hier nichts
 * Struktur: eine Stelle ist ein Text, der auf einer öffentlichen Karriereseite
 * landet, und eine Bewerbung ist ein Mensch. In einem echten Bau hat weder das
 * eine noch das andere erfunden dazustehen.
 *
 * **Jede Gesellschaft bekommt jeden Zustand.** Eine veröffentlichte Stelle mit
 * Bewerbungen, einen Entwurf und eine geschlossene; bei den Bewerbungen einen
 * frischen Eingang, eine bewertete und eine entschiedene. Sonst sind die
 * Filter leer, die Rangfolge hat eine Zeile und die Löschseite zeigt nichts —
 * und ein Bildschirm, der nichts zeigt, beweist nicht, dass er funktioniert.
 *
 * **Die Namen sind erkennbar Demodaten.** `@example.test` ist die RFC-6761
 * reservierte Domain: keine Adresse hier kann versehentlich jemanden
 * erreichen.
 *
 * **Eine Bewerbung trägt eine echte Aufbewahrungsfrist.** Sie wird aus
 * `recruiting.aufbewahrung_tage` und dem Eingangsdatum gerechnet — dieselbe
 * Rechnung wie im Betrieb, damit die Datenschutzseite eine Zeile hat, die
 * stimmt. Eine davon ist bewusst ABGELAUFEN und eine GESPERRT: nur so zeigt
 * die Seite beides, und nur so hat der Nachtlauf beim ersten Lauf etwas zu
 * tun.
 */

export interface RecruitingErgebnis {
  readonly stellen: number;
  readonly bewerbungen: number;
  readonly bewertungen: number;
  readonly uebersprungen: boolean;
}

interface Vorlage {
  readonly titel: string;
  readonly beschreibung: string;
  readonly anforderungen: readonly string[];
  readonly einsatzort: string;
  readonly wochenstunden: number;
}

const STELLEN: Readonly<Record<string, readonly Vorlage[]>> = {
  reinigung: [
    {
      titel: 'Reinigungskraft Unterhaltsreinigung (m/w/d)',
      beschreibung: 'Unterhaltsreinigung in Büroobjekten in Berlin-Mitte und Charlottenburg. '
        + 'Feste Objekte, feste Zeiten, Einarbeitung durch die Objektleitung.',
      anforderungen: ['Erfahrung in der Unterhaltsreinigung',
        'Deutsch für die Absprache im Objekt', 'Zuverlässigkeit bei festen Zeiten'],
      einsatzort: 'Berlin-Mitte',
      wochenstunden: 30,
    },
    {
      titel: 'Objektleitung Gebäudereinigung (m/w/d)',
      beschreibung: 'Verantwortung für sechs Objekte: Einteilung, Qualitätskontrolle, '
        + 'Ansprechpartner für Kunden vor Ort.',
      anforderungen: ['Mehrjährige Erfahrung in der Gebäudereinigung',
        'Führerschein Klasse B', 'Erfahrung in der Personaleinteilung'],
      einsatzort: 'Berlin',
      wochenstunden: 40,
    },
  ],
  security: [
    {
      titel: 'Sicherheitsmitarbeiter Objektschutz (m/w/d)',
      beschreibung: 'Objektschutz in einem Bürohaus in Berlin-Mitte, Schichtdienst '
        + 'einschliesslich Nacht und Wochenende.',
      anforderungen: ['Unterrichtung nach § 34a GewO', 'Bewacherregistrierung',
        'Bereitschaft zum Schichtdienst'],
      einsatzort: 'Berlin-Mitte',
      wochenstunden: 40,
    },
    {
      titel: 'Schichtleitung Veranstaltungsdienst (m/w/d)',
      beschreibung: 'Leitung von Teams im Veranstaltungsdienst: Einteilung vor Ort, '
        + 'Übergabe an die Einsatzleitung, Wachbuchführung.',
      anforderungen: ['Sachkundeprüfung nach § 34a GewO', 'Erfahrung im Veranstaltungsdienst',
        'Erfahrung in der Führung von Teams'],
      einsatzort: 'Berlin',
      wochenstunden: 40,
    },
  ],
  bau: [
    {
      titel: 'Bauleitung Ausbau (m/w/d)',
      beschreibung: 'Bauleitung im Innenausbau: Termine, Aufmass, Nachtragsmanagement, '
        + 'Abstimmung mit Auftraggeber und Nachunternehmern.',
      anforderungen: ['Abgeschlossene Ausbildung oder Studium im Bauwesen',
        'Erfahrung mit VOB/B', 'Sicherer Umgang mit Aufmass und Nachträgen'],
      einsatzort: 'Berlin',
      wochenstunden: 40,
    },
    {
      titel: 'Trockenbauer (m/w/d)',
      beschreibung: 'Trockenbau im Innenausbau: Ständerwerk, Beplankung, Spachtelarbeiten.',
      anforderungen: ['Erfahrung im Trockenbau', 'Selbstständige Arbeitsweise'],
      einsatzort: 'Berlin',
      wochenstunden: 40,
    },
  ],
  operations: [
    {
      titel: 'Sachbearbeitung Verwaltung (m/w/d)',
      beschreibung: 'Verwaltung für die Gruppe: Rechnungsprüfung, Stammdaten, Zuarbeit '
        + 'für die Buchhaltung.',
      anforderungen: ['Kaufmännische Ausbildung', 'Sicherer Umgang mit Tabellen',
        'Sorgfalt bei Belegen'],
      einsatzort: 'Berlin',
      wochenstunden: 40,
    },
  ],
};

/**
 * Vier Menschen je Gesellschaft, erkennbar erfunden (`.test`, RFC 6761) — und
 * vier, nicht drei, wegen des LETZTEN.
 *
 * Mit dreien war jede abgelaufene Bewerbung zugleich gesperrt, und damit hatte
 * der Nachtlauf beim ersten Lauf nichts zu tun: „0 gelöscht" auf einer Seite,
 * die vier fällige Zeilen zeigt. Das sah aus wie ein Fehler und war einer —
 * im Demodatum. Jetzt gibt es beides: eine abgelaufene, die gelöscht WIRD,
 * und eine abgelaufene, die eine Sperre hält.
 */
const BEWERBER: readonly { name: string; email: string; telefon: string }[] = [
  { name: 'Lena Brandt', email: 'lena.brandt@example.test', telefon: '+49 30 1111001' },
  { name: 'Tomasz Wójcik', email: 'tomasz.wojcik@example.test', telefon: '+49 30 1111002' },
  { name: 'Aisha Demir', email: 'aisha.demir@example.test', telefon: '+49 30 1111003' },
  { name: 'Marek Nowak', email: 'marek.nowak@example.test', telefon: '+49 30 1111004' },
];

export async function seedRecruiting(
  sql: postgres.Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<RecruitingErgebnis> {
  if (!demodaten) {
    return { stellen: 0, bewerbungen: 0, bewertungen: 0, uebersprungen: true };
  }

  let stellen = 0;
  let bewerbungen = 0;
  let bewertungen = 0;

  const [frist] = await sql<{ tage: number }[]>`
    select (app.plattform_einstellung('recruiting.aufbewahrung_tage') #>> '{}')::int as tage`;
  const tage = frist?.tage ?? 180;

  for (const [slug, mandantId] of ids) {
    const vorlagen = STELLEN[slug] ?? [];
    if (vorlagen.length === 0) continue;

    /*
     * Die erste Stelle ist VERÖFFENTLICHT und trägt deshalb eine Freigabe —
     * `stelle_freigegeben_hat_freigabe` (0166) lässt den Status ohne sie gar
     * nicht zu. Die Demo umgeht den Riegel nicht, sie erfüllt ihn.
     */
    const [freigabe] = await sql<{ id: string }[]>`
      select id from freigabe
       where mandant_id = ${mandantId} and status = 'genehmigt'
       order by erstellt_am limit 1`;

    for (const [i, v] of vorlagen.entries()) {
      const veroeffentlicht = i === 0 && freigabe !== undefined;
      const [s] = await sql<{ id: string }[]>`
        insert into stelle
          (mandant_id, titel, beschreibung, anforderungen, einsatzort, wochenstunden,
           status, freigabe_id, veroeffentlicht_am, bewerbungsfrist, entwurf_von_art)
        values (${mandantId}, ${v.titel}, ${v.beschreibung}, ${[...v.anforderungen]},
                ${v.einsatzort}, ${v.wochenstunden},
                ${veroeffentlicht ? 'veroeffentlicht' : 'entwurf'}::stelle_status,
                ${veroeffentlicht ? freigabe.id : null},
                ${veroeffentlicht ? sql`now() - interval '21 days'` : null},
                ${veroeffentlicht ? sql`(app.berlin_heute() + 30)` : null},
                ${i === 1 ? 'agent' : 'mensch'}::akteur_art)
        returning id`;
      if (s === undefined) continue;
      stellen += 1;
      if (!veroeffentlicht) continue;

      for (const [j, b] of BEWERBER.entries()) {
        /*
         * Vier Zustände, und die letzten beiden sind mit Absicht ABGELAUFEN:
         * einer ohne Sperre (den löscht der Nachtlauf beim ersten Lauf) und
         * einer mit (der bleibt und steht auf der Datenschutzseite unter
         * „gesperrt"). Ohne den ersten hätte der Lauf nichts zu tun, ohne den
         * zweiten zeigte die Seite keine Sperre — und beides sähe aus wie
         * „funktioniert", ohne etwas zu beweisen.
         */
        const abgelaufen = j >= 2;
        const alterTage = abgelaufen ? tage + 5 + j : j * 7 + 2;
        const [bw] = await sql<{ id: string }[]>`
          insert into bewerbung
            (mandant_id, stelle_id, quelle, status, name, email, telefon, nachricht,
             eingegangen_am, aufbewahrung_bis, loeschsperre)
          values (${mandantId}, ${s.id}, 'karriereseite'::bewerbung_quelle,
                  ${j === 1 ? 'in_pruefung' : 'eingegangen'}::bewerbung_status,
                  ${b.name}, ${`${slug}.${b.email}`}, ${b.telefon},
                  ${`Ich bewerbe mich auf die Stelle „${v.titel}". Über eine Rückmeldung `
                    + 'freue ich mich.'},
                  ${sql`now() - (${alterTage}::int * interval '1 day')`},
                  ${sql`(app.berlin_heute() - ${alterTage}::int + ${tage}::int)`},
                  ${j === 3 ? 'Laufendes AGG-Verfahren — Löschung ausgesetzt (Demodatum)' : null})
          returning id`;
        if (bw === undefined) continue;
        bewerbungen += 1;

        /* Die mittlere ist bewertet — damit die Rangfolge nicht aus einer Zeile besteht. */
        if (j !== 1) continue;
        for (const [k, anforderung] of v.anforderungen.entries()) {
          await sql`
            insert into bewerbung_bewertung
              (mandant_id, bewerbung_id, kriterium, gewicht, punkte, begruendung,
               erstellt_von_art)
            values (${mandantId}, ${bw.id}, ${anforderung},
                    ${[50, 30, 20][k] ?? 20}, ${[8, 6, 9][k] ?? 7},
                    ${'Im Lebenslauf belegt und im Gespräch bestätigt (Demodatum).'},
                    'mensch'::akteur_art)`;
          bewertungen += 1;
        }
      }
    }
  }

  return { stellen, bewerbungen, bewertungen, uebersprungen: false };
}
