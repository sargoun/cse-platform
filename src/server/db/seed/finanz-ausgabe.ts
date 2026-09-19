import type postgres from 'postgres';

/**
 * Ausgaben und Kassen — Demodaten für `/finanzen/ausgaben` und
 * `/finanzen/ausgaben/[id]` (FIN-14, FIN-17, ACC-01, ACC-08, K-05).
 *
 * **Eine eigene Datei mit EINER Einhängezeile in `index.ts`.** Der Seed ist
 * die Datei, an der alle Domänenagenten gleichzeitig arbeiten; ein Block von
 * zweihundert Zeilen mitten hinein ist ein Konflikt, der jemanden eine Stunde
 * kostet. Dasselbe Verfahren wie `seedEingang`, `seedBau`, `seedVertrieb`.
 *
 * **Wiederholbar.** Jede Zeile hängt an einem natürlichen Schlüssel
 * (`ausgabe_kategorie.schluessel`, `kasse.bezeichnung`, `ausgabe.bezeichnung`
 * je Gesellschaft), und der zweite Lauf legt nichts nach. Ein Seed, der
 * beim zweiten Aufruf verdoppelt, ist in einer append-only-Domäne nicht
 * zurücknehmbar (Invariante 8).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier BEWUSST fehlt — und warum**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  · **`beleg`** (und damit `/finanzen/belege`, `/finanzen/belege/[id]`):
 *    `beleg.dokument_id` und `.dokument_version_id` sind NOT NULL, und eine
 *    `dokument_version` zeigt über `objekt_schluessel` + `sha256` auf Bytes.
 *    Ohne verbundenen Objektspeicher wären das Zeilen, die auf eine Datei
 *    zeigen, die niemand öffnen kann — genau die Regel, mit der `seedEingang`
 *    seinen Verzicht begründet (ACC-03). Die Ausgaben hier bleiben deshalb in
 *    `erfasst`: der CHECK `ausgabe_beleg_ab_freigabe` verlangt ab
 *    `freigegeben` einen Beleg, und das ist richtig so.
 *
 *  · **`eingangsrechnung`** (und damit `/eingangsrechnungen/[id]/freigabe` und
 *    `…/steuer`): dasselbe, eine Stufe härter. `eingangsrechnung.beleg_id` ist
 *    NOT NULL — 0123 §2 schreibt den Grund hin: „Keine Eingangsrechnung ohne
 *    Beleg (ACC-03) … Ein Archivdokument, das sich spaeter austauschen laesst,
 *    bezeugt nichts." Es gibt hier also gar keinen Weg an der Datei vorbei,
 *    und `index.ts` sagt dasselbe seit dem Lieferantenseed („keine
 *    Eingangsrechnung, weil ein Beleg ohne Datei keiner ist"). Der Weg dahin
 *    ist `seedEingang` mit verbundenem Speicher, nicht ein zweiter Seed, der
 *    die Regel umgeht.
 *
 *  · **`freistellungsbescheinigung`** eines LIEFERANTEN: sie hängt nicht an
 *    einem Beleg (`dokument_id` ist nullable) und liesse sich anlegen — aber
 *    gezeigt wird sie ausschliesslich auf dem Steuerblatt einer
 *    Eingangsrechnung. Ohne die wäre sie eine Zeile, die in keiner Ansicht
 *    vorkommt: Demodaten, die nichts vorführen.
 *
 *  · **`rechnung_versand`**: der Auslöser `rechnung_versand_2_kanal_verbunden`
 *    (0181) lässt für einen unverbundenen Kanal nur `status =
 *    nicht_verbunden` zu, und verbunden ist keiner (O-22, O-603). Eine
 *    Demozeile mit `gesendet` wäre eine simulierte Auslieferung.
 *
 *  · **`abschlagsrechnung_bezug`**: braucht ZWEI festgeschriebene Rechnungen
 *    (Abschlag und Schlussrechnung). Festschreiben zieht eine Nummer aus
 *    `fin.rechnung_nummer_ziehen`, und auf der Produktionsfläche steht dort
 *    ein Platzhalterkreis (O-134). Der Vorgang gehört auf den
 *    Festschreibebildschirm und nicht in den Seed.
 *
 *  · **`bauleistung_jahressumme`**: wird seit dem Umbau von 0182 AUS DER
 *    QUELLE gerechnet — der Auslöser setzt sie, sobald eine Eingangsrechnung
 *    `freigegeben` erreicht. Sie hier von Hand zu füllen hiesse, neben die
 *    gerechnete Zahl eine erfundene zu legen.
 */
type Sql = postgres.Sql<Record<string, unknown>>;

export interface AusgabeSeedErgebnis {
  readonly kategorien: number;
  readonly kassen: number;
  readonly ausgaben: number;
  readonly steuerzeilen: number;
}

/** Die Gesellschaften mit eigenem Rechnungswesen — Schlüssel wie in `index.ts`. */
const RECHTSEINHEITEN = ['reinigung', 'security', 'bau'] as const;

/**
 * Zwei Aufwandskategorien je Gesellschaft.
 *
 * **Beide tragen `ist_platzhalter = true`, und das ist keine Schlamperei.**
 * Welche Aufwandskategorien der Steuerberater erwartet und welches SKR-Konto
 * je Kategorie gilt, ist nicht entschieden (O-05). Der Vorgabewert der Spalte
 * ist `true`; ihn im Seed auf `false` zu drehen behauptete eine Bestätigung,
 * die niemand gegeben hat — und die Oberfläche schriebe dann nicht mehr hin,
 * dass die Kontierung offen ist.
 */
const KATEGORIEN: Readonly<Record<string, readonly { schluessel: string; bezeichnung: string }[]>> = {
  reinigung: [
    { schluessel: 'verbrauchsmaterial', bezeichnung: 'Verbrauchsmaterial (Kontierung offen, O-05)' },
    { schluessel: 'fahrtkosten', bezeichnung: 'Fahrtkosten (Kontierung offen, O-05)' },
  ],
  security: [
    { schluessel: 'dienstkleidung', bezeichnung: 'Dienstkleidung (Kontierung offen, O-05)' },
    { schluessel: 'fahrtkosten', bezeichnung: 'Fahrtkosten (Kontierung offen, O-05)' },
  ],
  bau: [
    { schluessel: 'kleinwerkzeug', bezeichnung: 'Kleinwerkzeug (Kontierung offen, O-05)' },
    { schluessel: 'fahrtkosten', bezeichnung: 'Fahrtkosten (Kontierung offen, O-05)' },
  ],
};

/**
 * Die Barausgabe je Gesellschaft — mit ZWEI Steuerzeilen.
 *
 * Zwei Sätze in einem Beleg sind der Fall, der die Aufteilung überhaupt
 * nötig macht: aus einem Bruttobetrag mit 19 % und 7 % nebeneinander lässt
 * sich kein Satz mehr zurückrechnen, und der Vorsteuerabzug hängt an der
 * Aufteilung (§15 UStG, ACC-08). Der Auslöser `ausgabe_3_steuer_stimmt`
 * (aufgeschoben) prüft, dass die Zeilen den Kopf treffen — die Zahlen hier
 * sind deshalb exakt und nicht ungefähr.
 *
 * Alle Beträge in ganzen Cent (Invariante 1), nie als Gleitkommazahl.
 */
interface BarBeleg {
  readonly bezeichnung: string;
  readonly kasse: string;
  /** Netto/Steuer je Satz, in Cent. */
  readonly zeilen: readonly { gruppe: string; nettoCent: bigint; steuerCent: bigint }[];
}

const BARBELEGE: Readonly<Record<string, BarBeleg>> = {
  reinigung: {
    bezeichnung: 'Reinigungsmittel und Kaffee für die Objektküche (Barkauf)',
    kasse: 'Handkasse Kurfürstendamm',
    zeilen: [
      { gruppe: 'ust_19', nettoCent: 4_210n, steuerCent: 800n },
      { gruppe: 'ust_07', nettoCent: 1_290n, steuerCent: 90n },
    ],
  },
  security: {
    bezeichnung: 'Batterien für Handfunkgeräte und Getränke für den Nachtposten (Barkauf)',
    kasse: 'Handkasse Wache',
    zeilen: [
      { gruppe: 'ust_19', nettoCent: 3_780n, steuerCent: 718n },
      { gruppe: 'ust_07', nettoCent: 860n, steuerCent: 60n },
    ],
  },
  bau: {
    bezeichnung: 'Bohrkronen und Verpflegung für die Baustelle (Barkauf)',
    kasse: 'Handkasse Baustelle',
    zeilen: [
      { gruppe: 'ust_19', nettoCent: 8_950n, steuerCent: 1_700n },
      { gruppe: 'ust_07', nettoCent: 2_140n, steuerCent: 150n },
    ],
  },
};

export async function seedFinanzAusgaben(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<AusgabeSeedErgebnis> {
  let kategorien = 0;
  let kassen = 0;
  let ausgaben = 0;
  let steuerzeilen = 0;

  /** Die Steuersatzgruppen stehen plattformweit (kein `mandant_id`). */
  const gruppen = new Map<string, { id: string; satz_bp: number; kategorie: string }>(
    (await sql<{ id: string; schluessel: string; satz_bp: number; kategorie: string }[]>`
       select id, schluessel, satz_bp, kategorie::text as kategorie from steuersatz_gruppe`)
      .map((g) => [g.schluessel, { id: g.id, satz_bp: g.satz_bp, kategorie: g.kategorie }]),
  );

  for (const slug of RECHTSEINHEITEN) {
    const mandantId = ids.get(slug);
    if (mandantId === undefined) continue;

    /* ------------------------------------------------------------------ */
    /* 1 — Aufwandskategorien (O-05: Platzhalter, und sichtbar so)         */
    /* ------------------------------------------------------------------ */
    for (const k of KATEGORIEN[slug] ?? []) {
      const [neu] = await sql<{ id: string }[]>`
        insert into ausgabe_kategorie
          (mandant_id, schluessel, bezeichnung, ist_platzhalter,
           erstellt_von_art, erstellt_von_dienst)
        values (${mandantId}, ${k.schluessel}, ${k.bezeichnung}, true,
                'system', 'job:seed')
        on conflict do nothing
        returning id`;
      if (neu !== undefined) kategorien += 1;
    }

    /* ------------------------------------------------------------------ */
    /* 2 — eine Handkasse                                                  */
    /* ------------------------------------------------------------------ */
    const beleg = BARBELEGE[slug];
    if (beleg === undefined) continue;

    const [vorhandeneKasse] = await sql<{ id: string }[]>`
      select id from kasse
       where mandant_id = ${mandantId} and bezeichnung = ${beleg.kasse}`;
    let kasseId = vorhandeneKasse?.id ?? null;
    if (kasseId === null) {
      const [neu] = await sql<{ id: string }[]>`
        insert into kasse
          (mandant_id, bezeichnung, standort, erstellt_von_art, erstellt_von_dienst)
        values (${mandantId}, ${beleg.kasse}, 'Berlin', 'system', 'job:seed')
        returning id`;
      kasseId = neu?.id ?? null;
      if (kasseId !== null) kassen += 1;
    }

    /* ------------------------------------------------------------------ */
    /* 3 — die Barausgabe mit zwei Steuerzeilen                            */
    /* ------------------------------------------------------------------ */
    const [kategorie] = await sql<{ id: string }[]>`
      select id from ausgabe_kategorie
       where mandant_id = ${mandantId} and archiviert_am is null
       order by schluessel limit 1`;

    if (kategorie !== undefined && kasseId !== null) {
      const netto = beleg.zeilen.reduce((s, z) => s + z.nettoCent, 0n);
      const steuer = beleg.zeilen.reduce((s, z) => s + z.steuerCent, 0n);

      const [da] = await sql<{ id: string }[]>`
        select id from ausgabe
         where mandant_id = ${mandantId} and bezeichnung = ${beleg.bezeichnung}`;
      if (da === undefined) {
        /*
         * `status = 'erfasst'`: der CHECK `ausgabe_beleg_ab_freigabe` verlangt
         * ab `freigegeben` einen Beleg, und einen Beleg gibt es ohne
         * Objektspeicher nicht (siehe Kopf dieser Datei). Die Freigabe ist
         * damit der Vorgang, den die Oberfläche zeigt — nicht einer, den der
         * Seed schon erledigt hat.
         */
        const [neu] = await sql<{ id: string }[]>`
          insert into ausgabe
            (mandant_id, kategorie_id, bezeichnung, ausgabedatum,
             netto_cent, steuer_cent, brutto_cent, zahlungsmittel, kasse_id,
             weiterberechenbar, status, erstellt_von_art, erstellt_von_dienst)
          values (${mandantId}, ${kategorie.id}, ${beleg.bezeichnung},
                  app.berlin_heute() - 9, ${netto.toString()}, ${steuer.toString()},
                  ${(netto + steuer).toString()}, 'bar', ${kasseId},
                  false, 'erfasst', 'system', 'job:seed')
          returning id`;
        if (neu !== undefined) {
          ausgaben += 1;
          for (const z of beleg.zeilen) {
            const g = gruppen.get(z.gruppe);
            if (g === undefined) continue;
            await sql`
              insert into ausgabe_steuer
                (mandant_id, ausgabe_id, steuersatz_gruppe_id, satz_bp, kategorie,
                 netto_cent, steuer_cent, erstellt_von_art, erstellt_von_dienst)
              values (${mandantId}, ${neu.id}, ${g.id}, ${g.satz_bp},
                      ${g.kategorie}::en16931_steuerkategorie,
                      ${z.nettoCent.toString()}, ${z.steuerCent.toString()},
                      'system', 'job:seed')`;
            steuerzeilen += 1;
          }
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* 4 — eine ERSTATTUNG an eine Anstellung (das K-05-Tor)               */
    /* ------------------------------------------------------------------ */
    /**
     * `anstellung_id` ist die Spalte, um die 0180 gebaut ist: sie steht NICHT
     * im `GRANT` auf `ausgabe`, und der eine Weg zu ihr ist
     * `app.ausgabe_erstattung_lesen()` — mit `personal.erstattung_lesen` und
     * einem Protokolleintrag. Ohne eine Erstattungszeile im Bestand ist
     * dieses Tor nie durchlaufen worden, und ein Tor, das nie geschlossen
     * war, ist keines. Das Ja/Nein der Liste kommt daneben aus
     * `app.ausgabe_ist_erstattung()` (0184) und protokolliert nicht.
     *
     * Ohne Umsatzsteuer: eine Auslage, die ein Mensch vorgestreckt hat, ist
     * für die Gesellschaft kein Vorsteuerfall, solange kein Beleg auf sie
     * lautet — und der Beleg fehlt hier (siehe Kopf). Der Auslöser
     * `ausgabe_3_steuer_stimmt` ist damit erfüllt, ohne eine Steuerzeile zu
     * behaupten.
     */
    const [anstellung] = await sql<{ id: string }[]>`
      select a.id from anstellung a
       where a.mandant_id = ${mandantId} and a.geloescht_am is null
         and a.austritt is null
       order by a.personalnummer nulls last, a.id limit 1`;
    const [fahrtkosten] = await sql<{ id: string }[]>`
      select id from ausgabe_kategorie
       where mandant_id = ${mandantId} and schluessel = 'fahrtkosten'
         and archiviert_am is null`;

    if (anstellung !== undefined && fahrtkosten !== undefined) {
      const erstattungstext = 'Auslage: BVG-Fahrscheine für zwei Objektfahrten (Erstattung)';
      const [da] = await sql<{ id: string }[]>`
        select id from ausgabe
         where mandant_id = ${mandantId} and bezeichnung = ${erstattungstext}`;
      if (da === undefined) {
        const [neu] = await sql<{ id: string }[]>`
          insert into ausgabe
            (mandant_id, kategorie_id, bezeichnung, ausgabedatum,
             netto_cent, steuer_cent, brutto_cent, zahlungsmittel,
             anstellung_id, weiterberechenbar, status,
             erstellt_von_art, erstellt_von_dienst)
          values (${mandantId}, ${fahrtkosten.id}, ${erstattungstext},
                  app.berlin_heute() - 4, '1960', '0', '1960', 'verrechnung',
                  ${anstellung.id}, false, 'erfasst', 'system', 'job:seed')
          returning id`;
        if (neu !== undefined) ausgaben += 1;
      }
    }
  }

  return { kategorien, kassen, ausgaben, steuerzeilen };
}
