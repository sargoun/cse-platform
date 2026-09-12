/**
 * Demodaten fuer PR 36 — Auftrag, Leistungszeilen und der Weg Zeit → Auftrag
 * (TIM-12, FIN-07, FIN-18).
 *
 * **Warum das in den Seed gehoert.** Ohne eine Leistungszeile traegt jeder
 * Zeiteintrag `auftrag_leistung_id = NULL`, und dann sieht die
 * Abrechnungsseite genau so aus, wie sie bei einem kaputten Erben-Ausloeser
 * aussaehe: leer, ohne Fehler, ohne Luecke. Erst wenn die Kette in den
 * Demodaten steht — Auftrag → Leistungszeile → Turnus → Einsatz →
 * Zeiteintrag —, prueft ein Mensch beim Ansehen etwas.
 *
 * **Und die Gegenprobe steht auch drin.** Ein Turnus bleibt mit Absicht OHNE
 * Leistungszeile: seine Schichten erscheinen in `zeiteintrag_ohne_auftrag`,
 * also in dem Bericht, den FIN-18 verlangt. Demodaten, in denen alles
 * aufgeht, pruefen die Haelfte, auf die es ankommt, gerade nicht.
 *
 * **Die Auftragsnummer kommt aus dem KREIS** (FIN-03), wie in `vertrieb.ts`
 * und `bau.ts`. Hier stand eine von Hand geschriebene — `AU-2026-DEMO1`, die
 * einzige Nummer im ganzen Bestand ohne Zaehler dahinter. Sie sah nach
 * Demodaten aus und war etwas anderes: eine Zeile, die im Betrieb nicht
 * entstehen koennte und die verdeckt, ob der Kreis ueberhaupt zieht.
 *
 * **Idempotent durch LESEN ZUERST** — wie `dienstplan.ts` und aus demselben
 * Grund: die natuerlichen Schluessel liegen auf teilweisen Indizes. Der
 * Schluessel dieses Auftrags ist seit der Kreisvergabe die BEZEICHNUNG: eine
 * gezogene Nummer laesst sich nicht wiedererkennen, und ein zweiter Lauf
 * zoege sonst eine zweite.
 *
 * Laeuft NACH `seedDienstplan`, weil es dessen Turnusse und Einsaetze
 * nachtraeglich verankert. Die Reihenfolge ist eine Abhaengigkeit, keine
 * Vorliebe.
 */
import type postgres from 'postgres';
import { cent, type Cent } from '../../services/finanz/geld.js';
import { vergebeNummer } from '../../services/finanz/nummernkreis.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface AuftragErgebnis {
  readonly auftraege: number;
  readonly leistungen: number;
  readonly verankerteTurnusse: number;
  readonly verankerteEinsaetze: number;
}

const LEER: AuftragErgebnis = {
  auftraege: 0, leistungen: 0, verankerteTurnusse: 0, verankerteEinsaetze: 0,
};

/**
 * Der Regelsteuersatz in Basispunkten.
 *
 * 19 % ist kein erfundener Wert, sondern § 12 Abs. 1 UStG — und er steht als
 * Basispunkte da, weil Geld und Saetze in dieser Plattform ganzzahlig sind
 * (Invariante 1, K-16). Die Steuer wird JE Satzgruppe gebildet, nie aus einer
 * Bruttosumme zurueckgerechnet.
 */
const REGELSATZ_BP = 1900;

export async function seedAuftrag(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<AuftragErgebnis> {
  const reinigung = ids.get('reinigung');
  if (reinigung === undefined) return LEER;

  const [objekt] = await sql<{ id: string; kunde_id: string; bezeichnung: string }[]>`
    select id, kunde_id, bezeichnung from objekt
     where mandant_id = ${reinigung} and archiviert_am is null and kunde_id is not null
     order by objektnummer limit 1`;
  if (objekt === undefined) return LEER;

  /**
   * Der Verantwortliche wird ueber sein RECHT gesucht, nicht ueber das
   * Alphabet.
   *
   * Die Abfrage stand ohne jede Bedingung da — `order by b.email limit 1` ueber
   * ALLE Mitglieder der Gesellschaft. Heute gewann `admin.reinigung@`, und
   * deshalb fiel es nicht auf; in derselben Liste stehen aber der
   * Kundenzugang, der Website-Renderer und der Formular-Eingang. Ein Auftrag,
   * dessen `verantwortlich_benutzer_id` auf ein Dienstkonto oder auf den
   * KUNDEN zeigt, ist eine Zeile, die im Betrieb nie entstehen koennte — und
   * sie entsteht schon beim naechsten Konto, dessen Adresse frueher sortiert.
   * `vertrieb.ts` fragt aus demselben Grund nach `angebot.versenden`.
   */
  const [leitung] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
     join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id
     join berechtigung be on be.id = rb.berechtigung_id
    where be.schluessel = 'auftrag.schreiben'
      and b.status = 'aktiv' and b.ist_dienstkonto = false and bm.entzogen_am is null
    order by b.email limit 1`;
  if (leitung === undefined) return LEER;

  /**
   * Der Schluessel dieses Auftrags ist seine BEZEICHNUNG, nicht seine Nummer.
   *
   * Hier stand `AU-2026-DEMO1` — eine von Hand geschriebene Auftragsnummer,
   * und zwar die einzige im ganzen Bestand ohne Kreis dahinter. `index.ts`
   * legt fuer jede Rechtseinheit einen BESTAETIGTEN `auftrag`-Kreis an
   * (`AU-{jahr}-{nr:5}`), `vertrieb.ts` und `bau.ts` ziehen daraus — dieser
   * Seed schrieb daneben eine Nummer, die keinem Format folgt, keinen Zaehler
   * bewegt und im Betrieb nie entstehen koennte. Genau solche Zeilen
   * verdecken, ob die Nummernvergabe traegt (FIN-03).
   *
   * Gezogen wird deshalb aus dem Kreis, und damit in einer Sitzung:
   * `vergebeNummer` liest `app.aktiver_mandant()` und sperrt die Kreiszeile
   * mit `SELECT … FOR UPDATE`. Der Wiedererkennungsschluessel muss dann ein
   * anderer sein — eine gezogene Nummer kennt man vorher nicht —, sonst zoege
   * jeder zweite Lauf eine WEITERE und legte einen zweiten Auftrag an.
   *
   * Er ist Objekt + Bezeichnung + `angebot_id is null`, und der letzte Teil
   * ist kein Zierat: `wandleInAuftrag` legt aus dem Demoangebot einen Auftrag
   * am SELBEN Objekt an, und eine Browserpruefung hinterlaesst dort einen mit
   * genau derselben Bezeichnung. Ohne diese Bedingung haengte der naechste
   * Lauf seine Leistungszeilen an einen fremden Auftrag — und die Turnusse
   * daran gleich mit.
   */
  const bezeichnung = `Unterhaltsreinigung ${objekt.bezeichnung}`;
  let auftragId: string;
  const [vorhanden] = await sql<{ id: string }[]>`
    select id from auftrag
     where mandant_id = ${reinigung} and objekt_id = ${objekt.id}
       and bezeichnung = ${bezeichnung} and angebot_id is null
     limit 1`;
  if (vorhanden === undefined) {
    const neu = await alsPortalSitzung(sql, reinigung, leitung.id, async (kontext) => {
      const db = {
        unsafe: async (s: string, w: readonly unknown[] = []): Promise<readonly unknown[]> =>
          kontext.schreibe<unknown>(s, w),
      };
      const nummer = await vergebeNummer(db, { kreisTyp: 'auftrag' });
      const [zeile] = await kontext.schreibe<{ id: string }>(
        `insert into auftrag
           (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status, bezeichnung,
            verantwortlich_benutzer_id, start_datum)
         values ($1, $2, $3, $4, 'rahmenvertrag', 'aktiv', $5, $6, '2026-01-01')
         returning id`,
        [kontext.aktiverMandantId, nummer.formatiert, objekt.kunde_id, objekt.id,
         bezeichnung, leitung.id],
      );
      return zeile;
    });
    if (neu === undefined) return LEER;
    auftragId = neu.id;
  } else {
    auftragId = vorhanden.id;
  }

  /**
   * Zwei Leistungszeilen, und sie stehen fuer die zwei Faelle, die die
   * Abrechnung unterscheidet: eine monatlich wiederkehrende Unterhaltsleistung
   * und eine gesondert beauftragte Grundreinigung. Die Preise sind
   * DEMOWERTE — sie tragen keine Aussage ueber echte Marktpreise, und die
   * Kalkulation dahinter ist der Weg, auf dem ein echter Preis entsteht.
   */
  const zeilen: readonly {
    nr: number; bezeichnung: string; menge: number; einheit: string;
    einzelpreisCent: Cent; frequenz: string;
  }[] = [
    {
      nr: 1, bezeichnung: 'Unterhaltsreinigung Bürogeschosse', menge: 1, einheit: 'Monat',
      einzelpreisCent: cent(189_000n), frequenz: '3× wöchentlich',
    },
    {
      nr: 2, bezeichnung: 'Grundreinigung Halle', menge: 1, einheit: 'Einsatz',
      einzelpreisCent: cent(96_000n), frequenz: 'samstags nachts',
    },
  ];

  const leistungIds: string[] = [];
  for (const z of zeilen) {
    const [da] = await sql<{ id: string }[]>`
      select id from auftrag_leistung
       where auftrag_id = ${auftragId} and position_nr = ${z.nr}`;
    if (da !== undefined) {
      leistungIds.push(da.id);
      continue;
    }
    const [neu] = await sql<{ id: string }[]>`
      insert into auftrag_leistung
        (mandant_id, auftrag_id, position_nr, objekt_id, bezeichnung, menge, einheit,
         einzelpreis_cent, steuersatz_bp, leistungsfrequenz_text, gueltig_ab)
      values (${reinigung}, ${auftragId}, ${z.nr}, ${objekt.id}, ${z.bezeichnung},
              ${z.menge}, ${z.einheit}, ${z.einzelpreisCent}, ${REGELSATZ_BP},
              ${z.frequenz}, '2026-01-01')
      returning id`;
    if (neu !== undefined) leistungIds.push(neu.id);
  }
  const unterhalt = leistungIds[0];
  const grund = leistungIds[1];
  if (unterhalt === undefined || grund === undefined) {
    return { ...LEER, auftraege: 1, leistungen: leistungIds.length };
  }

  /**
   * Der Turnus bekommt seinen Abrechnungsanker — und ZWEI von dreien, nicht
   * drei. Die Glasreinigung bleibt ohne: sie ist der Fall, den
   * `zeiteintrag_ohne_auftrag` melden muss.
   */
  const turnusse = await sql<{ id: string; bezeichnung: string }[]>`
    update turnus
       set auftrag_leistung_id = case
             when bezeichnung like 'Grundreinigung%' then ${grund}::uuid
             else ${unterhalt}::uuid end
     where mandant_id = ${reinigung}
       and auftrag_leistung_id is null
       and (bezeichnung like 'Unterhaltsreinigung%' or bezeichnung like 'Grundreinigung%')
     returning id, bezeichnung`;

  /**
   * Und die schon materialisierten Schichten nach. Der Generator hat sie
   * angelegt, bevor es einen Anker gab; die naechsten Laeufe erben ihn selbst.
   *
   * `auftrag_id` steht hier bewusst NICHT: `kern.einsatz_auftrag_ableiten()`
   * (0050) leitet ihn aus der Leistungszeile ab. Ihn hier mitzusetzen liefe
   * ebenso, wuerde aber verdecken, dass der naechtliche Generator ihn gar
   * nicht kennt — und genau darauf beruht, dass sein Lauf nicht an
   * `einsatz_leistung_braucht_auftrag` scheitert.
   */
  const einsaetze = await sql<{ id: string }[]>`
    update einsatz e
       set auftrag_leistung_id = t.auftrag_leistung_id
      from turnus t
     where t.mandant_id = e.mandant_id and t.id = e.turnus_id
       and e.mandant_id = ${reinigung}
       and e.auftrag_leistung_id is null
       and t.auftrag_leistung_id is not null
     returning e.id`;

  return {
    auftraege: 1,
    leistungen: leistungIds.length,
    verankerteTurnusse: turnusse.length,
    verankerteEinsaetze: einsaetze.length,
  };
}
