/**
 * PR 39 ohne Datenbank — die Haelften der Zusagen, die Aussagen ueber den
 * CODE sind und nicht ueber Zeilen.
 *
 * Die Datenbankhaelften stehen in `tests/isolation/mitarbeiter.test.ts`. Hier
 * steht, was sich am Baum selbst pruefen laesst: dass es keine Route gibt, die
 * einen Zeiteintrag aendert (EMP-07); dass die Nutzlasten des Portals kein
 * Feld fuehren, das nach Geld klingt (K-05); dass jede Seite der Seitenkarte
 * wirklich existiert; und dass die Wache gegen ihre eigenen Falschtreffer
 * geprueft ist.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTEN as API_ROUTEN } from '../../src/server/auth/route-manifest.js';
import { ROUTEN, findeRoute } from '../../src/server/registry/routen.js';
import { DIENSTE } from '../../src/server/registry/dienste.js';
import { tableiste } from '../../src/server/registry/tableiste.js';
import {
  GELD_WOERTER, MITARBEITER_NUTZLASTEN, feldWoerter, istVerbotenesFeld,
} from '../../src/server/services/mitarbeiter/felder.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const MEIN = join(WURZEL, 'src/app/portal/mein');

/**
 * Kommentare raus — eine ERWAEHNUNG ist kein Aufruf.
 *
 * Die Docblocks dieser Seiten erklaeren ausdruecklich, dass
 * `korrigiereZeiteintrag` die Korrektur schreibt und nicht das Portal. Eine
 * Wache, die ihre eigene Begruendung als Verstoss meldet, wird abgeschaltet.
 */
function ohneKommentare(inhalt: string): string {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .split('\n')
    .map((z) => z.replace(/(^|\s)\/\/.*$/u, '$1'))
    .join('\n');
}

function dateien(verzeichnis: string): readonly string[] {
  const treffer: string[] = [];
  for (const e of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, e);
    if (statSync(voll).isDirectory()) treffer.push(...dateien(voll));
    else if (/\.tsx?$/u.test(e)) treffer.push(voll);
  }
  return treffer;
}

// ---------------------------------------------------------------------------
// Die Modulhuelle einer Route — und was darin einen Zeiteintrag schreibt
// ---------------------------------------------------------------------------

/**
 * `@/server/x` und `../y` zu einer Datei unter `src/` — oder `null`.
 *
 * Paketnamen (`postgres`, `next/server`) fallen durch: sie liegen nicht in
 * diesem Baum, und was nicht in diesem Baum liegt, schreibt hier auch keine
 * Tabelle.
 */
function moduldatei(quelle: string, spezifizierer: string): string | null {
  let basis: string;
  if (spezifizierer.startsWith('@/')) basis = join(WURZEL, 'src', spezifizierer.slice(2));
  else if (spezifizierer.startsWith('.')) basis = resolve(dirname(quelle), spezifizierer);
  else return null;
  const src = join(WURZEL, 'src');
  for (const endung of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const kandidat = `${basis}${endung}`;
    // Kein Ausbruch aus `src/` ueber `../../..` — und kein Verzeichnis.
    if (!kandidat.startsWith(`${src}/`)) continue;
    if (existsSync(kandidat) && statSync(kandidat).isFile()) return kandidat;
  }
  return null;
}

/**
 * Alle Dateien unter `src/`, die von `einstieg` aus erreichbar sind —
 * TRANSITIV, nicht eine Ebene tief.
 *
 * Eine Ebene reichte hier nicht: die Schichtrouten rufen nichts selbst, sie
 * reichen an `bruecke.ts` weiter, und die Bruecke reicht an den Fachdienst
 * weiter. Wer nur eine Ebene liest, liest genau bis zu der Stelle, an der das
 * Schreiben anfaengt.
 */
function modulhuelle(einstieg: string): readonly string[] {
  const gesehen = new Set<string>();
  const stapel = [einstieg];
  while (stapel.length > 0) {
    const datei = stapel.pop() as string;
    if (gesehen.has(datei)) continue;
    gesehen.add(datei);
    const quelle = readFileSync(datei, 'utf8');
    for (const treffer of quelle.matchAll(/from\s+'([^']+)'/gu)) {
      const ziel = moduldatei(datei, treffer[1] ?? '');
      if (ziel !== null) stapel.push(ziel);
    }
  }
  return [...gesehen];
}

/**
 * Eine Anweisung, die `zeiteintrag` SCHREIBT — kein `select … from`.
 *
 * Lesen ist ausdruecklich erlaubt und geschieht ueberall: das Stundenkonto,
 * der Monatsnachweis und das Bautagebuch lesen Zeiteintraege. EMP-07 verbietet
 * das AENDERN, und genau diese drei Anweisungen aendern.
 */
const SCHREIBT_ZEITEINTRAG = /(?:insert\s+into|update|delete\s+from)\s+zeiteintrag\b/iu;

/** Die Dateien der Huelle, die einen Zeiteintrag schreiben. */
function zeiteintragSchreiber(einstieg: string): readonly string[] {
  return modulhuelle(einstieg)
    .filter((d) => SCHREIBT_ZEITEINTRAG.test(ohneKommentare(readFileSync(d, 'utf8'))))
    .map((d) => d.replace(`${WURZEL}/`, ''))
    .sort();
}

/** Jede `route.ts` unter `src/app/api/mein/**`, als Manifestpfad. */
function meineRoutendateien(): readonly { readonly pfad: string; readonly datei: string }[] {
  const api = join(WURZEL, 'src/app/api');
  return dateien(join(api, 'mein'))
    .filter((d) => /\/route\.tsx?$/u.test(d))
    .map((datei) => ({
      pfad: `api/${datei.slice(api.length + 1).replace(/\/route\.tsx?$/u, '')}`,
      datei,
    }))
    .sort((a, b) => a.pfad.localeCompare(b.pfad));
}

// ---------------------------------------------------------------------------

describe('(2) es gibt keinen Weg, der einen Zeiteintrag aendert (EMP-07)', () => {
  it('keine API-Route traegt einen Zeiteintrag im Pfad', () => {
    /**
     * EMP-07 als Eigenschaft der ADRESSLISTE: was es nicht gibt, ruft auch
     * niemand versehentlich auf. `api/zeit/einwand` und
     * `api/zeit/einwand/entscheidung` sind die zwei Wege, die EMP-07 kennt.
     */
    const verdaechtig = API_ROUTEN
      .map((r) => r.pfad)
      .filter((p) => /^api\/(?:mein\/)?zeit(?:eintrag|\/eintrag|en)/u.test(p));
    expect(verdaechtig).toEqual([]);
  });

  /**
   * **Die Sperrklinke — sie darf mitwachsen, sie darf nicht verschwinden.**
   *
   * Frueher stand hier „genau DREI", und die Drei war das Falsche daran: die
   * Zusage von EMP-07 ist nicht „es sind drei", sondern „keine davon aendert
   * einen Zeiteintrag". Eine Zahl faellt bei jedem ehrlichen Zuwachs um und
   * wird dann hochgesetzt, bis niemand mehr hinsieht.
   *
   * Geblieben ist die LISTE — sie ist die Sperrklinke: eine neue Adresse unter
   * `api/mein/` faellt auf, bevor jemand sie benutzt, und wer sie eintraegt,
   * hat sie gelesen. Dazu gekommen ist die PRUEFUNG darunter, die fuer jede
   * Adresse der Liste NACHWEIST, was die Liste bisher nur behauptete.
   *
   * PR 42 brachte die Kenntnisnahme (EMP-09), 0301/0303 den Rueckzug, die
   * Fotos und die zwei Bautagebuchwege, 0304 den Leistungsnachweis mit seiner
   * Unterschrift und 0070/0300 die Wachbuchseite.
   */
  const MEINE_SCHREIBROUTEN: readonly string[] = [
    'api/mein/abwesenheit',
    /* V-056 — die eigene Ruecknahme, in derselben Form wie beim Antrag (0386). */
    'api/mein/abwesenheit/[id]/zurueckziehen',
    'api/mein/antraege',
    'api/mein/antraege/[id]/zurueckziehen',
    'api/mein/dienstanweisungen/[id]/kenntnisnahme',
    /*
     * Der Dateiabruf (0361) ist ein LESEWEG und steht trotzdem hier: er
     * schreibt eine Zeile in `dokument_zugriff`, weil DOC-03 und SEC-A6 das
     * verlangen — „wer wissen will, wer eine Personalakte gesehen hat
     * (Art. 15 DSGVO), findet sie hier". Ein Abruf ohne Spur waere fuer die
     * Datenschutzauskunft unsichtbar, und eine Liste, die nur die
     * offensichtlichen Schreibwege kennt, haette ihn nie gesehen.
     */
    'api/mein/dokumente/[id]/datei',
    /* Die Antwort im eigenen Faden (0350, EMP-11). */
    'api/mein/nachrichten/[id]',
    /*
     * **Die Antwort auf die eigene Einteilung (V-049, D-622, Migration 0374)
     * — die fuenfzehnte Schreibroute, und hier steht, warum sie eine sein darf.**
     *
     * Sie schreibt `einsatz_zuordnung.status`, und das Arbeiterportal hat auf
     * diese Tabelle ueber `cse_app` gar keinen Schreibweg: `t_selbst_m1` gibt
     * nur `r`, `t_mandant` verlangt `dienstplan.schreiben`, `p_ma_decke`
     * deckelt restriktiv auf die eigene Anstellung. Dieselbe Aufloesung wie
     * bei der Stempeluhr darunter: der Schreibweg laeuft ueber
     * `cse_definer` (`app.schicht_zusagen` / `app.schicht_absagen`), und die
     * Funktionen pruefen PORTAL und PERSONENZUGEHOERIGKEIT statt eines
     * Rechts. `dienstplan.schreiben` ist das Recht, den Plan zu MACHEN — wer
     * es einer Reinigungskraft gaebe, gaebe ihr den Plan.
     *
     * Der Fall „KEINE Route unter `api/mein/` schreibt einen Zeiteintrag"
     * bleibt unberuehrt: hier wird keiner geschrieben.
     */
    'api/mein/schicht',
    /*
     * **Zwei Wege am eigenen Bautag (V-063) — und keiner schreibt einen
     * Zeiteintrag.**
     *
     * `korrektur` storniert die EIGENE Mannstundenzeile und setzt einen Ersatz
     * daneben; `t_selbst_m1_storno` (0303) lässt genau diesen einen Übergang
     * zu und sonst nichts. `foto` hängt eine Aufnahme an den Bautag;
     * `t_selbst_schichtmedien` (0303) nennt `bezug_tabelle = 'bautagebuch'`
     * ausdrücklich. Beide Policies standen seit 0303 da — die Routen fehlten.
     *
     * `bautagebuch_mannstunden` ist eine Tagebuchzeile und keine Arbeitszeit:
     * der Abgleich GEGEN die Zeiterfassung liest sie, er schreibt nicht
     * zurück. EMP-07 bleibt damit unberührt.
     */
    'api/mein/schichten/[zuordnungId]/bautagebuch/foto',
    'api/mein/schichten/[zuordnungId]/bautagebuch/korrektur',
    'api/mein/schichten/[zuordnungId]/bautagebuch/mannstunden',
    'api/mein/schichten/[zuordnungId]/bautagebuch/position',
    'api/mein/schichten/[zuordnungId]/fotos',
    'api/mein/schichten/[zuordnungId]/leistungsnachweis',
    'api/mein/schichten/[zuordnungId]/leistungsnachweis/[id]/unterschrift',
    'api/mein/schichten/[zuordnungId]/wachbuch',
    /*
     * **Die Stempeluhr (D-618, O-93, Migration 0373) — und sie ist der
     * Grenzfall, den diese Liste festhalten soll.**
     *
     * Sie schreibt einen `zeiteintrag`, und genau das verbietet EMP-07 dem
     * Portal. Der Widerspruch loest sich an der Stelle auf, die der Kommentar
     * zu `p_ma_kein_update` (0052) schon nennt: verboten ist das AENDERN ueber
     * `cse_app`; der Check-in schreibt seit jeher ueber `cse_definer` (K-08),
     * und diese Route ruft mit `app.checkin_aus_der_sitzung` genau denselben
     * Weg wie der Token-Link — sie muendet in `app.checkin_verbrauchen`, den
     * einen Schreiber.
     *
     * Der Fall darunter („KEINE Route unter `api/mein/` schreibt einen
     * Zeiteintrag") bleibt deshalb gruen: er sucht nach `insert into
     * zeiteintrag` IM PORTALCODE, und den gibt es hier nicht.
     *
     * Was diese Zeile kostet, ist der Grund, aus dem sie hier steht: wer eine
     * vierzehnte Schreibroute dazunimmt, muss sie benennen und begruenden.
     */
    'api/mein/stempeluhr',
  ];

  it('jede Schreibroute des Portals steht namentlich in der Liste', () => {
    const meine = API_ROUTEN
      .filter((r) => r.pfad.startsWith('api/mein/'))
      .map((r) => r.pfad)
      .sort();
    expect(meine).toEqual([...MEINE_SCHREIBROUTEN].sort());
  });

  it('und die Liste beschreibt den Baum — kein Eintrag ohne Datei, keine Datei ohne Eintrag', () => {
    // Sonst pruefte die Zusage darunter eine Liste statt des Programms: eine
    // gestrichene Adresse bliebe als gruene Zeile stehen, eine neue fehlte.
    expect(meineRoutendateien().map((r) => r.pfad))
      .toEqual([...MEINE_SCHREIBROUTEN].sort());
  });

  it('KEINE Route unter `api/mein/` schreibt einen Zeiteintrag (EMP-07)', () => {
    /**
     * **Die eigentliche Zusage — nachgewiesen statt aufgezaehlt.**
     *
     * Gelesen wird die Modulhuelle jeder Portalroute: die Datei selbst, die
     * Bruecke, die Fachdienste dahinter, transitiv bis an den Rand von `src/`.
     * Taucht darin `insert into` / `update` / `delete from zeiteintrag` auf,
     * faellt die Probe — egal, ob die Adresse in der Liste oben steht.
     *
     * Das ist strenger als die Namensliste, die hier frueher stand: die Liste
     * sagte „diese drei sind in Ordnung", ohne je nachzusehen. Ein vierter
     * Eintrag haette sie geheilt. Hier heilt kein Eintrag etwas — eine neue
     * Adresse muss die Eigenschaft erfuellen, sonst bleibt sie rot.
     */
    const verdaechtig: string[] = [];
    for (const { pfad, datei } of meineRoutendateien()) {
      /*
       * Ohne diese Zeile bestuende die Probe auf einer Huelle von EINS: wenn
       * `moduldatei` eines Tages nichts mehr aufloest — ein Aliaswechsel, ein
       * anderer Anfuehrungsstil — laege jeder Fachdienst ausserhalb, und die
       * Probe meldete zehnmal „sauber", ohne eine einzige Zeile davon gelesen
       * zu haben.
       */
      const huelle = modulhuelle(datei);
      expect(huelle.length, `${pfad}: die Huelle reicht nicht ueber die Route hinaus`)
        .toBeGreaterThan(3);
      for (const schreiber of zeiteintragSchreiber(datei)) {
        verdaechtig.push(`${pfad} → ${schreiber}`);
      }
    }
    expect(
      verdaechtig,
      'EMP-07: eine Route des Mitarbeiterportals erreicht einen Schreibweg auf '
      + '`zeiteintrag`. Korrigiert wird ueber `api/zeit/korrektur`, eingewendet '
      + 'ueber `api/zeit/einwand` — nicht aus dem Portal heraus.',
    ).toEqual([]);
  });

  it('und die Probe sagt auch Nein — `api/zeit/korrektur` faellt ihr auf', () => {
    /**
     * **Die Gegenprobe.** Ohne sie koennte `zeiteintragSchreiber` schlicht
     * eine leere Liste zurueckgeben und alles oben waere gruen, ohne dass
     * irgendetwas geprueft wuerde.
     *
     * Genommen wird die EINE Route des Baums, die einen Zeiteintrag
     * rechtmaessig aendert (TIM-11). Sie liegt nicht unter `api/mein/`, sie
     * ruft `korrigiereZeiteintrag` nicht selbst — der Dienst
     * `services/zeit/korrektur.ts` schreibt —, und genau ueber zwei
     * Importkanten muss die Probe hinkommen, um das zu sehen.
     */
    const korrektur = join(WURZEL, 'src/app/api/zeit/korrektur/route.ts');
    expect(existsSync(korrektur), 'die Gegenprobe braucht ihre Route').toBe(true);
    // Die Huelle ist wirklich eine Huelle und nicht die eine Datei.
    expect(modulhuelle(korrektur).length).toBeGreaterThan(5);
    expect(zeiteintragSchreiber(korrektur))
      .toContain('src/server/services/zeit/korrektur.ts');
  });

  it('und genau EINE Portalroute traegt ueberhaupt ein Recht — die Abwesenheitsmeldung', () => {
    /**
     * Alles andere unter `api/mein/` ist Selbstzugriff (SEITENKARTE §7): „nur
     * der Betroffene" laesst sich als Recht gar nicht ausdruecken, weil ein
     * Recht einer Rolle gehoert und eine Rolle vielen Menschen. Ein erfundener
     * Schluessel muesste jeder Mitarbeiterrolle gebunden werden — er pruefte
     * nichts und behauptete, man pruefe (K-19).
     *
     * Der Grund ist deshalb Pflicht: er ist die Stelle, an der jemand
     * nachliest, WAS statt des Rechts bewacht — Sitzung, Ursprungsvergleich,
     * der serverseitig abgeleitete Mandant (K-02) und die Policy.
     */
    const meine = API_ROUTEN.filter((r) => r.pfad.startsWith('api/mein/'));
    expect(meine.filter((r) => r.recht !== null).map((r) => r.pfad))
      .toEqual(['api/mein/abwesenheit']);
    for (const r of meine.filter((r) => r.recht === null)) {
      expect((r.grund ?? '').length, r.pfad).toBeGreaterThan(40);
    }
  });

  it('die Kenntnisnahme ist Selbstzugriff — ohne Recht, aber mit einem Grund', () => {
    const k = API_ROUTEN.find(
      (r) => r.pfad === 'api/mein/dienstanweisungen/[id]/kenntnisnahme');
    expect(k?.recht).toBeNull();
    // Der Grund ist die Stelle, an der jemand die Entscheidung nachlesen kann.
    expect((k?.grund ?? '').length).toBeGreaterThan(40);
    expect(k?.grund).toContain('EMP-09');
  });

  it('das Einreichen ist Selbstzugriff — ohne Recht, aber mit einem Grund', () => {
    const antrag = API_ROUTEN.find((r) => r.pfad === 'api/mein/antraege');
    expect(antrag?.recht).toBeNull();
    // Der Grund ist die Stelle, an der jemand die Entscheidung nachlesen kann.
    expect((antrag?.grund ?? '').length).toBeGreaterThan(40);
    expect(antrag?.grund).toContain('EMP-10');
  });

  it('die Abwesenheitsmeldung verlangt `zeit.abwesenheit_melden` und ruft `authorize`', () => {
    const abw = API_ROUTEN.find((r) => r.pfad === 'api/mein/abwesenheit');
    expect(abw?.recht).toBe('zeit.abwesenheit_melden');
    const quelle = readFileSync(
      join(WURZEL, 'src/app/api/mein/abwesenheit/route.ts'), 'utf8');
    expect(quelle).toMatch(/\bauthorize\s*\(/u);
    expect(quelle).toContain('zeit.abwesenheit_melden');
  });

  it('unter `/portal/mein/zeiten` steht GENAU EIN Formular — der Einwand', () => {
    const mitFormular = dateien(join(MEIN, 'zeiten'))
      .filter((d) => /<form/u.test(readFileSync(d, 'utf8')))
      .map((d) => d.replace(`${MEIN}/`, ''));
    expect(mitFormular).toEqual(['zeiten/[id]/einwand/page.tsx']);
  });

  it('und dieses Formular zeigt auf die vorhandene Einwandroute, nicht auf eine zweite', () => {
    const quelle = readFileSync(
      join(MEIN, 'zeiten/[id]/einwand/page.tsx'), 'utf8');
    expect(quelle).toContain('action="/api/zeit/einwand"');
  });

  it('keine Seite unter `/portal/mein` ruft eine Schreibfunktion der Zeitdomaene', () => {
    const verdaechtig: string[] = [];
    for (const d of dateien(MEIN)) {
      const inhalt = ohneKommentare(readFileSync(d, 'utf8'));
      // Der Einwand ist der einzige erlaubte Import aus dieser Familie, und er
      // wird in der SEITE nur gelesen (`listeEigeneEinwaende`).
      if (/\b(korrigiereZeiteintrag|beendeZeiteintrag|starteZeiteintrag|entscheideEinwand)\b/u
        .test(inhalt)) {
        verdaechtig.push(d.replace(`${WURZEL}/`, ''));
      }
    }
    expect(verdaechtig).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('(4) die Feldwache kennt ihre eigenen Falschtreffer (K-05)', () => {
  it('erkennt ein Entgeltfeld, auch mit harmlosem Namen', () => {
    for (const name of [
      'stundensatz', 'stundensatzIntern', 'satz', 'tarifgruppe', 'entgeltCent',
      'preis', 'einzelpreisCent', 'betragCent', 'nettoCent', 'kundeId',
      'rechnungsnummer', 'marge', 'kondition',
    ]) {
      expect(istVerbotenesFeld(name), name).toBe(true);
    }
  });

  it('und laesst die deutschen Fachwoerter durch, die „satz" enthalten', () => {
    /**
     * Der Grund, aus dem die Wache Woerter vergleicht und keine Teilketten:
     * `einsatz`, `zusatz` und `ansatz` sind vier Falschtreffer, und eine
     * Wache mit Falschtreffern wird abgeschaltet.
     */
    for (const name of [
      'einsatzId', 'einsatzStatus', 'blockiertEinsatz', 'zusatzTage',
      'rechenansatz', 'nettoMinuten', 'bruttoMinuten', 'anteilNettoMinuten',
      'pauseMinuten', 'zeitabweichungBeginnSek', 'sollMinuten',
    ]) {
      expect(istVerbotenesFeld(name), name).toBe(false);
    }
  });

  it('zerlegt Binnengrossschreibung und Unterstriche gleich', () => {
    expect(feldWoerter('anteilBruttoMinuten')).toEqual(['anteil', 'brutto', 'minuten']);
    expect(feldWoerter('anteil_brutto_minuten')).toEqual(['anteil', 'brutto', 'minuten']);
  });

  it('`netto` ohne Zeiteinheit ist verboten, mit Zeiteinheit erlaubt', () => {
    // Die eine Regel, an der die Wache haengt: eine Schicht hat netto und
    // brutto in MINUTEN, eine Rechnung in Cent.
    expect(istVerbotenesFeld('nettoBetrag')).toBe(true);
    expect(istVerbotenesFeld('netto')).toBe(true);
    expect(istVerbotenesFeld('nettoMinuten')).toBe(false);
  });

  it('jede festgeschriebene Feldliste ist selbst sauber', () => {
    const verdaechtig: string[] = [];
    for (const [name, felder] of Object.entries(MITARBEITER_NUTZLASTEN)) {
      expect(felder.length, name).toBeGreaterThan(0);
      expect(new Set(felder).size, `${name} hat doppelte Felder`).toBe(felder.length);
      for (const f of felder) if (istVerbotenesFeld(f)) verdaechtig.push(`${name}.${f}`);
    }
    expect(verdaechtig).toEqual([]);
  });

  it('die Wortliste ist nicht leer — sonst bestuende die Probe ueber nichts', () => {
    expect(GELD_WOERTER.length).toBeGreaterThan(5);
    expect(GELD_WOERTER).toContain('stundensatz');
  });

  it('JEDE `*_FELDER`-Liste unter `services/mitarbeiter/` steht in MITARBEITER_NUTZLASTEN', async () => {
    /**
     * **Die Luecke, die diese Probe schliesst.** `SCHICHT_NACHWEIS_FELDER` und
     * `SCHICHT_MEDIUM_FELDER` waren exportiert, aber nicht eingetragen — also
     * prueften weder die Wortprobe oben noch der Feldvergleich in
     * `tests/isolation/mitarbeiter.test.ts` sie je. Nichts zaehlte die
     * Exporte auf, und deshalb fiel es nicht auf: die Datei lief mit 20 von 21
     * gruen, ohne die zwei anzufassen.
     *
     * Verglichen werden die LISTEN selbst und nicht ihre Namen: der Schluessel
     * im Register darf anders heissen als die Konstante, aber die Liste dahinter
     * muss dieselbe sein.
     */
    const verzeichnis = join(WURZEL, 'src/server/services/mitarbeiter');
    const dateien = readdirSync(verzeichnis)
      .filter((d) => d.endsWith('.ts') && d !== 'felder.ts');
    const eingetragen = new Set<readonly string[]>(Object.values(MITARBEITER_NUTZLASTEN));
    const fehlend: string[] = [];
    let gesehen = 0;

    for (const datei of dateien) {
      const modul = await import(join(verzeichnis, datei)) as Record<string, unknown>;
      for (const [name, wert] of Object.entries(modul)) {
        if (!name.endsWith('_FELDER') || !Array.isArray(wert)) continue;
        gesehen += 1;
        if (!eingetragen.has(wert as readonly string[])) fehlend.push(`${datei}:${name}`);
      }
    }

    // Ohne diese Zeile bestuende die Probe auf einer leeren Menge.
    expect(gesehen).toBeGreaterThan(5);
    expect(
      fehlend,
      'Jede exportierte *_FELDER-Liste gehoert in MITARBEITER_NUTZLASTEN (K-05) — '
      + 'sonst prueft die Wortprobe sie nie.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('die Seiten der Seitenkarte gibt es wirklich', () => {
  /** Die Routen, die dieser PR baut — Pfad fuer Pfad aus §7. */
  const GEBAUT: readonly string[] = [
    '/portal/mein',
    '/portal/mein/schichten',
    '/portal/mein/schichten/[zuordnungId]',
    '/portal/mein/zeiten',
    '/portal/mein/zeiten/[id]',
    '/portal/mein/zeiten/[id]/einwand',
    '/portal/mein/stundenkonto',
    '/portal/mein/monatsnachweis',
    '/portal/mein/urlaub',
    '/portal/mein/antraege',
    '/portal/mein/antraege/neu',
    '/portal/mein/abwesenheit/neu',
    '/portal/mein/nachweise',
    '/portal/mein/dienstanweisungen',
    '/portal/mein/dienstanweisungen/[id]',
  ];

  it('jede gebaute Route steht in der Seitenkarte', () => {
    const fehlend = GEBAUT.filter((p) => !ROUTEN.some((r) => r.pfad === p));
    expect(fehlend).toEqual([]);
  });

  it('und jede hat eine Seitendatei im App-Router-Baum', () => {
    const vorhanden = new Set(
      dateien(MEIN)
        .filter((d) => d.endsWith('page.tsx'))
        .map((d) => `/portal/mein${d.slice(MEIN.length).replace(/\/page\.tsx$/u, '')}`)
        .map((p) => (p === '/portal/mein' ? p : p)),
    );
    const fehlend = GEBAUT.filter((p) => !vorhanden.has(p));
    expect(fehlend).toEqual([]);
  });

  it('jede gebaute Route ist Selbstzugriff oder das eine Meldungsrecht', () => {
    for (const p of GEBAUT) {
      const r = findeRoute(p);
      expect(r, p).toBeDefined();
      const bewachung = r!.bewachung;
      if (bewachung.art === 'recht') {
        // Genau eine Ausnahme, und sie steht in §7: die Abwesenheitsmeldung.
        expect(bewachung.lesen, p).toEqual(['zeit.abwesenheit_melden']);
      } else {
        expect(bewachung.art, p).toBe('selbst');
      }
    }
  });

  it('der Scope jeder gebauten Route ist PER oder PER→M1 — nie M1 und nie GRP', () => {
    for (const p of GEBAUT) {
      const r = findeRoute(p);
      expect(['PER', 'PER→M1'], `${p}: ${r?.scope ?? '—'}`).toContain(r?.scope);
    }
  });

  it('die Tab-Leiste des Portals fuehrt fuenf Ziele, und alle fuehren irgendwohin', () => {
    const leiste = tableiste('mitarbeiter');
    expect(leiste.ziele).toHaveLength(5);
    for (const z of leiste.ziele) {
      const ziel = z.pfad.startsWith('/')
        ? z.pfad
        : (z.pfad === '' ? '/portal/mein' : `/portal/mein/${z.pfad}`);
      // Ein Menuepunkt, der auf 404 fuehrt, ist schlechter als keiner.
      expect(findeRoute(ziel), ziel).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------

describe('das Dienstregister kennt die Dienste des Portals', () => {
  it('jeder Dienst unter `mitarbeiter/` ist eingetragen', () => {
    const imBaum = readdirSync(join(WURZEL, 'src/server/services/mitarbeiter'))
      .filter((d) => d.endsWith('.ts'))
      .map((d) => `mitarbeiter/${d.replace(/\.ts$/u, '')}`);
    const bekannt = new Set(DIENSTE.map((d) => d.pfad));
    expect(imBaum.filter((p) => !bekannt.has(p))).toEqual([]);
  });

  it('und KEINER davon schreibt', () => {
    /**
     * Die Zusage von EMP-07 und K-18 als Eigenschaft des Registers: die
     * Schreibwege des Menschen sind der Einwand, der Antrag und die
     * Abwesenheitsmeldung — alle drei in bereits eingetragenen Fachdiensten.
     * Ein vierter, im Portaldienst angelegter waere genau der, der an ihnen
     * vorbeifuehrt.
     */
    const schreibend = DIENSTE
      .filter((d) => d.pfad.startsWith('mitarbeiter/') && d.schreibend)
      .map((d) => d.pfad);
    expect(schreibend).toEqual([]);
  });
});
