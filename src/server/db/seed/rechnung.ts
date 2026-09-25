import type postgres from 'postgres';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand,
} from '../../services/finanz/rechnung.js';
import { cent } from '../../services/finanz/geld.js';
import { milliMenge } from '../../services/finanz/menge.js';
import { alsPortalSitzung } from './sitzung.js';
import { schreibeVerrechnung } from '../../services/finanz/abschlag/index.js';
import type { Abfrage } from '../../services/finanz/rechnung.js';

/**
 * Ausgangsrechnungen für die Vorführung — über den ECHTEN Weg (FIN-01…FIN-04).
 *
 * **Warum es diese Datei gibt.** Ohne eine einzige festgeschriebene Rechnung
 * ist der halbe Betrieb unsichtbar: der Umsatzbericht zeigt Nullen, die
 * offenen Posten sind leer, die Hashkette hat kein Glied, die
 * Gruppenauswertung teilt nichts auf, und die Buchhaltung hat nichts zu
 * buchen. Wer die Plattform ansieht, sieht ein Gerüst und schliesst daraus
 * auf ein Gerüst.
 *
 * **Warum sie nur auf Entwicklungsflächen läuft.** Der Rechnungskreis ist in
 * der Produktion ein Platzhalter (O-134), und das bleibt richtig: eine
 * vergebene Rechnungsnummer nimmt man nicht zurück. Auf der Vorführfläche
 * trägt der Kreis die Maske `DEMO-{jahr}-{nr:5}`, und damit steht in jeder
 * einzelnen Nummer, was sie ist.
 *
 * **Warum über den Dienst und nicht per `insert`.** `rechnung` trägt
 * Invariante 4 als CHECK: festgeschrieben heisst Nummer, Nummernkreis,
 * laufende Nummer, Festschreibzeitpunkt, Festschreibender, Zahlungsziel und
 * Fälligkeit — alles zusammen oder gar nicht, dazu `hash` über die Kette.
 * Von Hand einzusetzen hiesse, acht Spalten zu erfinden und dabei genau den
 * Weg zu umgehen, den das Portal später nimmt. `legeEntwurfAn` →
 * `fuegePositionHinzu` → `finalisiere` ist derselbe Weg wie im Portal, und er
 * geht über `cse_app` mit gebundener Sitzung — nicht über den Eigentümer.
 *
 * **Und ein Entwurf bleibt stehen.** Ein Bestand, in dem alles
 * festgeschrieben ist, zeigt den einen Zustand nicht, der die Invariante
 * trägt: den ohne Nummer. Der Entwurf ist der Beweis, dass Nummern erst beim
 * Festschreiben entstehen — und er füllt die Entwurfsliste, die sonst leer
 * wäre.
 */

type Sql = postgres.Sql<Record<string, unknown>>;

export interface RechnungsErgebnis {
  readonly festgeschrieben: number;
  readonly entwuerfe: number;
  readonly nummern: readonly string[];
  readonly uebersprungen: boolean;
  readonly grund: string | null;
}

const LEER: RechnungsErgebnis = {
  festgeschrieben: 0, entwuerfe: 0, nummern: [], uebersprungen: true, grund: null,
};

/**
 * Eine Position, wie sie eine Unterhaltsreinigung oder ein Objektschutz
 * trägt.
 *
 * **`mengeMilli` heißt, was es heißt: TAUSENDSTEL** (K-16). Die Spalte ist
 * `numeric(12,3)`, und `milliMenge()` nimmt genau diese Einheit. Das Feld
 * hieß vorher `menge` und trug ganze Stück: `menge: 160n` ging als 0,160
 * Stunden in die Rechnung, und weil zwei der drei Rechnungen sofort
 * festgeschrieben werden, standen die falschen Beträge unveränderlich in
 * einer lückenlosen Nummernfolge. Der Name trägt die Einheit jetzt mit —
 * eine Menge ohne Einheit ist eine Zahl, die irgendjemand später deutet.
 */
interface Posten {
  readonly bezeichnung: string;
  readonly mengeMilli: bigint;
  readonly einheit: string;
  readonly einzelpreisCent: bigint;
}

const POSTEN: Readonly<Record<string, readonly Posten[]>> = {
  reinigung: [
    { bezeichnung: 'Unterhaltsreinigung Bürogeschoss, monatlich',
      mengeMilli: 1_000n, einheit: 'psch', einzelpreisCent: 189_000n },
    { bezeichnung: 'Glasreinigung innen, Fensterflügel',
      mengeMilli: 48_000n, einheit: 'stk', einzelpreisCent: 420n },
  ],
  security: [
    { bezeichnung: 'Objektschutz, Nachtdienst 22:00–06:00',
      mengeMilli: 160_000n, einheit: 'h', einzelpreisCent: 2_890n },
    { bezeichnung: 'Schliessdienst, Wochenende',
      mengeMilli: 8_000n, einheit: 'h', einzelpreisCent: 3_150n },
  ],
  bau: [
    { bezeichnung: 'Rückbau Trockenbauwände, Abschlagsrechnung',
      mengeMilli: 1_000n, einheit: 'psch', einzelpreisCent: 1_240_000n },
    { bezeichnung: 'Entsorgung Bauschutt, Container 7 m³',
      mengeMilli: 3_000n, einheit: 'stk', einzelpreisCent: 38_500n },
  ],
};

/**
 * Der Leistungszeitraum ist PFLICHT (§ 14 Abs. 4 Nr. 6 UStG) — `finalisiere`
 * prüft es, und das ist richtig so. Genommen wird der Vormonat: ein Zeitraum,
 * der in der Zukunft endet, wäre eine Rechnung über nicht Erbrachtes.
 */
function vormonat(heute: string): { von: string; bis: string } {
  const [j, m] = heute.split('-').map(Number) as [number, number];
  const jahr = m === 1 ? j - 1 : j;
  const monat = m === 1 ? 12 : m - 1;
  const letzter = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  const zwei = (n: number): string => String(n).padStart(2, '0');
  return {
    von: `${String(jahr)}-${zwei(monat)}-01`,
    bis: `${String(jahr)}-${zwei(monat)}-${zwei(letzter)}`,
  };
}

/**
 * **Ein Abschlag und die Schlussrechnung dazu — am Auftrag** (V-205, FIN-08).
 *
 * Bis dahin legte der Seed nur `standard` ohne Auftrag an, und damit
 * erschien keiner der Wege, die an Rechnungsart und Auftrag hängen: der
 * Verweis „Abschläge und Abzug", das Formular „Abschläge abziehen", die
 * Abzugstabelle, die Prüfung auf fehlende Zeiterfassung (FIN-18). Jetzt
 * steht im Bau der Auftrag des Seeds mit
 *
 *  - einer FESTGESCHRIEBENEN Abschlagsrechnung, die statt des
 *    Leistungszeitraums den Tag der Vereinnahmung nennt (§14 Abs. 4 Nr. 6
 *    UStG, zweite Alternative — das Feld dafür gab es vor V-205 nicht), und
 *  - einer Schlussrechnung als ENTWURF, von der dieser Abschlag abgezogen
 *    ist. Entwurf, damit die Vorführung Kopf, Abzug und Übernahme zeigen
 *    kann; festschreiben lässt sie sich wie jede andere.
 *
 * Die Beträge sind Demowerte wie die übrigen dieser Datei. Ohne sichtbaren
 * Auftrag im Bau (`auftrag.lesen`) bleibt es bei den drei Belegen oben.
 */
async function abschlagUndSchluss(
  db: Abfrage, zeitraum: { von: string; bis: string },
): Promise<{ abschlagNummer: string } | null> {
  const [auftrag] = await db.abfrage<{ id: string; kunde_id: string }>(
    `select id::text as id, kunde_id::text as kunde_id from auftrag
      where status <> 'storniert' and art = 'projekt' and kunde_id is not null
      order by erstellt_am, auftragsnummer limit 1`);
  if (auftrag === undefined) return null;

  const abschlag = await legeEntwurfAn(db, {
    kundeId: auftrag.kunde_id,
    auftragId: auftrag.id,
    rechnungsart: 'abschlag',
    vereinnahmungGeplantAm: zeitraum.bis,
    zahlungszielTage: 14,
    zahlungsmittelCode: '58',
    kopftext: '1. Abschlagsrechnung nach Baufortschritt.',
  });
  await fuegePositionHinzu(db, {
    rechnungId: abschlag,
    bezeichnung: '1. Abschlag Rückbau, Baufortschritt Trockenbau',
    menge: milliMenge(1_000n),
    einheit: 'psch',
    einzelpreisCent: cent(800_000n),
    steuergruppe: 'ust_19',
    quellen: vonHand('Demodaten des Seeds — Abschlag nach Baufortschritt, keine Messung.'),
  });
  const fest = await finalisiere(db, abschlag);

  const schluss = await legeEntwurfAn(db, {
    kundeId: auftrag.kunde_id,
    auftragId: auftrag.id,
    rechnungsart: 'schluss',
    leistungVon: zeitraum.von,
    leistungBis: zeitraum.bis,
    zahlungszielTage: 30,
    zahlungsmittelCode: '58',
    kopftext: 'Schlussrechnung. Der geleistete Abschlag ist abgezogen.',
  });
  await fuegePositionHinzu(db, {
    rechnungId: schluss,
    bezeichnung: 'Rückbau Trockenbauwände, Gesamtleistung',
    menge: milliMenge(1_000n),
    einheit: 'psch',
    einzelpreisCent: cent(1_950_000n),
    steuergruppe: 'ust_19',
    quellen: vonHand('Demodaten des Seeds — Gesamtleistung laut Abnahme, keine Messung.'),
  });
  await schreibeVerrechnung(db, schluss);
  return { abschlagNummer: fest.nummer };
}

export async function seedRechnungen(
  sql: Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<RechnungsErgebnis> {
  if (!demodaten) {
    return { ...LEER, grund: 'ohne CSE_DEV_FLAECHEN: der Rechnungskreis ist Platzhalter (O-134)' };
  }

  const nummern: string[] = [];
  let festgeschrieben = 0;
  let entwuerfe = 0;

  for (const [slug, posten] of Object.entries(POSTEN)) {
    const mandantId = ids.get(slug);
    if (mandantId === undefined) continue;

    /*
     * Die Administration dieser Gesellschaft schreibt fest — nicht „irgendein
     * Konto". `finalisiere` verlangt `finanzen.festschreiben`, und wer es
     * haelt, steht im Rechtemodell und nicht in dieser Datei.
     */
    const [konto] = await sql<{ id: string }[]>`
      select b.id
        from benutzer b
        join benutzer_mandant bm on bm.benutzer_id = b.id and bm.entzogen_am is null
        join rolle r on r.id = bm.rolle_id
       where bm.mandant_id = ${mandantId}
         and r.schluessel in ('admin', 'leitung')
         and b.status = 'aktiv'
       order by (r.schluessel = 'admin') desc, b.email
       limit 1`;
    if (konto === undefined) continue;

    /*
     * **Ein zweiter Seed legt nichts nach.** Ohne diese Frage wuechse der
     * Bestand mit jedem Lauf um sechs Rechnungen, und weil eine
     * festgeschriebene Rechnung unveraenderlich ist (Invariante 4), liesse
     * sie sich auch nicht wieder wegnehmen. Der Seed ist wiederholbar, also
     * muss er hier fragen.
     */
    const [bestand] = await sql<{ anzahl: string }[]>`
      select count(*)::text as anzahl from rechnung
       where mandant_id = ${mandantId}`;
    if (bestand!.anzahl !== '0') continue;

    const [kunde] = await sql<{ id: string }[]>`
      select id from kunde
       where mandant_id = ${mandantId} and archiviert_am is null and anonymisiert_am is null
       order by kundennummer limit 1`;
    if (kunde === undefined) continue;

    const [uhr] = await sql<{ tag: string }[]>`select app.berlin_heute()::text as tag`;
    const zeitraum = vormonat(uhr!.tag);

    const ergebnis = await alsPortalSitzung(sql, mandantId, konto.id, async (kontext) => {
      const db = { abfrage: kontext.abfrage.bind(kontext) };
      const eigene: string[] = [];

      /* Zwei festgeschriebene und ein Entwurf — der Entwurf bleibt ohne Nummer. */
      for (const [lauf, art] of [[0, 'fest'], [1, 'fest'], [2, 'entwurf']] as const) {
        const id = await legeEntwurfAn(db, {
          kundeId: kunde.id,
          rechnungsart: 'standard',
          zahlungszielTage: 14,
          leistungVon: zeitraum.von,
          leistungBis: zeitraum.bis,
          /*
           * **BT-81 (BR-DE-1) — ohne sie entsteht aus keinem Beleg eine
           * XRechnung und kein ZUGFeRD.**
           *
           * `zahlungsmittel_code` hat keinen Vorgabewert, und der Seed setzte
           * ihn nirgends. Die Folge war still und teuer: jeder Demobeleg war
           * festgeschrieben, gehasht und im Ausgangsbuch — und `belegAusgabe`
           * antwortete auf JEDEN `unvollstaendig`. Die Knöpfe im Kundenportal
           * erschienen nie, die beiden Ausgaberouten liefen in keinem
           * Durchlauf mit, und „seed data exercises it" (CLAUDE.md) war für
           * den ganzen Ausgabeweg nicht erfüllt.
           *
           * `58` ist die SEPA-Überweisung (UNTDID 4461) — die Zahlungsart,
           * die zu einem Geschäftskonto mit IBAN gehört, und das ist genau,
           * was der Seed anlegt (BR-DE-13 verlangt dann die IBAN der
           * Gesellschaft, und sie steht). Ein DEMOWERT wie die Beträge
           * daneben: welche Zahlungsart eine Gesellschaft je Kunde wirklich
           * vereinbart, steht im Vertrag und nicht hier.
           */
          zahlungsmittelCode: '58',
        });
        for (const p of posten) {
          await fuegePositionHinzu(db, {
            rechnungId: id,
            bezeichnung: p.bezeichnung,
            menge: milliMenge(p.mengeMilli * (lauf === 1 ? 2n : 1n)),
            einheit: p.einheit,
            einzelpreisCent: cent(p.einzelpreisCent),
            steuergruppe: 'ust_19',
            quellen: vonHand('Demodaten des Seeds — von Hand erfasst, keine Messung.'),
          });
        }
        if (art === 'fest') {
          const fest = await finalisiere(db, id);
          eigene.push(fest.nummer);
        }
      }
      /* V-205: im Bau ein Abschlag und die Schlussrechnung dazu, am Auftrag. */
      const kette = slug === 'bau' ? await abschlagUndSchluss(db, zeitraum) : null;
      if (kette !== null) eigene.push(kette.abschlagNummer);
      return { eigene, schlussEntwurf: kette !== null };
    });

    nummern.push(...ergebnis.eigene);
    festgeschrieben += ergebnis.eigene.length;
    entwuerfe += ergebnis.schlussEntwurf ? 2 : 1;
  }

  return { festgeschrieben, entwuerfe, nummern, uebersprungen: false, grund: null };
}
