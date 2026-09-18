/**
 * Der persönliche Posteingang mischt ZWEI Quellen — und diese Datei prüft die
 * Rechnung dahinter (EMP-11, NOT-01, NOT-03).
 *
 * **Warum das eine geprüfte Funktion ist und kein `order by`.** Der Bildschirm
 * einer Kraft heisst „Nachrichten"; dahinter liegen `benachrichtigung`
 * (Wächter-, Ablauf- und Fristmeldungen) und `nachricht` (Schriftverkehr in
 * einem Vorgang) — zwei Tabellen, zwei Abfragen, zwei Zeitbegriffe. Die eine
 * der anderen in einem `union` anzugleichen hiesse, bei einer von beiden die
 * Hälfte zu verlieren. Also: zwei ehrliche Abfragen und eine reine Funktion,
 * die sich Fall für Fall prüfen lässt.
 *
 * Der Befund dahinter: bis 0350 zeigte diese Seite AUSSCHLIESSLICH die erste
 * Quelle. Eine interne Nachricht der Leitung kam nie an — die Oberfläche
 * meldete „gesendet", und im Konto der Mitarbeiterin stand nichts.
 */
import { describe, expect, it } from 'vitest';
import {
  mischePosteingang, zaehleUngelesen, type PosteingangZeile,
} from '../../src/server/services/mitarbeiter/posteingang.js';

function zeile(teil: Partial<PosteingangZeile> & { id: string }): PosteingangZeile {
  return {
    art: 'meldung',
    titel: `Titel ${teil.id}`,
    auszug: '',
    absender: null,
    zeitpunkt: new Date('2026-03-01T08:00:00Z'),
    ungelesen: 0,
    mandantSlug: 'reinigung',
    mandantName: 'CSE Dienstleistungen GmbH',
    geschlossen: false,
    ...teil,
  };
}

describe('die Mischung ist EINE Liste, neueste zuerst', () => {
  it('beide Quellen stehen darin — keine geht verloren', () => {
    const gemischt = mischePosteingang(
      [zeile({ id: 'm1', art: 'meldung', zeitpunkt: new Date('2026-03-01T06:00:00Z') })],
      [zeile({ id: 'f1', art: 'faden', zeitpunkt: new Date('2026-03-01T07:00:00Z') })],
    );
    expect(gemischt.map((z) => z.id)).toEqual(['f1', 'm1']);
    expect(gemischt.map((z) => z.art)).toEqual(['faden', 'meldung']);
  });

  it('sortiert wird nach ZEIT und nicht nach Quelle', () => {
    /*
     * Erst die Meldungen, dann die Fäden hintereinanderzuhängen wäre die
     * bequeme Fassung — und auf dem Telefon stünde die Frage der Leitung von
     * heute Morgen unter einer Ablaufwarnung vom letzten Monat.
     */
    const gemischt = mischePosteingang(
      [
        zeile({ id: 'm-alt', zeitpunkt: new Date('2026-01-02T09:00:00Z') }),
        zeile({ id: 'm-neu', zeitpunkt: new Date('2026-03-09T09:00:00Z') }),
      ],
      [
        zeile({ id: 'f-mitte', art: 'faden', zeitpunkt: new Date('2026-02-11T09:00:00Z') }),
      ],
    );
    expect(gemischt.map((z) => z.id)).toEqual(['m-neu', 'f-mitte', 'm-alt']);
  });

  it('bei gleichem Zeitpunkt entscheidet die Id — die Liste springt nicht', () => {
    /*
     * Zwei Einträge in derselben Sekunde sind nach einem Stapellauf der
     * Normalfall. Ohne festen zweiten Schlüssel käme die Liste beim Neuladen
     * mal so und mal so heraus — und eine Liste, die sich umsortiert, sieht
     * aus wie eine, die etwas verloren hat.
     */
    const gleich = new Date('2026-03-01T08:00:00Z');
    const a = mischePosteingang(
      [zeile({ id: 'bbb', zeitpunkt: gleich }), zeile({ id: 'aaa', zeitpunkt: gleich })]);
    const b = mischePosteingang(
      [zeile({ id: 'aaa', zeitpunkt: gleich }), zeile({ id: 'bbb', zeitpunkt: gleich })]);
    expect(a.map((z) => z.id)).toEqual(['aaa', 'bbb']);
    expect(b.map((z) => z.id)).toEqual(a.map((z) => z.id));
  });

  it('die Eingabelisten bleiben unberührt', () => {
    const quelle = [
      zeile({ id: 'z2', zeitpunkt: new Date('2026-01-01T00:00:00Z') }),
      zeile({ id: 'z1', zeitpunkt: new Date('2026-05-01T00:00:00Z') }),
    ];
    const vorher = quelle.map((z) => z.id);
    mischePosteingang(quelle);
    expect(quelle.map((z) => z.id)).toEqual(vorher);
  });

  it('ein unbrauchbarer Zeitpunkt fällt ans Ende, nicht heraus', () => {
    /*
     * Etwas wegzulassen ist die eine Antwort, die ein Posteingang nie geben
     * darf: „ich habe nichts bekommen" muss sich widerlegen lassen.
     */
    const gemischt = mischePosteingang([
      zeile({ id: 'kaputt', zeitpunkt: new Date('nicht-datierbar') }),
      zeile({ id: 'gut', zeitpunkt: new Date('2026-03-01T08:00:00Z') }),
    ]);
    expect(gemischt.map((z) => z.id)).toEqual(['gut', 'kaputt']);
  });

  it('ohne Quellen ist die Liste leer und nicht undefiniert', () => {
    expect(mischePosteingang()).toEqual([]);
    expect(mischePosteingang([], [])).toEqual([]);
  });
});

describe('die Ungelesen-Zahlen stehen GETRENNT', () => {
  it('Meldungen und Fäden werden einzeln gezählt und dann summiert', () => {
    /*
     * „3 ungelesene Meldungen" heisst: drei Warnungen warten. „3 ungelesene
     * Nachrichten" heisst: drei Menschen warten auf eine Antwort. Eine
     * einzige Summe verwischt genau den Unterschied, nach dem die Kraft
     * abends ihre Entscheidung trifft.
     */
    const offen = zaehleUngelesen([
      zeile({ id: 'm1', art: 'meldung', ungelesen: 1 }),
      zeile({ id: 'm2', art: 'meldung', ungelesen: 1 }),
      zeile({ id: 'm3', art: 'meldung', ungelesen: 0 }),
      /* Ein Faden zählt seine ZEILEN, nicht sich selbst. */
      zeile({ id: 'f1', art: 'faden', ungelesen: 3 }),
      zeile({ id: 'f2', art: 'faden', ungelesen: 0 }),
    ]);
    expect(offen).toEqual({ meldungen: 2, faeden: 3, gesamt: 5 });
  });

  it('eine negative Zahl kann die Summe nicht kleiner machen', () => {
    // Nicht erwartbar, aber billig abgesichert: eine Zahl, die eine andere
    // wegkürzt, wäre ein stiller Fehlbetrag an der Glocke.
    expect(zaehleUngelesen([
      zeile({ id: 'a', art: 'faden', ungelesen: -5 }),
      zeile({ id: 'b', art: 'faden', ungelesen: 2 }),
    ])).toEqual({ meldungen: 0, faeden: 2, gesamt: 2 });
  });

  it('nichts Offenes heisst drei Nullen', () => {
    expect(zaehleUngelesen([])).toEqual({ meldungen: 0, faeden: 0, gesamt: 0 });
  });
});
