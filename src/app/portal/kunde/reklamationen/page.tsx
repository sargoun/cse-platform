import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import {
  listeKundenreklamationen, type Kundenreklamation,
} from '@/server/services/kundenportal/reklamation';
import { AnmeldungNoetig } from '../../Anmeldung';
import { kundePortal, KundenRahmen } from '../rahmen';
import { Gesellschaft, KeinZugang, Kopfzeile, Leer, Offen } from '../bausteine';

/**
 * `/portal/kunde/reklamationen` — die eigenen Beanstandungen (OPS-11,
 * SPEC §22 `reklamation`, 04-SEITENKARTE §8).
 *
 * **`ursache` steht nicht in der Liste und nicht im Detail.** Eine interne
 * Ursachenanalyse zeigt regelmaessig auf einen Menschen („Kraft war neu,
 * Einweisung fehlte"), und §8 verschliesst dem Kunden das ganze
 * `personal`-Modul. `massnahme` steht dagegen da und ist genau das, was der
 * Kunde wissen will: was getan wurde.
 *
 * **Die Abfrage liegt im Dienst, nicht in dieser Seite.** RLS ist zeilen-,
 * nicht spaltenweise: wer hier eine eigene Abfrage schriebe, koennte `ursache`
 * und `verantwortlich_benutzer_id` mitlesen, ohne dass eine Policy
 * widerspricht. Die Projektion IST die Grenze
 * (`services/kundenportal/reklamation.ts`).
 *
 * **Kein Melden-Knopf.** `qualitaet.schreiben` ist der Rolle `kunde` nicht
 * erteilt, und der Kontext hinter der Seite hat kein `schreibe`.
 */
export const dynamic = 'force-dynamic';

/** `reklamation_status`: offen, in_arbeit, behoben, abgelehnt, geschlossen. */
const PILLE: Readonly<Record<string, PillZustand>> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  behoben: 'Bereit',
  abgelehnt: 'Abgelehnt',
  geschlossen: 'Abgeschlossen',
};

/**
 * Die Beschriftungen des Filters.
 *
 * Sie stehen als Paare hier und nicht als Enumliste aus der Datenbank: der
 * Filter ist eine Oberflaeche, und „Behoben — bitte prüfen" sagt dem Kunden
 * mehr als `behoben`. Der WERT ist der Enumwert; er geht als Parameter in die
 * Abfrage ($1), nie in den SQL-Text.
 */
const ZUSTAENDE: readonly (readonly [string, string])[] = [
  ['offen', 'Offen'],
  ['in_arbeit', 'In Arbeit'],
  ['behoben', 'Behoben'],
  ['geschlossen', 'Abgeschlossen'],
  ['abgelehnt', 'Abgelehnt'],
];

/** `reklamation_prioritaet`: niedrig, mittel, hoch. */
const PRIORITAET: Readonly<Record<string, string>> = {
  niedrig: 'niedrig', mittel: 'mittel', hoch: 'hoch',
};

export default async function Kundenreklamationen(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const roh = typeof suche['status'] === 'string' ? suche['status'] : null;
  const status = ZUSTAENDE.some(([wert]) => wert === roh) ? roh : null;

  const ergebnis = await kundePortal('/portal/kunde/reklamationen',
    async (kontext) => listeKundenreklamationen(kontext, { status }),
    ['nachweis.lesen']);

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Reklamationen" aktiverTab="reklamationen">
        <Kopfzeile titel="Reklamationen" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;
  const pille = (aktiv: boolean): string => [
    'inline-flex min-h-11 items-center rounded-full px-s4 text-sm transition-colors duration-fast ease-brand',
    aktiv ? 'bg-white text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
  ].join(' ');

  return (
    <KundenRahmen basis={basis} titel="Reklamationen" aktiverTab="reklamationen">
      <Kopfzeile titel="Reklamationen" />

      <nav
        aria-label="Zustand"
        data-cse="reklamation-filter"
        className="mb-s5 flex flex-wrap gap-s2"
      >
        <Link
          href="/portal/kunde/reklamationen"
          aria-current={status === null ? 'page' : undefined}
          className={pille(status === null)}
        >
          Alle
        </Link>
        {ZUSTAENDE.map(([wert, text]) => (
          <Link
            key={wert}
            href={`/portal/kunde/reklamationen?status=${wert}`}
            aria-current={status === wert ? 'page' : undefined}
            className={pille(status === wert)}
          >
            {text}
          </Link>
        ))}
      </nav>

      {daten.length === 0 ? (
        <Leer text={status === null
          ? 'Es liegt keine Reklamation vor.'
          : 'In diesem Zustand liegt keine Reklamation vor. Über „Alle" sehen Sie die übrigen.'} />
      ) : (
        <DataTable
          beschriftung="Reklamationen mit Nummer, Objekt, Eingang, Priorität, Frist und Gesellschaft"
          zeilen={daten}
          schluessel={(r: Kundenreklamation) => r.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (r) => (
                <Link
                  href={`/portal/kunde/reklamationen/${r.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {r.nummer}
                </Link>
              ),
            },
            {
              schluessel: 'objekt',
              kopf: 'Objekt',
              zelle: (r) => r.objekt ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'eingang',
              kopf: 'Eingang (Berlin)',
              zelle: (r) => <span className="cse-zahl">{r.eingangAmLokal}</span>,
            },
            {
              schluessel: 'prioritaet',
              kopf: 'Priorität',
              zelle: (r) => PRIORITAET[r.prioritaet] ?? r.prioritaet,
            },
            {
              schluessel: 'faellig',
              kopf: 'Frist',
              /*
               * Eine leere Frist ist hier KEIN Gedankenstrich: die
               * Reaktionsfrist je Prioritaet ist O-14, und solange sie nicht
               * beantwortet ist, setzt der Dienst keine. „offen (O-14)" sagt
               * das — dieselbe Form wie auf dem internen Blatt.
               */
              zelle: (r) => r.faelligAmLokal === null
                ? <span className="text-text-subtle">offen (O-14)</span>
                : <span className="cse-zahl">{r.faelligAmLokal}</span>,
            },
            {
              schluessel: 'gesellschaft',
              kopf: 'Gesellschaft',
              zelle: (r) => <Gesellschaft slug={r.mandantSlug} name={r.mandantName} />,
            },
            {
              schluessel: 'status',
              kopf: 'Zustand',
              zelle: (r) => <StatusPill zustand={PILLE[r.status] ?? 'Offen'} />,
            },
          ]}
        />
      )}

      <div className="mt-s5 flex flex-col gap-s4">
        <Offen
          nummer="O-74"
          was="Melden läuft über Ihre Ansprechpartnerin"
          weg="Eine Beanstandung im Portal zu erfassen setzt einen Schreibweg
            voraus, den das Kundenportal noch nicht hat."
        />
      </div>
    </KundenRahmen>
  );
}
