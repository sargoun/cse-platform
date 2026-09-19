import 'server-only';
import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import {
  withPersonScope, withTenant, type SchreibKontext, type Sitzung,
} from '@/server/kontext/index';
import {
  KeineEigeneSchicht, schichtBezugOderFehler, type SchichtBezug,
} from '@/server/services/mitarbeiter/schicht-zugang';

/**
 * Die eine Bruecke, ueber die jeder Schreibweg der Schichtseiten faehrt
 * (K-02, K-18, K-04, AUT-06).
 *
 * **Vier Routen, ein Weg.** Wachbuch, Foto, Leistungsnachweis und Bautagebuch
 * tun dasselbe Vorspiel: Ursprung pruefen, Sitzung holen, die Zuordnung im
 * PERSONEN-Scope aufloesen, den Mandanten DARAUS ableiten und dann `withTenant`
 * mit `portal: 'mitarbeiter'` betreten. Viermal abgeschrieben ist es viermal
 * eine Stelle, an der jemand `portal: 'intern'` setzt, „damit es einfacher
 * wird" — und damit jede K-04-Mitarbeiterdecke dieser Anfrage aufhebt.
 *
 * **Der Mandant kommt aus der Schicht, nie aus der Anfrage** (K-02,
 * Invariante 3). Ein Feld dafuer gibt es hier nicht, auch kein verstecktes.
 *
 * **Alles in EINER Transaktion.** Der Personen-Scope loest auf, der
 * Mandantenscope schreibt — dieselbe Verbindung, dieselbe Transaktion, ein
 * Rollback fuer beides.
 */
export interface BrueckenAntwort {
  readonly fehler?: string;
  readonly status?: number;
}

export type BrueckenErgebnis<T> =
  | { readonly art: 'antwort'; readonly antwort: NextResponse }
  | { readonly art: 'ok'; readonly wert: T; readonly bezug: SchichtBezug };

/**
 * Fuehrt `fn` im Mandantenscope der eigenen Schicht aus.
 *
 * Gibt entweder eine fertige Fehlerantwort zurueck (401/403/404) oder das
 * Ergebnis samt aufgeloestem Bezug. Die Route entscheidet dann, ob sie 303
 * umleitet oder JSON schickt — das ist ihr Unterschied und nicht der dieser
 * Datei.
 */
export async function aufDerSchicht<T>(
  anfrage: NextRequest,
  zuordnungId: string,
  fn: (kontext: SchreibKontext, bezug: SchichtBezug, sitzung: Sitzung) => Promise<T>,
): Promise<BrueckenErgebnis<T>> {
  if (!istGleicherUrsprung(anfrage)) {
    return {
      art: 'antwort',
      antwort: NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 }),
    };
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return {
      art: 'antwort',
      antwort: NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 }),
    };
  }
  if (sitzung.personId === null || sitzung.personId === '') {
    /*
     * Ein Konto ohne Person hat keine Beschaeftigung, also auch keine Schicht,
     * an der etwas dokumentiert werden koennte. 404, nicht 403 (AUT-06).
     */
    return {
      art: 'antwort',
      antwort: NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 }),
    };
  }

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) => {
      const bezug = await withPersonScope(tx, sitzung, async (kontext) =>
        schichtBezugOderFehler(kontext, zuordnungId));

      const imMandanten: Sitzung = {
        ...sitzung,
        ansicht: 'mandant',
        aktiverMandantId: bezug.mandantId,
        /*
         * `mitarbeiter` BLEIBT. Die K-04-Decken auf `einsatz`, `wachbuch_eintrag`,
         * `einsatz_medien`, `leistungsnachweis*` und `bautagebuch*` haengen alle
         * daran; wer hier `intern` setzt, hebt sie fuer diese Anfrage auf.
         */
        portal: 'mitarbeiter',
      };
      const wert = await withTenant(tx, imMandanten, async (kontext) =>
        fn(kontext, bezug, imMandanten));
      return { art: 'ok' as const, wert, bezug };
    }) as Promise<BrueckenErgebnis<T>>);
  } catch (fehler: unknown) {
    if (fehler instanceof KeineEigeneSchicht) {
      return {
        art: 'antwort',
        antwort: NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 }),
      };
    }
    throw fehler;
  }
}

/**
 * Ein Fehler des Dienstes als Antwort — oder `null`, wenn es keiner ist.
 *
 * Die Dienste dieses Hauses tragen `code` und `status` auf ihren Fehlern
 * (`BautagebuchFehler`, `WachbuchEingabeFehlt`, `FalscherZustand` …). Was
 * beides traegt, ist eine Aussage fuer den Menschen davor; alles andere ist ein
 * Programmfehler und gehoert in die Protokolle, nicht auf den Bildschirm.
 */
export function dienstFehlerAntwort(fehler: unknown): NextResponse | null {
  const f = fehler as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof f.status === 'number' && typeof f.code === 'string') {
    return NextResponse.json(
      { fehler: f.code, meldung: typeof f.message === 'string' ? f.message : '' },
      { status: f.status },
    );
  }
  return null;
}

/** Der Rueckweg eines echten `<form method="post">`: 303 auf eine INTERNE Adresse. */
export function zurueckZu(
  daten: FormData, vorgabe: string, anfrage: NextRequest,
): NextResponse {
  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, vorgabe, anfrage), 303,
  );
}
