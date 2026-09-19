import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereMenge, mengeAusPostgres } from '@/server/services/finanz/menge';
import {
  auftraegeZumObjekt, findeKundenobjekt, raeumeZumObjekt,
  type Kundenraum, type ObjektAuftrag,
} from '@/server/services/kundenportal/objekt';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { kundePortal, KundenRahmen } from '../../rahmen';
import {
  Feld, Felder, Gesellschaft, KeinZugang, Kopfzeile, Leer, Offen, Zurueck,
} from '../../bausteine';

/**
 * `/portal/kunde/objekte/[id]` — eine Liegenschaft mit ihrem Raumbuch
 * (OPS-01, OPS-02, AUT-06, 04-SEITENKARTE §8).
 *
 * ===========================================================================
 * Das Raumbuch: vollstaendig, aber ohne die Kalkulationsspalten
 * ===========================================================================
 *
 * Gezeigt werden Raumnummer, Bezeichnung, Etage, Nutzungsart, Bodenflaeche
 * und Glasflaeche — die Bestandsaufnahme des eigenen Hauses. NICHT gezeigt
 * werden `belagsart` und `reinigungsklasse`: beide Kataloge haelt eine
 * restriktive Decke aus dem Kundenportal heraus (0021), und
 * `leistungswert_qm_pro_stunde` ist `cse_app` sogar spaltenweise entzogen. Aus
 * Belag, Klasse und Leistungswert entsteht der Preis; das ist
 * Verhandlungsstoff, und im Kundenportal ist er es gegen uns.
 *
 * **Die Spalten fehlen — sie stehen nicht leer da.** Ein `left join` auf die
 * unsichtbaren Kataloge haette „—" in jeder Zeile ergeben, und das liest sich
 * wie „nicht erfasst" (K-18). Eine fehlende Spalte ist ehrlicher als eine
 * leere.
 *
 * ===========================================================================
 * Zwei Wege fuehren vom Objekt zum Vertrag
 * ===========================================================================
 *
 * `auftrag.objekt_id` traegt den Einzelauftrag an genau diesem Haus;
 * `auftrag_leistung.objekt_id` traegt den Rahmenvertrag, der seine Standorte
 * an den Zeilen fuehrt (0050). Beide werden gefragt — nur der erste gefragt,
 * fehlte einem Kunden mit Rahmenvertrag auf JEDER Objektseite der Vertrag,
 * unter dem sein Haus betreut wird.
 *
 * ===========================================================================
 * Was es hier NICHT gibt
 * ===========================================================================
 *
 *  · **Zutrittshinweis.** `objekt.zutritt_hinweis` ist die Anweisung fuer die
 *    Kolonne („Schluessel im Schluesselkasten"). Eine Sicherheitsangabe des
 *    Hauses gehoert nicht in ein Portal, das jeder kuenftige Kundenzugang
 *    sieht.
 *  · **Einsatzplan, Reviere, Turnusse.** §8 verschliesst dem Kunden das
 *    `personal`-Modul; `revier` und `turnus` sind ausserdem die
 *    Kalkulationsgrundlage der Unterhaltsreinigung.
 *  · **Reklamationen und Nachweise ZU DIESEM OBJEKT.** Beide sind gebaut, aber
 *    als eigene Listen (`/portal/kunde/reklamationen`,
 *    `/portal/kunde/nachweise`). Eine dritte Ansicht derselben Zeilen hier
 *    waere eine dritte Stelle, an der ihre Projektion gepflegt werden muss.
 *
 * **Ein fremdes Objekt gibt 404, nie 403** (AUT-06, SEC-A3).
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  angelegt: 'Geplant',
  aktiv: 'Aktiv',
  pausiert: 'Wartet',
  abgeschlossen: 'Abgeschlossen',
  storniert: 'Abgelehnt',
};

const ART: Readonly<Record<string, string>> = {
  einzelauftrag: 'Einzelauftrag',
  rahmenvertrag: 'Rahmenvertrag',
  dauerauftrag: 'Dauerauftrag',
  projekt: 'Projekt',
};

export default async function Kundenobjekt(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roh } = await params;
  const id = kennungOder404(roh);

  const ergebnis = await kundePortal(`/portal/kunde/objekte/${id}`, async (kontext) => {
    const objekt = await findeKundenobjekt(kontext, id);
    if (objekt === null) return null;
    return {
      objekt,
      raeume: await raeumeZumObjekt(kontext, id),
      auftraege: await auftraegeZumObjekt(kontext, id),
    };
  }, ['auftrag.lesen']);

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Objekt" aktiverTab="objekte">
        <Kopfzeile titel="Objekt" />
        <KeinZugang />
      </KundenRahmen>
    );
  }
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { objekt: o, raeume, auftraege } = ergebnis.daten;
  const darfAuftrag = basis.rechte['auftrag.lesen'] === true;

  return (
    <KundenRahmen basis={basis} titel={o.bezeichnung} aktiverTab="objekte">
      <Zurueck ziel="/portal/kunde/objekte" text="Alle Objekte" />

      <Kopfzeile titel={o.bezeichnung}>
        <span className="cse-zahl text-sm text-text-muted">{o.objektnummer}</span>
      </Kopfzeile>

      <Card className="mb-s5">
        <Felder>
          <Feld label="Gesellschaft">
            <Gesellschaft slug={o.mandantSlug} name={o.mandantName} />
          </Feld>
          <Feld label="Anschrift">
            <span className="block">
              {o.strasse}{o.hausnummer === null ? '' : ` ${o.hausnummer}`}
            </span>
            {o.adresszusatz === null ? null : (
              <span className="block text-text-muted">{o.adresszusatz}</span>
            )}
            <span className="block">
              <span className="cse-zahl">{o.plz}</span> {o.ort}
            </span>
          </Feld>
          {o.gebaeudetyp !== null && <Feld label="Gebäudetyp">{o.gebaeudetyp}</Feld>}
          {o.etagenAnzahl !== null && (
            <Feld label="Etagen">
              <span className="cse-zahl">{o.etagenAnzahl}</span>
            </Feld>
          )}
          <Feld label="Räume im Raumbuch">
            {o.raeume === 0
              ? 'noch nicht aufgenommen'
              : <span className="cse-zahl">{o.raeume}</span>}
          </Feld>
          {o.raeume > 0 && (
            <Feld label="Bodenfläche gesamt">
              <span className="cse-zahl">
                {formatiereMenge(mengeAusPostgres(o.flaecheQm))}
              </span> m²
            </Feld>
          )}
          {/*
            * Die Glasflaeche erscheint NUR, wenn sie gepflegt ist. `null`
            * heisst „nicht erfasst" und nicht „null Quadratmeter": sie wird
            * dort gefuehrt, wo Glasreinigung vereinbart ist (CLN-05), und
            * „0,000 m² Glas" waere an einem Buerohaus offensichtlich falsch.
            */}
          {o.fensterFlaecheQm !== null && (
            <Feld label="Glasfläche gesamt">
              <span className="cse-zahl">
                {formatiereMenge(mengeAusPostgres(o.fensterFlaecheQm))}
              </span> m²
            </Feld>
          )}
        </Felder>
      </Card>

      <h2 className="mb-s3 text-h3 text-text">Aufträge an diesem Standort</h2>
      {auftraege.length === 0 ? (
        <div className="mb-s5">
          <Leer text="Zu dieser Liegenschaft ist kein laufender oder
            abgeschlossener Auftrag erfasst." />
        </div>
      ) : (
        <div className="mb-s5">
          <DataTable
            beschriftung="Aufträge an diesem Objekt mit Nummer, Bezeichnung, Art, Laufzeit und Zustand"
            zeilen={auftraege}
            schluessel={(a: ObjektAuftrag) => a.id}
            spalten={[
              {
                schluessel: 'nummer',
                kopf: 'Nummer',
                zelle: (a) => darfAuftrag ? (
                  <Link
                    href={`/portal/kunde/auftraege/${a.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {a.auftragsnummer}
                  </Link>
                ) : (
                  /*
                   * Ohne `auftrag.lesen` steht die NUMMER da und kein Verweis:
                   * ein Verweis, dessen Ziel diese Sitzung nicht oeffnen darf,
                   * endete in einem 404 und verriete die Existenz dessen, was
                   * er nicht zeigen darf (AUT-06, D-581).
                   */
                  <span className="text-text">{a.auftragsnummer}</span>
                ),
              },
              { schluessel: 'bezeichnung', kopf: 'Bezeichnung', zelle: (a) => a.bezeichnung },
              { schluessel: 'art', kopf: 'Art', zelle: (a) => ART[a.art] ?? a.art },
              {
                schluessel: 'start',
                kopf: 'Beginn',
                zelle: (a) => <span className="cse-zahl">{a.startDatumLokal}</span>,
              },
              {
                schluessel: 'laufzeit',
                kopf: 'Laufzeit bis',
                zelle: (a) => a.laufzeitBisLokal === null
                  ? <span className="text-text-subtle">unbefristet</span>
                  : <span className="cse-zahl">{a.laufzeitBisLokal}</span>,
              },
              {
                schluessel: 'status',
                kopf: 'Zustand',
                zelle: (a) => <StatusPill zustand={PILLE[a.status] ?? 'Geplant'} />,
              },
            ]}
          />
        </div>
      )}

      <h2 className="mb-s3 text-h3 text-text">Raumbuch</h2>
      {raeume.length === 0 ? (
        <div className="mb-s5">
          <Leer text="Für diese Liegenschaft ist noch kein Raumbuch aufgenommen.
            Das Raumbuch entsteht bei der Objektaufnahme; es ist die Grundlage
            jeder Flächenangabe." />
        </div>
      ) : (
        <div className="mb-s5">
          <DataTable
            beschriftung="Raumbuch mit Raumnummer, Bezeichnung, Etage, Nutzungsart, Bodenfläche und Glasfläche"
            zeilen={raeume}
            schluessel={(r: Kundenraum) => r.id}
            spalten={[
              {
                schluessel: 'nummer',
                kopf: 'Raum',
                /*
                 * `raumnummer` ist NULLBAR, und das mit Grund: ein echtes
                 * Raumbuch fuehrt Flur, Treppenhaus und WC-Vorraum ohne
                 * Tuernummer (0021). Fehlt sie, traegt die Zeile ihre
                 * Bezeichnung — nie ein leeres Feld.
                 */
                zelle: (r) => r.raumnummer === null
                  ? <span className="text-text-subtle">ohne Nummer</span>
                  : <span className="cse-zahl">{r.raumnummer}</span>,
              },
              {
                schluessel: 'bezeichnung',
                kopf: 'Bezeichnung',
                zelle: (r) => r.bezeichnung ?? <span className="text-text-subtle">—</span>,
              },
              {
                schluessel: 'etage',
                kopf: 'Etage',
                zelle: (r) => r.etage ?? <span className="text-text-subtle">—</span>,
              },
              {
                schluessel: 'nutzung',
                kopf: 'Nutzung',
                zelle: (r) => r.nutzungsart ?? <span className="text-text-subtle">—</span>,
              },
              {
                schluessel: 'flaeche',
                kopf: 'Fläche',
                numerisch: true,
                zelle: (r) => `${formatiereMenge(mengeAusPostgres(r.flaecheQm))} m²`,
              },
              {
                schluessel: 'glas',
                kopf: 'davon Glas',
                numerisch: true,
                zelle: (r) => r.fensterFlaecheQm === null
                  ? <span className="text-text-subtle">—</span>
                  : `${formatiereMenge(mengeAusPostgres(r.fensterFlaecheQm))} m²`,
              },
            ]}
          />
        </div>
      )}

      <div className="flex flex-col gap-s4">
        <Offen
          nummer="O-74"
          was="Änderungen am Raumbuch nimmt Ihre Ansprechpartnerin auf"
          weg="Das Portal ist lesend; ob ein Kundenzugang eine Raumänderung
            selbst melden kann, ist noch nicht entschieden."
        />
      </div>
    </KundenRahmen>
  );
}
