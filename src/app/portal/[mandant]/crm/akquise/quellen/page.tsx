import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { quellen, type AkquiseQuelle } from '@/server/services/akquise/quelle';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/crm/akquise/quellen` — woher käme eine Firma, und was
 * hat der Nachtlauf getan (§12).
 *
 * **Die Seite existiert für den Fall, dass nichts passiert.** Wäre jede Quelle
 * verbunden und liefe alles, bräuchte man sie kaum. Heute ist keine verbunden,
 * und ohne diese Seite wäre das eine unsichtbare Tatsache: die Akquiseliste
 * bliebe leer, und niemand könnte der Leere ansehen, ob sie am Markt liegt.
 *
 * Die Laufliste zeigt deshalb `uebersprungen` genauso prominent wie `erfolg` —
 * ein übersprungener Lauf ist hier die Nachricht, nicht die Ausnahme.
 */
export const dynamic = 'force-dynamic';

const ART_WORT: Readonly<Record<string, string>> = {
  manuell: 'Von Hand',
  register: 'Amtliches Register',
  dienstleister: 'Datenanbieter',
  vergabe_radar: 'Vergaberadar',
};

const ART_ERKLAERUNG: Readonly<Record<string, string>> = {
  manuell: 'Jemand trägt eine Firma ein, die ihm begegnet ist.',
  register: 'Das Handelsregister liefert Firmendaten — kostenpflichtig, dafür amtlich.',
  dienstleister: 'Ein beauftragter Anbieter mit Auftragsverarbeitungsvertrag.',
  vergabe_radar: 'Die Bekanntmachungen, die die Plattform ohnehin einliest.',
};

interface LaufZeile {
  readonly id: string;
  readonly quelle: string | null;
  readonly ergebnis: string;
  readonly meldung: string | null;
  readonly gefunden: number;
  readonly neu: number;
  readonly begonnen: string;
}

export default async function Akquisequellen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/crm/akquise/quellen`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return (
      <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant}
                    zielSlug={tor.ziel} zurueck={tor.zurueck} />
    );
  }
  const { sitzung } = zugang;
  const mandantId = sitzung.aktiverMandantId;
  if (mandantId === null) notFound();

  const daten = await db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const abfrage = { unsafe: (s: string, w?: readonly unknown[]) => kontext.abfrage(s, w) };
      return {
        liste: await quellen(abfrage, mandantId),
        laeufe: await kontext.abfrage<LaufZeile>(
          `select l.id, q.bezeichnung as quelle, l.ergebnis, l.meldung,
                  l.gefunden, l.neu,
                  to_char(l.begonnen_am at time zone 'Europe/Berlin',
                          'DD.MM.YYYY HH24:MI') as begonnen
             from akquise_lauf l
             left join akquise_quelle q on q.id = l.quelle_id
            where l.mandant_id = $1
            order by l.begonnen_am desc
            limit 50`, [mandantId]),
      };
    })) as { liste: readonly AkquiseQuelle[]; laeufe: readonly LaufZeile[] };

  const verbundene = daten.liste.filter((q) => q.verbunden).length;

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/crm/akquise`, text: 'Akquise' }}
      titel="Recherchequellen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="crm"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 mt-0 text-h1 text-text">Recherchequellen</h1>

      <Hinweis art={verbundene === 0 ? 'warnung' : 'hinweis'} cse="quellen-stand"
               className="mb-s5">
        {verbundene === 0 ? (
          <>
            <strong className="block">Keine Quelle ist verbunden — und keine tut so als ob.</strong>
            Firmenverzeichnisse automatisiert auszulesen scheidet aus zwei Gründen aus: es
            verstösst gegen deren Nutzungsbedingungen, und nach <strong>Art. 14 DSGVO</strong>
            {' '}müsste jede erfasste Person binnen eines Monats informiert werden. Was hier
            angeschlossen werden kann, ist eine beauftragte Quelle — das amtliche Register
            oder ein Anbieter mit Vertrag. Welche es wird, ist eine kaufmännische
            Entscheidung (offene Frage O-596).
          </>
        ) : (
          `${String(verbundene)} von ${String(daten.liste.length)} Quellen verbunden.`
        )}
      </Hinweis>

      <h2 className="mb-s4 mt-0 text-h3 text-text">Quellen</h2>
      {daten.liste.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Es ist keine Quelle eingerichtet. Firmen lassen sich trotzdem von Hand erfassen.
        </p>
      ) : (
        <div className="mb-s5">
          <DataTable
            beschriftung="Recherchequellen und ihr Verbindungsstand"
            zeilen={[...daten.liste]}
            schluessel={(q) => q.id}
            spalten={[
              {
                schluessel: 'bezeichnung',
                kopf: 'Quelle',
                zelle: (q) => (
                  <span>
                    {q.bezeichnung}
                    <span className="block text-xs text-text-muted">
                      {ART_ERKLAERUNG[q.art] ?? ''}
                    </span>
                  </span>
                ),
              },
              { schluessel: 'art', kopf: 'Art', zelle: (q) => ART_WORT[q.art] ?? q.art },
              {
                schluessel: 'stand',
                kopf: 'Stand',
                zelle: (q) => (
                  <span>
                    <StatusPill zustand={q.verbunden ? 'Abgeschlossen' : 'Archiviert'} />
                    <span className="block text-xs text-text-muted">
                      {q.verbunden ? 'verbunden' : 'nicht verbunden'}
                    </span>
                  </span>
                ),
              },
              {
                schluessel: 'hinweis',
                kopf: 'Grund',
                zelle: (q) => q.hinweis ?? <span className="text-text-subtle">—</span>,
              },
            ]}
          />
        </div>
      )}

      <h2 className="mb-s4 mt-0 text-h3 text-text">Läufe</h2>
      <p className="mb-s4 mt-0 text-sm text-text-muted">
        Der Nachtlauf startet um 05:10 UTC je Gesellschaft. Ohne verbundene Quelle schreibt
        er trotzdem eine Zeile — ein Lauf, der still nichts tut, sieht am nächsten Morgen aus
        wie ein Tag ohne Treffer.
      </p>
      {daten.laeufe.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Lauf protokolliert.
        </p>
      ) : (
        <DataTable
          beschriftung="Recherchelaeufe, neueste zuerst"
          zeilen={[...daten.laeufe]}
          schluessel={(l) => l.id}
          spalten={[
            { schluessel: 'begonnen', kopf: 'Zeitpunkt', zelle: (l) => l.begonnen },
            { schluessel: 'quelle', kopf: 'Quelle', zelle: (l) => l.quelle ?? '—' },
            {
              schluessel: 'ergebnis',
              kopf: 'Ergebnis',
              zelle: (l) => (
                <StatusPill zustand={l.ergebnis === 'erfolg' ? 'Abgeschlossen'
                  : l.ergebnis === 'fehler' ? 'Abgelehnt' : 'Archiviert'} />
              ),
            },
            {
              schluessel: 'meldung',
              kopf: 'Meldung',
              zelle: (l) => l.meldung ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'gefunden',
              kopf: 'Gefunden',
              numerisch: true,
              zelle: (l) => String(l.gefunden),
            },
            { schluessel: 'neu', kopf: 'Neu', numerisch: true, zelle: (l) => String(l.neu) },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
