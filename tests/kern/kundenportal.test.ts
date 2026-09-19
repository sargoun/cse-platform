/**
 * Das Kundenportal — die reinen Funktionen und die Grenzen der Projektion
 * (Invariante 1, K-16, K-18, K-20, 04-SEITENKARTE §8).
 *
 * **Warum die Hälfte dieser Datei den QUELLTEXT liest.** Die teuerste Zusage
 * dieses Stapels lässt sich nicht an einem Rückgabewert prüfen: „der Kunde
 * sieht keinen Mitarbeiternamen, keine Standortkoordinate und keine interne
 * Ursachenanalyse". RLS wirkt zeilen-, nicht spaltenweise — die Policy lässt
 * die Zeile zu RECHT durch, weil sie zum Vorgang DIESES Kunden gehört, und
 * welche Spalten daraus herauskommen, entscheidet allein die Projektion. Eine
 * Prüfung am Ergebnis fände den Fehler nur, wenn die Fixtur genau das Feld
 * gefüllt hat; eine Prüfung am Quelltext findet ihn immer.
 *
 * Dasselbe für `app.aktiver_mandant()`: im Kunden-Scope ist er nach K-20
 * NULL. Eine Bedingung darauf ist keine Verengung, sondern das stille Ende
 * der Ergebnismenge — und ein Test, der gegen eine leere Liste prüft, sieht
 * keinen Unterschied zu „es liegt nichts vor" (K-18).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prozentText } from '../../src/server/services/kundenportal/rechnung.js';
import { zustandVon } from '../../src/server/services/kundenportal/zahlung.js';
import {
  KLASSE_LABEL, klasseFuer,
} from '../../src/server/services/buchhaltung/offene-posten.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const DIENSTE = join(WURZEL, 'src/server/services/kundenportal');
const SEITEN = join(WURZEL, 'src/app/portal/kunde');
const API = join(WURZEL, 'src/app/api/kunde');

function alleDateien(verzeichnis: string, endung = /\.tsx?$/u): readonly string[] {
  const treffer: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) treffer.push(...alleDateien(voll, endung));
    else if (endung.test(eintrag)) treffer.push(voll);
  }
  return treffer;
}

/**
 * Der Quelltext OHNE Kommentare.
 *
 * Diese Datei begründet ihre Auslassungen ausführlich und nennt dabei jede
 * verbotene Spalte beim Namen — ein Test über den rohen Text fiele an der
 * Begründung statt am Code. Dieselbe Vorsichtsmassnahme wie in
 * `tests/kern/routen.test.ts` (`ohneKommentare`), hier bewusst schlank
 * gehalten: Blockkommentare, Zeilenkommentare, sonst nichts.
 */
function ohneKommentare(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/^[\t ]*\/\/.*$/gmu, ' ');
}

const DIENSTQUELLEN = alleDateien(DIENSTE)
  .map((d) => ({ pfad: relative(WURZEL, d), text: ohneKommentare(readFileSync(d, 'utf8')) }));

const SEITENQUELLEN = alleDateien(SEITEN)
  .map((d) => ({ pfad: relative(WURZEL, d), text: readFileSync(d, 'utf8') }));

// ---------------------------------------------------------------------------

describe('zustandVon · der Zustand eines Postens aus drei Beträgen', () => {
  const p = (bezahlt: string, offen: string, ausgeglichen: string | null = null) =>
    ({ bezahlt_cent: bezahlt, offen_cent: offen, ausgeglichen_lokal: ausgeglichen });

  it('nichts bezahlt, alles offen → offen', () => {
    expect(zustandVon(p('0', '119000'))).toBe('offen');
  });

  it('teilweise bezahlt → teilweise', () => {
    expect(zustandVon(p('50000', '69000'))).toBe('teilweise');
  });

  it('voll bezahlt → ausgeglichen', () => {
    expect(zustandVon(p('119000', '0'))).toBe('ausgeglichen');
  });

  it('ausgeglichen per Gutschrift — bezahlt 0, aber `ausgeglichen_am` gesetzt', () => {
    /**
     * Ein Posten kann durch eine Gutschrift oder eine Umbuchung ausgeglichen
     * sein, ohne dass ein Cent gezahlt wurde. Nur auf `bezahlt_cent` zu
     * schauen zeigte dem Kunden „offen" für eine Forderung, die die
     * Buchhaltung geschlossen hat — und der ruft dann an.
     */
    expect(zustandVon(p('0', '119000', '17.09.2026'))).toBe('ausgeglichen');
  });

  it('Überzahlung — `offen_cent` negativ, also nichts mehr offen', () => {
    /**
     * `offen_cent` ist eine ERZEUGTE Spalte (`betrag - bezahlt`); bei einer
     * Überzahlung wird sie negativ. `=== 0` statt `<= 0` hätte hier „offen"
     * gemeldet, obwohl der Kunde zu viel gezahlt hat — die peinlichste
     * Variante der falschen Zahl.
     */
    expect(zustandVon(p('130000', '-11000'))).toBe('ausgeglichen');
  });

  it('die Beträge laufen als Ganzzahltext durch — nie als `number`', () => {
    /**
     * Invariante 1 / K-16: ein Cent-Betrag jenseits von 2^53 ist als
     * `number` nicht mehr exakt. `zustandVon` nimmt Text und vergleicht mit
     * `BigInt`; diese Prüfung fällt, sobald jemand ein `Number(...)`
     * einbaut — 9007199254740993 ist die kleinste Zahl, die es verrät.
     */
    expect(zustandVon(p('0', '9007199254740993'))).toBe('offen');
    expect(zustandVon(p('9007199254740993', '0'))).toBe('ausgeglichen');
  });
});

describe('prozentText · Basispunkte als deutscher Prozentsatz', () => {
  it('die drei Sätze des UStG', () => {
    expect(prozentText(1900)).toBe('19,0 %');
    expect(prozentText(700)).toBe('7,0 %');
    expect(prozentText(0)).toBe('0,0 %');
  });

  it('ein halber Prozentpunkt bleibt sichtbar — ein Rabatt von 2,5 %', () => {
    expect(prozentText(250)).toBe('2,5 %');
  });

  it('die zweite Nachkommastelle erscheint, wenn sie etwas sagt', () => {
    expect(prozentText(725)).toBe('7,25 %');
    expect(prozentText(1)).toBe('0,01 %');
  });

  it('ein negativer Satz behält sein Vorzeichen', () => {
    expect(prozentText(-250)).toBe('-2,5 %');
  });

  it('kein `toLocaleString` — gerechnet wird in ganzen Zahlen (K-16)', () => {
    /**
     * Die Prüfung liest den QUELLTEXT, und das ist Absicht: am Ergebnis wäre
     * `(bp / 100).toLocaleString('de-DE', …)` von dieser Fassung nicht zu
     * unterscheiden, solange die Sätze klein und rund sind. Der Unterschied
     * zeigt sich erst dort, wo eine Gleitkommazahl rundet — und dann steht
     * er auf einer Rechnung.
     */
    const quelle = readFileSync(
      join(WURZEL, 'src/server/services/kundenportal/rechnung.ts'), 'utf8');
    const funktion = quelle.slice(quelle.indexOf('export function prozentText'));
    expect(funktion.slice(0, funktion.indexOf('\n}')))
      .not.toContain('toLocaleString');
  });

  it('Komma, nicht Punkt — ein Dezimalpunkt auf einer Rechnung ist ein Zahlendreher', () => {
    expect(prozentText(1900)).not.toContain('.');
  });
});

describe('klasseFuer · die Altersklasse ist dieselbe wie intern', () => {
  it('die Grenzen: 0, 30, 31, 60, 61, 90, 91 Tage', () => {
    /**
     * Die Klassen werden im Kundenportal NICHT neu erfunden — die Seite
     * benutzt `klasseFuer` und `KLASSE_LABEL` aus `buchhaltung/offene-posten`.
     * Diese Prüfung hält fest, dass die Grenzen dieselben sind: zwei
     * Fassungen derselben Einteilung wären eine Zahl, die der Kunde anders
     * liest als die Buchhaltung.
     */
    expect(klasseFuer(-1)).toBe('nicht_faellig');
    expect(klasseFuer(0)).toBe('bis30');
    expect(klasseFuer(30)).toBe('bis30');
    expect(klasseFuer(31)).toBe('bis60');
    expect(klasseFuer(60)).toBe('bis60');
    expect(klasseFuer(61)).toBe('bis90');
    expect(klasseFuer(90)).toBe('bis90');
    expect(klasseFuer(91)).toBe('ueber90');
  });

  it('jede Klasse hat eine Beschriftung', () => {
    for (const tage of [-1, 0, 45, 75, 400]) {
      expect(KLASSE_LABEL[klasseFuer(tage)]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------

describe('die Kundendienste rühren keine intern-only Tabelle an (K-18)', () => {
  /**
   * Jede dieser Tabellen liefert im Kunden-Scope null Zeilen — sie tragen
   * `p_intern_ceiling`, `p_intern_decke` oder `p_intern_einsatz_decke` und
   * kein `t_kunde` (in `pg_policies` nachgesehen, nicht vermutet). Ein Join
   * darüber gäbe dem Kunden keine Fehlermeldung, sondern eine leere Liste,
   * und die liest sich wie „es liegt nichts vor".
   *
   * `leistungsverzeichnis` ist der Fall, der es beinahe in die Projektion
   * geschafft hat: `listeProjekte` zählt es in einer Unterabfrage, und im
   * Kunden-Scope zählt sie 0 — „kein Leistungsverzeichnis" statt „nicht
   * sichtbar".
   */
  const VERBOTEN = [
    'zahlung', 'op_ausgleich', 'mahnung', 'mahnlauf', 'rechnung_hash',
    'rechnungsposition_quelle', 'rechnungsausgangsbuch', 'bautagebuch',
    'nachtrag', 'behinderung', 'leistungsverzeichnis', 'kalkulation',
    /*
     * `belagsart` und `reinigungsklasse` sind INTERNE Kataloge: sie tragen
     * eine restriktive Decke gegen das Kundenportal und kein `t_kunde`
     * (0021). Ein `left join` darauf ergaebe fuer JEDEN Raum „—" und liese
     * sich wie „nicht erfasst" — und er gaebe, wenn die Decke einmal fiele,
     * die Kalkulationsgrundlage heraus, aus der der Preis entsteht.
     * `revier` und `turnus` sind derselbe Fall eine Ebene weiter.
     */
    'belagsart', 'reinigungsklasse', 'revier', 'turnus',
  ] as const;

  for (const tabelle of VERBOTEN) {
    it(`kein \`from\`/\`join\` auf \`${tabelle}\``, () => {
      /*
       * Gesucht wird die STELLUNG, nicht das Wort: `zahlung` steht in
       * `zahlung_zuordnung` und im Dateinamen `zahlung.ts`, und
       * `rechnung_hash` in einem Bezeichner. Getroffen wird nur, was hinter
       * `from` oder `join` steht — also eine Tabelle in einer Abfrage.
       */
      const muster = new RegExp(`\\b(from|join)\\s+${tabelle}\\b`, 'iu');
      for (const { pfad, text } of DIENSTQUELLEN) {
        expect(muster.test(text), `${pfad} joint ${tabelle}`).toBe(false);
      }
    });
  }
});

describe('die Kundendienste fragen nie `app.aktiver_mandant()` (K-20)', () => {
  it('kein Vorkommen in einer Abfrage dieses Ordners', () => {
    /**
     * Im Kunden-Scope setzt `withKundeScope` `app.mandant_id` auf den leeren
     * String, und `app.aktiver_mandant()` gibt NULL zurück. `mandant_id =
     * app.aktiver_mandant()` ist damit nie wahr — die Abfrage liefert
     * schweigend nichts. Gearbeitet wird stattdessen über
     * `app.sichtbare_mandanten()`, und das tun die Policies von allein.
     */
    for (const { pfad, text } of DIENSTQUELLEN) {
      expect(text.includes('aktiver_mandant'), `${pfad} fragt aktiver_mandant`).toBe(false);
    }
  });
});

describe('die Projektion gibt keine internen Spalten heraus (04-SEITENKARTE §8)', () => {
  /**
   * §8 verschliesst dem Kunden das ganze `personal`-Modul: „no names, no
   * schedules". Jede Spalte hier ist ein konkreter Weg, wie ein Name, ein
   * Standort oder eine interne Bewertung trotzdem auf den Kundenbildschirm
   * käme — und jede stand in einem Dienst, der technisch im Kunden-Scope
   * läuft (`ladeSignaturen` führt die ersten sechs).
   */
  const VERBOTEN = [
    'breitengrad', 'laengengrad', 'geo_genauigkeit_m', 'zeitabweichung_sek',
    'geraete_zeit', 'user_agent', 'snapshot_hash',
    'ursache', 'verantwortlich_benutzer_id',
    'auftragssumme_netto_cent', 'sicherheitseinbehalt',
    'absender_benutzer_id', 'absender_extern', 'erstellt_von', 'geaendert_von',
    'letzte_mahnstufe', 'nummer_laufend', 'nummernkreis_id', 'festgeschrieben_von',
    /*
     * Der Auftrag, das Angebot und das Objekt (Stapel „auftraege/angebote/
     * objekte/dokumente"). Jede dieser Spalten steht auf einer Tabelle, deren
     * ZEILE der Kunde zu Recht sieht — RLS wirkt zeilenweise, die Projektion
     * entscheidet, welche Spalten herauskommen:
     *
     *   auftragswert_netto_cent   die Auftragssumme (offen, O-840)
     *   personalbedarf_anzahl     die Besetzung (§8: no names, no schedules)
     *   wochenstunden_soll        dieselbe Zeile von §8, plus Rechengroesse
     *   ausstattung_hinweis       interner Vermerk fuer die Kolonne
     *   entscheidung_notiz        interner Vermerk zur Angebotsentscheidung
     *   versendet_von             Name aus dem Haus
     *   freigegeben_von           Name aus dem Haus
     *   zutritt_hinweis           Schluessel- und Zutrittsangabe des Hauses
     *   geo_lat / geo_lon         Koordinaten fuer Anfahrt und Geofence
     *   objekt_schluessel         der Ablageort im Bucket (DOC-03)
     *   loeschsperre              Aufbewahrungspflicht des Hauses (DOC-07)
     *   sichtbar_fuer_mitarbeiter wer im Haus dasselbe Dokument sieht
     */
    'auftragswert_netto_cent', 'personalbedarf_anzahl', 'wochenstunden_soll',
    'ausstattung_hinweis', 'entscheidung_notiz', 'versendet_von', 'freigegeben_von',
    'zutritt_hinweis', 'geo_lat', 'geo_lon',
    'objekt_schluessel', 'loeschsperre', 'sichtbar_fuer_mitarbeiter',
  ] as const;

  for (const spalte of VERBOTEN) {
    it(`\`${spalte}\` steht in keiner Abfrage`, () => {
      for (const { pfad, text } of DIENSTQUELLEN) {
        expect(text.includes(spalte), `${pfad} liest ${spalte}`).toBe(false);
      }
    });
  }

  it('`unterzeichner_name` nur mit der Bedingung `rolle = auftraggeber`', () => {
    /**
     * Die eine Ausnahme, und sie ist eine mit Bedingung: die eigene
     * Unterschrift des Kunden erscheint MIT Namen — das ist der Sinn einer
     * Gegenzeichnung. Für die Rolle `auftragnehmer` steht „Unterschrift der
     * Gesellschaft" ohne Person. Geprüft wird deshalb nicht das Fehlen,
     * sondern die Verzweigung: jedes Vorkommen von `unterzeichner_name`
     * steht hinter `case when s.rolle = 'auftraggeber'`.
     */
    for (const { pfad, text } of DIENSTQUELLEN) {
      const vorkommen = text.split('unterzeichner_name').length - 1;
      if (vorkommen === 0) continue;
      const bewacht = text.split(/case\s+when\s+s\.rolle\s*=\s*'auftraggeber'\s+then\s+s\.unterzeichner_(name|funktion)/gu)
        .length - 1;
      expect(bewacht, `${pfad}: ${String(vorkommen)} Vorkommen, davon bewacht`)
        .toBeGreaterThanOrEqual(vorkommen);
    }
  });
});

describe('jede Kundenseite geht durch die eine Hülle', () => {
  /**
   * `kundePortal` ist das Tor: Sitzung, Kunden-Scope, `KeinKundenzugangFehler`
   * und die Rechte in EINER gebundenen Transaktion. Eine Seite, die sich
   * ihren Scope selbst aufmacht, ist eine Gelegenheit, den `catch` zu
   * vergessen — und dann sieht ein Kunde ohne `kunde_zugang` einen
   * Serverfehler statt des Satzes, der erklärt, was ist (K-18).
   */
  const AUSNAHMEN = new Set(['rahmen.tsx', 'bausteine.tsx']);

  for (const { pfad, text } of SEITENQUELLEN) {
    const datei = pfad.split('/').at(-1) ?? '';
    if (AUSNAHMEN.has(datei)) continue;
    /*
     * **Die Auffangroute `[...rest]` bleibt — und sie darf die Huelle NICHT
     * benutzen.**
     *
     * Die vier Routen, die sie frueher aufgefangen hat — `auftraege`,
     * `angebote`, `objekte`, `dokumente` —, sind gebaut; die Liste unten
     * haelt das fest. Sie bleibt trotzdem stehen, fuer jede Adresse unter
     * `/portal/kunde/…`, die es nicht gibt: ein Tippfehler in der Adresszeile
     * oder ein alter Verweis soll „wird noch gebaut" sehen und keinen
     * Serverfehler. Dafuer braucht sie keinen Kunden-Scope — eine konkrete
     * Route gewinnt in Next.js immer gegen eine Auffangroute, sie sieht also
     * nur, was es nicht gibt.
     */
    if (pfad.includes('[...rest]')) continue;

    it(`${pfad} ruft kundePortal und öffnet keine eigene Transaktion`, () => {
      expect(text).toContain('kundePortal(');
      expect(text).not.toContain('db().begin');
      expect(text).not.toContain('withKundeScope');
      /*
       * **Die KONKRETE Adresse, nie das Routenmuster.** `portalZugang` legt
       * den Wert über `merkeHuelle` als Rückweg der Sitzung ab; mit
       * `'/portal/kunde/rechnungen/[id]'` stünde dort eine Adresse, die es
       * nicht gibt. `findeRoute` trägt den Mustervergleich zwar, aber jede
       * andere Portalseite im Haus übergibt die echte URL — und der
       * Sprachumschalter (D-592) wird der erste sein, der auf den gemerkten
       * Pfad zurückspringt.
       */
      expect(text).not.toMatch(/kundePortal\(\s*'[^']*\[/u);
      /*
       * Und sie behandelt BEIDE Ausgänge. Fehlt `kein_zugang`, rendert die
       * Seite mit `daten === undefined` oder fällt auf 500 — die Hülle gibt
       * dann kein `daten` zurück.
       */
      expect(text).toContain("=== 'anmeldung'");
      expect(text).toContain("=== 'kein_zugang'");
    });
  }

  it('alle neunzehn Adressen des Kundenportals sind GEBAUT, nicht aufgefangen', () => {
    /**
     * Die Gegenprobe zur Auffangroute: solange sie steht, ist eine vergessene
     * Seite von einer gebauten nicht zu unterscheiden — sie antwortet
     * höflich „wird noch gebaut", und niemand sieht die Lücke. Diese Liste
     * ist das ganze Kundenportal; fehlt eine Datei, fällt der Test statt der
     * Seite.
     *
     * Die acht zuletzt hinzugekommenen (`auftraege`, `angebote`, `objekte`,
     * `dokumente` je mit Blatt) standen bis dahin in der Auffangroute —
     * `auftraege` sogar als Ziel eines SICHTBAREN Menuepunkts der Tab-Leiste.
     */
    const gebaut = new Set(SEITENQUELLEN.map((s) => s.pfad));
    for (const route of [
      '', 'nachrichten', 'nachrichten/[id]', 'nachweise', 'projekte', 'projekte/[id]',
      'rechnungen', 'rechnungen/[id]', 'reklamationen', 'reklamationen/[id]', 'zahlungen',
      'auftraege', 'auftraege/[id]', 'angebote', 'angebote/[id]',
      'objekte', 'objekte/[id]', 'dokumente', 'dokumente/[id]',
    ]) {
      const datei = `src/app/portal/kunde/${route === '' ? '' : `${route}/`}page.tsx`;
      expect(gebaut.has(datei), `${datei} fehlt`).toBe(true);
    }
  });
});

describe('die Sprungkarten der Übersicht nennen die Rechte des MANIFESTS', () => {
  /**
   * **Ein Verweis darf nicht mehr versprechen, als seine Zielroute hält.**
   *
   * Hier stand je Karte genau EIN abgeschriebener Rechteschlüssel. Zwei Ziele
   * verlangen aber zwei: `/portal/kunde/rechnungen` führt
   * `["finanzen.lesen","finanzen.herunterladen"]`,
   * `/portal/kunde/nachweise` führt `["nachweis.lesen","bau.lesen"]`, und
   * `pruefeZugang` verknüpft die Leserechte einer Route mit UND. Eine
   * Anmeldung ohne das zweite Recht sah die Karte und bekam dahinter 404 —
   * genau das, was der Kopfkommentar der Seite ausschliesst (AUT-06, D-581).
   *
   * Die Prüfung liest den QUELLTEXT, weil die Aussage eine über die HERKUNFT
   * der Liste ist: eine abgeschriebene Liste kann heute stimmen und morgen
   * nicht. `leserechte(findeRoute(...))` liest dort, wo `portalZugang` auch
   * liest.
   */
  const UEBERSICHT = SEITENQUELLEN.find(
    (q) => q.pfad === 'src/app/portal/kunde/page.tsx');

  it('die Übersicht zieht ihre Rechte aus dem Routenregister, nicht aus sich selbst', () => {
    expect(UEBERSICHT).toBeDefined();
    const text = ohneKommentare(UEBERSICHT!.text);
    expect(text).toContain('leserechte(');
    expect(text).toContain('findeRoute(');
    // `every`, nicht `some`: eine Route verlangt ALLE ihre Leserechte.
    expect(text).toContain('.every(');
    // Und kein handgeschriebener Schlüssel je Karte mehr.
    expect(text).not.toMatch(/recht:\s*'[a-z_.]+'/u);
  });

  it('die Zahlungsseite verlangt für den Rechnungsverweis BEIDE Rechte', () => {
    const q = SEITENQUELLEN.find(
      (x) => x.pfad === 'src/app/portal/kunde/zahlungen/page.tsx');
    expect(q).toBeDefined();
    const text = ohneKommentare(q!.text);
    expect(text).toContain("basis.rechte['finanzen.lesen']");
    expect(text).toContain("basis.rechte['finanzen.herunterladen']");
  });
});

describe('die Belegprojektion behält die Nullbarkeit der Tabelle', () => {
  /**
   * Der CHECK `rp_ohne_leistung_ohne_betrag` ERZWINGT
   * `netto_cent IS NULL` für jede Position mit `positionsart <> 'leistung'`
   * — also für `textzeile` und `zwischensumme`. Eine Projektion, die
   * `nettoCent: string` behauptet, und eine Zelle, die
   * `BigInt(p.nettoCent)` ohne Wache rechnet, lassen die Belegseite für jede
   * Schlussrechnung mit einer Gliederungszeile auf 500 laufen.
   *
   * Der Demobestand führt nur `leistung`; die laufende Prüfung dafür ist die
   * Fixtur in `tests/isolation/kundenportal.test.ts` (23a). Diese Wache hier
   * hält den TYP fest — sie fällt schon beim Zurückschreiben, ohne Datenbank.
   */
  it('`nettoCent` ist `string | null` — wie die Spalte', () => {
    const q = DIENSTQUELLEN.find(
      (x) => x.pfad === 'src/server/services/kundenportal/rechnung.ts');
    expect(q).toBeDefined();
    expect(q!.text).toMatch(/readonly nettoCent: string \| null;/u);
    expect(q!.text).toMatch(/netto_cent: string \| null;/u);
  });

  it('die Belegseite fängt jede der drei nullbaren Spalten ab', () => {
    const q = SEITENQUELLEN.find(
      (x) => x.pfad === 'src/app/portal/kunde/rechnungen/[id]/page.tsx');
    expect(q).toBeDefined();
    const text = ohneKommentare(q!.text);
    for (const feld of ['p.menge', 'p.einzelpreisCent', 'p.nettoCent']) {
      expect(text, `${feld} ohne Wache`).toContain(`${feld} === null`);
    }
  });
});

describe('die Kundenausgaberouten binden den Kunden-Scope, nicht den Mandanten', () => {
  for (const datei of alleDateien(API)) {
    const pfad = relative(WURZEL, datei);
    const text = ohneKommentare(readFileSync(datei, 'utf8'));

    it(`${pfad} benutzt withKundeScope und niemals withTenant`, () => {
      expect(text).toContain('withKundeScope');
      expect(text).not.toContain('withTenant');
    });

    it(`${pfad} geht durch \`authorize\` mit dem Bereich der Rechnung`, () => {
      /**
       * `app.hat_recht(recht, null)` antwortet im Kunden-Scope auf ALLES
       * `false` (gegen eine echte Kundensitzung nachgemessen). Eine Route,
       * die `authorize` ohne `mandantId` aufruft, gibt deshalb jedem Kunden
       * 404 — richtig aussehend, immer falsch. Der Bereich kommt aus der
       * angefragten Rechnung, gelesen unter derselben RLS wie die Seite.
       */
      expect(text).toContain('authorize(');
      expect(text).toContain('mandantZurRechnung');
      expect(text).toContain('mandantId');
      expect(text).toContain("recht: 'finanzen.herunterladen'");
    });

    it(`${pfad} antwortet auf einen fehlenden Kundenzugang mit 404, nicht 500`, () => {
      expect(text).toContain('KeinKundenzugangFehler');
      expect(text).toContain('NichtGefundenFehler');
    });
  }
});
