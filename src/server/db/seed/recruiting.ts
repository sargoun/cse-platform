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
  readonly antworten: number;
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
    return { stellen: 0, bewerbungen: 0, bewertungen: 0, antworten: 0, uebersprungen: true };
  }

  let stellen = 0;
  let bewerbungen = 0;
  let antworten = 0;
  let bewertungen = 0;

  const [frist] = await sql<{ tage: number }[]>`
    select (app.plattform_einstellung('recruiting.aufbewahrung_tage') #>> '{}')::int as tage`;
  const tage = frist?.tage ?? 180;

  for (const [slug, mandantId] of ids) {
    const vorlagen = STELLEN[slug] ?? [];
    if (vorlagen.length === 0) continue;

    /*
     * Der Gesellschaftsname für die Grussformel der Antwortentwürfe — aus der
     * Datenbank gelesen und nicht aus dem Slug gebastelt. „reinigung" ist kein
     * Firmenname, und unter einem Brief steht der Firmenname.
     */
    const [gesellschaft] = await sql<{ name: string }[]>`
      select name from mandant where id = ${mandantId}`;
    const firmenname = gesellschaft?.name ?? slug;

    /*
     * Die erste Stelle ist VERÖFFENTLICHT und trägt deshalb eine EIGENE,
     * genehmigte Freigabe. Die Demo umgeht den Riegel nicht, sie erfüllt ihn.
     *
     * **Hier stand einmal `select … where status = 'genehmigt' limit 1`** —
     * irgendeine genehmigte Freigabe des Mandanten, meistens die eines
     * Social-Beitrags. Das ging gut, solange `stelle_freigegeben_hat_freigabe`
     * (0166) nur `freigabe_id is not null` prüfte. Seit 0167 fragt der
     * Auslöser auch nach der AKTION — und wies den Seed ab, mit genau der
     * Meldung, für die er gebaut ist: eine Zustimmung zu einem Instagram-Post
     * öffnet keine Stellenanzeige. Der Seed war damit der erste echte Beweis,
     * dass der Riegel greift.
     *
     * `erforderliches_recht` steht dran, weil `app.freigabe_entscheiden` sonst
     * auf das allgemeine `freigabe.entscheiden` zurückfiele: der Demo-Posteingang
     * liesse dann eine Stellenanzeige unter einem breiteren Recht durch, als
     * der echte Weg es täte.
     */
    const [mensch] = await sql<{ id: string }[]>`
      select benutzer_id as id from benutzer_mandant
       where mandant_id = ${mandantId} and entzogen_am is null
       order by erstellt_am limit 1`;

    for (const [i, v] of vorlagen.entries()) {
      const veroeffentlicht = i === 0 && mensch !== undefined;
        /*
       * **Mit Mandantenkontext** — sonst schliesst der Riegel aus 0167
       * mitten im Seed.
       *
       * `stelle_braucht_genehmigung` fragt `app.freigabe_genehmigt`, einen
       * Definer, dessen Policy auf `freigabe` (`d_freigabe_lesen`, 0123)
       * `mandant_id = app.aktiver_mandant()` verlangt. Die Seed-Verbindung ist
       * der Eigentuemer und umgeht RLS fuer die EIGENEN Anweisungen; der
       * Definer darin tut das nicht. Dieselbe Loesung wie im Social-Seed, und
       * `set_config(..., true)` ist transaktionslokal: der Mandant verlaesst
       * diese eine Transaktion nicht.
       */
      const [s] = await sql.begin(async (tx) => {
        await tx`select set_config('app.scope', 'mandant', true),
                        set_config('app.mandant_id', ${mandantId}, true)`;
        /*
         * **Erst der Entwurf, dann die Freigabe DAZU, dann die Anzeige.**
         *
         * Die Freigabe entstand frueher VOR der Schleife und damit vor jeder
         * Stelle — sie konnte deshalb kein `bezug_id` tragen, und der Seed
         * haengte dieselbe Zustimmung an die erste Anzeige jeder
         * Gesellschaft. Seit der Auslöser auch fragt, zu WELCHER Stelle die
         * Freigabe gehoert, geht das nicht mehr: `bezug_id` ist Pflicht, und
         * eine Kennung gibt es erst, wenn die Zeile steht.
         *
         * Das ist auch der echte Weg. Niemand genehmigt eine Anzeige, die es
         * noch nicht gibt; `legeStelleVor` legt die Freigabe zu einem
         * vorhandenen Entwurf an. Die Demo bildet jetzt dieselbe Reihenfolge
         * ab, statt ein Ergebnis hinzuschreiben, das so nie zustande kaeme.
         */
        const [angelegt] = await tx<{ id: string }[]>`
        insert into stelle
          (mandant_id, titel, beschreibung, anforderungen, einsatzort, wochenstunden,
           status, bewerbungsfrist, entwurf_von_art)
        values (${mandantId}, ${v.titel}, ${v.beschreibung}, ${[...v.anforderungen]},
                ${v.einsatzort}, ${v.wochenstunden}, 'entwurf'::stelle_status,
                ${veroeffentlicht ? tx`(app.berlin_heute() + 30)` : null},
                ${i === 1 ? 'agent' : 'mensch'}::akteur_art)
        returning id`;
        if (angelegt === undefined || !veroeffentlicht) return [angelegt];

        const [f] = await tx<{ id: string }[]>`
          insert into freigabe
            (mandant_id, aktion, status, vorgang_typ, titel, zusammenfassung, risiko,
             vorschau_payload, payload_hash, freigegeben_von, freigegeben_am,
             bezug_typ, bezug_id, erforderliches_recht)
          values (${mandantId}, 'stelle_veroeffentlichen', 'genehmigt',
                  'stellenanzeige_entwurf', ${`Stellenanzeige: ${v.titel}`},
                  'Freigabe der ersten Anzeige dieser Gesellschaft.',
                  'mittel'::risiko_stufe, ${sql.json({ demo: true })},
                  encode(sha256(convert_to('stelle-demo', 'UTF8')), 'hex'),
                  ${mensch.id}, now() - interval '22 days', 'stelle',
                  ${angelegt.id}, 'recruiting.stelle_veroeffentlichen')
          returning id`;
        if (f === undefined) return [angelegt];

        await tx`
          update stelle
             set status = 'veroeffentlicht'::stelle_status,
                 freigabe_id = ${f.id},
                 veroeffentlicht_am = now() - interval '21 days'
           where id = ${angelegt.id} and mandant_id = ${mandantId}`;
        return [angelegt];
      }) as unknown as { id: string }[];
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

        /*
         * **Die Eingangsbestätigung als ENTWURF** — für jede Bewerbung, die
         * noch lebt (REC-03).
         *
         * Nicht als „gesendet": es ist kein Postausgang verbunden (O-501), und
         * eine Demozeile, die Versand behauptet, wäre die vorgetäuschte
         * Integration, gegen die die ganze Kette gebaut ist. Als Entwurf zeigt
         * sie genau den Stand: der Text steht, ein Mensch fehlt, ein Anbieter
         * auch.
         *
         * Die abgelaufenen Bewerbungen bekommen keine — der Löschlauf nimmt
         * sie mit, und eine Antwort an jemanden, dessen Daten heute Nacht
         * verschwinden, ist kein sinnvolles Demodatum.
         */
        if (!abgelaufen) {
          const [a] = await sql<{ id: string }[]>`
            insert into bewerbung_antwort
              (mandant_id, bewerbung_id, art, betreff, text, entworfen_von)
            values (${mandantId}, ${bw.id}, 'eingangsbestaetigung',
                    ${`Ihre Bewerbung als ${v.titel}`},
                    ${`Guten Tag ${b.name},\n\n`
                      + `vielen Dank für Ihre Bewerbung als ${v.titel}. Sie ist bei uns `
                      + 'eingegangen und wird gerade gesichtet.\n\n'
                      + 'Wir melden uns, sobald wir sie durchgesehen haben. Bis dahin '
                      + 'brauchen Sie nichts weiter zu tun.\n\n'
                      + `Freundliche Grüße\n${firmenname}`},
                    'mensch'::akteur_art)
            on conflict do nothing
            returning id`;
          if (a !== undefined) antworten += 1;
        }

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

  return { stellen, bewerbungen, bewertungen, antworten, uebersprungen: false };
}
