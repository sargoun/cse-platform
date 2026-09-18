/**
 * Aufträge, Angebote, Objekte und Dokumente im Kundenportal — die reinen
 * Funktionen und die Grenzen dieser vier Seitenpaare (OPS-05, OPS-08,
 * OPS-01, DOC-01, K-16, K-18, K-20, 04-SEITENKARTE §8).
 *
 * **Warum diese Datei neben `kundenportal.test.ts` steht und nicht darin.**
 * Jene prüft, was für JEDE Kundenseite gilt — eine Hülle, kein
 * `app.aktiver_mandant()`, keine intern-only Tabelle, keine interne Spalte.
 * Diese prüft, was nur für diesen Stapel gilt: zwei Rechenfunktionen, die
 * Formulierung einer offenen Frage auf dem Bildschirm, und die eine Aussage,
 * die den Dokumentenbildschirm von einem Defekt unterscheidet.
 *
 * Die Aussagen über die DATENBANK (wer sieht welche Zeile) stehen in
 * `tests/isolation/kundenportal-stapel.test.ts` — eine Policy hat nur eine
 * Datenbank, und ein Mock, der null Zeilen liefert, bestätigt genau die
 * Verwechslung, die K-18 ausschliessen will.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bindefristText, bindefristVorbei,
} from '../../src/server/services/kundenportal/angebot.js';
import {
  dateigroesse, dateityp, DOKUMENTE_ERREICHBAR, KATEGORIE_LABEL,
} from '../../src/server/services/kundenportal/dokument.js';

const WURZEL = resolve(import.meta.dirname, '../..');

function quelle(pfad: string): string {
  return readFileSync(join(WURZEL, pfad), 'utf8');
}

function ohneKommentare(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/^[\t ]*\/\/.*$/gmu, ' ');
}

// ---------------------------------------------------------------------------

describe('bindefristText · die Bindefrist eines Angebots als Satz', () => {
  it('die drei Fälle um den Stichtag herum', () => {
    /**
     * Die ZAHL kommt aus der Datenbank (`gueltig_bis - app.berlin_heute()`,
     * K-11) — der Node-Prozess läuft in UTC, und am Monatsersten um 00:30
     * Berliner Zeit wäre sein „heute" der Vortag. Diese Funktion formt nur
     * noch Worte daraus; genau deshalb ist sie prüfbar.
     */
    expect(bindefristText(12)).toBe('noch 12 Tage');
    expect(bindefristText(1)).toBe('noch 1 Tag');
    expect(bindefristText(0)).toBe('heute letzter Tag');
  });

  it('ein Tag danach heisst „seit 1 Tag", nicht „seit -1 Tagen"', () => {
    expect(bindefristText(-1)).toBe('seit 1 Tag abgelaufen');
    expect(bindefristText(-3)).toBe('seit 3 Tagen abgelaufen');
    expect(bindefristText(-90)).toBe('seit 90 Tagen abgelaufen');
  });

  it('keine Frist vereinbart ist kein Satz — und schon gar nicht „abgelaufen"', () => {
    /**
     * `gueltig_bis` ist nullbar. Ein Angebot ohne Bindefrist mit „abgelaufen"
     * zu beschriften wäre die teuerste Verwechslung dieser Seite: der Kunde
     * hielte ein gültiges Angebot für erledigt.
     */
    expect(bindefristText(null)).toBeNull();
    expect(bindefristVorbei(null)).toBe(false);
  });

  it('`bindefristVorbei` kippt genau am Tag NACH dem letzten', () => {
    expect(bindefristVorbei(1)).toBe(false);
    expect(bindefristVorbei(0)).toBe(false);
    expect(bindefristVorbei(-1)).toBe(true);
  });

  it('der Satz leitet KEINEN Zustand ab (O-842)', () => {
    /**
     * `angebot_status` kennt `abgelaufen` als eigenen Wert, und es gibt heute
     * keinen Lauf, der ihn setzt. Die Seite zeigt den GESPEICHERTEN Zustand
     * und diesen Satz nebeneinander. Fiele hier eine Ableitung hinein, stünde
     * im Portal ein anderer Zustand als in der Datenbank — und die
     * Sachbearbeitung suchte den Unterschied.
     */
    const text = ohneKommentare(
      quelle('src/app/portal/kunde/angebote/page.tsx')
      + quelle('src/app/portal/kunde/angebote/[id]/page.tsx'));
    expect(text).not.toMatch(/status\s*=\s*['"]abgelaufen/u);
    expect(text).not.toMatch(/\?\s*['"]abgelaufen['"]\s*:/u);
  });
});

describe('dateigroesse · Bytes als Satz, gerechnet in BigInt', () => {
  it('unter tausend Byte bleibt es bei ganzen Byte', () => {
    expect(dateigroesse('0')).toBe('0 Byte');
    expect(dateigroesse('1')).toBe('1 Byte');
    expect(dateigroesse('999')).toBe('999 Byte');
  });

  it('Dezimalpräfixe, nicht binäre — der Browser sagt dasselbe', () => {
    /**
     * 1024 statt 1000 ergäbe „1,4 MiB" für eine Datei, die der Browser als
     * „1,5 MB" lädt. Der Kunde vergleicht mit dem, was sein Rechner sagt.
     */
    expect(dateigroesse('1000')).toBe('1,0 kB');
    expect(dateigroesse('1500')).toBe('1,5 kB');
    expect(dateigroesse('1536000')).toBe('1,5 MB');
    expect(dateigroesse('2000000000')).toBe('2,0 GB');
  });

  it('kaufmännisch gerundet, eine Nachkommastelle', () => {
    expect(dateigroesse('1450')).toBe('1,5 kB');
    expect(dateigroesse('1440')).toBe('1,4 kB');
  });

  it('der Übertrag über die Einheitsgrenze steigt eine Stufe auf', () => {
    /**
     * 999.950 Byte runden auf „1000,0 kB", und das liest niemand als ein
     * Megabyte. Ohne diesen Fall stünde auf dem Bildschirm eine Zahl, die
     * formal stimmt und falsch gelesen wird.
     */
    expect(dateigroesse('999950')).toBe('1,0 MB');
  });

  it('gerechnet wird in `BigInt` — jenseits von 2^53 bleibt es exakt', () => {
    /**
     * `groesse_bytes` ist `bigint`. Die Spalte durch `Number` zu drehen ist
     * dieselbe Nachlässigkeit, die bei Cent-Beträgen Geld kostet (K-16).
     * 9007199254740993 ist die kleinste Zahl, die es verrät: als `number`
     * wird sie zu …992.
     */
    expect(dateigroesse('9007199254740993')).toBe('9007199,3 GB');
    /*
     * Der Rumpf OHNE Kommentare: die Begruendung darin nennt `Math.round`
     * beim Namen — ein Test ueber den rohen Text fiele an der Begruendung
     * statt am Code. Dieselbe Vorsichtsmassnahme wie in
     * `tests/kern/kundenportal.test.ts`.
     */
    const quelltext = quelle('src/server/services/kundenportal/dokument.ts');
    const roh = quelltext.slice(quelltext.indexOf('export function dateigroesse'));
    const rumpf = ohneKommentare(roh.slice(0, roh.indexOf('\n}')));
    expect(rumpf).not.toContain('Number(');
    expect(rumpf).not.toContain('Math.');
    expect(rumpf).not.toContain('parseFloat');
  });

  it('eine negative Größe ist keine Größe', () => {
    expect(() => dateigroesse('-1')).toThrow(RangeError);
  });
});

describe('dateityp · der Dateityp als Wort', () => {
  it('die bekannten Typen tragen ihren Namen', () => {
    expect(dateityp('application/pdf')).toBe('PDF');
    expect(dateityp('image/png')).toBe('PNG-Bild');
  });

  it('ein unbekannter Typ nennt die Obergruppe, nie die rohe MIME-Zeile', () => {
    /**
     * „video/quicktime; codecs=hvc1" sagt dem Kunden nichts und verrät
     * nebenbei, womit aufgenommen wurde. „Video" sagt, was er wissen will.
     */
    expect(dateityp('video/quicktime; codecs=hvc1')).toBe('Video');
    expect(dateityp('image/heic')).toBe('Bild');
    expect(dateityp('application/x-etwas')).toBe('Datei');
  });

  it('ein leerer Typ ergibt nie ein leeres Feld', () => {
    expect(dateityp('')).toBe('Datei');
  });

  it('alle neun Kategorien aus DOC-01 haben eine deutsche Beschriftung', () => {
    for (const k of ['kunde', 'vertrag', 'angebot', 'rechnung', 'beleg',
      'mitarbeiter', 'projekt', 'buchhaltung', 'unternehmen']) {
      expect(KATEGORIE_LABEL[k], `${k} ohne Beschriftung`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------

describe('die Dokumentenseite sagt, WARUM sie leer ist (K-18, O-671)', () => {
  /**
   * **Die teuerste Verwechslung dieses Stapels.** `dokument` trägt im
   * Kunden-Scope zwei restriktive Decken und keine permissive Policy; die
   * Liste liefert deshalb null Zeilen (in `tests/isolation/` an einer echten
   * Datenbank nachgemessen). „Es liegt keine Unterlage vor" wäre dort schlicht
   * gelogen: es liegen welche vor, sie kommen nur nicht diesen Weg.
   *
   * Ob sie ihn je kommen, ist eine Entscheidung über Offenlegung und als
   * O-671 offen. Diese Prüfungen halten fest, dass die Seite sie als offen
   * AUSWEIST, statt sie stillschweigend als Tatsache auszugeben.
   */
  const LISTE = quelle('src/app/portal/kunde/dokumente/page.tsx');
  const BLATT = quelle('src/app/portal/kunde/dokumente/[id]/page.tsx');

  it('`DOKUMENTE_ERREICHBAR` ist eine Konstante und heute `false`', () => {
    /**
     * Eine Konstante und keine Abfrage: „null Zeilen" ist genau die Auskunft,
     * die man hier nicht als Antwort nehmen darf. Dieselbe Bauart wie
     * `ANHAENGE_SICHTBAR` in `kundenportal/nachricht.ts`.
     */
    expect(DOKUMENTE_ERREICHBAR).toBe(false);
  });

  it('die Liste nennt O-671 an der Stelle, an der sonst die Zeilen stünden', () => {
    expect(ohneKommentare(LISTE)).toContain('O-671');
    expect(ohneKommentare(LISTE)).toContain('DOKUMENTE_ERREICHBAR');
  });

  it('der Leertext behauptet NICHT, dass nichts vorliegt', () => {
    /**
     * Der Satz für den Fall „Weg nicht geöffnet" muss ausdrücklich das
     * Gegenteil sagen. Geprüft wird die Formulierung, weil genau sie die
     * Auskunft trägt — ein Test auf `length === 0` sähe keinen Unterschied.
     */
    const text = ohneKommentare(LISTE);
    expect(text).toMatch(/nicht, weil keine Unterlagen vorliegen/u);
  });

  it('das Blatt bietet keinen Abruf an, solange keiner existiert', () => {
    /**
     * Kein `<a href>` auf eine Datei und keine erfundene Route: ein Knopf vor
     * einem 404 ist schlechter als keiner. Und ausgeliefert würde ohnehin nur
     * über eine signierte Adresse — die Konstante dafür steht im Adapter
     * (DOC-03), nicht als Zahl in der Seite.
     */
    const text = ohneKommentare(BLATT);
    expect(text).not.toContain('/api/kunde/dokumente');
    expect(text).not.toContain('/api/dokumente');
    /*
     * Die Frist kommt als abgeleitete Konstante aus dem Dienst, nie als Zahl
     * in der Seite: `SIGNATUR_SEKUNDEN` (DOC-03) ist die Wahrheit, und eine
     * „15" hier waere ihre zweite Fassung — die bliebe stehen, wenn die erste
     * sich aendert. Und es wird auch nicht in der Komponente umgerechnet.
     */
    expect(text).toContain('SIGNATUR_MINUTEN');
    expect(text).not.toMatch(/\b900\b/u);
    expect(text).not.toMatch(/\b15\b/u);
    expect(text).not.toContain('Math.');
  });

  it('die Kategorie steht sichtbar auf Liste und Blatt (O-736, drizzle/0297)', () => {
    /**
     * Solange offen ist, welche Kategorien einem Kunden überhaupt freigegeben
     * werden dürfen, prüft die Datenbank nur das Recht. Die sichtbare
     * Kategorie ist die Stelle, an der eine falsche Freigabe auffällt —
     * „Personalunterlage" in einer Kundenliste sieht falsch aus, und genau
     * das soll sie.
     */
    for (const [name, text] of [['Liste', LISTE], ['Blatt', BLATT]] as const) {
      expect(ohneKommentare(text), `${name} ohne Kategorie`)
        .toContain('KATEGORIE_LABEL');
      expect(ohneKommentare(text), `${name} ohne Anker`)
        .toContain('data-cse="kategorie"');
    }
  });
});

describe('die vier neuen Seitenpaare halten sich an die Bauart des Portals', () => {
  const PAARE = [
    'auftraege', 'angebote', 'objekte', 'dokumente',
  ] as const;

  for (const p of PAARE) {
    const liste = quelle(`src/app/portal/kunde/${p}/page.tsx`);
    const blatt = quelle(`src/app/portal/kunde/${p}/[id]/page.tsx`);

    it(`${p}: das Blatt prüft die Kennung, bevor sie in eine Abfrage kommt`, () => {
      /**
       * Ohne `kennungOder404` reicht die Route `"neu"` unverändert in ein
       * `$1::uuid`; Postgres antwortet `invalid input syntax for type uuid`
       * und die Anwendung mit 500. Ein 500 ist die schlechteste Antwort: er
       * sagt „mein Fehler", wo „gibt es nicht" die Wahrheit ist
       * (`app/portal/kennung.ts`).
       */
      expect(ohneKommentare(blatt)).toContain('kennungOder404(');
    });

    it(`${p}: ein fremder Datensatz endet in notFound(), nie in 403`, () => {
      expect(ohneKommentare(blatt)).toContain('notFound()');
      expect(ohneKommentare(blatt)).not.toContain('403');
    });

    it(`${p}: die Liste sagt bei null Zeilen, warum sie leer ist`, () => {
      expect(ohneKommentare(liste)).toContain('<Leer');
    });

    it(`${p}: keine Summe und keine Multiplikation in der Seite`, () => {
      /**
       * CLAUDE.md: „No calculation in a component, ever." Beträge kommen als
       * Ganzzahl-Cent aus der Datenbank und laufen durch `formatiereGeld`;
       * Mengen durch `formatiereMenge(mengeAusPostgres(...))`. Gesucht wird
       * die STELLUNG — `reduce`, `+=` und `*` auf Beträgen —, nicht das
       * Zeichen: `*` steht auch in jedem Kommentar und in `select count(*)`.
       */
      for (const [name, text] of [['Liste', liste], ['Blatt', blatt]] as const) {
        const nackt = ohneKommentare(text);
        expect(nackt, `${p} ${name}: reduce`).not.toContain('.reduce(');
        expect(nackt, `${p} ${name}: BigInt-Addition`).not.toMatch(/BigInt\([^)]*\)\s*[+*-]/u);
        expect(nackt, `${p} ${name}: Cent-Arithmetik`).not.toMatch(/Cent\s*[+*]\s/u);
      }
    });

    it(`${p}: jeder bedingte Verweis prüft das Recht seiner Zielroute`, () => {
      /**
       * Ein Verweis darf nicht mehr versprechen, als seine Zielroute hält:
       * ohne das Recht stünde dahinter ein 404 — genau die Auskunft, die
       * AUT-06 verweigert (D-581). Geprüft wird, dass eine Seite, die auf ein
       * ANDERES Modul verweist, dessen Recht über `basis.rechte` erfragt.
       */
      const nackt = ohneKommentare(blatt);
      /*
       * Nur `href=`, nicht jedes Vorkommen des Pfades: die eigene Adresse
       * steht auch im Aufruf von `kundePortal(...)` — das ist der Rueckweg
       * der Sitzung und kein Verweis. Und die EIGENE Wurzel zaehlt nicht:
       * wer diese Seite sieht, darf sie schon.
       */
      const fremdeZiele = [...nackt.matchAll(
        /href=\{`\/portal\/kunde\/(auftraege|angebote|objekte|rechnungen|projekte)\/\$\{/gu)]
        .map((m) => m[1]).filter((z) => z !== p);
      if (fremdeZiele.length === 0) return;
      expect(nackt, `${p}: verweist auf ${fremdeZiele.join(', ')} ohne Rechtefrage`)
        .toContain('basis.rechte[');
    });
  }

  it('die Aufträge nennen O-840 — die Auftragssumme ist offen, nicht vergessen', () => {
    /**
     * Sie steht in keiner Abfrage (`tests/kern/kundenportal.test.ts` hält die
     * Spalte fern). Eine Auslassung ohne Nummer wäre von einem Versehen nicht
     * zu unterscheiden — und jemand trüge sie beim nächsten Umbau nach.
     */
    expect(ohneKommentare(quelle('src/app/portal/kunde/auftraege/[id]/page.tsx')))
      .toContain('O-840');
  });

  it('die Angebote nennen O-74 auf Liste UND Blatt', () => {
    /**
     * Die Annahme ist eine Willenserklärung; sie bringt einen Vertrag
     * zustande. Auf der Liste steht die Nummer, weil dort der erste Impuls
     * entsteht, und auf dem Blatt, weil dort der Knopf stünde.
     */
    for (const p of ['src/app/portal/kunde/angebote/page.tsx',
      'src/app/portal/kunde/angebote/[id]/page.tsx']) {
      expect(ohneKommentare(quelle(p)), `${p} ohne O-74`).toContain('O-74');
    }
  });

  it('kein ausgegrauter Knopf, wo eine Frage offen ist', () => {
    /**
     * Ein ausgegrauter Knopf sagt „nicht jetzt" und lässt offen, ob es an der
     * Anmeldung, am Recht oder am Zustand liegt; der Mensch klickt und lernt
     * nichts. `Offen` sagt stattdessen, was heute der richtige Weg IST, und
     * nennt die Nummer, unter der die Frage im Register steht.
     */
    for (const p of PAARE) {
      for (const datei of [`src/app/portal/kunde/${p}/page.tsx`,
        `src/app/portal/kunde/${p}/[id]/page.tsx`]) {
        const nackt = ohneKommentare(quelle(datei));
        expect(nackt, `${datei}: disabled`).not.toContain('disabled');
        expect(nackt, `${datei}: <button`).not.toContain('<button');
        expect(nackt, `${datei}: <form`).not.toContain('<form');
      }
    }
  });
});

describe('der Gesellschaftsfilter ist kein Mandantenwechsler (Invariante 3, K-20)', () => {
  const BAUSTEINE = quelle('src/app/portal/kunde/bausteine.tsx');

  it('der Slug wird auf seine Form geprüft, bevor er irgendwohin geht', () => {
    expect(ohneKommentare(BAUSTEINE)).toMatch(/\^\[a-z0-9-\]\{1,40\}\$/u);
  });

  it('die vier gefilterten Listen benutzen DENSELBEN Baustein', () => {
    /**
     * Vier Abschriften wären vier Gelegenheiten, das Muster zu lockern — und
     * die erste Lockerung ist die, die einen fremden Slug durchlässt.
     */
    for (const p of ['rechnungen', 'auftraege', 'angebote', 'objekte']) {
      const text = ohneKommentare(quelle(`src/app/portal/kunde/${p}/page.tsx`));
      expect(text, `${p} ohne GesellschaftsFilter`).toContain('<GesellschaftsFilter');
      expect(text, `${p} ohne slugAus`).toContain('slugAus(');
    }
  });

  it('der Filter ändert keine Sitzung — er steht nur in einem `href`', () => {
    /**
     * Der aktive Mandant lebt in der Serversitzung, nie in einem URL-Parameter
     * (Invariante 3) — und im Kunden-Scope ist er ohnehin NULL (K-20). Was
     * sichtbar ist, entscheidet RLS; dieser Filter kann nur wegnehmen.
     */
    const nackt = ohneKommentare(BAUSTEINE);
    expect(nackt).not.toContain('aktiverMandant');
    expect(nackt).not.toContain('setMandant');
    expect(nackt).not.toContain("'use client'");
  });
});
