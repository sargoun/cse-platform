/**
 * `/portal/mein/dokumente` und `/portal/mein/objekte` — die Haelften, die
 * Aussagen ueber den CODE sind (EMP-02, EMP-11, DOC-03, DOC-04, OPS-01).
 *
 * Die Datenbankhaelften stehen in `tests/isolation/mein-dokumente-objekte.test.ts`:
 * ob der Zutrittshinweis wirklich mit der letzten Schicht verschwindet,
 * entscheidet eine Definer-Funktion und keine Zeile TypeScript.
 *
 * Hier steht, was sich am Baum selbst pruefen laesst: dass die vier Seiten
 * existieren und in der Seitenkarte stehen, dass sie OHNE JavaScript bedienbar
 * sind, dass jedes Beruehrungsziel 44 px hoch ist, und dass die Rechenregeln
 * dieser Seiten — Groessenangabe, Anschrift, Kategorie — genau das tun, was
 * sie versprechen.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findeRoute } from '../../src/server/registry/routen.js';
import {
  DOKUMENT_KATEGORIE_TEXTE, MEIN_TEXTE, PORTAL_SPRACHEN, dokumentKategorieText,
} from '../../src/lib/i18n/texte.js';
import { SIGNATUR_SEKUNDEN } from '../../src/server/storage/adapter.js';
import {
  DOKUMENT_KATEGORIEN, GRENZE, MEIN_DOKUMENT_FELDER, SIGNATUR_MINUTEN,
  groesseText, istDokumentKategorie,
} from '../../src/server/services/mitarbeiter/dokumente.js';
import {
  EIGENES_OBJEKT_FELDER, OBJEKT_ZUGANG_FELDER, anschriftZeile, zugangIstLeer,
  type EigenesObjekt,
} from '../../src/server/services/mitarbeiter/objekte.js';
import {
  MITARBEITER_NUTZLASTEN, istVerbotenesFeld,
} from '../../src/server/services/mitarbeiter/felder.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const MEIN = join(WURZEL, 'src/app/portal/mein');

/** Die vier Seiten dieses Stapels — Pfad, Datei. */
const SEITEN: readonly (readonly [string, string])[] = [
  ['/portal/mein/dokumente', 'dokumente/page.tsx'],
  ['/portal/mein/dokumente/[id]', 'dokumente/[id]/page.tsx'],
  ['/portal/mein/objekte', 'objekte/page.tsx'],
  ['/portal/mein/objekte/[id]', 'objekte/[id]/page.tsx'],
];

function quelle(datei: string): string {
  return readFileSync(join(MEIN, datei), 'utf8');
}

/**
 * Traegt dieser Ausschnitt `min-h-11` — selbst oder ueber die Konstanten, die
 * er nennt?
 *
 * Die Klassen stehen nicht immer im Element: `className={aktiv ? a : b}` zeigt
 * auf zwei Konstanten, und `const aktiv = \`${knopf} …\`` zeigt weiter auf
 * eine dritte. Die Wache folgt den Namen deshalb bis `tiefe` Ebenen weit —
 * eine Wache, die nur das Element liest, meldet vier Falschtreffer und wird
 * abgeschaltet.
 */
function hatHoehe(ausschnitt: string, quelltext: string, tiefe: number): boolean {
  if (ausschnitt.includes('min-h-11')) return true;
  if (tiefe <= 0) return false;
  for (const name of new Set(
    [...ausschnitt.matchAll(/[A-Za-z_][A-Za-z0-9_]*/gu)].map((m) => m[0]),
  )) {
    const def = new RegExp(`const\\s+${name}\\s*=[\\s\\S]{0,400}?;`, 'u')
      .exec(quelltext)?.[0];
    if (def !== undefined && hatHoehe(def, quelltext, tiefe - 1)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

describe('die vier Seiten gibt es, und die Seitenkarte kennt sie', () => {
  it('jede hat ihre Seitendatei im App-Router-Baum', () => {
    const fehlend = SEITEN.filter(([, datei]) => !existsSync(join(MEIN, datei)));
    expect(fehlend.map(([pfad]) => pfad)).toEqual([]);
  });

  it('jede steht in der Seitenkarte, als Selbstzugriff und im Personen-Scope', () => {
    for (const [pfad] of SEITEN) {
      const r = findeRoute(pfad);
      expect(r, pfad).toBeDefined();
      /*
       * `S` in §7: „nur der Betroffene" laesst sich als Recht nicht
       * ausdruecken (K-19). Stuende hier ein Modulrecht, muesste es jeder
       * Mitarbeiterrolle gebunden werden — es pruefte nichts und behauptete,
       * man pruefe.
       */
      expect(r!.bewachung.art, pfad).toBe('selbst');
      expect(['PER', 'PER→M1'], `${pfad}: ${r!.scope}`).toContain(r!.scope);
    }
  });

  it('und sie sind von „Heute" aus erreichbar — sonst gaebe es sie fuer niemanden', () => {
    /**
     * Die Arbeiterleiste traegt fuenf Ziele (SEITENKARTE §11.2), und mehr
     * gehoert dort auch nicht hin. Ohne eine Zeile unter „Weiteres" waeren
     * diese Seiten gebaut, uebersetzt, geprueft — und fuer den Menschen davor
     * dasselbe wie nicht vorhanden. Genau das war der Befund, der die Liste
     * auf `/portal/mein` ueberhaupt entstehen liess.
     */
    const heute = readFileSync(join(MEIN, 'page.tsx'), 'utf8');
    expect(heute).toContain("'/portal/mein/dokumente'");
    expect(heute).toContain("'/portal/mein/objekte'");
  });
});

describe('ohne JavaScript bedienbar (SPEC §10, DESIGN §8)', () => {
  it('keine der vier Seiten ist eine Client-Komponente', () => {
    for (const [pfad, datei] of SEITEN) {
      expect(quelle(datei), pfad).not.toMatch(/^\s*['"]use client['"]/mu);
    }
  });

  it('und keine haengt an einem Ereignis im Browser', () => {
    /**
     * Ein `onChange` an einem `<select>` ist auf einem alten Diensttelefon
     * eine Liste, die sich nie aendert: der Filter waere sichtbar und ohne
     * Wirkung. Deshalb sind die Filter LINKS — sie fuehren auf eine Adresse,
     * stehen im Verlauf und lassen sich zurueckgehen.
     */
    for (const [pfad, datei] of SEITEN) {
      expect(quelle(datei), pfad).not.toMatch(/\bon(Click|Change|Submit|Input)=/u);
    }
  });

  it('jedes Beruehrungsziel ist mindestens 44 px hoch', () => {
    /**
     * DESIGN §8: `44×44px`. Ein `inline-block` mit 16px/26px Zeilenhoehe ist
     * 26 px hoch — auf einem 390-px-Telefon der Unterschied zwischen
     * „getroffen" und „daneben", und getroffen wird hier die Adresse, zu der
     * jemand gleich faehrt.
     *
     * Geprueft wird jeder Anker: `<Link` und `<a`. Die Klasse muss im
     * ELEMENT stehen oder in einer Variablen, die es benutzt — deshalb wird
     * das Element bis zum schliessenden `>` gelesen und, wenn dort eine
     * Klassenvariable steht, deren Definition dazu.
     */
    const fehlend: string[] = [];
    for (const [pfad, datei] of SEITEN) {
      const text = quelle(datei);
      let gelesen = 0;
      for (const treffer of text.matchAll(/<(Link|a)\s[^>]*?>/gsu)) {
        const element = treffer[0];
        gelesen += 1;
        if (hatHoehe(element, text, 2)) continue;
        fehlend.push(`${pfad}: ${element.slice(0, 60).replace(/\s+/gu, ' ')}`);
      }
      expect(gelesen, `${pfad}: kein Anker gelesen`).toBeGreaterThan(0);
    }
    expect(fehlend).toEqual([]);
  });

  it('und die Probe sagt auch Nein — ein Anker ohne Hoehe faellt ihr auf', () => {
    // Ohne diesen Fall koennte die Schleife oben leer laufen und alles waere
    // gruen, ohne dass ein einziger Anker gelesen wurde.
    const beispiel = '<Link href="/x" className="text-base">a</Link>';
    expect(/<(Link|a)\s[^>]*?>/su.exec(beispiel)?.[0].includes('min-h-11')).toBe(false);
  });

  it('jede Seite laeuft ueber `meinPortal` — den EINEN Personen-Scope (K-18)', () => {
    /**
     * Drei Seiten, die sich ihren Scope je selbst aufmachen, sind drei
     * Stellen, an denen jemand `withGroupScope` schreibt — und dann steht die
     * Seite leer da, ohne Fehler und ohne Meldung.
     */
    for (const [pfad, datei] of SEITEN) {
      expect(quelle(datei), pfad).toMatch(/\bmeinPortal\s*</u);
      expect(quelle(datei), pfad).not.toMatch(/\bwithGroupScope\b/u);
    }
  });

  it('die Blattseiten pruefen die Kennung, bevor sie in eine Abfrage geht', () => {
    // Sonst reicht `"neu"` unveraendert in ein `$1::uuid` und Postgres
    // antwortet mit einem 500 auf einen Tippfehler.
    for (const datei of ['dokumente/[id]/page.tsx', 'objekte/[id]/page.tsx']) {
      expect(quelle(datei), datei).toMatch(/kennungOder404\(/u);
    }
  });

  it('der Dateiabruf ist ein `<a>` und kein `<Link>` — kein Vorabruf', () => {
    /**
     * Next.js holt `<Link>`-Ziele im Voraus. Ein vorgeholter Abruf waere eine
     * Zeile in `dokument_zugriff` fuer eine Datei, die niemand geoeffnet hat —
     * und eine Auskunft nach Art. 15 DSGVO mit erfundenen Abrufen ist
     * wertlos.
     */
    const blatt = quelle('dokumente/[id]/page.tsx');
    expect(blatt).toMatch(/<a\s[^>]*href=\{`\/api\/mein\/dokumente\/\$\{d\.id\}\/datei`\}/su);
    expect(blatt).not.toMatch(/<Link\s[^>]*\/api\/mein\/dokumente/su);
  });
});

// ---------------------------------------------------------------------------

describe('die Groessenangabe (DOC-01)', () => {
  it('rechnet zu 1024 und nicht zu 1000', () => {
    expect(groesseText('512')).toBe('512 B');
    expect(groesseText('1023')).toBe('1023 B');
    expect(groesseText('1024')).toBe('1,0 KB');
    expect(groesseText('10240')).toBe('10 KB');
    expect(groesseText('1048576')).toBe('1,0 MB');
    // Die Obergrenze aus 0009: 268435456 Bytes.
    expect(groesseText('268435456')).toBe('256 MB');
  });

  it('erfindet keine Zahl, wenn keine dasteht', () => {
    // Ein „0 B" fuer eine unlesbare Angabe waere eine Aussage ueber die Datei,
    // die niemand geprueft hat.
    expect(groesseText('keine')).toBe('—');
    expect(groesseText('')).toBe('—');
    expect(groesseText('-5')).toBe('—');
  });

  it('kommt mit einem `bigint` jenseits der sicheren Ganzzahl zurecht', () => {
    // `groesse_bytes` ist `bigint`. Ein `Number(...)` beim EINLESEN waere der
    // Fehler, den K-16 meint; gerechnet wird deshalb auf `BigInt`.
    expect(() => groesseText('9007199254740993')).not.toThrow();
    expect(groesseText('9007199254740993').endsWith(' MB')).toBe(true);
  });

  it('das Komma ist deutsch — in jeder Sprache dieselbe gesetzliche Form', () => {
    // SEITENKARTE §12: Zahlen, Geld, Datum und Uhrzeit werden NICHT uebersetzt.
    expect(groesseText('1536')).toBe('1,5 KB');
  });
});

describe('die Anschrift (OPS-01)', () => {
  const basis: EigenesObjekt = {
    objektId: 'x', mandantSlug: 'reinigung', mandantName: 'CSE',
    objektnummer: 'OBJ-1', bezeichnung: 'Bürohaus', gebaeudetyp: null,
    strasse: 'Kurfürstendamm', hausnummer: '21', adresszusatz: null,
    plz: '10719', ort: 'Berlin', etagenAnzahl: 4, archiviert: false,
    aktuellEingeteilt: true, anzahlEinteilungen: 3,
    naechsteSchichtLokal: null, letzteSchichtLokal: null,
  };

  it('setzt Strasse, Hausnummer, Zusatz und Ort zusammen', () => {
    expect(anschriftZeile(basis)).toBe('Kurfürstendamm 21, 10719 Berlin');
  });

  it('ein Gelaende ohne Hausnummer bekommt kein doppeltes Leerzeichen', () => {
    // `hausnummer` ist nullbar, und zwar mit Absicht: ein Gelaende hat keine.
    expect(anschriftZeile({ ...basis, hausnummer: null }))
      .toBe('Kurfürstendamm, 10719 Berlin');
  });

  it('der Adresszusatz steht zwischen Strasse und Ort', () => {
    expect(anschriftZeile({ ...basis, adresszusatz: 'Hinterhaus, 2. Aufgang' }))
      .toBe('Kurfürstendamm 21, Hinterhaus, 2. Aufgang, 10719 Berlin');
  });
});

describe('der Zutritt ist leer oder er ist es nicht', () => {
  it('leer heisst: alle vier Felder leer', () => {
    expect(zugangIstLeer({
      zutrittHinweis: null, ansprechpartnerName: null,
      ansprechpartnerTelefon: null, ansprechpartnerMobil: null,
    })).toBe(true);
  });

  it('ein Ansprechpartner ohne Hinweis ist NICHT leer', () => {
    /**
     * Der Unterschied traegt einen ganzen Satz auf dem Bildschirm: „kein
     * Zutrittshinweis hinterlegt" ist etwas anderes als „Sie sind hier nicht
     * eingeteilt", und wer beides gleich behandelt, schickt jemanden vor eine
     * verschlossene Tuer.
     */
    expect(zugangIstLeer({
      zutrittHinweis: null, ansprechpartnerName: 'Frau Meyer',
      ansprechpartnerTelefon: null, ansprechpartnerMobil: null,
    })).toBe(false);
  });
});

describe('die Kategorien (DOC-01)', () => {
  it('es sind die neun des Enums, in seiner Reihenfolge', () => {
    expect([...DOKUMENT_KATEGORIEN]).toEqual([
      'kunde', 'vertrag', 'angebot', 'rechnung', 'beleg', 'mitarbeiter',
      'projekt', 'buchhaltung', 'unternehmen',
    ]);
  });

  it('`istDokumentKategorie` laesst nur diese neun durch', () => {
    for (const k of DOKUMENT_KATEGORIEN) expect(istDokumentKategorie(k), k).toBe(true);
    // Ein Wert aus der Adressleiste, der ins SQL kaeme, waere ein 500 fuer
    // einen Tippfehler — und im schlimmeren Fall eine Einschleusung.
    for (const k of ['RECHNUNG', 'lohn', '', "kunde'; drop table dokument; --"]) {
      expect(istDokumentKategorie(k), k).toBe(false);
    }
  });

  it('jede Kategorie hat in JEDER der vier Sprachen ein Wort', () => {
    for (const s of PORTAL_SPRACHEN) {
      for (const k of DOKUMENT_KATEGORIEN) {
        const text = DOKUMENT_KATEGORIE_TEXTE[s][k];
        expect(text, `${s}.${k}`).toBeDefined();
        expect((text ?? '').trim(), `${s}.${k}`).not.toBe('');
      }
    }
  });

  it('und keine Sprache ausser Deutsch gibt einfach den deutschen Text zurueck', () => {
    // Der bequeme Fehler: kopieren statt uebersetzen. Er faellt in keiner
    // Vollstaendigkeitspruefung auf.
    for (const s of PORTAL_SPRACHEN.filter((x) => x !== 'de')) {
      const gleich = DOKUMENT_KATEGORIEN
        .filter((k) => DOKUMENT_KATEGORIE_TEXTE[s][k] === DOKUMENT_KATEGORIE_TEXTE.de[k]);
      expect(gleich.length / DOKUMENT_KATEGORIEN.length, `${s}: ${gleich.join(', ')}`)
        .toBeLessThan(0.15);
    }
  });

  it('eine unbekannte Kategorie behaelt ihren Namen — kein „Sonstiges"', () => {
    /**
     * Eine unbekannte Kategorie ist eine, die das Enum erweitert hat. Sie in
     * einen Sammelbegriff zu schieben hiesse, sie verschwinden zu lassen —
     * und die sichtbare Kategorie ist genau die Stelle, an der eine falsche
     * Freigabe auffaellt (O-851).
     */
    expect(dokumentKategorieText('de', 'gutachten')).toBe('gutachten');
  });
});

describe('die Angaben, die diese Seiten VERSPRECHEN', () => {
  it('die Signaturdauer ist abgeleitet und nicht abgeschrieben (DOC-03)', () => {
    // Eine „15" in einer Seite waere die zweite Fassung derselben Zahl — und
    // sie bliebe stehen, wenn die erste sich aendert.
    expect(SIGNATUR_MINUTEN).toBe(Math.round(SIGNATUR_SEKUNDEN / 60));
    expect(SIGNATUR_MINUTEN).toBe(15);
  });

  it('die Listengrenze ist eine Zahl und wird auf dem Bildschirm genannt', () => {
    expect(GRENZE).toBeGreaterThan(0);
    const liste = quelle('dokumente/page.tsx');
    expect(liste).toContain('GRENZE');
    expect(liste).toContain('listeGekuerzt');
  });

  it('die offenen Fragen stehen als SATZ auf dem Bildschirm, nicht nur im Kommentar', () => {
    /**
     * CLAUDE.md: eine offene Geschaeftsregel wird sichtbar „offen (O-NN)".
     * O-850 ist die Zuordnung „dieses Dokument betrifft DIESEN Menschen" —
     * `dokument` traegt keine `person_id`, und ohne sie waere jede
     * personenbezogene Auswahl geraten.
     */
    for (const s of PORTAL_SPRACHEN) {
      expect(MEIN_TEXTE[s].dokumenteOffenerBezug, s).toContain('O-850');
    }
    expect(quelle('dokumente/page.tsx')).toContain('dokumenteOffenerBezug');
  });

  it('und die Zutrittsregel ebenfalls — in jeder der vier Sprachen', () => {
    for (const s of PORTAL_SPRACHEN) {
      expect(MEIN_TEXTE[s].zutrittNurWaehrendEinteilung.trim().length, s)
        .toBeGreaterThan(20);
      expect(MEIN_TEXTE[s].nichtMehrEingeteilt.trim().length, s).toBeGreaterThan(10);
      expect(MEIN_TEXTE[s].keinZutrittHinterlegt.trim().length, s).toBeGreaterThan(10);
    }
    const blatt = quelle('objekte/[id]/page.tsx');
    expect(blatt).toContain('zutrittNurWaehrendEinteilung');
    expect(blatt).toContain('keinZutrittHinterlegt');
    expect(blatt).toContain('nichtMehrEingeteilt');
  });
});

describe('K-05: die Nutzlasten fuehren kein Feld, das nicht hierhergehoert', () => {
  it('die drei neuen Listen stehen im Register', () => {
    const eingetragen = new Set<readonly string[]>(Object.values(MITARBEITER_NUTZLASTEN));
    expect(eingetragen.has(MEIN_DOKUMENT_FELDER)).toBe(true);
    expect(eingetragen.has(EIGENES_OBJEKT_FELDER)).toBe(true);
    expect(eingetragen.has(OBJEKT_ZUGANG_FELDER)).toBe(true);
  });

  it('und keines ihrer Felder klingt nach Geld oder nach Kunde', () => {
    const verdaechtig: string[] = [];
    for (const [name, liste] of [
      ['meinDokument', MEIN_DOKUMENT_FELDER],
      ['eigenesObjekt', EIGENES_OBJEKT_FELDER],
      ['objektZugang', OBJEKT_ZUGANG_FELDER],
    ] as const) {
      for (const f of liste) if (istVerbotenesFeld(f)) verdaechtig.push(`${name}.${f}`);
    }
    expect(verdaechtig).toEqual([]);
  });

  it('die Projektion des Objekts nennt `kunde_id` nicht — auch nicht im SQL', () => {
    /**
     * EMP-13: dieses Portal fuehrt keinen Kunden. Die Feldliste oben ist die
     * eine Linie; dass die ABFRAGE die Spalte gar nicht erst holt, ist die
     * andere — ein `select o.*` haette sie mitgebracht, ohne dass die
     * Feldliste es merkt.
     */
    const dienst = readFileSync(
      join(WURZEL, 'src/server/services/mitarbeiter/objekte.ts'), 'utf8');
    expect(dienst).not.toMatch(/\bo\.kunde_id\b/u);
    expect(dienst).not.toMatch(/select\s+o\.\*/u);
  });

  it('und die des Dokuments weder `bucket` noch `objekt_schluessel`', () => {
    /**
     * Der Ablageort. Wer ihn kennt, kennt das Namensschema des Speichers;
     * ausgeliefert wird ohnehin nur ueber eine kurzlebige signierte Adresse
     * (DOC-03). Die Abrufroute liest ihn — sie gibt ihn nicht heraus.
     */
    const dienst = readFileSync(
      join(WURZEL, 'src/server/services/mitarbeiter/dokumente.ts'), 'utf8');
    expect(dienst).not.toMatch(/\bd\.bucket\b/u);
    expect(dienst).not.toMatch(/\bd\.objekt_schluessel\b/u);
    expect(dienst).not.toMatch(/\bd\.kunde_id\b/u);
  });
});
