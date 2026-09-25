import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import {
  istGleicherUrsprung, erwarteterUrsprung, internesZiel,
} from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { cent, type Cent } from '@/server/services/finanz/geld';
import { milliMenge, type MilliMenge } from '@/server/services/finanz/menge';
import { prozentInBasispunkteOderGrund } from '@/server/services/finanz/prozent';
import {
  RechnungFehler, fuegePositionHinzu, fuegeZeitPositionHinzu, istEntwurfRechnungsart,
  legeEntwurfAn, type EntwurfRechnungsart,
} from '@/server/services/finanz/rechnung';
import {
  QuellenFehler, type QuelleEingabe,
} from '@/server/services/finanz/positionsquelle';
import {
  aendereEntwurfKopf, fuegeMaterialPositionHinzu, uebernimmAbrechnungsart,
} from '@/server/services/finanz/entwurf';
import { AbrechnungFehler } from '@/server/services/finanz/abrechnungsart/index';
import { SteuerfallFehler } from '@/server/services/finanz/steuerfall';
import { maskeMitEingaben } from '@/lib/formular/maske';
import { UUID } from '../rumpf';

/**
 * `POST /api/rechnungen` — den Entwurf anlegen, seinen Kopf ändern und ihn
 * bestuecken.
 *
 * Alle Handlungen tragen dasselbe Recht (`finanzen.schreiben`) und laufen
 * deshalb ueber dieselbe Adresse. Die drei Uebergaenge, die ein EIGENES Recht
 * tragen — festschreiben, verwerfen, stornieren — haben je eine eigene
 * Adresse; sie teilen sich keine, weil sonst ein Recht das andere mit
 * durchliesse.
 *
 * Der Handler bleibt duenn: pruefen, den Dienst rufen, antworten. Gerechnet
 * wird in `services/finanz`, entschieden in der Datenbank.
 *
 * **Ein Formular bekommt seine Seite zurueck, kein JSON** (D-599, V-204).
 * Schickt es `zurueck` mit, fuehrt eine Abweisung dorthin — mit dem Grund als
 * Schluessel und, wo die Maske lang ist, mit ihren Eingaben. Ohne `zurueck`
 * antwortet die Route wie bisher mit JSON: ein Programm bekommt Daten.
 */
export const dynamic = 'force-dynamic';

/** Die Felder, die je Maske bei einer Abweisung zurueckreisen (V-240, D-599). */
const MASKE: Readonly<Record<string, readonly string[]>> = {
  anlegen: ['kundeId', 'objektId', 'auftragId', 'rechnungsart', 'leistungVon', 'leistungBis',
    'vereinnahmungGeplantAm', 'zahlungszielTage', 'zahlungsmittelCode', 'kopftext'],
  kopf: ['objektId', 'auftragId', 'rechnungsart', 'leistungVon', 'leistungBis',
    'vereinnahmungGeplantAm', 'zahlungszielTage', 'zahlungsmittelCode', 'kopftext',
    'fusstext'],
  position: ['bezeichnung', 'menge', 'einheit', 'einzelpreisCent', 'steuergruppe',
    'herkunft', 'auftragLeistungId', 'ausgabeId', 'herkunftNotiz'],
  'aus-zeiten': [],
  'aus-abrechnungsart': [],
};

/** Wohin der Browser auf dem Blatt zurueckspringt. */
const ANKER: Readonly<Record<string, string>> = {
  kopf: 'kopf', position: 'position', 'aus-zeiten': 'zeitzeile',
  'aus-abrechnungsart': 'abrechnungsart',
};

const TAG = /^\d{4}-\d{2}-\d{2}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };
  const aktion = text('aktion') ?? 'anlegen';

  /**
   * Die Abweisung — fuer ein Formular eine Seite, fuer ein Programm JSON.
   *
   * `internesZiel` laesst nur einen Pfad DIESER Anwendung durch (D-562); ein
   * fremdes Ziel im versteckten Feld waere eine offene Umleitung.
   */
  const abweisung = (
    grund: string, status: number, extra: Record<string, unknown> = {},
  ): NextResponse => {
    const zurueckFeld = text('zurueck');
    if (zurueckFeld === null) {
      return NextResponse.json({ fehler: grund, ...extra }, { status });
    }
    const werte = Object.fromEntries(
      (MASKE[aktion] ?? []).map((name) => [name, text(name)]));
    const pfad = maskeMitEingaben(zurueckFeld, grund, { ...werte, maske: aktion });
    const ziel = internesZiel(pfad, '/portal', anfrage);
    const anker = ANKER[aktion];
    if (anker !== undefined) ziel.hash = anker;
    return NextResponse.redirect(ziel, 303);
  };

  /**
   * **Zahlen werden GEPRUEFT, nicht gecastet.**
   *
   * Unten stand dreimal `BigInt(text(...))` und einmal `Number(...)` mitten
   * im Schreibvorgang. `BigInt('abc')` wirft einen `SyntaxError`, den die
   * Fehlerkette nicht kennt — sie faengt `RechnungFehler` und `QuellenFehler`
   * —, also wurde aus einer falsch ausgefuellten Zeile eine 500. Eine
   * Falscheingabe ist eine Abweisung, kein Programmfehler, und diese Route
   * antwortet darauf sonst ueberall mit 400.
   *
   * `SyntaxError` mitzufangen waere die schlechtere Reparatur: dann
   * antwortete auch ein echter Programmfehler mit 400.
   *
   * Seit V-204 gilt dasselbe fuer Kennungen und Tage: ein `objektId=abc`
   * oder ein `leistungVon=31.08.` scheiterte sonst erst am Typ in Postgres —
   * mit einer 500 statt eines Satzes.
   */
  const ungueltig: string[] = [];
  const kennungFalsch: string[] = [];
  const centOderNull = (name: string): Cent | null => {
    const wert = text(name);
    if (wert === null) return null;
    if (!/^-?\d{1,18}$/u.test(wert)) { ungueltig.push(name); return null; }
    return cent(BigInt(wert));
  };
  const mengeOderNull = (name: string): MilliMenge | null => {
    const wert = text(name);
    if (wert === null) return null;
    if (!/^-?\d{1,18}$/u.test(wert)) { ungueltig.push(name); return null; }
    return milliMenge(BigInt(wert));
  };
  const ganzzahlOderNull = (name: string, min: number, max: number): number | null => {
    const wert = text(name);
    if (wert === null) return null;
    if (!/^\d{1,9}$/u.test(wert)) { ungueltig.push(name); return null; }
    const zahl = Number(wert);
    if (zahl < min || zahl > max) { ungueltig.push(name); return null; }
    return zahl;
  };
  const tagOderNull = (name: string): string | null => {
    const wert = text(name);
    if (wert === null) return null;
    if (!TAG.test(wert)) { ungueltig.push(name); return null; }
    return wert;
  };
  const kennungOderNull = (name: string): string | null => {
    const wert = text(name);
    if (wert === null) return null;
    if (!UUID.test(wert)) { kennungFalsch.push(name); return null; }
    return wert;
  };

  const stundensatzCent = centOderNull('stundensatzCent');
  const einzelpreisCent = centOderNull('einzelpreisCent');
  const mengeWert = mengeOderNull('menge');
  // `smallint` und ein Zahlungsziel: mehr als zehn Jahre ist keine Frist.
  const zahlungszielTage = ganzzahlOderNull('zahlungszielTage', 0, 3650);
  const leistungVon = tagOderNull('leistungVon');
  const leistungBis = tagOderNull('leistungBis');
  const vereinnahmungGeplantAm = tagOderNull('vereinnahmungGeplantAm');
  const vonDatum = tagOderNull('vonDatum');
  const bisDatum = tagOderNull('bisDatum');
  const rechnungId = kennungOderNull('rechnungId');
  const kundeId = kennungOderNull('kundeId');
  const objektId = kennungOderNull('objektId');
  const auftragId = kennungOderNull('auftragId');
  const auftragLeistungId = kennungOderNull('auftragLeistungId');
  const ausgabeId = kennungOderNull('ausgabeId');
  const aufmassIds = daten.getAll('aufmassIds')
    .filter((w): w is string => typeof w === 'string' && w.trim() !== '')
    .map((w) => w.trim());
  if (aufmassIds.some((w) => !UUID.test(w))) kennungFalsch.push('aufmassIds');

  if (kennungFalsch.length > 0) {
    return abweisung('kennung_ungueltig', 400, { felder: kennungFalsch });
  }
  if (ungueltig.length > 0) return abweisung('ungueltig', 400, { felder: ungueltig });

  const artEingabe = text('rechnungsart') ?? 'standard';
  if (!istEntwurfRechnungsart(artEingabe)) return abweisung('rechnungsart_unbekannt', 400);
  const rechnungsart: EntwurfRechnungsart = artEingabe;

  /*
   * Der Fertigstellungsgrad eines Pauschalpreis-Loses (anteilig) — derselbe
   * Leser wie jeder andere Prozentsatz (`finanz/prozent.ts`), bis 100 %.
   */
  let fertigstellungBp: number | undefined;
  const fertigstellung = text('fertigstellung');
  if (fertigstellung !== null) {
    const p = prozentInBasispunkteOderGrund(fertigstellung, 10_000);
    if (p.art !== 'ok') return abweisung('fertigstellung_ungueltig', 400);
    fertigstellungBp = p.bp;
  }

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'finanzen.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        /**
         * Der Slug kommt aus der SITZUNG, nie aus `?mandant=` (Invariante 3) —
         * dieselbe Regel wie im Uebergangsgeruest (`api/uebergang.ts`).
         */
        const [m] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        const slug = m?.slug ?? '';
        const ziel = await handle(kontext);
        return ziel === null ? null : { slug, ziel };
      })) as Promise<{ slug: string; ziel: string } | null>);

    if (ergebnis === null) return abweisung('unvollstaendig', 400);
    return NextResponse.redirect(
      new URL(`/portal/${ergebnis.slug}/finanzen/rechnungen${ergebnis.ziel}`,
        erwarteterUrsprung(anfrage)),
      303);
  } catch (fehler) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    if (fehler instanceof RechnungFehler) {
      return abweisung(fehler.grund, 409, { text: fehler.message });
    }
    /**
     * Eine fehlende oder unbelegbare Herkunft ist eine Abweisung, kein
     * Programmfehler (FIN-07): der Mensch hat die Begruendung vergessen oder
     * im Zeitraum liegt keine freigegebene Stunde. 409 mit Text, nicht 500.
     */
    if (fehler instanceof QuellenFehler) {
      return abweisung(fehler.grund, 409, { text: fehler.message });
    }
    /* V-206: die Abrechnungsart sagt, WARUM sie nicht rechnet (O-04). */
    if (fehler instanceof AbrechnungFehler) {
      return abweisung(fehler.grund, 409, { text: fehler.message });
    }
    if (fehler instanceof SteuerfallFehler) {
      return abweisung(fehler.grund, 409, { text: fehler.message });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  /** Die eine Handlung dieser Anfrage — `null` heisst: es fehlte eine Pflichtangabe. */
  async function handle(kontext: SchreibKontext): Promise<string | null> {
    /**
     * **Die Zeile AUS der Zeiterfassung** (TIM-12, FIN-07) — der Weg, den
     * die Seitenkarte „billing type, then source" nennt.
     *
     * Er steht vor `position`, weil er der Regelfall sein soll: eine Zeile,
     * die aus freigegebenen Zeiteintraegen entsteht, traegt ihren Beleg
     * von selbst und kann sich nicht vertippen. Die Handeingabe darunter
     * ist die Ausnahme und verlangt deshalb eine Begruendung.
     */
    if (aktion === 'aus-zeiten') {
      if (rechnungId === null || stundensatzCent === null) return null;
      await fuegeZeitPositionHinzu(kontext, {
        rechnungId,
        bezeichnung: text('bezeichnung') ?? 'Geleistete Stunden',
        stundensatzCent,
        steuergruppe: text('steuergruppe') ?? 'ust_19',
        auftragLeistungId,
        auftragId,
        vonDatum,
        bisDatum,
      });
      return `/${rechnungId}`;
    }

    /**
     * **Nach der Abrechnungsart des Auftrags** (V-206, FIN-01). Zeitraum und
     * Auftrag stehen im Kopf des Entwurfs; die Maske nennt nur, was die Art
     * zusaetzlich braucht — die Leistungszeile, die Aufmassblaetter, den
     * Fertigstellungsgrad.
     */
    if (aktion === 'aus-abrechnungsart') {
      if (rechnungId === null) return null;
      await uebernimmAbrechnungsart(kontext, rechnungId, {
        auftragLeistungId,
        aufmassIds,
        ...(fertigstellungBp === undefined ? {} : { fertigstellungBp }),
      });
      return `/${rechnungId}?hinweis=uebernommen#positionen`;
    }

    /** **Der Kopf des Entwurfs** (V-204, V-205). Nur ein Entwurf ändert sich. */
    if (aktion === 'kopf') {
      if (rechnungId === null) return null;
      const aenderung = await aendereEntwurfKopf(kontext, rechnungId, {
        objektId, auftragId, rechnungsart,
        leistungVon, leistungBis, vereinnahmungGeplantAm,
        zahlungszielTage,
        zahlungsmittelCode: text('zahlungsmittelCode'),
        kopftext: text('kopftext'),
        fusstext: text('fusstext'),
      });
      const hinweis = aenderung.abzugZurueckgenommen
        ? 'abzug_zurueckgenommen' : 'kopf_gespeichert';
      return `/${rechnungId}?hinweis=${hinweis}#kopf`;
    }

    if (aktion === 'position') {
      if (rechnungId === null || mengeWert === null || einzelpreisCent === null) {
        return null;
      }
      /**
       * **Die Herkunft ist Pflicht** (FIN-07, §4.4). Das Formular bietet
       * drei Wege an: eine Vertragszeile als Beleg, eine Ausgabe als Beleg
       * (Material, V-206), oder ausdruecklich „von Hand" MIT Begruendung.
       * Einen vierten — „ohne Angabe" — gibt es nicht, und der Handler
       * erfindet auch keinen: fehlt die Begruendung, weist der Dienst ab, und
       * die Datenbank taete es beim COMMIT ohnehin.
       */
      const herkunft = text('herkunft') ?? 'manuell';

      /**
       * Menge und Preis kommen als ganze Zahlen herein — Tausendstel und
       * Cent (K-16, Invariante 1). Die Oberflaeche rechnet nicht um: eine
       * Gleitkommazahl an dieser Stelle waere ein Bruchteil eines Cents,
       * der spaeter niemandem mehr auffaellt.
       */
      if (herkunft === 'material') {
        if (ausgabeId === null) return null;
        await fuegeMaterialPositionHinzu(kontext, {
          rechnungId,
          ausgabeId,
          bezeichnung: text('bezeichnung') ?? '',
          beschreibung: text('beschreibung'),
          menge: mengeWert,
          einheit: text('einheit') ?? '',
          einzelpreisCent,
          steuergruppe: text('steuergruppe') ?? 'ust_19',
        });
        return `/${rechnungId}#positionen`;
      }

      const quellen: QuelleEingabe[] = herkunft === 'vertrag'
        ? [{ typ: 'vertrag', id: auftragLeistungId }]
        : [{ typ: 'manuell', notiz: text('herkunftNotiz') }];
      await fuegePositionHinzu(kontext, {
        rechnungId,
        bezeichnung: text('bezeichnung') ?? '',
        beschreibung: text('beschreibung'),
        menge: mengeWert,
        einheit: text('einheit') ?? '',
        einzelpreisCent,
        steuergruppe: text('steuergruppe') ?? 'ust_19',
        auftragLeistungId: herkunft === 'vertrag' ? auftragLeistungId : null,
        quellen,
      });
      return `/${rechnungId}`;
    }

    if (kundeId === null) return null;
    const neu = await legeEntwurfAn(kontext, {
      kundeId,
      objektId,
      /* V-205: Auftrag und Rechnungsart — der Dienst prueft, ob beides passt. */
      auftragId,
      rechnungsart,
      leistungVon,
      leistungBis,
      vereinnahmungGeplantAm,
      // Kein Vorgabewert (§4.2): fehlt die Eingabe, loest der Dienst auf,
      // und bleibt es NULL, weist die Festschreibung benannt ab.
      zahlungszielTage,
      // BT-81. `zahlungsmittelCode` siebt selbst: was nicht in UNTDID 4461
      // steht, kommt als null an und nicht als Freitext auf den Beleg.
      zahlungsmittelCode: text('zahlungsmittelCode'),
      kopftext: text('kopftext'),
    });
    return `/${neu}`;
  }
}
