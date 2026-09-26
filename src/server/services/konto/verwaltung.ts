import type { SchreibKontext } from '../../kontext/index.js';

/**
 * Ein Konto zurücknehmen — entsperren, entziehen, wiedergeben, hinauswerfen
 * (V-022, V-074, V-075, V-076).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: `benutzer.status` hatte drei Sackgassen von vier Werten.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `gesperrt` setzte die Brute-Force-Wache und nichts setzte es zurück;
 * `deaktiviert` hatte überhaupt keinen Erzeuger; das Benutzerblatt konnte
 * einladen und nie zurücknehmen; und `system.sitzung_widerrufen` war im
 * Katalog vergeben, ohne dass eine einzige Zeile Code es je prüfte — das
 * Blatt sagte wörtlich, der Widerruf „kommt mit" diesem Recht.
 *
 * **Warum das alles über Definer-Funktionen läuft.** `cse_app` hält auf
 * `benutzer` ein SPALTEN-Grant (`name`, `sprache`,
 * `benachrichtigung_praeferenz`) und eine UPDATE-Policy auf die EIGENE Zeile.
 * `status`, `gesperrt_bis` und `deaktiviert_am` sind der Anwendung damit
 * entzogen — richtig so, und nie das Problem. Das Problem war, dass daneben
 * kein Weg gebaut wurde. `drizzle/0379` baut ihn: vier Funktionen, jede auf
 * einen Fall geschnitten, jede mit ihrer eigenen Rechtefrage.
 *
 * **Dieser Dienst rechnet nichts und entscheidet nichts.** Er reicht durch
 * und übersetzt Fehlercodes in Sätze. Jede Prüfung, auf die es ankommt —
 * Recht, Mandant, zweiter Faktor, Selbstbezug —, steht in der Datenbank; hier
 * stünde sie ein zweites Mal und ginge beim nächsten neuen Aufrufer verloren.
 */

export class KontoFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'KontoFehler';
  }
}

/** Was die vier Handlungen gemeinsam haben: ein Ziel und ein Grund. */
export interface Kontohandlung {
  readonly benutzerId: string;
  readonly grund: string;
}

export type KontoAktion =
  'entsperren' | 'deaktivieren' | 'reaktivieren' | 'sitzungen_widerrufen';

export const KONTO_AKTIONEN: readonly KontoAktion[] = [
  'entsperren', 'deaktivieren', 'reaktivieren', 'sitzungen_widerrufen',
];

/**
 * Was eine Handlung ausgerichtet hat.
 *
 * **`false` ist kein Fehler.** Zwei Bearbeiterinnen auf demselben Blatt sind
 * der Normalfall: wer ein bereits entsperrtes Konto entsperrt, soll „war
 * schon offen" lesen und keine Ausnahme sehen. Die Datenbank unterscheidet
 * beides am Rückgabewert, nicht am Fehler — deshalb kommt es hier auch so an.
 */
export interface KontoErgebnis {
  readonly geaendert: boolean;
  /** Nur beim Widerruf gesetzt: wie viele Anmeldungen beendet wurden. */
  readonly sitzungen: number | null;
}

/**
 * Die Postgres-Fehlercodes, die aus `0379` kommen, in Sätze übersetzt.
 *
 * `42501` ist „darf nicht" — Recht, Mandant, zweiter Faktor, Lesemodus,
 * eigenes Konto. Die Datenbank nennt den Fall im Text; weiterzureichen wäre
 * bequem und gäbe dem Bildschirm eine Meldung, die sagt, welche Bedingung
 * gefehlt hat. Genau das will AUT-06 nicht: wer das Recht nicht hält, soll
 * nicht erfahren, WAS er nicht hält.
 */
function uebersetze(fehler: unknown, aktion: KontoAktion): never {
  const code = (fehler as { code?: string }).code;
  if (code === '42501') {
    throw new KontoFehler(
      aktion === 'sitzungen_widerrufen'
        ? 'Dieser Widerruf ist nicht möglich.'
        : 'Diese Änderung am Konto ist nicht möglich.',
      'nicht_erlaubt', 403);
  }
  if (code === '22023') {
    throw new KontoFehler(
      'Zu jeder Änderung am Zugang gehört ein Grund — er ist das, was im '
      + 'Streitfall gelesen wird.', 'ohne_grund');
  }
  throw fehler;
}

async function rufe(
  kontext: SchreibKontext, funktion: string, eingabe: Kontohandlung,
  aktion: KontoAktion,
): Promise<unknown> {
  if (eingabe.grund.trim() === '') {
    throw new KontoFehler(
      'Zu jeder Änderung am Zugang gehört ein Grund — er ist das, was im '
      + 'Streitfall gelesen wird.', 'ohne_grund');
  }
  try {
    const zeilen = await kontext.schreibe<Record<string, unknown>>(
      `select ${funktion}($1::uuid, $2) as wert`,
      [eingabe.benutzerId, eingabe.grund.trim()]);
    return zeilen[0]?.['wert'];
  } catch (fehler) {
    return uebersetze(fehler, aktion);
  }
}

/** V-074 — die Brute-Force-Sperre zurücknehmen. */
export async function entsperreKonto(
  kontext: SchreibKontext, eingabe: Kontohandlung,
): Promise<KontoErgebnis> {
  const wert = await rufe(kontext, 'app.konto_entsperren', eingabe, 'entsperren');
  return { geaendert: wert === true, sitzungen: null };
}

/**
 * V-075, V-022 — den Zugang entziehen.
 *
 * **Kein Löschen** (Invariante 8): `audit_log` benennt dieses Konto als
 * Akteur, dauerhaft. Die offenen Anmeldungen enden mit — `sitzung_aufloesen`
 * verlangt ohnehin `status = 'aktiv'`, aber eine Liste, die „läuft bis …"
 * zeigt, behauptete einen Zugang, den es nicht mehr gibt.
 */
export async function deaktiviereKonto(
  kontext: SchreibKontext, eingabe: Kontohandlung,
): Promise<KontoErgebnis> {
  const wert = await rufe(kontext, 'app.konto_deaktivieren', eingabe, 'deaktivieren');
  return { geaendert: wert === true, sitzungen: null };
}

/** V-022 — der Weg zurück aus `deaktiviert`. */
export async function reaktiviereKonto(
  kontext: SchreibKontext, eingabe: Kontohandlung,
): Promise<KontoErgebnis> {
  const wert = await rufe(kontext, 'app.konto_reaktivieren', eingabe, 'reaktivieren');
  return { geaendert: wert === true, sitzungen: null };
}

/**
 * V-076 — alle Anmeldungen eines FREMDEN Kontos beenden.
 *
 * **Das kleinere Recht, und mit Absicht.** Ein Widerruf nimmt ein Plätzchen
 * aus dem Verkehr, keinen Menschen aus dem Betrieb: wer widerrufen ist, meldet
 * sich sofort wieder an. Deshalb hängt er an `system.sitzung_widerrufen`
 * (bindbar bis `leitung`) und nicht an `system.benutzer_verwalten`.
 */
export async function widerrufeSitzungen(
  kontext: SchreibKontext, eingabe: Kontohandlung,
): Promise<KontoErgebnis> {
  const wert = await rufe(
    kontext, 'app.sitzungen_widerrufen', eingabe, 'sitzungen_widerrufen');
  const anzahl = typeof wert === 'number' ? wert : Number(wert ?? 0);
  return { geaendert: anzahl > 0, sitzungen: anzahl };
}

/** Eine Handlung an ihrem Namen — der Weg von der Route in den Dienst. */
export async function fuehreKontohandlungAus(
  kontext: SchreibKontext, aktion: KontoAktion, eingabe: Kontohandlung,
): Promise<KontoErgebnis> {
  switch (aktion) {
    case 'entsperren': return entsperreKonto(kontext, eingabe);
    case 'deaktivieren': return deaktiviereKonto(kontext, eingabe);
    case 'reaktivieren': return reaktiviereKonto(kontext, eingabe);
    case 'sitzungen_widerrufen': return widerrufeSitzungen(kontext, eingabe);
  }
}
