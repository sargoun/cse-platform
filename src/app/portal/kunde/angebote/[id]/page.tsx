import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgres } from '@/server/services/finanz/menge';
import { prozentText } from '@/server/services/kundenportal/rechnung';
import {
  angebotsSummen, angebotsTexte, bindefristText, bindefristVorbei,
  findeKundenangebot, positionenZumAngebot, steuernZumAngebot,
  type Angebotsposition,
} from '@/server/services/kundenportal/angebot';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { kundePortal, KundenRahmen } from '../../rahmen';
import {
  Feld, Felder, Gesellschaft, KeinZugang, Kopfzeile, Offen, Zurueck,
} from '../../bausteine';

/**
 * `/portal/kunde/angebote/[id]` — ein Angebot, wie der Kunde es bekommen hat
 * (OPS-08, OPS-09, AUT-06, 04-SEITENKARTE §8).
 *
 * ===========================================================================
 * Es wird auf dieser Seite NICHTS gerechnet
 * ===========================================================================
 *
 * `gesamtpreis_cent` je Position ist eine ERZEUGTE Spalte
 * (`round(menge * einzelpreis_cent)`, 0024), `netto_cent` am Kopf pflegt ein
 * Ausloeser, und die Umsatzsteuer steht JE STEUERSATZGRUPPE in
 * `angebot_steuer` — beim Versand geschrieben und danach unveraenderlich. Die
 * Bruttosumme bildet `angebotsSummen` in Postgres in `bigint`. Eine Summe,
 * die hier entstuende, waere eine zweite Wahrheit neben der versendeten
 * (CLAUDE.md: „No calculation in a component, ever").
 *
 * **Warum es kein `brutto_cent` am Angebot gibt** (0024): §0.6 verbietet, die
 * Umsatzsteuer aus einer Bruttosumme abzuleiten, und eine zweite gepflegte
 * Summe neben den Steuerzeilen waere genau das.
 *
 * ===========================================================================
 * Die Annahme — der eine sichtbare Platzhalter
 * ===========================================================================
 *
 * Die Annahme eines Angebots ist eine WILLENSERKLAERUNG: sie bringt einen
 * Vertrag zustande. Ob ein Kundenzugang sie im Portal abgeben kann — und wenn
 * ja, mit welcher Identitaetspruefung, welchem Protokoll und welcher
 * Vertretungsmacht des Ansprechpartners —, ist als O-74 offen. Hier steht
 * deshalb ein SATZ und kein ausgegrauter Knopf: ein ausgegrauter Knopf sagt
 * „nicht jetzt" und laesst offen, ob es an der Anmeldung, am Recht oder am
 * Zustand liegt. Der Satz sagt, was heute der richtige Weg IST.
 *
 * Alles andere auf dieser Seite ist gebaut: Kopf, Texte, Positionen,
 * Steuerzeilen, Summen, Bindefrist, Zustand.
 *
 * **Kein PDF-Verweis.** Das Angebots-PDF entsteht intern aus den HEUTIGEN
 * Stammdaten (`/portal/[mandant]/angebote/[id]/pdf`) und nicht aus einem
 * Schnappschuss, wie K-12 ihn fuer die Rechnung verlangt. Zwei Abzuege
 * desselben Angebots koennten sich damit unterscheiden — bei einem Dokument,
 * das ein Vertragsangebot IST, ist das kein Schoenheitsfehler.
 * // TODO(client, O-844): Bekommt das versendete Angebot einen Schnappschuss
 * wie die Rechnung (`rechnung_snapshot`, K-12), damit der Kunde im Portal
 * genau das Dokument herunterladen kann, das er per Mail bekommen hat? Ohne
 * ihn gibt es keinen Abzug, der nachweislich derselbe ist.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  versendet: 'Angebot',
  angenommen: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Archiviert',
  abgelaufen: 'Archiviert',
  entwurf: 'Entwurf',
  in_pruefung: 'In Prüfung',
};

const ZUSTANDSSATZ: Readonly<Record<string, string>> = {
  versendet: 'Dieses Angebot liegt Ihnen zur Entscheidung vor.',
  angenommen: 'Dieses Angebot wurde angenommen.',
  abgelehnt: 'Dieses Angebot wurde abgelehnt.',
  zurueckgezogen: 'Dieses Angebot wurde zurückgezogen und gilt nicht mehr.',
  abgelaufen: 'Die Bindefrist dieses Angebots ist abgelaufen.',
};

/** `angebotsposition_typ` (0024, Platzhalter O-73). */
const TYP: Readonly<Record<string, string>> = {
  leistung: 'Leistung',
  alternativ: 'Alternativposition',
  eventual: 'Bedarfsposition',
  text: 'Text',
  zwischensumme: 'Zwischensumme',
};

const KENNZEICHEN: Readonly<Record<string, string>> = {
  reverse_charge_13b: '§ 13b UStG',
  steuerfrei: 'steuerfrei',
};

export default async function Kundenangebot(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roh } = await params;
  const id = kennungOder404(roh);

  const ergebnis = await kundePortal(`/portal/kunde/angebote/${id}`, async (kontext) => {
    const angebot = await findeKundenangebot(kontext, id);
    if (angebot === null) return null;
    return {
      angebot,
      texte: await angebotsTexte(kontext, id),
      positionen: await positionenZumAngebot(kontext, id),
      steuern: await steuernZumAngebot(kontext, id),
      summen: await angebotsSummen(kontext, id),
    };
  });

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Angebot" aktiverTab="angebote">
        <Kopfzeile titel="Angebot" />
        <KeinZugang />
      </KundenRahmen>
    );
  }
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { angebot: a, texte, positionen, steuern, summen } = ergebnis.daten;
  /*
   * Eine Bedarfs- oder Alternativposition zaehlt NICHT in die Summe: der
   * Ausloeser `kern.aktualisiere_angebot_summen` (0024) summiert
   * ausschliesslich `typ = 'leistung'`. Die Seite sagt das, wenn es solche
   * Zeilen gibt — sonst sucht der Kunde den Unterschied zwischen der Spalte
   * und der Summe.
   */
  const hatNebenpositionen = positionen.some(
    (p) => p.typ === 'alternativ' || p.typ === 'eventual');

  return (
    <KundenRahmen basis={basis} titel={a.angebotsnummer} aktiverTab="angebote">
      <Zurueck ziel="/portal/kunde/angebote" text="Alle Angebote" />

      <Kopfzeile titel={a.angebotsnummer}>
        <StatusPill zustand={PILLE[a.status] ?? 'Angebot'} />
      </Kopfzeile>

      <p className="mb-s5 max-w-prose text-h3 text-text">{a.titel}</p>

      {ZUSTANDSSATZ[a.status] === undefined ? null : (
        <p data-cse="zustandssatz" className="mb-s5 max-w-prose text-base text-text-muted">
          {ZUSTANDSSATZ[a.status]}
          {a.entschiedenAmLokal === null ? '' : ` (${a.entschiedenAmLokal})`}
        </p>
      )}

      <Card className="mb-s5">
        <Felder>
          <Feld label="Gesellschaft">
            <Gesellschaft slug={a.mandantSlug} name={a.mandantName} />
          </Feld>
          <Feld label="Versendet am">
            <span className="cse-zahl">{a.versendetAmLokal}</span>
          </Feld>
          <Feld label="Bindefrist">
            {a.gueltigBisLokal === null ? 'ohne Frist vereinbart' : (
              <>
                <span className="cse-zahl">{a.gueltigBisLokal}</span>
                <span
                  data-cse="bindefrist"
                  className={`ml-s2 text-sm ${
                    bindefristVorbei(a.tageBisAblauf) ? 'text-warning' : 'text-text-muted'}`}
                >
                  {bindefristText(a.tageBisAblauf)}
                </span>
              </>
            )}
          </Feld>
          {(a.leistungVonLokal !== null || a.leistungBisLokal !== null) && (
            <Feld label="Leistungszeitraum">
              <span className="cse-zahl">
                {a.leistungVonLokal ?? '?'} – {a.leistungBisLokal ?? '?'}
              </span>
            </Feld>
          )}
          {a.objektBezeichnung !== null && (
            <Feld label="Objekt">{a.objektBezeichnung}</Feld>
          )}
          {a.version > 1 && (
            <Feld label="Fassung">
              <span className="cse-zahl">{a.version}</span>
              {a.ersetztNummer === null ? null : ` — ersetzt ${a.ersetztNummer}`}
            </Feld>
          )}
        </Felder>

        {texte === null || texte.einleitung === null ? null : (
          <p className="mt-s5 mb-0 max-w-prose whitespace-pre-line text-base text-text">
            {texte.einleitung}
          </p>
        )}
      </Card>

      <h2 className="mb-s3 text-h3 text-text">Positionen</h2>
      {positionen.length === 0 ? (
        <p className="m-0 mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Dieses Angebot führt keine Einzelpositionen.
        </p>
      ) : (
        <div className="mb-s5">
          <DataTable
            beschriftung="Positionen des Angebots mit Bezeichnung, Menge, Einheit, Einzelpreis, Gesamtpreis und Steuersatz"
            zeilen={positionen}
            schluessel={(p: Angebotsposition) => p.id}
            spalten={[
              {
                schluessel: 'nr',
                kopf: 'Pos.',
                numerisch: true,
                zelle: (p) => (
                  <span>
                    {String(p.positionNr)}
                    {p.oz === null ? null : (
                      <span className="block text-xs text-text-subtle">{p.oz}</span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'bezeichnung',
                kopf: 'Bezeichnung',
                zelle: (p) => (
                  <span>
                    <span className="text-text">{p.kurztext}</span>
                    {p.langtext === null ? null : (
                      <span className="block whitespace-pre-line text-sm text-text-muted">
                        {p.langtext}
                      </span>
                    )}
                    {p.objektBezeichnung === null ? null : (
                      <span className="block text-sm text-text-subtle">
                        {p.objektBezeichnung}
                      </span>
                    )}
                    {/*
                      * Der TYP steht nur dort, wo er etwas aendert. „Leistung"
                      * an jeder Zeile waere Rauschen; „Bedarfsposition" ist
                      * die Auskunft, dass diese Zeile NICHT in der Summe
                      * steht.
                      */}
                    {p.typ === 'leistung' ? null : (
                      <span data-cse="positionstyp" className="block text-xs text-text-subtle">
                        {TYP[p.typ] ?? p.typ}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'menge',
                kopf: 'Menge',
                numerisch: true,
                zelle: (p) => p.menge === null
                  ? <span className="text-text-subtle">—</span>
                  : `${formatiereMenge(mengeAusPostgres(p.menge))} ${p.einheit ?? ''}`,
              },
              {
                schluessel: 'einzelpreis',
                kopf: 'Einzelpreis',
                numerisch: true,
                /*
                 * Eine `text`- oder `zwischensumme`-Zeile traegt laut CHECK
                 * `ap_text_ohne_preis` KEINEN Preis. `BigInt(null)` wuerfe,
                 * und der Kunde saehe sein eigenes Angebot nicht mehr.
                 */
                zelle: (p) => p.einzelpreisCent === null
                  ? <span className="text-text-subtle">—</span>
                  : formatiereGeld(cent(BigInt(p.einzelpreisCent))),
              },
              {
                schluessel: 'gesamt',
                kopf: 'Gesamt',
                numerisch: true,
                zelle: (p) => p.gesamtpreisCent === null
                  ? <span className="text-text-subtle">—</span>
                  : formatiereGeld(cent(BigInt(p.gesamtpreisCent))),
              },
              {
                schluessel: 'ust',
                kopf: 'USt.',
                numerisch: true,
                zelle: (p) => (
                  <span>
                    {prozentText(p.steuersatzBp)}
                    {KENNZEICHEN[p.steuerKennzeichen] === undefined ? null : (
                      <span className="block text-xs text-text-subtle">
                        {KENNZEICHEN[p.steuerKennzeichen]}
                      </span>
                    )}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      {hatNebenpositionen && (
        <p data-cse="nebenpositionen" className="mb-s5 max-w-prose text-sm text-text-muted">
          Alternativ- und Bedarfspositionen sind in den Summen unten NICHT
          enthalten. Sie werden berechnet, wenn sie abgerufen werden.
        </p>
      )}

      <h2 className="mb-s3 text-h3 text-text">Summen</h2>
      <Card className="mb-s5">
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-s5 gap-y-s2">
          <dt className="text-base text-text-muted">Netto</dt>
          <dd className="m-0 cse-zahl text-base text-text">
            {formatiereGeld(cent(BigInt(summen.nettoCent)))}
          </dd>

          {/*
            * Die Steuer je STEUERSATZGRUPPE, nicht als eine Zahl: Invariante 1
            * verlangt sie je Gruppe gerechnet, und ein Angebot mit 19 % und
            * 7 % hat zwei Zeilen. Der Hinweistext steht dort, wo der Satz 0
            * ist — sonst stuende „0,00 EUR" ohne Erklaerung.
            */}
          {steuern.map((s, i) => (
            <div key={`${s.steuerKennzeichen}-${String(s.steuersatzBp)}-${String(i)}`} className="contents">
              <dt className="text-base text-text-muted">
                Umsatzsteuer {prozentText(s.steuersatzBp)}
                <span className="block text-sm text-text-subtle">
                  auf {formatiereGeld(cent(BigInt(s.nettoCent)))}
                  {s.hinweistext === null ? '' : ` · ${s.hinweistext}`}
                </span>
              </dt>
              <dd className="m-0 cse-zahl text-base text-text">
                {formatiereGeld(cent(BigInt(s.steuerCent)))}
              </dd>
            </div>
          ))}

          <dt className="border-t border-line pt-s3 text-h3 text-text">Brutto</dt>
          <dd
            data-cse="angebot-brutto"
            className="m-0 border-t border-line pt-s3 cse-zahl text-h3 text-text"
          >
            {formatiereGeld(cent(BigInt(summen.bruttoCent)))}
          </dd>
        </dl>
      </Card>

      {texte === null || texte.schluss === null ? null : (
        <p className="mb-s5 max-w-prose whitespace-pre-line text-sm text-text-muted">
          {texte.schluss}
        </p>
      )}

      <h2 className="mb-s3 text-h3 text-text">Annehmen oder ablehnen</h2>
      <div className="flex flex-col gap-s4">
        <Offen
          nummer="O-74"
          was="Ihre Entscheidung nimmt Ihre Ansprechpartnerin entgegen"
          weg="Die Annahme eines Angebots bringt einen Vertrag zustande. Ob ein
            Kundenzugang diese Erklärung im Portal abgeben kann — und mit
            welcher Prüfung der Vertretungsmacht —, ist noch nicht entschieden."
        />
        <Offen
          nummer="O-844"
          was="Dieses Angebot gibt es hier nicht als Datei"
          weg="Ein Abzug entstünde aus den heutigen Stammdaten und wäre damit
            nicht nachweislich derselbe wie der versendete; ob das versendete
            Angebot einen Schnappschuss bekommt, ist noch nicht entschieden."
        />
      </div>
    </KundenRahmen>
  );
}
