import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgres } from '@/server/services/finanz/menge';
import { prozentText } from '@/server/services/kundenportal/rechnung';
import {
  findeKundenauftrag, leistungenZumAuftrag, type Auftragsleistung,
} from '@/server/services/kundenportal/auftrag';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { kundePortal, KundenRahmen } from '../../rahmen';
import {
  Feld, Felder, Gesellschaft, KeinZugang, Kopfzeile, Leer, Offen, Zurueck,
} from '../../bausteine';

/**
 * `/portal/kunde/auftraege/[id]` — ein Auftrag mit seinen Leistungszeilen
 * (OPS-05, OPS-11, CRM-06, AUT-06, 04-SEITENKARTE §8).
 *
 * ===========================================================================
 * Es wird auf dieser Seite NICHTS gerechnet
 * ===========================================================================
 *
 * `gesamtpreis_cent` ist eine ERZEUGTE Spalte der Datenbank
 * (`round(menge * einzelpreis_cent)`, 0050) — kaufmaennisch gerundet in
 * exakter numerischer Arithmetik, nie in JavaScript, wo aus 0,1 × 3 nicht 0,3
 * wird. Die Seite liest sie und formatiert sie; sie multipliziert nicht.
 *
 * **Und es steht bewusst KEINE Summe unter der Tabelle.** Die Zeilen eines
 * Auftrags haben Gueltigkeitszeitraeume: eine abgeloeste Zeile steht neben
 * ihrer Nachfolgerin, und eine Monatsleistung neben einer einmaligen. Eine
 * addierte Spalte darueber waere eine Zahl ohne Bedeutung — und im
 * Kundenportal eine, die wie ein Rechnungsbetrag aussaehe. Was tatsaechlich
 * berechnet wurde, steht unter „Rechnungen".
 *
 * ===========================================================================
 * Abschnitte, die es hier NICHT gibt
 * ===========================================================================
 *
 *  · **Dienstplan, Einsaetze, eingesetzte Personen.** 04-SEITENKARTE §8
 *    verschliesst dem Kunden das `personal`-Modul („no names, no schedules").
 *    Die Abfrage wird gar nicht erst gestellt.
 *  · **Zeiteintraege.** `zeiteintrag` traegt ausdruecklich KEIN `t_kunde`
 *    (0034: „Stunden sind ein Beschaeftigungsdatensatz"). Eine leere Liste
 *    behauptete, es sei nicht gearbeitet worden.
 *  · **Kalkulation und Marge.** `kalkulation` wird in diesem ganzen Ordner
 *    nirgends gelesen; `tests/kern/kundenportal.test.ts` haelt das fest.
 *
 * **Ein fremder Auftrag gibt 404, nie 403** (AUT-06, SEC-A3): `t_kunde` auf
 * `auftrag` bindet die Zeile an `app.aktuelle_kunden()`, und „nicht da" ist
 * byte-gleich mit „nicht erlaubt".
 */
export const dynamic = 'force-dynamic';

const ART: Readonly<Record<string, string>> = {
  einzelauftrag: 'Einzelauftrag',
  rahmenvertrag: 'Rahmenvertrag',
  dauerauftrag: 'Dauerauftrag',
  projekt: 'Projekt',
};

const PILLE: Readonly<Record<string, PillZustand>> = {
  angelegt: 'Geplant',
  aktiv: 'Aktiv',
  pausiert: 'Wartet',
  abgeschlossen: 'Abgeschlossen',
  storniert: 'Abgelehnt',
};

const ZUSATZ: Readonly<Record<string, string>> = {
  pausiert: 'pausiert',
  storniert: 'storniert',
};

/** `steuer_kennzeichen` — der Grund, warum keine Umsatzsteuer ausgewiesen ist. */
const KENNZEICHEN: Readonly<Record<string, string>> = {
  reverse_charge_13b: '§ 13b UStG',
  steuerfrei: 'steuerfrei',
};

export default async function Kundenauftrag(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roh } = await params;
  const id = kennungOder404(roh);

  const ergebnis = await kundePortal(`/portal/kunde/auftraege/${id}`, async (kontext) => {
    const auftrag = await findeKundenauftrag(kontext, id);
    if (auftrag === null) return null;
    return { auftrag, leistungen: await leistungenZumAuftrag(kontext, id) };
  }, ['objekt.lesen', 'angebot.lesen']);

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Auftrag" aktiverTab="auftraege">
        <Kopfzeile titel="Auftrag" />
        <KeinZugang />
      </KundenRahmen>
    );
  }
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { auftrag: a, leistungen } = ergebnis.daten;
  /*
   * Ein Verweis darf nicht mehr versprechen, als seine Zielroute haelt: ohne
   * das Recht der Zielseite stuende dahinter ein 404 — genau die Auskunft,
   * die AUT-06 verweigert (D-581). Die Rechte kommen aus derselben gebundenen
   * Transaktion wie die Daten.
   */
  const darfObjekt = basis.rechte['objekt.lesen'] === true;
  const darfAngebot = basis.rechte['angebot.lesen'] === true;

  return (
    <KundenRahmen basis={basis} titel={a.auftragsnummer} aktiverTab="auftraege">
      <Zurueck ziel="/portal/kunde/auftraege" text="Alle Aufträge" />

      <Kopfzeile titel={a.auftragsnummer}>
        <span className="inline-flex flex-wrap items-center gap-s2">
          <StatusPill zustand={PILLE[a.status] ?? 'Geplant'} />
          {ZUSATZ[a.status] === undefined ? null : (
            <span data-cse="zustand-zusatz" className="text-sm text-text-muted">
              {ZUSATZ[a.status]}
            </span>
          )}
        </span>
      </Kopfzeile>

      <p className="mb-s5 max-w-prose text-h3 text-text">{a.bezeichnung}</p>

      <Card className="mb-s5">
        <Felder>
          <Feld label="Gesellschaft">
            <Gesellschaft slug={a.mandantSlug} name={a.mandantName} />
          </Feld>
          <Feld label="Art">{ART[a.art] ?? a.art}</Feld>
          <Feld label="Beginn">
            <span className="cse-zahl">{a.startDatumLokal}</span>
          </Feld>
          <Feld label="Laufzeit bis">
            {a.laufzeitBisLokal === null
              ? 'unbefristet'
              : <span className="cse-zahl">{a.laufzeitBisLokal}</span>}
          </Feld>
          {a.kuendigungsfristTage !== null && (
            <Feld label="Kündigungsfrist">
              <span className="cse-zahl">{a.kuendigungsfristTage}</span> Tage
            </Feld>
          )}
          <Feld label="Verlängerung">
            {a.verlaengerungAutomatisch
              ? 'verlängert sich automatisch'
              : 'endet zum vereinbarten Datum'}
          </Feld>
          <Feld label="Objekt">
            {a.objektBezeichnung === null ? (
              /*
               * Ein Rahmenvertrag ueber mehrere Liegenschaften traegt im Kopf
               * kein Objekt — die Standorte stehen an den Leistungszeilen
               * (0050). Der Satz sagt das, statt ein „—" stehen zu lassen,
               * das wie eine Luecke aussieht.
               */
              <span className="text-text-muted">
                kein einzelnes Objekt — die Standorte stehen an den Leistungen
              </span>
            ) : a.objektId !== null && darfObjekt ? (
              <Link
                href={`/portal/kunde/objekte/${a.objektId}`}
                className="text-text underline-offset-2 hover:text-brand hover:underline"
              >
                {a.objektBezeichnung}
              </Link>
            ) : (
              a.objektBezeichnung
            )}
          </Feld>
          {a.angebotsnummer !== null && (
            <Feld label="Aus Angebot">
              {a.angebotId !== null && darfAngebot ? (
                <Link
                  href={`/portal/kunde/angebote/${a.angebotId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {a.angebotsnummer}
                </Link>
              ) : (
                a.angebotsnummer
              )}
            </Feld>
          )}
          {a.abnahmeAmLokal !== null && (
            <Feld label="Abnahme">
              <span className="cse-zahl">{a.abnahmeAmLokal}</span>
            </Feld>
          )}
          {a.gewaehrleistungBisLokal !== null && (
            <Feld label="Gewährleistung bis">
              <span className="cse-zahl">{a.gewaehrleistungBisLokal}</span>
            </Feld>
          )}
          {a.abgeschlossenAmLokal !== null && (
            <Feld label="Abgeschlossen am">
              <span className="cse-zahl">{a.abgeschlossenAmLokal}</span>
            </Feld>
          )}
        </Felder>

        {a.beschreibung === null ? null : (
          <p className="mt-s5 mb-0 max-w-prose whitespace-pre-line text-base text-text">
            {a.beschreibung}
          </p>
        )}
      </Card>

      <h2 className="mb-s3 text-h3 text-text">Vereinbarte Leistungen</h2>
      {leistungen.length === 0 ? (
        <div className="mb-s5">
          <Leer text="Zu diesem Auftrag sind keine Leistungszeilen erfasst. Was
            geschuldet ist, steht dann im Vertragstext — Ihre Ansprechpartnerin
            hat ihn vorliegen." />
        </div>
      ) : (
        <div className="mb-s5">
          <DataTable
            beschriftung="Vereinbarte Leistungen mit Menge, Einheit, Einzelpreis, Gesamtpreis, Steuersatz und Gültigkeit"
            zeilen={leistungen}
            schluessel={(l: Auftragsleistung) => l.id}
            spalten={[
              {
                schluessel: 'nr',
                kopf: 'Pos.',
                numerisch: true,
                zelle: (l) => String(l.positionNr),
              },
              {
                schluessel: 'bezeichnung',
                kopf: 'Leistung',
                zelle: (l) => (
                  <span>
                    <span className="text-text">{l.bezeichnung}</span>
                    {l.beschreibung === null ? null : (
                      <span className="block text-sm text-text-muted">{l.beschreibung}</span>
                    )}
                    {l.frequenzText === null ? null : (
                      <span className="block text-sm text-text-subtle">{l.frequenzText}</span>
                    )}
                    {l.objektBezeichnung === null ? null : (
                      <span className="block text-sm text-text-subtle">
                        {l.objektBezeichnung}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'menge',
                kopf: 'Menge',
                numerisch: true,
                /*
                 * `formatiereMenge(mengeAusPostgres(...))` — eine Menge ist
                 * `numeric(12,3)` und kommt als Text. Sie durch `Number`
                 * laufen zu lassen waere der Gleitkommafehler, den R-15
                 * ausschliesst.
                 */
                zelle: (l) => l.menge === null
                  ? <span className="text-text-subtle">—</span>
                  : `${formatiereMenge(mengeAusPostgres(l.menge))} ${l.einheit ?? ''}`,
              },
              {
                schluessel: 'einzelpreis',
                kopf: 'Einzelpreis',
                numerisch: true,
                zelle: (l) => l.einzelpreisCent === null
                  ? <span className="text-text-subtle">—</span>
                  : formatiereGeld(cent(BigInt(l.einzelpreisCent))),
              },
              {
                schluessel: 'gesamt',
                kopf: 'Gesamt',
                numerisch: true,
                zelle: (l) => l.gesamtpreisCent === null
                  ? <span className="text-text-subtle">—</span>
                  : formatiereGeld(cent(BigInt(l.gesamtpreisCent))),
              },
              {
                schluessel: 'ust',
                kopf: 'USt.',
                numerisch: true,
                zelle: (l) => (
                  <span>
                    {prozentText(l.steuersatzBp)}
                    {KENNZEICHEN[l.steuerKennzeichen] === undefined ? null : (
                      <span className="block text-xs text-text-subtle">
                        {KENNZEICHEN[l.steuerKennzeichen]}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'gueltig',
                kopf: 'Gültig',
                zelle: (l) => (
                  <span>
                    <span className="cse-zahl">
                      {l.gueltigAbLokal}
                      {l.gueltigBisLokal === null ? ' –' : ` – ${l.gueltigBisLokal}`}
                    </span>
                    {/*
                      * „abgelöst" statt „abgelaufen": die Zeile ist nicht
                      * verfallen, sie wurde durch eine neue ersetzt (0050 —
                      * beendet wird durch `gueltig_bis`, nicht durch DELETE).
                      * Wer eine alte Rechnung prüft, braucht genau diese
                      * Zeile.
                      */}
                    {l.inKraft ? null : (
                      <span data-cse="abgeloest" className="block text-xs text-text-subtle">
                        abgelöst
                      </span>
                    )}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      <div className="flex flex-col gap-s4">
        <Offen
          nummer="O-840"
          was="Die Auftragssumme steht nicht im Portal"
          weg="Ob der vereinbarte Auftragswert hier erscheint, ist noch nicht
            entschieden; was berechnet wurde, steht unter „Rechnungen“."
        />
        <Offen
          nummer="O-74"
          was="Änderungswünsche laufen über Ihre Ansprechpartnerin"
          weg="Das Portal ist lesend; ob ein Kundenzugang einen Auftrag im
            Portal ändern oder kündigen kann, ist noch nicht entschieden."
        />
      </div>
    </KundenRahmen>
  );
}
