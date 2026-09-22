import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

/**
 * Die eigenen Anmeldungen sehen und beenden (V-039, V-076, AUT-05).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: `benutzer_sitzung` war lesbar, beendbar — und unsichtbar.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Zwei Policies stehen seit je für `cse_app` bereit: `t_sitzung_eigene`
 * (SELECT auf die eigenen) und `t_sitzung_eigene_schreiben` (UPDATE auf die
 * eigenen). Kein Bildschirm nutzte eine von beiden. Wer sein Telefon verlor,
 * hatte keinen Weg, die Anmeldung darauf zu beenden — ausser das Kennwort zu
 * ändern und zu hoffen, dass das die Sitzung mitnimmt.
 *
 * **Das ist die SELBSTbedienung, nicht die Verwaltung.** `system.
 * sitzung_widerrufen` ist das Recht, FREMDE Sitzungen zu beenden (V-076, noch
 * offen); hier braucht es keines, weil die Policy schon sagt, worum es geht:
 * `benutzer_id = app.aktueller_benutzer()`. Ein Rechteschlüssel für „die
 * eigene Anmeldung beenden" wäre einer, den jede Rolle hielte — also keiner.
 *
 * **Der Token-Hash kommt nicht mit.** Er ist das Geheimnis; eine Liste, die
 * ihn zeigt, gibt die Sitzungen her, die sie schützen soll. Was der Mensch
 * zum Wiedererkennen braucht, ist etwas anderes: Gerät, IP, letzte
 * Aktivität.
 */

export class SitzungFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'SitzungFehler';
  }
}

export interface EigeneSitzung {
  readonly id: string;
  readonly geraet: string | null;
  readonly userAgent: string | null;
  readonly ip: string | null;
  readonly letzteAktivitaetAm: Date;
  readonly ablaufAm: Date;
  readonly erstelltAm: Date;
  /** Die Sitzung, aus der gerade gelesen wird — sie beendet man nicht hier. */
  readonly istDiese: boolean;
}

export async function meineSitzungen(
  kontext: LeseKontext, dieseSitzungId: string,
): Promise<readonly EigeneSitzung[]> {
  const zeilen = await kontext.abfrage<{
    id: string; geraet: string | null; user_agent: string | null; ip: string | null;
    letzte_aktivitaet_am: Date; ablauf_am: Date; erstellt_am: Date;
  }>(
    /*
     * Nur die LEBENDEN: beendet ist beendet, und eine Liste, die abgelaufene
     * Anmeldungen mitführt, lässt den Menschen raten, welche davon noch
     * etwas kann. Die Spur der beendeten steht im Protokoll, nicht hier.
     */
    `select id, geraet, user_agent, host(ip) as ip,
            letzte_aktivitaet_am, ablauf_am, erstellt_am
       from benutzer_sitzung
      where beendet_am is null and ablauf_am > now()
      order by letzte_aktivitaet_am desc
      limit 100`,
  );
  return zeilen.map((z) => ({
    id: z.id,
    geraet: z.geraet,
    userAgent: z.user_agent,
    ip: z.ip,
    letzteAktivitaetAm: z.letzte_aktivitaet_am,
    ablaufAm: z.ablauf_am,
    erstelltAm: z.erstellt_am,
    istDiese: z.id === dieseSitzungId,
  }));
}

/**
 * Eine eigene Anmeldung beenden.
 *
 * **Die LAUFENDE Sitzung wird hier nicht beendet, und das ist kein
 * Schönheitsfehler.** Wer sich abmelden will, nimmt `/auth/abmelden` — dieser
 * Weg räumt auch das Sitzungsplätzchen des Browsers ab. Beendete man die
 * eigene Sitzung hier, bliebe das Plätzchen stehen und zeigte auf eine
 * Sitzung, die es nicht mehr gibt: jede weitere Seite antwortete mit einer
 * Anmeldeaufforderung, die niemand erklärt hat.
 */
export async function beendeEigeneSitzung(
  kontext: SchreibKontext, sitzungId: string, dieseSitzungId: string,
): Promise<void> {
  if (sitzungId === dieseSitzungId) {
    throw new SitzungFehler(
      'Das ist die Anmeldung, in der Sie gerade sind. Zum Abmelden nehmen Sie '
      + '„Abmelden" — dieser Weg räumt auch die Spuren im Browser ab.',
      'diese_sitzung', 409);
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    /*
     * `ende_grund = 'abmeldung'`: aus der Sicht der beendeten Sitzung ist es
     * genau das. `gesperrt` waere die Verwaltungsentscheidung (V-076) und
     * behauptete im Protokoll etwas anderes, als geschehen ist.
     *
     * Die Policy `t_sitzung_eigene_schreiben` deckelt das UPDATE auf die
     * eigenen Zeilen — eine fremde Kennung trifft deshalb null Zeilen und
     * sieht von aussen aus wie eine, die es nicht gibt (AUT-06).
     */
    `update benutzer_sitzung
        set beendet_am = now(), ende_grund = 'abmeldung'
      where id = $1::uuid and beendet_am is null
     returning id`,
    [sitzungId],
  );
  if (zeilen[0] === undefined) {
    throw new SitzungFehler(
      'Diese Anmeldung gibt es nicht mehr — sie ist bereits beendet oder abgelaufen.',
      'nicht_gefunden', 404);
  }
}
