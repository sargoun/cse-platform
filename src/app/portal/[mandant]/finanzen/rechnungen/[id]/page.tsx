import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgres } from '@/server/services/finanz/menge';
import { ermittleSteuerfall } from '@/server/services/finanz/steuerfall';
import { ladeQuellen, pruefeZeiterfassung, type Fin18Befund, type QuelleZeile }
  from '@/server/services/finanz/positionsquelle';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { RECHNUNG_AKTE_TEXTE } from '@/lib/i18n/verwaltung/finanzen/rechnung-akte';
import { RECHNUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/rechnungen';
import { RECHNUNG_ENTWURF_TEXTE } from '@/lib/i18n/verwaltung/finanzen/rechnung-entwurf';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { haeltRechte } from '@/app/portal/rechte';
import { vorbelegt } from '@/lib/formular/maske';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { tagInSprache } from '@/lib/datum/kalendertag';
import { formatiereGeldIn } from '@/server/services/finanz/geld';
import { formatiereMengeIn } from '@/server/services/finanz/menge';
import { prozentText } from '@/server/services/finanz/prozent';
import { ZAHLUNGSMITTEL } from '@/server/services/finanz/zahlungsmittel';
import { ENTWURF_RECHNUNGSARTEN, istVorauszahlung } from '@/server/services/finanz/rechnung';
import {
  aufmasseZumAuftrag, auftraegeZurAuswahl, grundOhneLeistungszeitpunkt,
  vorschauAbrechnungsart, weiterberechenbareAusgaben,
  type AbrechnungsVorschau, type AufmassAuswahl, type AuftragAuswahl, type AusgabeAuswahl,
} from '@/server/services/finanz/entwurf';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]` — **Entwurfseditor ODER
 * festgeschriebene Ansicht, nie beides** (04-SEITENKARTE.md §5).
 *
 * Das ist keine Darstellungsfrage. Ein Formular auf einem festgeschriebenen
 * Beleg verspricht eine Aenderung, die die Datenbank anschliessend ablehnt —
 * und der Mensch, der es ausfuellt, lernt aus einer Fehlermeldung, was die
 * Oberflaeche ihm haette sagen muessen.
 *
 * **Eine Position laesst sich nicht ENTFERNEN, nur korrigieren.** Invariante 8
 * kennt in dieser Domaene keinen Hard Delete, und `rechnungsposition` traegt
 * keine Zustandsspalte. Wer neu anfangen will, verwirft den Entwurf — der
 * bleibt mit Grund stehen und kostet keine Nummer. Der Knopf dafuer steht
 * unten.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  festgeschrieben: 'Abgeschlossen',
  verworfen: 'Archiviert',
};

/*
 * Kennungen, keine Woerter. Der Name eines Rechts und der Code eines
 * EN16931-Feldes lauten in beiden Sprachen gleich; sie stehen deshalb hier und
 * nicht in der Texttabelle, wo eine zweite Spalte nur eine Erfindung waere.
 */
const RECHT_STORNIEREN = 'finanzen.stornieren';
const BT_MENGENEINHEIT = 'BT-130';

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsart: string;
  readonly kunde: string;
  readonly kunde_id: string;
  readonly objekt: string | null;
  readonly rechnungsdatum: string | null;
  readonly leistung_von: string | null;
  readonly leistung_bis: string | null;
  readonly abzug_brutto_cent: string;
  readonly reverse_charge: boolean;
  readonly reverse_charge_grundlage: string | null;
  readonly steuerhinweis: string | null;
  readonly bauabzugsteuer_pflichtig: boolean;
  readonly bauabzugsteuer_satz_bp: number | null;
  readonly einbehalt_bauabzugsteuer_cent: string;
  readonly ueberweisungsbetrag_cent: string;
  readonly freistellung_nummer: string | null;
  readonly zahlbetrag_cent: string;
  readonly auftrag_id: string | null;
  readonly zahlungsziel_tage: number | null;
  readonly faellig_am: string | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly kopftext: string | null;
  readonly verworfen_grund: string | null;
  /* V-204/V-205: was der Kopf des Entwurfs in seiner Maske braucht. */
  readonly objekt_id: string | null;
  readonly auftragsnummer: string | null;
  readonly auftrag_bezeichnung: string | null;
  readonly leistung_von_tag: string | null;
  readonly leistung_bis_tag: string | null;
  readonly vereinnahmung_tag: string | null;
  readonly zahlungsmittel_code: string | null;
  readonly fusstext: string | null;
  readonly hash: string | null;
  readonly kette_position: string | null;
  readonly storniert_durch: string | null;
  readonly ersetzt_durch: string | null;
}

interface Pos {
  readonly id: string;
  readonly position_nr: number;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly unece_code: string | null;
  readonly einzelpreis_cent: string | null;
  readonly netto_cent: string | null;
  readonly gruppe: string;
  readonly satz_bp: number;
}

interface Steuer {
  readonly gruppe: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

/**
 * Eine abgezogene Abschlagsrechnung, je Steuergruppe (FIN-08).
 *
 * Sie steht auf dem Beleg, weil der Kunde sonst einen Zahlbetrag sieht, den
 * er aus dem Sichtbaren nicht nachrechnen kann — Positionen, Summen, und
 * dazwischen eine Differenz ohne Erklaerung.
 */
interface Abzug {
  readonly nummer: string;
  readonly rechnungsdatum: string | null;
  readonly gruppe: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

interface Leistung {
  readonly id: string;
  readonly position_nr: number;
  readonly bezeichnung: string;
}

interface Einheit { readonly schluessel: string; readonly bezeichnung: string;
  readonly ist_platzhalter: boolean }
interface Gruppe { readonly schluessel: string; readonly bezeichnung: string }

export default async function Rechnungsblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/rechnungen/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(RECHNUNG_AKTE_TEXTE, zugang.sprache);
  const e = nachSprache(RECHNUNG_ENTWURF_TEXTE, zugang.sprache);
  const rt = nachSprache(RECHNUNGEN_TEXTE, zugang.sprache);
  const arten = rt.artNamen;
  const g = verwaltungTexte(zugang.sprache);

  /*
   * V-204 … V-206: Auftrag, Ausgaben und die Abrechnung des Auftrags tragen
   * EIGENE Rechte. Ohne sie steht der Satz, welches Recht fehlt — keine leere
   * Liste, die „nichts da" behauptet, und kein Verweis auf ein 404 (AUT-06).
   */
  const darf = await haeltRechte(
    sitzung, 'auftrag.lesen', 'eingang.lesen', 'abrechnung.schreiben');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kopf: (await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status,
                r.rechnungsart::text as rechnungsart,
                k.name as kunde, k.id::text as kunde_id, o.bezeichnung as objekt,
                to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                to_char(r.leistung_von, 'DD.MM.YYYY') as leistung_von,
                to_char(r.leistung_bis, 'DD.MM.YYYY') as leistung_bis,
                r.zahlungsziel_tage, to_char(r.faellig_am, 'DD.MM.YYYY') as faellig_am,
                r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text, r.brutto_cent::text,
                r.abzug_brutto_cent::text, r.zahlbetrag_cent::text, r.auftrag_id,
                r.reverse_charge, r.reverse_charge_grundlage::text as reverse_charge_grundlage,
                r.steuerhinweis, r.bauabzugsteuer_pflichtig, r.bauabzugsteuer_satz_bp,
                r.einbehalt_bauabzugsteuer_cent::text, r.ueberweisungsbetrag_cent::text,
                fb.bescheinigung_nummer as freistellung_nummer,
                r.kopftext, r.verworfen_grund,
                r.objekt_id::text as objekt_id, a.auftragsnummer,
                a.bezeichnung as auftrag_bezeichnung,
                to_char(r.leistung_von, 'YYYY-MM-DD') as leistung_von_tag,
                to_char(r.leistung_bis, 'YYYY-MM-DD') as leistung_bis_tag,
                to_char(r.vereinnahmung_geplant_am, 'YYYY-MM-DD') as vereinnahmung_tag,
                r.zahlungsmittel_code, r.fusstext,
                h.hash, h.kette_position::text,
                (select s.nummer from rechnung_beziehung b
                   join rechnung s on s.id = b.von_rechnung_id
                  where b.zu_rechnung_id = r.id and b.art = 'storno' limit 1) as storniert_durch,
                (select s.nummer from rechnung_beziehung b
                   join rechnung s on s.id = b.von_rechnung_id
                  where b.zu_rechnung_id = r.id and b.art = 'ersetzt' limit 1) as ersetzt_durch
           from rechnung r
           join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
           left join objekt o on o.mandant_id = r.mandant_id and o.id = r.objekt_id
           -- Ohne auftrag.lesen bleibt die Nummer leer; die Kennung steht
           -- trotzdem am Kopf, und das Blatt sagt, welches Recht fehlt.
           left join auftrag a on a.mandant_id = r.mandant_id and a.id = r.auftrag_id
           left join rechnung_hash h on h.rechnung_id = r.id
           left join freistellungsbescheinigung fb
                  on fb.mandant_id = r.mandant_id
                 and fb.id = r.freistellungsbescheinigung_id
          where r.id = $1`, [id]))[0] ?? null,
      positionen: await kontext.abfrage<Pos>(
        `select p.id, p.position_nr, p.bezeichnung, p.menge::text, p.einheit,
                e.unece_code, p.einzelpreis_cent::text, p.netto_cent::text,
                g.schluessel as gruppe, p.satz_bp
           from rechnungsposition p
           join steuersatz_gruppe g on g.id = p.steuersatz_gruppe_id
           left join masseinheit e on e.id = p.masseinheit_id
          where p.rechnung_id = $1 order by p.position_nr`, [id]),
      /**
       * Die abgezogenen Abschlaege — nur die WIRKSAMEN. Eine unwirksam
       * gewordene Zeile (die Schlussrechnung wurde storniert) bleibt in der
       * Tabelle stehen (Invariante 8) und gehoert nicht mehr auf den Beleg.
       */
      abzuege: await kontext.abfrage<Abzug>(
        `select a.nummer, to_char(a.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                g.schluessel as gruppe,
                (select rs.satz_bp from rechnung_steuer rs
                  where rs.rechnung_id = b.abschlag_rechnung_id
                    and rs.steuersatz_gruppe_id = b.steuersatz_gruppe_id) as satz_bp,
                b.abzug_netto_cent::text as netto_cent,
                b.abzug_steuer_cent::text as steuer_cent
           from abschlagsrechnung_bezug b
           join rechnung a on a.mandant_id = b.mandant_id and a.id = b.abschlag_rechnung_id
           join steuersatz_gruppe g on g.id = b.steuersatz_gruppe_id
          where b.schluss_rechnung_id = $1 and b.wirksam
          order by a.rechnungsdatum, a.nummer, g.schluessel`, [id]),
      steuer: await kontext.abfrage<Steuer>(
        `select g.schluessel as gruppe, s.satz_bp, s.netto_cent::text, s.steuer_cent::text
           from rechnung_steuer s
           join steuersatz_gruppe g on g.id = s.steuersatz_gruppe_id
          where s.rechnung_id = $1 and (s.netto_cent <> 0 or s.steuer_cent <> 0)
          order by g.schluessel`, [id]),
      einheiten: await kontext.abfrage<Einheit>(
        `select schluessel, bezeichnung, ist_platzhalter from masseinheit order by schluessel`),
      gruppen: await kontext.abfrage<Gruppe>(
        `select schluessel, bezeichnung from steuersatz_gruppe
          where app.berlin_heute() >= gueltig_von
            and (gueltig_bis is null or app.berlin_heute() <= gueltig_bis)
          order by satz_bp desc`),
      /**
       * Die Herkunft jeder Zeile (FIN-07, DSH-04) — mit Beschriftung, Ziel und
       * dem auf sie entfallenden Anteil. Gebildet wird das im DIENST, nicht
       * hier: dieselbe Zeile fuehrt aus der Rechnung, aus dem Bericht und aus
       * einem spaeteren Export an dieselbe Stelle, und drei Kopien eines
       * Pfades driften.
       */
      quellen: await ladeQuellen(kontext, id),
      /**
       * Der Steuerfall, NEU GERECHNET beim Anzeigen (FIN-09, FIN-10).
       *
       * Gespeichert sind die Folgen (`reverse_charge`, der Einbehalt); was
       * NICHT gespeichert ist, ist der Hinweis, wenn Kopf und Positionen
       * auseinandergehen — und genau der muss auf dem Bildschirm stehen,
       * bevor jemand festschreibt.
       */
      steuerfall: await ermittleSteuerfall(kontext, id),
      /**
       * Die Leistungszeilen des Auftrags — die eine Herkunft, die sich hier
       * OHNE Zeiterfassung belegen laesst, und zugleich der Anker der
       * Stundenzeile darunter. Ist die Rechnung keinem Auftrag zugeordnet,
       * bleibt die Liste leer und das Formular bietet nur „von Hand" an.
       */
      leistungen: await kontext.abfrage<Leistung>(
        `select al.id::text as id, al.position_nr, al.bezeichnung
           from auftrag_leistung al
           join rechnung r on r.mandant_id = al.mandant_id and r.auftrag_id = al.auftrag_id
          where r.id = $1
          order by al.position_nr`, [id]),
      /**
       * FIN-18 — und nur, wenn der Betrachter ueberhaupt festschreiben darf.
       *
       * `fin.auftrag_erfasste_minuten()` verlangt `finanzen.festschreiben` und
       * weist sonst ab. Den Aufruf ungeprueft zu wagen liesse diese Seite fuer
       * jeden abstuerzen, der eine Rechnung nur ANSEHEN darf.
       */
      fin18: (await kontext.abfrage<{ darf: boolean }>(
        `select app.hat_recht('finanzen.festschreiben', app.aktiver_mandant()) as darf`,
      ))[0]?.darf === true
        ? await pruefeZeiterfassung(kontext, id)
        : null,
      /**
       * Darf dieser Mensch ueberhaupt stornieren?
       *
       * Die Frage MUSS hier gestellt werden und nicht erst an der Route.
       * `finanzen.stornieren` haelt heute nur `super_admin` (Katalog:
       * `gebunden: ['super_admin'], bindbar: ['admin','leitung']`) — und der
       * Vorgabewert ist ausdruecklich vorlaeufig, solange O-77 offen ist.
       * Das Formular stand trotzdem auf JEDEM festgeschriebenen Beleg: die
       * Verwaltung einer Gesellschaft tippte einen auditfaehigen Grund, drueckte
       * „Stornieren" und bekam die rohe Zeichenkette `{"fehler":"unbekannt"}`
       * ins Fenster — 404, weil dieses Projekt fehlende Rechte nicht
       * bestaetigt (AUT-06). Ein Bedienelement, das jeder sieht und niemand
       * benutzen kann, ist schlimmer als keines: es sagt, die Korrektur sei
       * moeglich, und nimmt dem Leser die eine Auskunft, die er braucht —
       * naemlich WER sie vornehmen kann.
       *
       * // TODO(client, O-77): Wer darf eine festgeschriebene Rechnung
       * stornieren — nur die Gruppenleitung, oder auch die Verwaltung einer
       * Gesellschaft? Invariante 4 legt den MECHANISMUS fest (Stornobuchung)
       * und sagt ueber die Befugnis nichts.
       */
      darfStornieren: ((await kontext.abfrage<{ darf: boolean }>(
        `select app.hat_recht('finanzen.stornieren', app.aktiver_mandant()) as darf`,
      ))[0]?.darf) === true,
      /*
       * `/finanzen/rechnungen/[id]/xrechnung` verlangt laut Manifest
       * `finanzen.herunterladen`; diese Seite oeffnet mit `finanzen.lesen`.
       * „XRechnung ansehen" stand sonst auch vor dem, der das Blatt nicht
       * oeffnen darf, und fuehrte auf 404 — ein Verweis, der die Existenz
       * dessen verraet, was er nicht zeigen darf (AUT-06, Copilot-Runde auf
       * PR 16 / D-581).
       */
      darfHerunterladen: ((await kontext.abfrage<{ darf: boolean }>(
        `select app.hat_recht('finanzen.herunterladen', app.aktiver_mandant()) as darf`,
      ))[0]?.darf) === true,
      /*
       * Die drei Uebergaenge haben seit PR 54.x eigene Bildschirme
       * (`/festschreiben`, `/verwerfen`, `/versand`), und jeder oeffnet mit
       * einem EIGENEN Recht. Sie stehen hier als Verweis und nur fuer den,
       * der sie oeffnen darf — dasselbe Muster wie `darfHerunterladen`
       * daneben (AUT-06, D-581). Die Formulare weiter unten bleiben, wo sie
       * sind: eine Adresse zu entfernen, die funktioniert, nimmt niemandem
       * einen Fehler ab.
       */
      darfFestschreiben: ((await kontext.abfrage<{ darf: boolean }>(
        `select app.hat_recht('finanzen.festschreiben', app.aktiver_mandant()) as darf`,
      ))[0]?.darf) === true,
      darfVerwerfen: ((await kontext.abfrage<{ darf: boolean }>(
        `select app.hat_recht('finanzen.entwurf_verwerfen', app.aktiver_mandant()) as darf`,
      ))[0]?.darf) === true,
      darfVersandLesen: ((await kontext.abfrage<{ darf: boolean }>(
        `select app.hat_recht('versand.lesen', app.aktiver_mandant()) as darf`,
      ))[0]?.darf) === true,
    }))) as Promise<{
      kopf: Kopf | null; positionen: readonly Pos[]; steuer: readonly Steuer[];
      abzuege: readonly Abzug[];
      einheiten: readonly Einheit[]; gruppen: readonly Gruppe[];
      quellen: readonly QuelleZeile[]; leistungen: readonly Leistung[];
      fin18: Fin18Befund | null;
      steuerfall: Awaited<ReturnType<typeof ermittleSteuerfall>>;
      darfStornieren: boolean;
      darfHerunterladen: boolean;
      darfFestschreiben: boolean;
      darfVerwerfen: boolean;
      darfVersandLesen: boolean;
    }>);

  const k = daten.kopf;
  if (k === null) notFound();
  const entwurf = k.status === 'entwurf';
  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  /*
   * **Was nur ein Entwurf braucht** (V-204 … V-206): die Auswahl des Kopfes,
   * die Vorschau nach Abrechnungsart, die Aufmaßblätter und die
   * weiterberechenbaren Ausgaben. Ein festgeschriebener Beleg bekommt keine
   * davon — ein Formular darauf verspräche eine Änderung, die die Datenbank
   * ablehnt (Invariante 4).
   *
   * `?zeile=` wählt die Leistungszeile der Vorschau; übernommen wird sie nur,
   * wenn sie zu den Leistungszeilen DIESES Auftrags gehört.
   */
  const zeileAusAdresse = vorbelegt(suche, 'zeile');
  const zeile = daten.leistungen.some((l) => l.id === zeileAusAdresse)
    ? (zeileAusAdresse ?? null) : null;
  const ent = !entwurf ? null : await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const d = { abfrage: kontext.abfrage.bind(kontext) };
      const vorschau = await vorschauAbrechnungsart(d, k.id, zeile);
      return {
        objekte: await kontext.abfrage<{ id: string; name: string }>(
          `select id::text as id, bezeichnung as name from objekt
            where archiviert_am is null order by bezeichnung`),
        auftraege: darf['auftrag.lesen'] === true ? await auftraegeZurAuswahl(d, k.kunde_id) : [],
        vorschau,
        aufmasse: vorschau.art?.schluessel === 'einheitspreis_aufmass' && k.auftrag_id !== null
          ? await aufmasseZumAuftrag(d, k.auftrag_id) : [],
        ausgaben: darf['eingang.lesen'] === true ? await weiterberechenbareAusgaben(d, k.id) : [],
      };
    }))) as {
      objekte: readonly { id: string; name: string }[];
      auftraege: readonly AuftragAuswahl[];
      vorschau: AbrechnungsVorschau;
      aufmasse: readonly AufmassAuswahl[];
      ausgaben: readonly AusgabeAuswahl[];
    } | null;

  /*
   * Eine Abweisung kommt mit ihren Eingaben zurück (D-599, V-240) — aber nur
   * in die Maske, aus der sie kam (`maske`), nicht in jede mit gleichem
   * Feldnamen. Ein Schlüssel aus der Adresse wird nur als eigener Eintrag
   * nachgeschlagen (D-728).
   */
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const hinweis = typeof suche['hinweis'] === 'string' ? suche['hinweis'] : null;
  const maske = fehler === null ? null : (vorbelegt(suche, 'maske') ?? null);
  const zurueckIn = (m: string) => (name: string): string | undefined =>
    maske === m ? vorbelegt(suche, name) : undefined;
  const kopfZurueck = zurueckIn('kopf');
  const posZurueck = zurueckIn('position');
  const kopfWert = (name: string, db: string | null): string =>
    kopfZurueck(name) ?? db ?? '';
  const kopfArt = ENTWURF_RECHNUNGSARTEN.find((a) => a === kopfWert('rechnungsart', k.rechnungsart))
    ?? 'standard';
  const fehltZeitpunkt = grundOhneLeistungszeitpunkt({
    rechnungsart: k.rechnungsart, leistungVon: k.leistung_von_tag,
    leistungBis: k.leistung_bis_tag, vereinnahmungGeplantAm: k.vereinnahmung_tag,
  });
  const rueckweg = `/portal/${mandant}/finanzen/rechnungen/${k.id}`;
  const herkunftVor = posZurueck('herkunft');
  /* Die Herkünfte, die diese Zeile haben KANN — von Hand gibt es immer. */
  const herkuenfte: readonly ('vertrag' | 'material' | 'manuell')[] = [
    ...(daten.leistungen.length > 0 ? ['vertrag' as const] : []),
    ...(ent !== null && ent.ausgaben.length > 0 ? ['material' as const] : []),
    'manuell' as const,
  ];

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/finanzen/rechnungen`, text: t.alleRechnungen }}
      titel={k.nummer ?? t.rechnungsentwurf}
      bereich={mandant as BereichSchluessel}
      nurLesen={!entwurf}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label={g.zurueck} className="mb-s3 flex flex-wrap gap-s4">
        {/*
          * Der §14-UStG-Vorabbericht (PR 47). Er steht auf einer EIGENEN
          * Seite und nicht als Kasten hier: er nennt jedes fehlende Feld auf
          * einmal, und diese Seite ist der Editor — zwei Aufgaben auf einem
          * Blatt heisst, dass man beim Tippen scrollt.
          */}
        <Link
          href={`/portal/${mandant}/finanzen/rechnungen/${k.id}/pruefung`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          {t.pruefungAnsehen}
        </Link>
        {/*
          * Die XRechnung (PR 52). Auch sie auf einer eigenen Seite: sie zeigt
          * das erzeugte UBL und den Pruefstand, und beides gehoert nicht in
          * einen Editor. Der Verweis steht bei JEDEM Beleg und nicht nur bei
          * einem oeffentlichen Auftraggeber — wer wissen will, ob eine
          * Rechnung elektronisch zustellbar waere, findet die Antwort sonst
          * nur, indem er sie verschickt.
          *
          * Bei jedem Beleg — aber nur fuer den, der das Blatt oeffnen darf
          * (`finanzen.herunterladen`, siehe `darfHerunterladen` oben; AUT-06).
          */}
        {daten.darfHerunterladen && (
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${k.id}/xrechnung`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t.xrechnungAnsehen}
          </Link>
        )}
        {/*
          * ZUGFeRD (PR 53) — und der Verweis steht nur bei einem
          * FESTGESCHRIEBENEN Beleg.
          *
          * Ein Entwurf hat keinen Schnappschuss (K-12); der Knopf gäbe eine
          * 422-Antwort mit einer Liste, die auf dieser Seite ohnehin schon
          * steht. Ein Knopf, der beim Drücken erklärt, warum er nicht geht,
          * ist ein Knopf zu viel.
          */}
        {k.status === 'festgeschrieben' && (
          <a
            href={`/api/finanzen/rechnungen/${k.id}/zugferd.pdf`}
            data-cse="zugferd-laden"
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t.zugferdPdfLaden}
          </a>
        )}
        {/*
          * Die ZUGFeRD-Vorschau mit Pruefstand und Summenprobe — dieselbe
          * Regel wie bei der XRechnung: das Blatt liegt hinter
          * `finanzen.herunterladen`, und ein Entwurf hat keinen Schnappschuss.
          */}
        {k.status === 'festgeschrieben' && daten.darfHerunterladen && (
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${k.id}/zugferd`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t.zugferdAnsehen}
          </Link>
        )}
        {/*
          * Das Einwegtor als eigener Bildschirm: er zeigt vorher in Zahlen,
          * was gleich unumkehrbar wird, samt §14-Ampel und FIN-18. Nur bei
          * einem Entwurf und nur mit `finanzen.festschreiben`.
          */}
        {entwurf && daten.darfFestschreiben && (
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${k.id}/festschreiben`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t.festschreibenPruefen}
          </Link>
        )}
        {entwurf && daten.darfVerwerfen && (
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${k.id}/verwerfen`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t.entwurfVerwerfen}
          </Link>
        )}
        {/* Abschlaege: dieselbe Rechteschwelle wie diese Seite (`finanzen.lesen`). */}
        {k.rechnungsart === 'schluss' && (
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${k.id}/abschlaege`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t.abschlaegeUndAbzug}
          </Link>
        )}
        {k.status === 'festgeschrieben' && daten.darfStornieren && (
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${k.id}/storno`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t.stornieren}
          </Link>
        )}
        {k.status === 'festgeschrieben' && daten.darfVersandLesen && (
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${k.id}/versand`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t.versandprotokoll}
          </Link>
        )}
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">
          {k.nummer ?? t.entwurfOhneNummer}
        </h1>
        <StatusPill zustand={PILLE[k.status] ?? 'Entwurf'} sprache={zugang.sprache} />
      </div>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div><dt className="text-xs text-text-muted">{g.kunde}</dt>
          <dd className="text-sm text-text">{k.kunde}</dd></div>
        <div><dt className="text-xs text-text-muted">{t.leistungsort}</dt>
          <dd className="text-sm text-text">{k.objekt ?? '—'}</dd></div>
        <div><dt className="text-xs text-text-muted">{t.leistungszeitraum}</dt>
          <dd className="text-sm text-text">
            {k.leistung_von ?? '—'} – {k.leistung_bis ?? '—'}
          </dd></div>
        <div><dt className="text-xs text-text-muted">{t.rechnungsdatum}</dt>
          <dd className="text-sm text-text">{k.rechnungsdatum ?? '—'}</dd></div>
        <div><dt className="text-xs text-text-muted">{t.zahlungsziel}</dt>
          <dd className="text-sm text-text">
            {k.zahlungsziel_tage === null
              ? <span className="text-warning">{t.zahlungszielFehlt}</span>
              : `${String(k.zahlungsziel_tage)} ${t.tage}`}
          </dd></div>
        <div><dt className="text-xs text-text-muted">{g.faellig}</dt>
          <dd className="text-sm text-text">{k.faellig_am ?? '—'}</dd></div>
        <div><dt className="text-xs text-text-muted">{e.rechnungsart}</dt>
          <dd className="text-sm text-text" data-cse="rechnungsart-anzeige">
            {eigenerEintrag(arten, k.rechnungsart) ?? '—'}
          </dd></div>
        {/*
          * Der Auftrag (V-205) — als Verweis nur für den, der ihn öffnen darf
          * (AUT-06). Ohne `auftrag.lesen` steht das fehlende Recht da, nicht
          * die Kennung.
          */}
        <div><dt className="text-xs text-text-muted">{e.auftrag}</dt>
          <dd className="text-sm text-text" data-cse="auftrag-anzeige">
            {k.auftrag_id === null ? e.ohneAuftrag
              : k.auftragsnummer === null
                ? <><span className="text-text-muted">{e.auftraegeVerdeckt}</span>{' '}
                  <Recht schluessel="auftrag.lesen" sprache={zugang.sprache} /></>
                : (
                  <Link
                    href={`/portal/${mandant}/auftraege/${k.auftrag_id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {k.auftragsnummer} · {k.auftrag_bezeichnung}
                  </Link>
                )}
          </dd></div>
        {istVorauszahlung(k.rechnungsart) && (
          <div><dt className="text-xs text-text-muted">{e.vereinnahmung}</dt>
            <dd className="text-sm text-text">
              {k.vereinnahmung_tag === null ? '—'
                : tagInSprache(k.vereinnahmung_tag, zugang.sprache)}
            </dd></div>
        )}
      </dl>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="rechnung-fehler" className="mb-s5 max-w-prose">
          <strong>{e.nichtsGespeichert}</strong>{' '}
          {eigenerEintrag(e.fehler, fehler) ?? e.abgewiesen}
        </Hinweis>
      )}
      {hinweis === null || eigenerEintrag(e.hinweis, hinweis) === undefined ? null : (
        <Hinweis art="erfolg" cse="rechnung-hinweis" className="mb-s5 max-w-prose">
          {eigenerEintrag(e.hinweis, hinweis)}
        </Hinweis>
      )}

      {/*
        * **Der Kopf des Entwurfs** (V-204, V-205, FIN-04, FIN-05).
        *
        * Bis dahin liess sich nach dem Anlegen nichts davon ändern: ein
        * fehlender Leistungszeitraum oder ein fehlendes Zahlungsziel sperrte
        * den Entwurf dauerhaft, und die Vorabprüfung verwies hierher, wo beides
        * nur ANGEZEIGT wurde. Jetzt zeigt ihr Verweis auf `#kopf`. Die Maske
        * ist mit dem heutigen Stand vorbelegt — ein leeres Feld heisst „leer".
        */}
      {entwurf && ent !== null && (
        <section id="kopf" className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5">
          <h2 className="text-h3 text-text">{e.kopfTitel}</h2>
          <p className="mt-s2 text-sm text-text-muted">{e.kopfErklaerung}</p>
          {fehltZeitpunkt === null ? null : (
            <p className="mt-s3 rounded-md border border-warning bg-warning-soft p-s3 text-sm text-warning">
              {eigenerEintrag(e.fehler, fehltZeitpunkt)}
            </p>
          )}
          <form method="post" action={`/api/rechnungen?mandant=${mandant}`} data-cse="kopf-form">
            <input type="hidden" name="aktion" value="kopf" />
            <input type="hidden" name="rechnungId" value={k.id} />
            <input type="hidden" name="zurueck" value={rueckweg} />

            <label className="mt-s4 block text-sm text-text" htmlFor="kopf-rechnungsart">
              {e.rechnungsart}
            </label>
            <select
              id="kopf-rechnungsart" name="rechnungsart" required className={feld}
              defaultValue={kopfArt}
            >
              {ENTWURF_RECHNUNGSARTEN.map((a) => (
                <option key={a} value={a}>{arten[a]}</option>
              ))}
            </select>

            <label className="mt-s4 block text-sm text-text" htmlFor="kopf-auftrag">{e.auftrag}</label>
            {darf['auftrag.lesen'] === true ? (
              <>
                <select
                  id="kopf-auftrag" name="auftragId" className={feld}
                  defaultValue={kopfWert('auftragId', k.auftrag_id)}
                >
                  <option value="">{e.ohneAuftrag}</option>
                  {/*
                    * Der heutige Auftrag steht IMMER zur Wahl — auch wenn er
                    * inzwischen storniert ist und die Liste ihn nicht mehr
                    * anbietet. Sonst wählte der Browser still „ohne Auftrag",
                    * und wer nur den Zeitraum nachträgt, nähme die Zuordnung
                    * mit weg.
                    */}
                  {k.auftrag_id !== null && !ent.auftraege.some((a) => a.id === k.auftrag_id) && (
                    <option value={k.auftrag_id}>
                      {k.auftragsnummer ?? e.nichtGesetzt} · {k.auftrag_bezeichnung ?? ''}
                    </option>
                  )}
                  {ent.auftraege.map((a) => (
                    <option key={a.id} value={a.id}>{a.auftragsnummer} · {a.bezeichnung}</option>
                  ))}
                </select>
                <p className="mt-s1 text-xs text-text-muted">{e.auftragHinweis}</p>
              </>
            ) : (
              <>
                {/* Ohne Leserecht bleibt die Zuordnung, wie sie ist. */}
                <input type="hidden" name="auftragId" value={k.auftrag_id ?? ''} />
                <p className="mt-s2 text-sm text-text-muted">
                  {e.auftraegeVerdeckt}{' '}
                  <Recht schluessel="auftrag.lesen" sprache={zugang.sprache} />.
                </p>
              </>
            )}
            {k.rechnungsart === 'schluss' && daten.abzuege.length > 0 && (
              <p className="mt-s1 text-xs text-warning">{e.kopfAbzugHinweis}</p>
            )}

            <label className="mt-s4 block text-sm text-text" htmlFor="kopf-objekt">
              {t.leistungsort}
            </label>
            <select
              id="kopf-objekt" name="objektId" className={feld}
              defaultValue={kopfWert('objektId', k.objekt_id)}
            >
              <option value="">{e.nichtGesetzt}</option>
              {/* Dasselbe für ein inzwischen archiviertes Objekt. */}
              {k.objekt_id !== null && !ent.objekte.some((o) => o.id === k.objekt_id) && (
                <option value={k.objekt_id}>{k.objekt ?? e.nichtGesetzt}</option>
              )}
              {ent.objekte.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-text" htmlFor="kopf-von">{rt.leistungVon}</label>
                <input
                  id="kopf-von" name="leistungVon" type="date" className={feld}
                  defaultValue={kopfWert('leistungVon', k.leistung_von_tag)}
                />
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="kopf-bis">{rt.leistungBis}</label>
                <input
                  id="kopf-bis" name="leistungBis" type="date" className={feld}
                  defaultValue={kopfWert('leistungBis', k.leistung_bis_tag)}
                />
              </div>
            </div>
            <p className="mt-s1 text-xs text-text-muted">{e.leistungszeitraumPflicht}</p>

            <label className="mt-s4 block text-sm text-text" htmlFor="kopf-vereinnahmung">
              {e.vereinnahmung}
            </label>
            <input
              id="kopf-vereinnahmung" name="vereinnahmungGeplantAm" type="date" className={feld}
              defaultValue={kopfWert('vereinnahmungGeplantAm', k.vereinnahmung_tag)}
            />
            <p className="mt-s1 text-xs text-text-muted">{e.vereinnahmungHinweis}</p>

            <label className="mt-s4 block text-sm text-text" htmlFor="kopf-ziel">{t.zahlungsziel}</label>
            <input
              id="kopf-ziel" name="zahlungszielTage" type="number" min="0" step="1" className={feld}
              defaultValue={kopfWert('zahlungszielTage',
                k.zahlungsziel_tage === null ? null : String(k.zahlungsziel_tage))}
            />
            <p className="mt-s1 text-xs text-text-muted">{e.kopfZahlungszielLeer}</p>

            <label className="mt-s4 block text-sm text-text" htmlFor="kopf-zahlungsart">
              {rt.zahlungsart}
            </label>
            <select
              id="kopf-zahlungsart" name="zahlungsmittelCode" className={feld}
              defaultValue={kopfWert('zahlungsmittelCode', k.zahlungsmittel_code)}
            >
              <option value="">{e.nichtGesetzt}</option>
              {ZAHLUNGSMITTEL.map((z) => (
                <option key={z.code} value={z.code}>{z.bezeichnung} ({z.code})</option>
              ))}
            </select>

            <label className="mt-s4 block text-sm text-text" htmlFor="kopf-kopftext">{rt.kopftext}</label>
            <textarea
              id="kopf-kopftext" name="kopftext" rows={3} className={feld}
              defaultValue={kopfWert('kopftext', k.kopftext)}
            />
            <label className="mt-s4 block text-sm text-text" htmlFor="kopf-fusstext">{e.fusstext}</label>
            <textarea
              id="kopf-fusstext" name="fusstext" rows={3} className={feld}
              defaultValue={kopfWert('fusstext', k.fusstext)}
            />

            <button
              type="submit"
              data-cse="kopf-speichern"
              className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
            >
              {e.kopfSpeichern}
            </button>
          </form>
        </section>
      )}

      {k.verworfen_grund === null ? null : (
        <p className="mb-s5 rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text-muted">
          {t.verworfenLabel} {k.verworfen_grund}
        </p>
      )}
      {k.storniert_durch === null ? null : (
        <p className="mb-s5 rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text-muted">
          {t.aufgehobenDurch} {k.storniert_durch}
          {k.ersetzt_durch === null ? '' : `${t.neuAusgestelltAls} ${k.ersetzt_durch}`}.
          {' '}{t.stornoUnveraendert}
        </p>
      )}

      <h2 id="positionen" className="mb-s3 text-h3 text-text">{t.positionen}</h2>
      {daten.positionen.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.keinePosition}
        </p>
      ) : (
        <div className="mb-s5">
          <DataTable
            beschriftung={t.tabellePositionen}
            zeilen={daten.positionen}
            schluessel={(p) => p.id}
            spalten={[
              { schluessel: 'nr', kopf: t.nr, numerisch: true,
                zelle: (p) => String(p.position_nr) },
              { schluessel: 'bez', kopf: g.bezeichnung, zelle: (p) => p.bezeichnung },
              { schluessel: 'menge', kopf: g.menge, numerisch: true,
                zelle: (p) => p.menge === null ? '—'
                  : `${formatiereMenge(mengeAusPostgres(p.menge))} ${p.einheit ?? ''}` },
              { schluessel: 'code', kopf: BT_MENGENEINHEIT,
                zelle: (p) => p.unece_code ?? (
                  <span className="text-warning" title={t.unbestaetigterWert}>
                    {t.codeOffen}
                  </span>
                ) },
              { schluessel: 'preis', kopf: t.einzelpreis, numerisch: true,
                zelle: (p) => p.einzelpreis_cent === null ? '—'
                  : formatiereGeld(cent(BigInt(p.einzelpreis_cent))) },
              { schluessel: 'satz', kopf: 'USt', numerisch: true,
                zelle: (p) => prozentText(p.satz_bp) },
              { schluessel: 'netto', kopf: t.netto, numerisch: true,
                zelle: (p) => p.netto_cent === null ? '—'
                  : formatiereGeld(cent(BigInt(p.netto_cent))) },
            ]}
          />
        </div>
      )}

      {/*
        * **Die Herkunft jeder Zeile** (FIN-07, DSH-04, Abnahme 2).
        *
        * Sie steht als eigener Abschnitt und nicht als achte Spalte der
        * Tabelle: eine Zeile hat oft ein Dutzend Belege — auf einer
        * Reinigungsrechnung auch siebenundachtzig —, und eine Spalte, die
        * siebenundachtzig Verweise fassen soll, ist keine Spalte.
        *
        * Der Klick fuehrt an GENAU den Satz dahinter: an den Zeiteintrag, an
        * das Aufmassblatt, an den Nachtrag. Wo es (noch) keine Seite gibt,
        * steht der Beleg ohne Verweis da — ein Link ins Leere waere die
        * schlechtere Auskunft.
        */}
      {daten.quellen.length === 0 ? null : (
        <>
          <h2 className="mb-s3 text-h3 text-text">{t.herkunftTitel}</h2>
          <div className="mb-s5 rounded-lg border border-line bg-surface p-s5">
            {daten.positionen.map((p) => {
              const belege = daten.quellen.filter((q) => q.positionId === p.id);
              if (belege.length === 0) return null;
              const summe = belege.reduce((a, q) => a + q.anteilCent, 0n);
              return (
                <section key={p.id} className="mb-s4 last:mb-0">
                  <h3 className="text-sm text-text">
                    {t.position} {p.position_nr} · {p.bezeichnung}
                  </h3>
                  <ul className="mt-s2">
                    {belege.map((q) => (
                      <li
                        key={q.id}
                        className="flex flex-wrap items-baseline justify-between gap-s3 border-b border-line py-s2 text-sm last:border-b-0"
                      >
                        <span className="text-text-muted">
                          {q.ziel === null ? q.bezeichnung : (
                            <Link
                              href={`/portal/${mandant}/${q.ziel}`}
                              className="text-text underline-offset-2 hover:underline"
                            >
                              {q.bezeichnung}
                            </Link>
                          )}
                          {q.mengeAnteil === null ? '' : ` · ${formatiereMenge(
                            mengeAusPostgres(q.mengeAnteil))} ${p.einheit ?? ''}`}
                          {q.wirksam ? '' : ` · ${t.anspruchErloschen}`}
                        </span>
                        <span className="cse-zahl text-text">
                          {formatiereGeld(cent(q.anteilCent))}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/*
                    * Die Probe, die Abnahme 2 verlangt: die Anteile summieren
                    * sich AUF DEN CENT zur Zeile. Sie steht sichtbar da und
                    * nicht nur im Test — wer sie einmal nicht aufgehen sieht,
                    * soll es sehen, statt es zu erfahren, wenn der Beleg
                    * draussen ist.
                    */}
                  <p className="mt-s2 text-xs text-text-muted">
                    {t.summeDerBelege} {formatiereGeld(cent(summe))}
                    {p.netto_cent !== null && summe === BigInt(p.netto_cent)
                      ? ` ${t.stimmtUeberein}`
                      : ` ${t.positionTraegt} ${p.netto_cent === null ? '—'
                        : formatiereGeld(cent(BigInt(p.netto_cent)))}.`}
                  </p>
                </section>
              );
            })}
          </div>
        </>
      )}

      <h2 className="mb-s3 text-h3 text-text">{t.ustJeGruppe}</h2>
      <table className="mb-s5 w-full max-w-prose border-collapse text-sm">
        <caption className="sr-only">
          {t.ustAufschluesselung}
        </caption>
        <tbody>
          {daten.steuer.map((s) => (
            <tr key={s.gruppe} className="border-b border-line">
              <th scope="row" className="py-s2 text-left font-normal text-text-muted">
                {s.gruppe} ({prozentText(s.satz_bp)})
              </th>
              <td className="cse-zahl py-s2 text-text">
                {formatiereGeld(cent(BigInt(s.netto_cent)))}
              </td>
              <td className="cse-zahl py-s2 text-text">
                {formatiereGeld(cent(BigInt(s.steuer_cent)))}
              </td>
            </tr>
          ))}
          <tr className="border-b border-line">
            <th scope="row" className="py-s2 text-left font-normal text-text-muted">{t.netto}</th>
            <td className="cse-zahl py-s2 text-text" colSpan={2}>
              {formatiereGeld(cent(BigInt(k.netto_gesamt_cent)))}
            </td>
          </tr>
          <tr className="border-b border-line">
            <th scope="row" className="py-s2 text-left font-normal text-text-muted">
              {t.umsatzsteuer}
            </th>
            <td className="cse-zahl py-s2 text-text" colSpan={2}>
              {formatiereGeld(cent(BigInt(k.steuer_gesamt_cent)))}
            </td>
          </tr>
          <tr>
            <th scope="row" className="py-s2 text-left text-text">{t.brutto}</th>
            <td className="cse-zahl py-s2 font-semibold text-text" colSpan={2}>
              {formatiereGeld(cent(BigInt(k.brutto_cent)))}
            </td>
          </tr>
        </tbody>
      </table>

      {/*
        * **Die Abzugstabelle** (FIN-08, Abnahme 5).
        *
        * Sie steht auf dem Beleg, weil der Kunde sonst einen Zahlbetrag saehe,
        * den er aus dem Sichtbaren nicht nachrechnen kann: Positionen, Summen,
        * und dazwischen eine Differenz ohne Erklaerung. Sie steht je Beleg UND
        * je Steuergruppe, weil §14 Abs. 4 Nr. 8 UStG die Umsatzsteuer je Satz
        * verlangt und ein Abzug in einer einzigen Zahl sich darauf nicht
        * abbilden liesse.
        */}
      {daten.abzuege.length > 0 && (
        <>
          <h2 className="mb-s3 text-h3 text-text">{t.abzuegeTitel}</h2>
          <div className="overflow-x-auto">
          <table
            data-cse="abzugstabelle"
            className="mb-s5 w-full max-w-prose border-collapse text-sm"
          >
            <caption className="sr-only">
              {t.abzuegeBeschriftung}
            </caption>
            <thead>
              <tr className="border-b border-line-strong text-text-muted">
                <th scope="col" className="py-s2 text-left font-normal">{t.beleg}</th>
                <th scope="col" className="py-s2 text-left font-normal">{t.steuersatz}</th>
                <th scope="col" className="py-s2 text-right font-normal">{t.netto}</th>
                <th scope="col" className="py-s2 text-right font-normal">{t.umsatzsteuer}</th>
              </tr>
            </thead>
            <tbody>
              {daten.abzuege.map((a) => (
                <tr key={`${a.nummer}-${a.gruppe}`} className="border-b border-line">
                  <th scope="row" className="py-s2 text-left font-normal text-text">
                    {a.nummer}
                    {a.rechnungsdatum === null ? '' : ` ${t.vom} ${a.rechnungsdatum}`}
                  </th>
                  <td className="py-s2 text-text-muted">
                    {a.gruppe}
                    {a.satz_bp === null ? '' : ` (${prozentText(a.satz_bp)})`}
                  </td>
                  <td className="cse-zahl py-s2 text-right text-text">
                    −{formatiereGeld(cent(BigInt(a.netto_cent)))}
                  </td>
                  <td className="cse-zahl py-s2 text-right text-text">
                    −{formatiereGeld(cent(BigInt(a.steuer_cent)))}
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row" colSpan={2} className="py-s2 text-left text-text">
                  {t.zahlbetrag}
                </th>
                <td
                  data-cse="zahlbetrag"
                  className="cse-zahl py-s2 text-right font-semibold text-text"
                  colSpan={2}
                >
                  {formatiereGeld(cent(BigInt(k.zahlbetrag_cent)))}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </>
      )}

      {/*
        * **Der Steuerfall** (FIN-09, FIN-10).
        *
        * Er steht auf dem Bildschirm, weil beide Regeln Geld bewegen und
        * beide an einem Datum haengen: §13b verlagert die Steuerschuld (der
        * Beleg weist dann 0,00 € Umsatzsteuer aus und sagt warum), §48 behaelt
        * 15 % der Gegenleistung ein. Wer die Rechnung freigibt, soll beides
        * sehen — nicht erst der Steuerberater im naechsten Quartal.
        */}
      {(k.reverse_charge || k.bauabzugsteuer_pflichtig) && (
        <section
          data-cse="steuerfall"
          className="mb-s5 max-w-prose rounded-md border border-line bg-surface p-s4"
        >
          <h2 className="mb-s3 text-h3 text-text">{t.steuerfallTitel}</h2>
          {k.reverse_charge && (
            <p data-cse="reverse-charge" className="mb-s3 text-sm text-text">
              <strong className="text-text">§13b UStG:</strong>{' '}
              {k.steuerhinweis ?? t.reverseChargeVorgabe}
              {k.reverse_charge_grundlage === null ? '' : (
                k.reverse_charge_grundlage === 'bau'
                  ? t.grundlageBau
                  : t.grundlageReinigung
              )}
            </p>
          )}
          {k.bauabzugsteuer_pflichtig && (
            <p data-cse="bauabzugsteuer" className="text-sm text-text">
              <strong className="text-text">§48 EStG:</strong>{' '}
              {k.bauabzugsteuer_satz_bp === null
                ? ''
                : `${prozentText(k.bauabzugsteuer_satz_bp)} `}
              {t.bauabzugsteuerEinbehalten}{' '}
              {formatiereGeld(cent(BigInt(k.einbehalt_bauabzugsteuer_cent)))}
              {t.ueberwiesenWerden}{' '}
              {formatiereGeld(cent(BigInt(k.ueberweisungsbetrag_cent)))}.
              {k.freistellung_nummer === null
                ? t.keineFreistellung
                : ` ${t.freistellungNummer} ${k.freistellung_nummer}.`}
            </p>
          )}
          {!k.bauabzugsteuer_pflichtig && k.freistellung_nummer !== null && (
            <p className="text-sm text-text-muted">
              <strong className="text-text">§48 EStG:</strong>{' '}
              {t.keinEinbehaltFreistellung} {k.freistellung_nummer}{' '}
              {t.giltAmLeistungsdatum}
            </p>
          )}
        </section>
      )}

      {daten.steuerfall.positionenHinweis !== null && (
        <p
          data-cse="steuerfall-hinweis"
          className="mb-s5 max-w-prose rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          {daten.steuerfall.positionenHinweis}
        </p>
      )}

      {/*
        * **Den Steuerfall bestimmen** — nur am Entwurf. Der Mensch sagt, WAS
        * geleistet wurde; ob daraus ein Reverse Charge folgt, entscheidet der
        * hinterlegte §13b-Status am Leistungsdatum. Ein aus dem Gewerk der
        * Gesellschaft abgeleiteter Reverse Charge waere genau der Fehler, den
        * `01-ORDNERSTRUKTUR.md` §8.6 beim Namen nennt.
        */}
      {entwurf && (
        <form
          method="post"
          action={`/api/rechnungen/steuerfall?mandant=${mandant}`}
          className="mb-s5 max-w-prose rounded-md border border-line bg-surface p-s4"
        >
          <input type="hidden" name="rechnungId" value={k.id} />
          <label htmlFor="steuerfall-grundlage" className="text-xs text-text-muted">
            {t.artDerLeistung}
          </label>
          <select
            id="steuerfall-grundlage"
            name="grundlage"
            data-cse="steuerfall-grundlage"
            defaultValue={k.reverse_charge_grundlage ?? ''}
            className={feld}
          >
            <option value="">{t.wederNoch}</option>
            <option value="bau">{t.optionBau}</option>
            <option value="gebaeudereinigung">
              {t.optionReinigung}
            </option>
          </select>
          <p className="mt-s3 text-sm text-text-muted">
            {t.steuerfallHinweis}
          </p>
          <button
            type="submit"
            data-cse="steuerfall-bestimmen"
            className="mt-s4 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
          >
            {t.steuerfallBestimmen}
          </button>
        </form>
      )}

      {/*
        * **Abschlaege abziehen** — nur an einem Entwurf, und nur bei einer
        * Schlussrechnung mit Auftrag. Nach dem Festschreiben waere derselbe
        * Knopf eine stille Aenderung an einem Beleg, den der Kunde schon hat
        * (Invariante 4); ohne Auftrag gibt es keine Frage, welche Abschlaege
        * gemeint sind, und geraten wird hier nichts.
        */}
      {entwurf && k.rechnungsart === 'schluss' && k.auftrag_id !== null && (
        <form
          method="post"
          action={`/api/rechnungen/abschlaege?mandant=${mandant}`}
          className="mb-s5 rounded-md border border-line bg-surface p-s4"
        >
          <input type="hidden" name="rechnungId" value={k.id} />
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            {t.abschlaegeErklaerung}
          </p>
          <button
            type="submit"
            data-cse="abschlaege-abziehen"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
          >
            {t.abschlaegeAbziehen}
          </button>
        </form>
      )}

      {entwurf ? (
        <>
          {/*
            * **Nach der Abrechnungsart des Auftrags** (V-206, FIN-01, FIN-07).
            *
            * `bestueckeAusAbrechnungsart` hatte bis dahin keinen Aufrufer: die
            * Art liess sich je Auftrag festlegen und wirkte auf keine Rechnung.
            * Die Vorschau rechnet mit DERSELBEN Funktion wie die Übernahme, und
            * die Befunde stehen VOR dem Knopf — wer übernimmt, hat sie gesehen.
            * Der Zeitraum ist der Leistungszeitraum im Kopf, der Auftrag der
            * des Kopfes; einen zweiten gibt es nicht.
            */}
          {ent === null ? null : (
            <section
              id="abrechnungsart" data-cse="abrechnungsart"
              className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5"
            >
              <h2 className="text-h3 text-text">{e.abrTitel}</h2>
              <p className="mt-s2 text-sm text-text-muted">{e.abrErklaerung}</p>

              {ent.vorschau.auftragId === null && ent.vorschau.grund === 'auftrag_passt_nicht' ? (
                <p className="mt-s3 text-sm text-text-muted">{e.abrOhneAuftrag}</p>
              ) : ent.vorschau.grund === 'leistungszeitpunkt_fehlt' ? (
                <p className="mt-s3 text-sm text-text-muted">{e.abrOhneZeitraum}</p>
              ) : ent.vorschau.grund !== null ? (
                <Hinweis art="warnung" cse="abrechnung-abgewiesen" className="mt-s3">
                  {e.abrAbgewiesen} {ent.vorschau.meldung}
                  {darf['abrechnung.schreiben'] === true && k.auftrag_id !== null && (
                    <>
                      {' '}
                      <Link
                        href={`/portal/${mandant}/auftraege/${k.auftrag_id}/abrechnung`}
                        className="underline underline-offset-2"
                      >
                        {e.abrZurAbrechnung}
                      </Link>
                    </>
                  )}
                </Hinweis>
              ) : ent.vorschau.art === null ? null : (
                <>
                  <dl className="mt-s3 grid grid-cols-1 gap-s3 sm:grid-cols-2">
                    <div><dt className="text-xs text-text-muted">{e.abrArt}</dt>
                      <dd className="text-sm text-text">
                        {ent.vorschau.art.bezeichnung}
                        {ent.vorschau.art.istProvisorisch && (
                          <span className="text-xs text-warning"> · {e.abrProvisorisch}</span>
                        )}
                      </dd></div>
                    <div><dt className="text-xs text-text-muted">{e.abrGiltAb}</dt>
                      <dd className="text-sm text-text">
                        {tagInSprache(ent.vorschau.gueltigAb, zugang.sprache)}
                      </dd></div>
                  </dl>
                  {ent.vorschau.befunde.length === 0 ? null : (
                    <Hinweis art="warnung" cse="abrechnung-befunde" className="mt-s3">
                      <p className="font-semibold">{e.abrBefunde}</p>
                      <ul className="mt-s2 list-disc pl-s5">
                        {ent.vorschau.befunde.map((b) => (
                          <li key={`${b.feld}-${b.textDe}`}>
                            {b.textDe}{b.offeneFrage === null ? '' : ` (${b.offeneFrage})`}
                          </li>
                        ))}
                      </ul>
                    </Hinweis>
                  )}
                  {ent.vorschau.positionen.length === 0 ? (
                    <p className="mt-s3 text-sm text-text-muted">{e.abrKeineZeilen}</p>
                  ) : (
                    <div className="mt-s3">
                      <h3 className="mb-s2 text-sm text-text">{e.abrZeilen}</h3>
                      <DataTable
                        beschriftung={e.abrTabelle}
                        zeilen={ent.vorschau.positionen}
                        schluessel={(p) => `${p.bezeichnung}-${p.leistungVon ?? ''}-${p.auftragLeistungId ?? ''}-${p.herkunft[0]?.id ?? ''}`}
                        spalten={[
                          { schluessel: 'bez', kopf: g.bezeichnung, zelle: (p) => p.bezeichnung },
                          { schluessel: 'zeit', kopf: e.abrZeitraum,
                            zelle: (p) => p.leistungVon === null ? '—'
                              : `${tagInSprache(p.leistungVon, zugang.sprache)} – ${
                                tagInSprache(p.leistungBis, zugang.sprache)}` },
                          { schluessel: 'menge', kopf: g.menge, numerisch: true,
                            zelle: (p) => `${formatiereMengeIn(p.menge, zugang.sprache)} ${p.einheit}` },
                          { schluessel: 'preis', kopf: t.einzelpreis, numerisch: true,
                            zelle: (p) => formatiereGeldIn(p.einzelpreisCent, zugang.sprache) },
                          { schluessel: 'netto', kopf: t.netto, numerisch: true,
                            zelle: (p) => formatiereGeldIn(p.nettoCent, zugang.sprache) },
                        ]}
                      />
                    </div>
                  )}
                  {ent.vorschau.schonUebernommen > 0
                    && ent.vorschau.art.schluessel !== 'einheitspreis_aufmass' && (
                    <p className="mt-s3 text-sm text-warning">{e.abrSchonUebernommen}</p>
                  )}
                </>
              )}

              {/*
                * Mehrere Leistungszeilen: die Vorschau je Zeile wählen (O-53).
                * Ein GET-Formular — die Auswahl ändert nichts, sie zeigt nur.
                */}
              {daten.leistungen.length > 1 && ent.vorschau.auftragId !== null && (
                <form method="get" action={rueckweg} className="mt-s4">
                  <label className="block text-sm text-text" htmlFor="abr-zeile">
                    {e.abrLeistungszeile}
                  </label>
                  <select id="abr-zeile" name="zeile" className={feld} defaultValue={zeile ?? ''}>
                    <option value="">{e.abrGanzerAuftrag}</option>
                    {daten.leistungen.map((l) => (
                      <option key={l.id} value={l.id}>{l.position_nr}. {l.bezeichnung}</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="mt-s3 min-h-11 rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
                  >
                    {e.abrVorschauFuerZeile}
                  </button>
                </form>
              )}

              {ent.vorschau.art === null ? null : (
                <form
                  method="post" action={`/api/rechnungen?mandant=${mandant}`}
                  className="mt-s4" data-cse="abrechnung-uebernehmen"
                >
                  <input type="hidden" name="aktion" value="aus-abrechnungsart" />
                  <input type="hidden" name="rechnungId" value={k.id} />
                  <input type="hidden" name="zurueck" value={rueckweg} />
                  <input type="hidden" name="auftragLeistungId" value={zeile ?? ''} />
                  {ent.vorschau.art.schluessel === 'einheitspreis_aufmass' && (
                    <fieldset className="rounded-md border border-line p-s4">
                      <legend className="px-s2 text-sm text-text">{e.abrAufmasse}</legend>
                      <p className="text-xs text-text-muted">{e.abrAufmasseHinweis}</p>
                      {ent.aufmasse.length === 0 ? (
                        <p className="mt-s2 text-sm text-text-muted">{e.abrKeineAufmasse}</p>
                      ) : ent.aufmasse.map((a) => (
                        <label key={a.id} className="mt-s2 flex min-h-11 items-center gap-s3 text-sm text-text">
                          <input type="checkbox" name="aufmassIds" value={a.id} />
                          <span>
                            {a.nummer}{a.bezeichnung === null ? '' : ` · ${a.bezeichnung}`}
                            {' · '}{eigenerEintrag(e.aufmassStatus, a.status) ?? ''}
                            {a.messdatum === null ? '' : ` · ${tagInSprache(a.messdatum, zugang.sprache)}`}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {ent.vorschau.art.schluessel === 'festpreis_los' && (
                    <>
                      <label className="block text-sm text-text" htmlFor="abr-fertig">
                        {e.abrFertigstellung}
                      </label>
                      <input
                        id="abr-fertig" name="fertigstellung" type="text" inputMode="decimal"
                        className={feld}
                      />
                      <p className="mt-s1 text-xs text-text-muted">{e.abrFertigstellungHinweis}</p>
                    </>
                  )}
                  <button
                    type="submit"
                    disabled={ent.vorschau.schonUebernommen > 0
                      && ent.vorschau.art.schluessel !== 'einheitspreis_aufmass'}
                    className="mt-s4 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {e.abrUebernehmen}
                  </button>
                </form>
              )}
            </section>
          )}

          {/*
            * **Der Regelweg: eine Zeile AUS der Zeiterfassung** (TIM-12,
            * FIN-07). Er steht VOR der Handeingabe, weil er der bessere ist —
            * die Stunden kommen aus freigegebenen Eintraegen, jeder einzelne
            * haengt anschliessend als Beleg unter der Zeile, und niemand kann
            * sich vertippen. Er erscheint nur, wenn die Rechnung einem Auftrag
            * zugeordnet ist: ohne Auftrag gibt es keine Leistungszeile, an der
            * Zeit haengen koennte.
            */}
          {daten.leistungen.length === 0 ? null : (
            <>
              <h2 id="zeitzeile" className="mb-s3 text-h3 text-text">{t.zeitzeileTitel}</h2>
              <form
                method="post"
                action={`/api/rechnungen?mandant=${mandant}`}
                className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5"
              >
                <input type="hidden" name="aktion" value="aus-zeiten" />
                <input type="hidden" name="rechnungId" value={k.id} />
                <input type="hidden" name="zurueck" value={rueckweg} />
                <p className="max-w-prose text-sm text-text-muted">
                  {t.zeitzeileTeil1}{' '}
                  <strong className="text-text">{t.zeitzeileBetont}</strong>{' '}
                  {t.zeitzeileTeil2}
                </p>

                <label className="mt-s4 block text-sm text-text" htmlFor="zeitLeistung">
                  {t.leistungszeile}
                </label>
                <select
                  id="zeitLeistung" name="auftragLeistungId" required className={feld}
                >
                  {daten.leistungen.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.position_nr}. {l.bezeichnung}
                    </option>
                  ))}
                </select>

                <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm text-text" htmlFor="zeitBezeichnung">
                      {t.handelsuebliche}
                    </label>
                    <input
                      id="zeitBezeichnung" name="bezeichnung" type="text" required
                      defaultValue="Geleistete Stunden" className={feld}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-text" htmlFor="stundensatzCent">
                      {t.stundensatzCent}
                    </label>
                    <input
                      id="stundensatzCent" name="stundensatzCent" type="number" step="1"
                      required className={feld}
                    />
                    <p className="mt-s1 text-xs text-text-muted">4250 = 42,50 €</p>
                  </div>
                  <div>
                    <label className="block text-sm text-text" htmlFor="vonDatum">
                      {t.vonBerlinerTag}
                    </label>
                    <input id="vonDatum" name="vonDatum" type="date" className={feld} />
                  </div>
                  <div>
                    <label className="block text-sm text-text" htmlFor="bisDatum">
                      {t.bisEinschliesslich}
                    </label>
                    <input id="bisDatum" name="bisDatum" type="date" className={feld} />
                  </div>
                  <div>
                    <label className="block text-sm text-text" htmlFor="zeitSteuergruppe">
                      {t.steuergruppe}
                    </label>
                    <select
                      id="zeitSteuergruppe" name="steuergruppe" required className={feld}
                    >
                      {daten.gruppen.map((g) => (
                        <option key={g.schluessel} value={g.schluessel}>{g.bezeichnung}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
                >
                  {t.stundenUebernehmen}
                </button>
              </form>
            </>
          )}

          <h2 id="position" className="mb-s3 text-h3 text-text">{t.positionHinzufuegen}</h2>
          <form
            method="post"
            action={`/api/rechnungen?mandant=${mandant}`}
            className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="aktion" value="position" />
            <input type="hidden" name="rechnungId" value={k.id} />
            <input type="hidden" name="zurueck" value={rueckweg} />

            <label className="block text-sm text-text" htmlFor="bezeichnung">
              {t.handelsuebliche}
            </label>
            <input
              id="bezeichnung" name="bezeichnung" type="text" required className={feld}
              defaultValue={posZurueck('bezeichnung')}
            />

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                {/*
                  * Die Menge wird in TAUSENDSTELN eingegeben, der Preis in
                  * CENT. Beides sind ganze Zahlen — K-16 und Invariante 1 —
                  * und eine Umrechnung in der Oberflaeche waere genau die
                  * Gleitkommastelle, die diese Plattform nicht hat.
                  */}
                <label className="block text-sm text-text" htmlFor="menge">
                  {t.mengeTausendstel}
                </label>
                <input
                  id="menge" name="menge" type="number" step="1" required className={feld}
                  defaultValue={posZurueck('menge')}
                />
                <p className="mt-s1 text-xs text-text-muted">30870 = 30,870</p>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="einheit">{g.einheit}</label>
                <select
                  id="einheit" name="einheit" required className={feld}
                  defaultValue={daten.einheiten.some((x) => x.schluessel === posZurueck('einheit'))
                    ? posZurueck('einheit') : daten.einheiten[0]?.schluessel}
                >
                  {daten.einheiten.map((e) => (
                    <option key={e.schluessel} value={e.schluessel}>
                      {e.bezeichnung}{e.ist_platzhalter ? t.unbestaetigterWertSuffix : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="einzelpreisCent">
                  {t.einzelpreisCent}
                </label>
                <input
                  id="einzelpreisCent" name="einzelpreisCent" type="number" step="1" required
                  className={feld} defaultValue={posZurueck('einzelpreisCent')}
                />
                <p className="mt-s1 text-xs text-text-muted">1999 = 19,99 €</p>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="steuergruppe">
                  {t.steuergruppe}
                </label>
                <select
                  id="steuergruppe" name="steuergruppe" required className={feld}
                  defaultValue={daten.gruppen.some((x) => x.schluessel === posZurueck('steuergruppe'))
                    ? posZurueck('steuergruppe') : daten.gruppen[0]?.schluessel}
                >
                  {daten.gruppen.map((g) => (
                    <option key={g.schluessel} value={g.schluessel}>{g.bezeichnung}</option>
                  ))}
                </select>
              </div>
            </div>

            {/*
              * **Die Herkunft ist Pflicht** (FIN-07, §4.4). Es gibt drei Wege
              * und keinen vierten: eine Vertragszeile als Beleg, eine Ausgabe
              * als Beleg (Material, V-206) oder ausdruecklich „von Hand" MIT
              * Begruendung. Ein „ohne Angabe" faende die Datenbank beim
              * COMMIT — dann aber erst, nachdem jemand das ganze Formular
              * ausgefuellt hat.
              */}
            <fieldset className="mt-s5 rounded-md border border-line p-s4">
              <legend className="px-s2 text-sm text-text">{t.herkunftDieserZeile}</legend>
              {herkuenfte.length === 1 ? (
                <input type="hidden" name="herkunft" value="manuell" />
              ) : (
                <>
                  <label className="block text-sm text-text" htmlFor="herkunft">{t.beleg}</label>
                  <select
                    id="herkunft" name="herkunft" className={feld} data-cse="herkunft"
                    defaultValue={herkuenfte.find((h) => h === herkunftVor) ?? herkuenfte[0]}
                  >
                    {herkuenfte.map((h) => (
                      <option key={h} value={h}>
                        {h === 'vertrag' ? t.optionVertrag
                          : h === 'material' ? e.optionMaterial : t.optionManuell}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {daten.leistungen.length === 0 ? null : (
                <>
                  <label className="mt-s4 block text-sm text-text" htmlFor="auftragLeistungId">
                    {t.vertragsposition}
                  </label>
                  <select
                    id="auftragLeistungId" name="auftragLeistungId" className={feld}
                    defaultValue={daten.leistungen.some((l) => l.id === posZurueck('auftragLeistungId'))
                      ? posZurueck('auftragLeistungId') : daten.leistungen[0]?.id}
                  >
                    {daten.leistungen.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.position_nr}. {l.bezeichnung}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {/*
                * **Material** (V-206, FIN-07): eine weiterberechenbare,
                * freigegebene Ausgabe als Beleg. Der Preis ist die Eingabe
                * oben — ob zum Einstand oder mit Aufschlag, ist offen (O-931);
                * der Einstand steht hier nur als Auskunft.
                */}
              {ent === null || ent.ausgaben.length === 0 ? null : (
                <>
                  <label className="mt-s4 block text-sm text-text" htmlFor="ausgabeId">
                    {e.ausgabe}
                  </label>
                  <select
                    id="ausgabeId" name="ausgabeId" className={feld} data-cse="material-ausgabe"
                    defaultValue={ent.ausgaben.some((a) => a.id === posZurueck('ausgabeId'))
                      ? posZurueck('ausgabeId') : ent.ausgaben[0]?.id}
                  >
                    {ent.ausgaben.map((a) => (
                      <option key={a.id} value={a.id}>
                        {tagInSprache(a.ausgabedatum, zugang.sprache)} · {a.bezeichnung} · {e.einstandNetto}{' '}
                        {formatiereGeldIn(a.nettoCent, zugang.sprache)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-s1 text-xs text-text-muted">{e.materialHinweis}</p>
                </>
              )}
              {darf['eingang.lesen'] === true ? null : (
                <p className="mt-s4 text-xs text-text-muted">
                  {e.ausgabenVerdeckt}{' '}
                  <Recht schluessel="eingang.lesen" sprache={zugang.sprache} />.
                </p>
              )}

              <label className="mt-s4 block text-sm text-text" htmlFor="herkunftNotiz">
                {t.begruendungVonHand}
              </label>
              {/*
                * `required` genau dann, wenn es KEINE andere Herkunft gibt:
                * ohne Auftrag bleibt nur „von Hand", und dann ist die
                * Begründung die einzige Angabe, die die Zeile belegt. Mit
                * Auftrag steht sie daneben und wird nur für den Fall gebraucht,
                * dass jemand bewusst „von Hand" wählt — das kann HTML allein
                * nicht bedingen, und der Dienst weist es sauber ab.
                */}
              <input
                id="herkunftNotiz" name="herkunftNotiz" type="text" minLength={3}
                required={herkuenfte.length === 1} className={feld}
                defaultValue={posZurueck('herkunftNotiz')}
              />
              <p className="mt-s1 text-xs text-text-muted">
                {t.keineZeileOhneBeleg}
              </p>
            </fieldset>

            <button
              type="submit"
              className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
            >
              {t.positionHinzufuegen}
            </button>
          </form>

          <div className="flex flex-wrap gap-s5">
            <form
              method="post"
              action={`/api/rechnungen/festschreiben?mandant=${mandant}`}
              className="rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="rechnungId" value={k.id} />
              <h2 className="text-h3 text-text">{t.festschreibenTitel}</h2>
              <p className="mt-s2 max-w-prose text-sm text-text-muted">
                {t.festschreibenErklaerung}{' '}
                <strong className="text-text">{t.danachUnveraenderlich}</strong>
                {' '}{t.korrekturIstStorno}
              </p>

              {/*
                * **FIN-18 — blockierend, und sie fällt VOR der Nummer**
                * (Abnahme 3). Der Knopf bleibt bedienbar, aber die
                * Festschreibung weist ab, solange keine Begründung dasteht;
                * das ist der Unterschied zwischen einer Warnung, die man
                * wegklickt, und einer, die man beantwortet. Die Begründung
                * landet im Audit-Log und im Schnappschuss und ist danach
                * unveränderlich.
                */}
              {daten.fin18 === null ? null : (
                <div className="mt-s4 max-w-prose rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning">
                  <p>
                    <strong>{t.fin18Auftrag} {daten.fin18.auftragsnummer}</strong>{' '}
                    ({t.zitatAuf}{daten.fin18.bezeichnung}{t.zitatZu}){' '}
                    {t.fin18Satz}
                  </p>
                  <label className="mt-s3 block" htmlFor="fin18Begruendung">
                    {t.fin18Begruendung10}
                  </label>
                  <input
                    id="fin18Begruendung" name="fin18Begruendung" type="text" minLength={10}
                    className={feld}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={daten.positionen.length === 0}
                className="mt-s4 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.rechnungFestschreiben}
              </button>
            </form>

            <form
              method="post"
              action={`/api/rechnungen/verwerfen?mandant=${mandant}`}
              className="rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="rechnungId" value={k.id} />
              <h2 className="text-h3 text-text">{t.verwerfenTitel}</h2>
              <p className="mt-s2 max-w-prose text-sm text-text-muted">
                {t.verwerfenErklaerungKurz}
              </p>
              <label className="mt-s4 block text-sm text-text" htmlFor="grund">{t.grund}</label>
              <input id="grund" name="grund" type="text" required className={feld} />
              <button
                type="submit"
                className="mt-s4 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
              >
                {t.entwurfVerwerfen}
              </button>
            </form>
          </div>
        </>
      ) : (
        <>
          <h2 className="mb-s3 text-h3 text-text">{t.kettenbindung}</h2>
          <p className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {k.hash === null ? t.keinKettensatz : (
              <>
                {t.kettePositionVor} {k.kette_position} {t.kettePositionNach}{' '}
                <code className="break-all text-xs text-text">{k.hash}</code>
              </>
            )}
          </p>

          {k.status === 'festgeschrieben' && k.storniert_durch === null
           && !daten.darfStornieren ? (
             <p className="max-w-prose text-sm text-text-muted">
               {t.stornoRechtFehltVor}
               {' '}<Recht schluessel={RECHT_STORNIEREN} sprache={zugang.sprache} />{' '}
               {t.stornoRechtFehltNach}
             </p>
           ) : null}

          {k.status === 'festgeschrieben' && k.storniert_durch === null
           && daten.darfStornieren ? (
            <form
              method="post"
              action={`/api/rechnungen/storno?mandant=${mandant}`}
              className="max-w-prose rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="rechnungId" value={k.id} />
              <h2 className="text-h3 text-text">{t.korrigieren}</h2>
              <p className="mt-s2 text-sm text-text-muted">
                {t.korrigierenErklaerung}
              </p>
              <label className="mt-s4 block text-sm text-text" htmlFor="stornogrund">
                {t.grundZehnZeichen}
              </label>
              <input
                id="stornogrund" name="grund" type="text" required minLength={10}
                className={feld}
              />
              <label className="mt-s4 block text-sm text-text" htmlFor="form">{t.form}</label>
              <select id="form" name="form" defaultValue="korrektur" className={feld}>
                <option value="korrektur">{t.formKorrektur}</option>
                <option value="nur_storno">{t.formNurStorno}</option>
              </select>
              <button
                type="submit"
                className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
              >
                {t.stornieren}
              </button>
            </form>
          ) : null}
        </>
      )}
    </PortalRahmen>
  );
}
