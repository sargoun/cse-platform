/**
 * Das Routen-Manifest — die Liste, über die PR 19 alles andere prüft.
 *
 * **Wenn sie falsch ist, bestehen alle folgenden Prüfungen umsonst.** Eine
 * Aufzählungsprobe über eine leere oder halbe Liste läuft grün durch und sagt
 * nichts. Deshalb steht hier zuerst, dass die Liste vollständig, eindeutig und
 * gegen den Rechtekatalog auflösbar ist — und erst dann darf sie irgendwo
 * anders die Rolle des Maßstabs spielen.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ROUTEN, familie, findeRoute, leserechte, routeMitPfad, routenIn, routenMitScope,
} from '../../src/server/registry/routen.js';
import { SCOPES, pfadeAus, zerlegeBewachung } from '../../scripts/seitenkarte/extrahiere.js';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';
import { ANGEBOT_PFAD } from '../../src/lib/formular/bereiche.js';

const WURZEL = resolve(import.meta.dirname, '../..');

describe('das Manifest ist überhaupt eines', () => {
  it('führt Hunderte Routen, nicht eine Handvoll', () => {
    // Die Karte hat 34 Routentabellen. Eine Zahl in dieser Grössenordnung ist
    // der Unterschied zwischen "ausgelesen" und "eine Tabelle erwischt".
    expect(ROUTEN.length).toBeGreaterThan(400);
  });

  it('kein Pfad steht zweimal', () => {
    const zaehler = new Map<string, number>();
    for (const r of ROUTEN) zaehler.set(r.pfad, (zaehler.get(r.pfad) ?? 0) + 1);
    const doppelt = [...zaehler].filter(([, n]) => n > 1).map(([p]) => p);
    // Zwei Zeilen für einen Pfad hiessen zwei Bedingungen für eine Seite —
    // und die Rollenprobe prüfte die eine, während die Seite die andere führt.
    expect(doppelt).toEqual([]);
  });

  it('jeder Pfad beginnt mit / und trägt keine Backticks oder Kommata', () => {
    const krumm = ROUTEN.map((r) => r.pfad)
      .filter((p) => !p.startsWith('/') || /[`,\s]/u.test(p));
    expect(krumm).toEqual([]);
  });

  it('jedes Scope-Token ist eines der zehn aus §1.3', () => {
    const fremd = [...new Set(ROUTEN.map((r) => r.scope))]
      .filter((s) => !SCOPES.includes(s));
    // Ein unbekanntes Token ist eine Route, die die Datenbank ausserhalb der
    // vier Scopes und des K-08-Registers erreicht.
    expect(fremd).toEqual([]);
  });

  it('jede Phase ist eine Zahl zwischen 1 und 10', () => {
    const krumm = ROUTEN.filter((r) => !Number.isInteger(r.phase) || r.phase < 1 || r.phase > 10);
    expect(krumm.map((r) => `${r.pfad} → ${String(r.phase)}`)).toEqual([]);
  });
});

describe('jedes genannte Recht existiert im Katalog (K-19)', () => {
  const bekannt = new Set(KATALOG.map((k) => k.schluessel));

  it('kein Leserecht ohne Katalogzeile', () => {
    const fehlend = new Map<string, string>();
    for (const r of ROUTEN) for (const s of leserechte(r)) {
      if (!bekannt.has(s)) fehlend.set(s, r.pfad);
    }
    /**
     * `app.hat_recht` antwortet auf einen unbekannten Schlüssel `false` —
     * dauerhaft und ohne Fehlermeldung. Eine Route, deren Recht hier fehlt,
     * ist für JEDE Rolle ein leerer Bildschirm, `super_admin` eingeschlossen.
     * Genau so fehlten `agent.*`, `wissen.*` und `freigabe.*` vollständig,
     * und mit `freigabe.*` der Freigabe-Posteingang aus Invariante 7.
     */
    expect([...fehlend].map(([s, p]) => `${s} (${p})`)).toEqual([]);
  });

  it('auch kein Schreibrecht ohne Katalogzeile', () => {
    const fehlend = new Set<string>();
    for (const r of ROUTEN) {
      const b = r.bewachung;
      const schreiben = b.art === 'recht' || b.art === 'selbst' ? b.schreiben : [];
      for (const s of schreiben) if (!bekannt.has(s)) fehlend.add(s);
    }
    expect([...fehlend]).toEqual([]);
  });

  it('kein Schlüssel beginnt mit einem Punkt', () => {
    // `.schreiben` ist in der Karte die Kurzform für "dasselbe Modul". Wörtlich
    // übernommen wäre es ein Schlüssel, den `hat_recht` nie beantwortet.
    const krumm = ROUTEN.flatMap((r) => {
      const b = r.bewachung;
      return b.art === 'recht' ? [...b.lesen, ...b.schreiben]
        : b.art === 'selbst' ? [...b.schreiben] : [];
    }).filter((s) => s.startsWith('.'));
    expect(krumm).toEqual([]);
  });
});

describe('die Bewachung wird richtig gelesen, nicht nur vollständig', () => {
  it('`a + b` verlangt beide zum Ansehen', () => {
    const b = zerlegeBewachung('`bericht.lesen` + `finanzen.lesen`');
    expect(b).toEqual({
      art: 'recht', lesen: ['bericht.lesen', 'finanzen.lesen'], schreiben: [], aal2: false,
    });
  });

  it('`a / b` trennt Ansehen von Tun', () => {
    const b = zerlegeBewachung('`dienstplan.lesen` / `dienstplan.schreiben`');
    expect(b).toEqual({
      art: 'recht', lesen: ['dienstplan.lesen'], schreiben: ['dienstplan.schreiben'], aal2: false,
    });
  });

  it('die Klammer ist NIE die Sehbedingung', () => {
    const b = zerlegeBewachung('`crm_entgelt.lesen` (+ `crm.schreiben` to edit)');
    expect(b).toEqual({
      art: 'recht', lesen: ['crm_entgelt.lesen'], schreiben: ['crm.schreiben'], aal2: false,
    });
  });

  it('`.schreiben` erbt das Modul des ersten Schlüssels', () => {
    const b = zerlegeBewachung('`dienstanweisung.lesen` / `.schreiben`');
    expect(b).toEqual({
      art: 'recht', lesen: ['dienstanweisung.lesen'],
      schreiben: ['dienstanweisung.schreiben'], aal2: false,
    });
  });

  it('`aal2` in der Zelle wird erkannt (K-15)', () => {
    const b = zerlegeBewachung(
      '`system.rolle_lesen` / `system.rolle_verwalten` (**write requires `aal2`**, K-15)',
    );
    expect(b.art === 'recht' && b.aal2).toBe(true);
  });

  it('`S` ist Selbstzugriff und trägt kein Leserecht', () => {
    expect(zerlegeBewachung('`S`')).toEqual({ art: 'selbst', schreiben: [] });
    expect(zerlegeBewachung('`S` (`wachbuch.schreiben` for others)'))
      .toEqual({ art: 'selbst', schreiben: ['wachbuch.schreiben'] });
  });

  it('`—` ist offen, `Sitzung` ist angemeldet, ein Token ist keines von beiden', () => {
    expect(zerlegeBewachung('—')).toEqual({ art: 'offen' });
    expect(zerlegeBewachung('`Sitzung`')).toEqual({ art: 'sitzung' });
    expect(zerlegeBewachung('**token only, no login**')).toEqual({ art: 'token' });
  });

  it('eine Zelle, die niemand deuten kann, wirft — statt still offen zu stehen', () => {
    // Eine unverstandene Zelle als `offen` durchzulassen wäre die schlimmste
    // Vorgabe: die Route stünde für jeden offen, und niemand sähe es.
    expect(() => zerlegeBewachung('irgendein Freitext')).toThrow();
  });
});

describe('Geschwisterpfade einer Zeile werden entfaltet', () => {
  it('`…/serien` , `/neu` , `/[id]` sind DREI Routen', () => {
    expect(pfadeAus('| `/portal/[mandant]/dienstplan/serien` , `/neu` , `/[id]` — RRULE'))
      .toEqual([
        '/portal/[mandant]/dienstplan/serien',
        '/portal/[mandant]/dienstplan/serien/neu',
        '/portal/[mandant]/dienstplan/serien/[id]',
      ]);
  });

  it('und sie stehen wirklich im Manifest', () => {
    // Ohne die Entfaltung fehlten 61 Routen — darunter fast jede Detailseite,
    // also genau die Seiten, auf denen eine fremde Zeile stünde.
    for (const p of [
      '/portal/[mandant]/dienstplan/serien/[id]',
      '/portal/kunde/rechnungen/[id]',
      '/portal/mein/dokumente/[id]',
      '/portal/[mandant]/buchhaltung/bank/[auszugId]',
    ]) expect(routeMitPfad(p), p).toBeDefined();
  });
});

describe('eine konkrete URL findet ihre Route', () => {
  it('ein Parameter nimmt genau ein Segment', () => {
    expect(findeRoute('/portal/reinigung/crm/kunden/7f3a')?.pfad)
      .toBe('/portal/[mandant]/crm/kunden/[id]');
  });

  it('die SPEZIFISCHERE Route gewinnt — /neu ist nicht /[id]', () => {
    /**
     * Ohne diese Regel liefe die Anlegen-Seite unter dem Leserecht der
     * Detailseite: `crm.lesen` statt `crm.schreiben`. Die Route stünde dann
     * für jeden offen, der Kunden ansehen darf.
     */
    expect(findeRoute('/portal/reinigung/crm/kunden/neu')?.pfad)
      .toBe('/portal/[mandant]/crm/kunden/neu');
    expect(leserechte(findeRoute('/portal/reinigung/crm/kunden/neu')!))
      .toEqual(['crm.schreiben']);
  });

  it('ein Segment zu viel passt NICHT — Muster sind nicht Präfixe', () => {
    expect(findeRoute('/portal/reinigung/crm/kunden/7f3a/geheim')).toBeUndefined();
  });

  it('eine unbekannte URL ist undefined und nicht die erste beste', () => {
    expect(findeRoute('/portal/reinigung/gibtesnicht')).toBeUndefined();
  });
});

describe('die Portalfamilien trennen sauber', () => {
  it('jede Familie hat Routen, und keine liegt in der falschen', () => {
    expect(routenIn('mandant').length).toBeGreaterThan(200);
    expect(routenIn('mein').length).toBeGreaterThan(10);
    expect(routenIn('kunde').length).toBeGreaterThan(10);
    expect(routenIn('gruppe').length).toBeGreaterThan(10);

    // `/portal/kunde` beginnt mit `/portal/`, ist aber kein Mandantenpfad.
    // Wer nur auf das Präfix prüft, gibt einem Kunden die Mandanten-Shell.
    expect(familie('/portal/kunde/rechnungen')).toBe('kunde');
    expect(familie('/portal/mein/stundenkonto')).toBe('mein');
    expect(familie('/portal/gruppe/finanzen')).toBe('gruppe');
    expect(familie('/portal/konto/sicherheit')).toBe('konto');
    expect(familie('/portal/reinigung/crm')).toBe('mandant');
  });

  it('das Mitarbeiterportal liest im Personen-Scope, nie in der Gruppe (K-18)', () => {
    const fremd = routenIn('mein').filter((r) => r.scope === 'GRP');
    /**
     * Die Gruppenpolicy verlangt `gruppe.<modul>.lesen` — ein Recht, das kein
     * `mitarbeiter` hält. Über den Gruppen-Scope gelesen bliebe das
     * Mitarbeiterportal LEER, nicht verboten: kein Fehler, keine Meldung,
     * nur nichts.
     */
    expect(fremd.map((r) => r.pfad)).toEqual([]);
  });

  it('das Kundenportal ebenso', () => {
    expect(routenIn('kunde').filter((r) => r.scope === 'GRP').map((r) => r.pfad)).toEqual([]);
  });

  it('jede Gruppenroute ist lesend — es gibt keinen Schreib-Scope dort (Inv. 10)', () => {
    const schreibend = routenIn('gruppe').filter((r) => r.scope !== 'GRP' && r.scope !== 'USR');
    expect(schreibend.map((r) => `${r.pfad} → ${r.scope}`)).toEqual([]);
  });

  it('kein Mandantenpfad liegt im Personen- oder Kunden-Scope ohne Not', () => {
    const fremd = routenMitScope('KDN').filter((r) => familie(r.pfad) !== 'kunde');
    expect(fremd.map((r) => r.pfad)).toEqual([]);
  });
});

describe('die erzeugte Datei ist aktuell', () => {
  it('`pnpm seitenkarte --check` läuft durch', () => {
    /**
     * Veraltet heisst: die Rollenprobe läuft über eine Routenliste, die es so
     * nicht mehr gibt. Sie bestünde — über nichts.
     */
    expect(() => execFileSync(join(WURZEL, 'node_modules/.bin/tsx'),
      [join(WURZEL, 'scripts/seitenkarte/extrahiere.ts'), '--check'],
      { cwd: WURZEL, encoding: 'utf8' })).not.toThrow();
  });
});

describe('die gebaute Anwendung und die Karte widersprechen sich nicht', () => {
  /**
   * **Die Prüfung, die den Widerspruch gefunden hat.**
   *
   * `OEFFENTLICHE_ROUTEN` sagt, welche Adressen die Anwendung WIRKLICH
   * ausliefert; `routen.generiert.ts` sagt, welche `04-SEITENKARTE.md`
   * VORSIEHT. Beide sind legitim — die eine ist der Bestand, die andere der
   * Plan. Nicht legitim ist eine ausgelieferte Adresse, die im Plan anders
   * heisst: dann zeigt jeder Verweis der Karte ins Leere, und das Routen-Tor,
   * das gegen den Plan entscheidet, beantwortet die ausgelieferte Adresse mit
   * `unbekannt` — also 404.
   *
   * Genau das war der Fall. PR 16 lieferte die Unternehmensprofile unter
   * `/reinigung` statt `/unternehmen/[bereich]`, PR 17 das Angebotsformular
   * unter `/anfrage/[bereich]` statt `/angebot/[bereich]`. Beides fiel
   * niemandem auf, weil das Tor damals noch nicht existierte und beide
   * Fassungen für sich funktionierten.
   */

  /** Die Routenmuster, die der App-Router öffentlich ausliefert. */
  function geliefertePfade(): readonly string[] {
    const gefunden: string[] = [];
    const gehe = (verzeichnis: string, pfad: string): void => {
      for (const e of readdirSync(verzeichnis, { withFileTypes: true })) {
        if (!e.isDirectory()) {
          if (e.name === 'page.tsx') gefunden.push(pfad === '' ? '/' : pfad);
          continue;
        }
        // Routengruppen `(public)` erscheinen nicht in der URL.
        const naechster = e.name.startsWith('(') && e.name.endsWith(')')
          ? pfad : `${pfad}/${e.name}`;
        gehe(join(verzeichnis, e.name), naechster);
      }
    };
    gehe(resolve(WURZEL, 'src/app'), '');
    return gefunden.filter((p) =>
      // Entwicklungsflächen (D-81) verschwinden mit PR 20; der englische Zweig
      // ist dieselbe Route mit Sprachpräfix (D-82).
      !/^\/dev(\/|$)/u.test(p) && !/^\/en(\/|$)/u.test(p));
  }

  /** Passt eine Adresse auf ein Muster? `[x]` nimmt genau ein Segment. */
  function passt(muster: string, adresse: string): boolean {
    const m = muster.split('/').filter((x) => x !== '');
    const a = adresse.split('/').filter((x) => x !== '');
    return m.length === a.length
      && m.every((seg, i) => /^\[.+\]$/u.test(seg) || seg === a[i]);
  }

  it('jede ausgelieferte öffentliche Adresse steht so auch in der Karte', () => {
    expect(OEFFENTLICHE_ROUTEN.length, 'es gibt überhaupt Routen').toBeGreaterThan(10);
    /**
     * `findeRoute` und nicht `routeMitPfad`: die Karte führt Muster
     * (`/unternehmen/[bereich]`), die Anwendung liefert Adressen
     * (`/unternehmen/reinigung`). Ein Vergleich auf Gleichheit meldete beide
     * als Widerspruch, obwohl sie dasselbe meinen.
     */
    const fehlend = OEFFENTLICHE_ROUTEN
      .map((r) => r.pfad)
      .filter((p) => findeRoute(p) === undefined);
    expect(fehlend).toEqual([]);
  });

  it('auch das Angebotsformular — es ist der Kanal, auf dem Umsatz ankommt', () => {
    expect(routeMitPfad(ANGEBOT_PFAD)).toBeDefined();
    expect(findeRoute('/angebot/reinigung')?.pfad).toBe(ANGEBOT_PFAD);
  });

  it('und jede Adresse, die die Karte für Phase 2 zusagt, wird ausgeliefert', () => {
    /**
     * Die Gegenrichtung. Ohne sie hiesse "kein Widerspruch" auch dann ja, wenn
     * die Anwendung die halbe Karte nicht ausliefert — und eine Karte, deren
     * Phase-2-Zeilen 404 geben, ist keine Karte, sondern eine Absicht.
     */
    const muster = geliefertePfade();
    expect(muster.length, 'der Router liefert überhaupt Seiten').toBeGreaterThan(5);

    const versprochen = ROUTEN.filter((r) =>
      r.phase <= 2 && familie(r.pfad) === 'oeffentlich'
      && r.bewachung.art !== 'infrastruktur'
      // Die Maschinenflächen sind `route.ts` und keine Seiten.
      && !/^\/(robots\.txt|sitemap\.xml|llms\.txt|healthz)$/u.test(r.pfad));

    const offen = versprochen
      .map((r) => r.pfad)
      .filter((p) => !muster.some((m) => passt(m, p)))
      .sort();

    /**
     * Was hier steht, ist bewusst offen — und steht im Test, nicht in einer
     * Notiz, die niemand liest. Jede Zeile hängt an einem Modul, das noch
     * nicht gemergt ist; sie verschwindet, wenn es landet.
     */
    /**
     * **Die Liste ist eingefroren und darf nur SCHRUMPFEN.**
     *
     * Sie ist der gemessene Rest von Phase 2 — nicht ein Widerspruch, sondern
     * Arbeit, die die Karte zusagt und die noch niemand geliefert hat. Sie
     * steht hier und nicht in einer Notiz, weil eine Notiz nicht fällt, wenn
     * jemand eine achtzehnte Zeile hinzufügt.
     */
    expect(offen).toEqual([
      // §2.3 — die Danke-Seite. Die Annahme antwortet heute JSON (PR 17);
      // eine eigene Seite ist der Weg für ein Formular ohne JavaScript.
      '/angebot/[bereich]/danke',

      /**
       * §2.4 — die drei öffentlichen PFLICHTWEGE. Sie wiegen schwerer als
       * alles andere in dieser Liste: Art. 15–21 DSGVO verlangt einen Weg für
       * Auskunft und Löschung, und BFSG verlangt einen Meldeweg für Barrieren.
       * Die Barrierefreiheitserklärung nennt heute eine E-Mail-Adresse — das
       * erfüllt den Meldeweg, das Formular wäre der bessere.
       */
      '/barrierefreiheit/feedback',
      '/datenschutz/anfrage',
      '/datenschutz/anfrage/danke',

      // Detailseiten, deren Modul noch nicht gemergt ist (Phase 4 bis 9).
      '/leistungen/[slug]',
      '/news/[slug]',
      '/projekte/[slug]',

      /*
       * **§2.2 — die zehn tiefen Profilseiten sind hier weg, und das ist der
       * Zweck dieser Liste.**
       *
       * Sie stand hier, solange PR 16 je Gesellschaft nur EINE Profilseite
       * lieferte. Seit `0170` den Referenzen und Beiträgen ihren URL-Schlüssel
       * gibt und die Galerie einen `galerie_rang` hat, sind alle zehn gebaut —
       * deutsch und englisch (D-82). Der Rest dieser Liste ist echte,
       * gemessene Arbeit; wer sie wieder wachsen lässt, fällt hier auf.
       */
    ].sort());
  });
});
