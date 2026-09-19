import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import { istKennung } from '@/app/portal/kennung';
import { antworte, markiereGelesen } from '@/server/services/kern/nachricht';
import {
  antwortZiele, fadenGeschlossen, mandantDesFadens,
} from '@/server/services/mitarbeiter/nachricht';

/**
 * `POST /api/mein/nachrichten/[id]` — die Kraft stempelt ihren Faden als
 * gelesen oder antwortet darin (EMP-11, NOT-03).
 *
 * **Der Befund dahinter.** Eine interne Nachricht der Leitung erreichte das
 * Mitarbeiterportal überhaupt nicht: die Seite las `benachrichtigung` statt
 * `nachricht` (0350). Mit dem Posteingang gehört der Rückweg dazu — ein Faden,
 * der nur in eine Richtung trägt, ist kein Faden.
 *
 * **Kein Rechteschlüssel für das Stempeln** (K-19, wie `api/mein/antraege`):
 * `markiereGelesen` trifft nur die EIGENEN Empfängerzeilen
 * (`t_empfaenger_eigene_stempeln`, 0231); ein Recht davor hiesse, dass jemand
 * eine Nachricht bekommen kann, die er nicht als gelesen markieren darf. Für
 * das Antworten prüft die Datenbank `nachricht.versenden` in beiden
 * WITH-CHECK-Hälften (`t_nachricht_mandant`, `t_empfaenger_mandant`, 0011);
 * der Schlüssel ist im Katalog (0008) an die Rolle `mitarbeiter` gebunden.
 *
 * **Der Umweg über zwei Scopes ist der Punkt** (K-18): im Personen-Scope ist
 * `app.aktiver_mandant()` NULL, und keine Schreibpolicy träfe zu. Also erst
 * den Mandanten des Fadens im Personen-Scope auflösen — ein fremder Faden
 * liefert dort null Zeilen und damit 404, nicht 403 (AUT-06) — und dann
 * `withTenant` mit genau diesem Mandanten betreten, mit `portal:
 * 'mitarbeiter'`, damit die K-04-Decke weiter gilt. Der Mandant kommt aus der
 * DATENBANK, nie aus einem Feld der Anfrage (K-02, Invariante 3).
 *
 * **Nichts verlässt das System** (Invariante 7). `antworte` schreibt
 * `richtung = 'intern'`, `kanal = 'portal'`; `kern.nachricht_sendetor()` (0231)
 * kehrt für diesen Kanal sofort zurück. Der Weg nach draussen ist
 * `sendeNachAussen` — und der endet heute an einer Wand (O-36, kein Versender
 * verbunden). Zwei Wege mit einem Namen wären der Weg, auf dem eine Werbemail
 * als interne Notiz hinausgeht.
 *
 * **303 und kein JSON.** Das Formular ist ein echtes `<form method="post">`,
 * damit es auf einem alten Diensttelefon ohne JavaScript funktioniert; eine
 * JSON-Antwort wäre dort eine Sackgasse.
 */
export const dynamic = 'force-dynamic';

type Ergebnis =
  | { readonly art: 'getan'; readonly was: string }
  | { readonly art: 'fehler'; readonly code: string; readonly status: number };

export async function POST(
  anfrage: NextRequest,
  kontext: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await kontext.params;

  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  /* Eine unlesbare Kennung ist nach aussen dasselbe wie eine, die es nicht
   * gibt (AUT-06) — und sie gelangt gar nicht erst in ein `$1::uuid`. */
  if (!istKennung(id)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (sitzung.personId === null || sitzung.personId === '') {
    // Ein Konto ohne Person hat kein Mitarbeiterportal — und damit keinen
    // Faden, in dem es hier antworten könnte.
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const feld = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };
  const was = feld('was') ?? '';
  if (was !== 'gelesen' && was !== 'antworten') {
    return NextResponse.json({ fehler: 'unbekannter_vorgang' }, { status: 400 });
  }
  const koerper = feld('koerper');
  if (was === 'antworten' && koerper === null) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) => {
    const vorbereitung = await withPersonScope(tx, sitzung, async (k) => {
      const mandantId = await mandantDesFadens(k, id);
      if (mandantId === null) return null;
      return {
        mandantId,
        geschlossen: await fadenGeschlossen(k, id),
        ziele: was === 'antworten' ? await antwortZiele(k, id) : [],
      };
    });
    if (vorbereitung === null) {
      return { art: 'fehler', code: 'nicht_gefunden', status: 404 } satisfies Ergebnis;
    }
    /*
     * Ein geschlossener Faden ist der Ersatz für eine Löschung (Invariante 8):
     * lesbar, aber er nimmt nichts mehr auf. Gestempelt werden darf er
     * trotzdem — „gelesen" ist eine Aussage über MICH, nicht über den Vorgang.
     */
    if (was === 'antworten' && vorbereitung.geschlossen) {
      return { art: 'fehler', code: 'faden_geschlossen', status: 409 } satisfies Ergebnis;
    }

    const imMandanten: Sitzung = {
      ...sitzung, ansicht: 'mandant', aktiverMandantId: vorbereitung.mandantId,
      portal: 'mitarbeiter',
    };
    return withTenant(tx, imMandanten, async (k): Promise<Ergebnis> => {
      if (was === 'gelesen') {
        /*
         * Die ZAHL wird durchgereicht, nicht verworfen. Traf der Stempel null
         * eigene Zeilen, hat sich nichts geändert — und dann ist „Gespeichert."
         * eine Behauptung.
         */
        const gestempelt = await markiereGelesen(k, id);
        return { art: 'getan', was: gestempelt === 0 ? 'gelesen_schon' : 'gelesen' };
      }
      /*
       * Wer antwortet, hat gelesen. Der Stempel steht VOR der Antwort: bliebe
       * der Faden danach ungelesen, zeigte der Posteingang eine offene
       * Nachricht, die dieser Mensch gerade beantwortet hat.
       */
      await markiereGelesen(k, id);
      /*
       * **Der Schreibsatz steht im FACHDIENST**, nicht im Portaldienst:
       * `antworte` schreibt `richtung = 'intern'`, `kanal = 'portal'` und
       * `absender_benutzer_id = app.aktueller_benutzer()` fest. Die Empfänger
       * werden ÜBERGEBEN und nicht geerbt — unter der K-04-Decke sieht eine
       * Kraft nur ihre eigene Empfängerzeile, und ein `erbeEmpfaenger`
       * adressierte die Antwort damit an sie selbst (siehe `antwortZiele`).
       */
      const neu = await antworte(k, id, {
        koerper: koerper as string,
        empfaenger: vorbereitung.ziele.map(
          (ziel) => ({ typ: 'benutzer' as const, id: ziel, art: 'an' as const })),
      });
      return neu === null
        ? { art: 'fehler', code: 'nicht_gefunden', status: 404 }
        : { art: 'getan', was: 'geantwortet' };
    });
  }) as Promise<Ergebnis>);

  if (ergebnis.art === 'fehler') {
    return NextResponse.json({ fehler: ergebnis.code }, { status: ergebnis.status });
  }
  /*
   * Zurück auf den Faden, mit der Auskunft, was geschehen ist — dieselbe Form
   * wie `/api/nachrichten` (`?getan=…`). Das Ziel wird HIER gebaut und nicht
   * aus einem Feld der Anfrage genommen: ein `zurueck`-Feld wäre eine offene
   * Weiterleitung mit einer echten Anmeldung davor (D-504).
   */
  return NextResponse.redirect(
    new URL(`/portal/mein/nachrichten/${id}?getan=${ergebnis.was}`,
            erwarteterUrsprung(anfrage)),
    303,
  );
}
