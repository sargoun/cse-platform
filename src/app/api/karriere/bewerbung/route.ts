import { NextResponse, type NextRequest } from 'next/server';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { withEingang } from '@/server/kontext/eingang';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { herkunft } from '@/app/auth/mitarbeiter/anmeldung';
import { ipHash, istBot, pruefeRatenlimit, RatenlimitFehler }
  from '@/server/services/lead/annahme';
import { nimmBewerbungAn, RecruitingFehler } from '@/server/services/recruiting/dienst';
import { bewerbungsMeldung } from '@/app/(public)/karriere/meldung';

/**
 * `POST /api/karriere/bewerbung` — die öffentliche Bewerbung (REC-03).
 *
 * **Bewusst offen**, wie `api/anfrage`: sie ist der Weg, auf dem sich jemand
 * ohne Konto bewirbt. Was sie schützt, sind nicht Rechte des Aufrufers,
 * sondern Honigtopf, Ratenlimit, Validierung — und ein Prinzipal, der
 * schreiben und nicht lesen kann (`withEingang`).
 *
 * **Der Mandant kommt NIE aus dem Formular, wenn es eine Stelle gibt.** Er
 * wird aus der Stelle aufgelöst, und zwar über die öffentliche Sicht, die
 * ausschliesslich veröffentlichte Stellen durchlässt. Sonst könnte ein
 * präparierter POST eine Bewerbung in eine fremde Gesellschaft schreiben oder
 * sich auf einen Entwurf bewerben, den niemand ausgeschrieben hat (K-02).
 *
 * Bei der Initiativbewerbung gibt es keine Stelle; dort ist der Bereich eine
 * Wahl aus einer Liste, und der Slug wird gegen `mandant` aufgelöst — auch das
 * serverseitig, nicht als Kennung aus dem Rumpf.
 */
export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9-]{1,40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function feld(daten: FormData, name: string): string {
  const wert = daten.get(name);
  return typeof wert === 'string' ? wert.trim() : '';
}

/** Der Mandant der Bewerbung — aus der Stelle oder aus der Bereichswahl. */
async function mandantFuer(
  stelleId: string | null, bereich: string,
): Promise<string | null> {
  return db().begin(async (tx: postgres.TransactionSql) =>
    withOeffentlich(tx, async (kontext) => {
      if (stelleId !== null) {
        /*
         * **Auch hier die archivierte Gesellschaft ausschliessen.** Die
         * Liste und das Stellenblatt tun es (`karriere/daten.ts`); täte es
         * diese Auflösung nicht, nähme die Plattform noch Bewerbungen für
         * eine Gesellschaft entgegen, die es nicht mehr gibt — und die
         * Daten lägen in einem Mandanten, den niemand mehr öffnet.
         * Gemeldet von der Copilot-Runde auf PR 16 (D-585).
         */
        const [z] = await kontext.abfrage<{ mandant_id: string }>(
          `select s.mandant_id from stelle s
             join mandant m on m.id = s.mandant_id and m.archiviert_am is null
            where s.id = $1::uuid and s.status = 'veroeffentlicht'
              and s.geschlossen_am is null`,
          [stelleId]);
        return z?.mandant_id ?? null;
      }
      const [m] = await kontext.abfrage<{ id: string }>(
        `select id from mandant where slug = $1 and archiviert_am is null`, [bereich]);
      return m?.id ?? null;
    })) as Promise<string | null>;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const daten = await anfrage.formData();

  /*
   * Der Honigtopf antwortet mit ERFOLG und schreibt nichts. Ein sichtbares
   * "abgelehnt" waere die Rueckmeldung, mit der ein Skript sein Formular
   * verbessert.
   */
  if (istBot(feld(daten, 'webseite'))) {
    return NextResponse.redirect(internesZiel(null, '/karriere/danke', anfrage), 303);
  }

  const stelleRoh = feld(daten, 'stelle');
  const stelleId = UUID.test(stelleRoh) ? stelleRoh : null;
  const bereich = feld(daten, 'bereich');

  /*
   * **Ein Browser bekommt eine Seite, ein Programm bekommt JSON (D-599, V-158).**
   *
   * Hier antwortete JEDER Fehler mit JSON — `{"fehler":"unvollstaendig"}`
   * auf weissem Grund, für eine Bewerberin, deren `name@firma` der Browser
   * durchliess und der Dienst nicht. Das Formular trägt jetzt `antwort=seite`
   * (dieselbe Weiche wie `api/anfrage`), und die Abweisung geht als GRUND
   * zurück auf die Seite, von der sie kam; dort steht der Satz
   * (`karriere/meldung.ts`). Die eingegebenen Werte reisen NICHT mit: Name,
   * E-Mail und Nachricht gehören in keine Adresse.
   */
  const alsSeite = feld(daten, 'antwort') === 'seite';
  const formularPfad = stelleId === null
    ? '/karriere/initiativbewerbung' : `/karriere/${stelleId}/bewerbung`;
  const abgewiesen = (grund: string, status: number, ziel = formularPfad): NextResponse =>
    alsSeite
      ? NextResponse.redirect(internesZiel(
        `${ziel}?fehler=${encodeURIComponent(grund)}`, '/karriere', anfrage), 303)
      : NextResponse.json({ fehler: grund, meldung: bewerbungsMeldung(grund) }, { status });

  if (stelleId === null && !SLUG.test(bereich)) {
    return abgewiesen('kein_bereich', 400);
  }

  const mandantId = await mandantFuer(stelleId, bereich);
  // Eine geschlossene Stelle und eine erfundene Kennung geben dieselbe
  // Antwort — der Unterschied waere die Auskunft, dass es sie gibt (AUT-06).
  if (mandantId === null) {
    /*
     * Mit Stelle: zurück auf die LISTE — das Stellenblatt einer geschlossenen
     * Stelle antwortet mit 404. Ohne Stelle war der Bereich unbekannt, und das
     * ist für den Menschen dasselbe wie keiner.
     */
    const grund = stelleId === null ? 'kein_bereich' : 'stelle_geschlossen';
    if (!alsSeite) {
      // Das JSON bleibt, was es war (`nicht_gefunden`) — jetzt mit Satz.
      return NextResponse.json(
        { fehler: 'nicht_gefunden', meldung: bewerbungsMeldung(grund) }, { status: 404 });
    }
    return abgewiesen(grund, 404, stelleId === null ? formularPfad : '/karriere');
  }

  const { ip } = await herkunft(anfrage.headers);
  const pfeffer = process.env['CSE_IP_PFEFFER'] ?? '';

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withEingang(tx, mandantId, async (kontext) => {
        /*
         * Das Ratenlimit laeuft in DERSELBEN Transaktion wie das Schreiben:
         * getrennt liesse ein Ansturm beliebig viele Bewerbungen zwischen
         * Zaehlung und INSERT durch. `unsafe` und nicht `kontext.abfrage`,
         * weil der Zaehler die rohe Form des Treibers erwartet.
         */
        if (ip !== null && pfeffer !== '') {
          await pruefeRatenlimit(tx, ipHash(ip, pfeffer), new Date());
        }
        return nimmBewerbungAn(kontext, {
          stelleId,
          name: feld(daten, 'name'),
          email: feld(daten, 'email'),
          telefon: feld(daten, 'telefon') || null,
          nachricht: feld(daten, 'nachricht') || null,
        });
      }));
  } catch (fehler: unknown) {
    if (fehler instanceof RatenlimitFehler) {
      return abgewiesen('zu_viele', 429);
    }
    if (fehler instanceof RecruitingFehler) {
      return abgewiesen(fehler.grund, fehler.status);
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(null, '/karriere/danke', anfrage), 303);
}
