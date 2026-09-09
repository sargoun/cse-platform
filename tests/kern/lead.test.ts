/**
 * PR 17 — die reinen Entscheidungen: SLA, Eskalationsfenster, Feldvertrag.
 *
 * Sie stehen hier und nicht in der Isolationssuite, weil sie keine Datenbank
 * brauchen — und weil "hoechstens einmal je Stunde" sich nur pruefen laesst,
 * wenn die Uhr ein Argument ist.
 */
import { describe, expect, it } from 'vitest';
import { entscheideEskalation, slaFrist, SlaFehler } from '../../src/server/services/lead/sla.js';
import { eingabeSchema, Felder, fehlerAbbilden, type FormularFeld }
  from '../../src/lib/formular/schema.js';
import { istBot, ipHash, leadnummerAus } from '../../src/server/services/lead/annahme.js';
import { bestaetigungNutzlast } from '../../src/server/services/lead/bestaetigung.js';
import { gate } from '../../src/server/agent/policy.js';
import { FORMULARE } from '../../src/server/db/seed/formulare.js';

const T = (iso: string): Date => new Date(iso);

describe('die SLA-Frist wird gerechnet, nicht geraten', () => {
  it('eingegangen + Stunden, in UTC', () => {
    expect(slaFrist(T('2026-03-02T10:00:00Z'), 24)?.toISOString())
      .toBe('2026-03-03T10:00:00.000Z');
  });

  it('ohne sla_stunden gibt es KEINE Frist — und keine erfundene', () => {
    // Ein manuell erfasster Lead hat nichts zu erben (O-14). Eine erfundene
    // Frist wäre schlimmer als keine: der Eskalationsjob nimmt sie ernst.
    expect(slaFrist(T('2026-03-02T10:00:00Z'), null)).toBeNull();
  });

  it('die Frist überspringt die Sommerzeit-Umstellung korrekt', () => {
    // 2026-03-29 ist die Nacht der Vorstellung in Europe/Berlin. Gerechnet
    // wird auf UTC-Instanten (Invariante 2), also sind 24 Stunden 24 Stunden —
    // die Berliner Wanduhr zeigt danach eine Stunde später.
    const frist = slaFrist(T('2026-03-28T23:00:00Z'), 24)!;
    expect(frist.toISOString()).toBe('2026-03-29T23:00:00.000Z');
    expect(frist.getTime() - T('2026-03-28T23:00:00Z').getTime()).toBe(24 * 3_600_000);
  });

  it('eine unsinnige Stundenzahl wirft, statt still zu rechnen', () => {
    expect(() => slaFrist(T('2026-03-02T10:00:00Z'), 0)).toThrow(SlaFehler);
    expect(() => slaFrist(T('2026-03-02T10:00:00Z'), -5)).toThrow(SlaFehler);
    expect(() => slaFrist(T('2026-03-02T10:00:00Z'), 1.5)).toThrow(SlaFehler);
  });
});

describe('(2) eskaliert wird HÖCHSTENS EINMAL je Stunde', () => {
  const basis = {
    slaFristAm: T('2026-03-02T10:00:00Z'),
    ersteReaktionAm: null,
    zuletztEskaliertAm: null,
    eskalationsstufe: 0,
  };

  it('vor der Frist passiert nichts', () => {
    expect(entscheideEskalation(basis, T('2026-03-02T09:59:00Z')).eskalieren).toBe(false);
  });

  it('nach der Frist wird eskaliert, Stufe 1', () => {
    const e = entscheideEskalation(basis, T('2026-03-02T10:00:01Z'));
    expect(e.eskalieren).toBe(true);
    expect(e.neueStufe).toBe(1);
  });

  it('ein zweiter Lauf in derselben Stunde sendet NICHTS', () => {
    // Ohne diese Sperre schickt ein wiederholter Job dieselbe Eskalation
    // mehrfach — und wer stündlich dieselbe Mail bekommt, filtert sie weg.
    const nach = { ...basis, zuletztEskaliertAm: T('2026-03-02T10:00:01Z'), eskalationsstufe: 1 };
    expect(entscheideEskalation(nach, T('2026-03-02T10:30:00Z')).eskalieren).toBe(false);
    expect(entscheideEskalation(nach, T('2026-03-02T10:59:59Z')).eskalieren).toBe(false);
  });

  it('eine Stunde später wieder — Stufe 2', () => {
    const nach = { ...basis, zuletztEskaliertAm: T('2026-03-02T10:00:01Z'), eskalationsstufe: 1 };
    const e = entscheideEskalation(nach, T('2026-03-02T11:00:02Z'));
    expect(e.eskalieren).toBe(true);
    expect(e.neueStufe).toBe(2);
  });

  it('eine erfasste erste Reaktion hält die Uhr an', () => {
    const reagiert = { ...basis, ersteReaktionAm: T('2026-03-02T09:00:00Z') };
    expect(entscheideEskalation(reagiert, T('2026-03-05T00:00:00Z')).eskalieren).toBe(false);
  });

  it('ohne Frist wird nie eskaliert', () => {
    expect(entscheideEskalation({ ...basis, slaFristAm: null }, T('2030-01-01T00:00:00Z'))
      .eskalieren).toBe(false);
  });
});

describe('der Feldvertrag ist die EINE Quelle — Definition, Rendern, Annahme', () => {
  const felder = FORMULARE.find((f) => f.slug === 'reinigung')!.felder;

  it('jede Seed-Definition hält den Vertrag', () => {
    for (const f of FORMULARE) {
      expect(Felder.safeParse(f.felder).success, f.slug).toBe(true);
    }
  });

  it('jedes Feld trägt eine SPEZIFISCHE Fehlermeldung (WCAG 3.3.1/3.3.3)', () => {
    for (const f of FORMULARE) {
      for (const feld of f.felder) {
        expect(feld.fehlermeldung.length, `${f.slug}.${feld.schluessel}`).toBeGreaterThan(10);
        // "Ungültig" sagt niemandem, was zu tun ist.
        expect(feld.fehlermeldung.toLowerCase()).not.toBe('ungültig');
      }
    }
  });

  it('die persönlichen Felder tragen ein autocomplete-Token (WCAG 1.3.5)', () => {
    const mit = new Map(felder.map((f) => [f.schluessel, f.autocomplete]));
    expect(mit.get('email')).toBe('email');
    expect(mit.get('telefon')).toBe('tel');
    expect(mit.get('name')).toBe('name');
  });

  it('eine gültige Einsendung geht durch', () => {
    const ergebnis = eingabeSchema(felder).safeParse({
      gebaeudetyp: 'buero', flaeche_qm: '250.5', anzahl_objekte: '2',
      frequenz: 'woechentlich', wunsch_start: '2026-10-01',
      firma: 'Muster GmbH', name: 'A. Muster', email: 'a@muster.test',
      telefon: '+49 30 1', nachricht: 'Bitte um Angebot.',
      datenschutz_hinweis: 'on', einwilligung_werbung: 'on',
    });
    expect(ergebnis.success).toBe(true);
  });

  it('ein FELD, DAS NICHT IN DER DEFINITION STEHT, wird abgewiesen (SEC-A4)', () => {
    // Sonst wäre `daten` ein Ablageort für alles, was jemand an die Route
    // schickt — und die Auswertung liest später Felder, die nie gefragt wurden.
    const ergebnis = eingabeSchema(felder).safeParse({
      gebaeudetyp: 'buero', flaeche_qm: '1', anzahl_objekte: '1',
      frequenz: 'taeglich', wunsch_start: '2026-10-01',
      firma: 'M', name: 'A', email: 'a@b.test', telefon: '+49',
      datenschutz_hinweis: 'on',
      rolle: 'super_admin',
    });
    expect(ergebnis.success).toBe(false);
  });

  it('ein unbekannter Auswahlwert wird abgewiesen', () => {
    const ergebnis = eingabeSchema(felder).safeParse({
      gebaeudetyp: 'raumstation', flaeche_qm: '1', anzahl_objekte: '1',
      frequenz: 'taeglich', wunsch_start: '2026-10-01',
      firma: 'M', name: 'A', email: 'a@b.test', telefon: '+49',
      datenschutz_hinweis: 'on',
    });
    expect(ergebnis.success).toBe(false);
  });

  it('die Fehlermeldung kommt aus der DEFINITION, nicht von Zod', () => {
    const ergebnis = eingabeSchema(felder).safeParse({ email: 'kein-email' });
    expect(ergebnis.success).toBe(false);
    const abgebildet = fehlerAbbilden(felder, ergebnis.error!);
    const email = felder.find((f) => f.schluessel === 'email')!;
    expect(abgebildet['email']).toBe(email.fehlermeldung);
    // Zods Meldung ist englisch und beschreibt einen Typfehler.
    expect(abgebildet['email']).not.toMatch(/invalid/iu);
  });

  it('das Dateifeld steht NICHT im Eingabeschema — eine Datei ist kein JSON-Wert', () => {
    const bau = FORMULARE.find((f) => f.slug === 'bau')!.felder as readonly FormularFeld[];
    const ergebnis = eingabeSchema(bau).safeParse({
      gewerk: 'hochbau', volumen: 'x', fertigstellung_bis: '2027-01-01',
      firma: 'M', name: 'A', email: 'a@b.test', telefon: '+49',
      datenschutz_hinweis: 'on',
      lv_datei: 'irgendwas',
    });
    // `lv_datei` ist ein unbekanntes Feld für das Eingabeschema — abgewiesen.
    expect(ergebnis.success).toBe(false);
  });
});

describe('Honigtopf und IP-Hash', () => {
  it('ein ausgefülltes verstecktes Feld ist ein Bot', () => {
    expect(istBot('http://spam.test')).toBe(true);
    expect(istBot('')).toBe(false);
    expect(istBot(undefined)).toBe(false);
  });

  it('der IP-Hash ist gepfeffert — ohne Pfeffer wirft er', () => {
    // Vier Milliarden IPv4-Hashes sind an einem Nachmittag gerechnet: ein
    // ungepfefferter Hash ist kein Schutz, sondern eine Behauptung.
    expect(() => ipHash('1.2.3.4', '')).toThrow();
    const a = ipHash('1.2.3.4', 'pfeffer');
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(a).not.toBe(ipHash('1.2.3.4', 'anderer'));
    expect(a).toBe(ipHash('1.2.3.4', 'pfeffer'));
  });

  it('die Leadnummer benutzt NICHT den Rechnungskreis', () => {
    // K-12s lückenlose Kette gehört Rechnungen. Sie von aussen auslösbar zu
    // machen, wäre der teuerste Weg, eine Leadnummer zu bekommen.
    const nummer = leadnummerAus('0f4c1b2a-3d4e-5f60-7a8b-9c0d1e2f3a4b');
    expect(nummer).toMatch(/^L-[0-9A-F]{10}$/u);
  });
});

describe('(3) die Eingangsbestätigung geht durch das Gate — auch sie', () => {
  const nutzlast = bestaetigungNutzlast({
    mandantId: 'm1', empfaenger: 'a@b.test', firma: 'CSE',
    leadnummer: 'L-1', slaFristAm: T('2026-03-03T10:00:00Z'),
  });

  it('ohne Richtlinie und ohne Freigabe wird NICHT gesendet (fail-closed)', () => {
    const ergebnis = gate(nutzlast, null, null);
    expect(ergebnis.erlaubt).toBe(false);
  });

  it('sie enthält keine Werbung — § 7 UWG trennt Antwort und Angebot', () => {
    const text = String((nutzlast.inhalt as Record<string, unknown>)['text']);
    expect(text).toContain('L-1');
    expect(text.toLowerCase()).not.toContain('unsere weiteren leistungen');
  });

  it('sie nennt die zugesagte Frist, wenn es eine gibt', () => {
    expect(String((nutzlast.inhalt as Record<string, unknown>)['text'])).toContain('2026-03-03');
    const ohne = bestaetigungNutzlast({
      mandantId: 'm1', empfaenger: 'a@b.test', firma: 'CSE',
      leadnummer: 'L-1', slaFristAm: null,
    });
    // Ohne Frist wird keine behauptet.
    expect(String((ohne.inhalt as Record<string, unknown>)['text']))
      .toContain('so bald wie möglich');
  });
});
