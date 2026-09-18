import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { findeKundenprojekt } from '@/server/services/kundenportal/projekt';
import {
  aufmasseZumProjekt, kundenUnterschriften,
  type Kundennachweis, type Kundenunterschrift,
} from '@/server/services/kundenportal/nachweis';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { kundePortal, KundenRahmen } from '../../rahmen';
import {
  Feld, Felder, Gesellschaft, KeinZugang, Kopfzeile, Leer, Offen, Zurueck,
} from '../../bausteine';

/**
 * `/portal/kunde/projekte/[id]` — ein Bauprojekt mit seinen Aufmassen
 * (OPS-05, REP-05, AUT-06, 04-SEITENKARTE §8).
 *
 * ===========================================================================
 * Drei Abschnitte, die es hier bewusst NICHT gibt
 * ===========================================================================
 *
 *  · **Bautagebuch.** `bautagebuch` traegt `p_intern_einsatz_decke` und kein
 *    `t_kunde`. Die Abfrage wird nicht gestellt — eine leere Liste auf dem
 *    Bildschirm behauptet, es sei nichts geschrieben worden (K-18).
 *    O-78 hält Bautagebuch und Wachbuch ausdrücklich vom Kunden fern.
 *  · **Nachträge und Behinderungsanzeigen.** Beide tragen die RESTRIKTIVE
 *    `p_intern_decke` mit `app.portal() = 'intern'` und kein `t_kunde`
 *    (nachgesehen in `pg_policies`). Die Datenbank hat die Frage also schon
 *    entschieden, genauso wie beim Bautagebuch. Ein Platzhalterabschnitt
 *    dafür entsteht hier NICHT — sonst schliesst ihn später jemand „einfach
 *    an", ohne zu merken, dass dafür eine Decke geöffnet werden muss.
 *  · **Kalkulation, Marge, Stundensätze, Sicherheitseinbehalt.** Keine dieser
 *    Spalten steht in der Abfrage.
 *
 * **Ein fremdes Projekt gibt 404, nie 403** (AUT-06, SEC-A3): `t_kunde` auf
 * `projekt` bindet die Zeile an `app.aktuelle_kunden()`, und „nicht da" ist
 * byte-gleich mit „nicht erlaubt".
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  geplant: 'Geplant',
  in_arbeit: 'In Arbeit',
  abgenommen: 'Bereit',
  abgeschlossen: 'Abgeschlossen',
  archiviert: 'Archiviert',
};

const AUFMASS_PILLE: Readonly<Record<string, PillZustand>> = {
  vorgelegt: 'In Prüfung',
  gegengezeichnet: 'Abgeschlossen',
  einseitig_festgestellt: 'Bereit',
  abgelehnt: 'Abgelehnt',
};

const ART: Readonly<Record<string, string>> = {
  hochbau: 'Hochbau', ausbau: 'Ausbau', rueckbau: 'Rückbau',
};

const GRUNDLAGE: Readonly<Record<string, string>> = { vob_b: 'VOB/B', bgb: 'BGB' };

const ERHEBUNG: Readonly<Record<string, string>> = {
  gemeinsam: 'gemeinsam aufgemessen', einseitig: 'einseitig aufgemessen',
};

export default async function Kundenprojekt(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roh } = await params;
  const id = kennungOder404(roh);

  const ergebnis = await kundePortal(`/portal/kunde/projekte/${id}`, async (kontext) => {
    const projekt = await findeKundenprojekt(kontext, id);
    if (projekt === null) return null;
    const aufmasse = await aufmasseZumProjekt(kontext, id);
    const unterschriften = await kundenUnterschriften(
      kontext, [], aufmasse.map((a) => a.id),
    );
    return { projekt, aufmasse, unterschriften };
  });

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Bauprojekt" aktiverTab="projekte">
        <Kopfzeile titel="Bauprojekt" />
        <KeinZugang />
      </KundenRahmen>
    );
  }
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { projekt, aufmasse, unterschriften } = ergebnis.daten;

  const jeAufmass = new Map<string, Kundenunterschrift[]>();
  for (const u of unterschriften) {
    const liste = jeAufmass.get(u.nachweisId) ?? [];
    liste.push(u);
    jeAufmass.set(u.nachweisId, liste);
  }

  return (
    <KundenRahmen basis={basis} titel={projekt.nummer} aktiverTab="projekte">
      <Zurueck ziel="/portal/kunde/projekte" text="Alle Bauprojekte" />

      <Kopfzeile titel={projekt.nummer}>
        <StatusPill zustand={PILLE[projekt.status] ?? 'Geplant'} />
      </Kopfzeile>

      <p className="mb-s5 max-w-prose text-h3 text-text">{projekt.bezeichnung}</p>

      <Card className="mb-s5">
        <Felder>
          <Feld label="Gesellschaft">
            <Gesellschaft slug={projekt.mandantSlug} name={projekt.mandantName} />
          </Feld>
          <Feld label="Art">{ART[projekt.art] ?? projekt.art}</Feld>
          <Feld label="Vertragsgrundlage">
            {GRUNDLAGE[projekt.vertragsgrundlage] ?? projekt.vertragsgrundlage}
          </Feld>
          <Feld label="Soll-Beginn">
            <span className="cse-zahl">{projekt.sollBeginnLokal ?? '—'}</span>
          </Feld>
          <Feld label="Soll-Ende">
            <span className="cse-zahl">{projekt.sollEndeLokal ?? '—'}</span>
          </Feld>
          <Feld label="Baubeginn">
            <span className="cse-zahl">{projekt.istBeginnLokal ?? '—'}</span>
          </Feld>
          <Feld label="Fertig am">
            <span className="cse-zahl">{projekt.istEndeLokal ?? '—'}</span>
          </Feld>
        </Felder>
      </Card>

      <h2 className="mb-s3 text-h3 text-text">Aufmaße</h2>
      {aufmasse.length === 0 ? (
        <Leer text="Zu diesem Projekt liegt kein Aufmaß vor. Ein Aufmaß erscheint
          hier, sobald es den Entwurf verlassen hat — also nach dem gemeinsamen
          Messtermin." />
      ) : (
        <DataTable
          beschriftung="Aufmaße dieses Projekts mit Nummer, Messdatum, Umfang und Gegenzeichnung"
          zeilen={aufmasse}
          schluessel={(a: Kundennachweis) => a.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (a) => a.nummer ?? <span className="text-text-subtle">ohne Nummer</span>,
            },
            {
              schluessel: 'bezeichnung',
              kopf: 'Bezeichnung',
              zelle: (a) => a.bezug ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'messdatum',
              kopf: 'Messdatum',
              zelle: (a) => <span className="cse-zahl">{a.zeitraumLokal}</span>,
            },
            {
              schluessel: 'erhebung',
              kopf: 'Erhebung',
              zelle: (a) => a.erhebungsart === null
                ? <span className="text-text-subtle">—</span>
                : (ERHEBUNG[a.erhebungsart] ?? a.erhebungsart),
            },
            {
              schluessel: 'zeilen',
              kopf: 'Zeilen',
              numerisch: true,
              zelle: (a) => a.zeilen === null
                ? <span className="text-text-subtle">—</span>
                : String(a.zeilen),
            },
            {
              schluessel: 'unterschriften',
              kopf: 'Gegenzeichnung',
              zelle: (a) => {
                const liste = jeAufmass.get(a.id) ?? [];
                if (liste.length === 0) {
                  return <span className="text-text-subtle">keine</span>;
                }
                return (
                  <ul className="m-0 flex list-none flex-col gap-s1 p-0">
                    {liste.map((u, i) => (
                      <li key={`${u.rolle}-${i}`} className="text-sm">
                        <span className="text-text">
                          {u.rolle === 'auftraggeber'
                            ? (u.name ?? 'Ihre Unterschrift')
                            : 'Unterschrift der Gesellschaft'}
                        </span>
                        <span className="cse-zahl text-text-muted">
                          {' · '}{u.unterzeichnetAmLokal}
                        </span>
                        {u.vorbehalt === null ? null : (
                          <span className="block text-text-muted">
                            Vorbehalt: {u.vorbehalt}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                );
              },
            },
            {
              schluessel: 'status',
              kopf: 'Zustand',
              zelle: (a) => <StatusPill zustand={AUFMASS_PILLE[a.status] ?? 'In Prüfung'} />,
            },
          ]}
        />
      )}

      <div className="mt-s5 flex flex-col gap-s4">
        <Offen
          nummer="O-78"
          was="Bautagebuch und Wachbuch stehen nicht im Portal"
          weg="Beide sind interne Aufzeichnungen mit Personenbezug; ob es einen
            kundensichtbaren Auszug geben soll, ist noch nicht entschieden."
        />
        <Offen
          nummer="O-674"
          was="Nachträge und Behinderungsanzeigen stehen nicht im Portal"
          weg="Ein Nachtrag berührt Geld, eine Behinderungsanzeige ist eine
            Erklärung nach VOB/B § 6 — beides erreicht Sie heute schriftlich
            über die Bauleitung."
        />
      </div>
    </KundenRahmen>
  );
}
