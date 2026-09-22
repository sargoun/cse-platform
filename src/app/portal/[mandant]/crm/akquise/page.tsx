import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { liste, type Ziel } from '@/server/services/akquise/ziel';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/crm/akquise` — der Wartesaal vor der Pipeline (§12).
 *
 * **Warum diese Liste nicht die Leadliste ist.** Ein Lead hat einen Anlass,
 * eine Frist und einen Besitzer. Eine recherchierte Firma hat eine Vermutung.
 * Beides in einer Liste zu führen hiesse, die Arbeitsliste des Vertriebs mit
 * Vermutungen zu fluten — und die SLA-Eskalation (REQ-06) gegen Firmen laufen
 * zu lassen, die nie etwas gefragt haben.
 *
 * **Der Kasten oben steht dauerhaft da, nicht als Fehlermeldung.** Solange
 * keine Quelle verbunden ist, füllt sich diese Liste nur von Hand. Wer das
 * nicht liest, hält eine leere Liste für einen leeren Markt.
 */
export const dynamic = 'force-dynamic';

const STATUS_PILLE: Readonly<Record<string, PillZustand>> = {
  neu: 'Offen',
  geprueft: 'In Arbeit',
  uebernommen: 'Abgeschlossen',
  verworfen: 'Archiviert',
};

const STATUS_WORT: Readonly<Record<string, string>> = {
  neu: 'Neu',
  geprueft: 'Angesehen',
  uebernommen: 'Im Vertrieb',
  verworfen: 'Verworfen',
};

const BEREICH_WORT: Readonly<Record<string, string>> = {
  reinigung: 'Reinigung',
  security: 'Security',
  bau: 'Bau',
};

export default async function Akquiseliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/crm/akquise`);
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

  const { ziele, quellen } = await db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const abfrage = { unsafe: (s: string, w?: readonly unknown[]) => kontext.abfrage(s, w) };
      return {
        ziele: await liste(abfrage, mandantId, { grenze: 200 }),
        quellen: await kontext.abfrage<{ verbunden: boolean }>(
          `select verbunden from akquise_quelle where mandant_id = $1 and aktiv`, [mandantId]),
      };
    })) as { ziele: readonly Ziel[]; quellen: readonly { verbunden: boolean }[] };

  const verbundene = quellen.filter((q) => q.verbunden).length;
  const offen = ziele.filter((z) => z.status === 'neu' || z.status === 'geprueft');

  return (
    <PortalRahmen
      titel="Akquise"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="crm"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Akquise</h1>
        <p className="m-0 text-sm text-text-muted">
          {`${String(offen.length)} offen von ${String(ziele.length)}`}
        </p>
      </div>

      <Hinweis art={verbundene === 0 ? 'warnung' : 'hinweis'} cse="akquise-quellenstand"
               className="mb-s5">
        {verbundene === 0 ? (
          <>
            <strong className="block">Es ist keine Recherchequelle verbunden.</strong>
            Diese Liste füllt sich deshalb heute nur von Hand. Der Nachtlauf legt trotzdem
            jeden Morgen eine Zeile an und schreibt den Grund hinein — damit ein leerer
            Tag von einer fehlenden Verbindung unterscheidbar bleibt.{' '}
            <Link href={`/portal/${mandant}/crm/akquise/quellen`}
                  className="underline underline-offset-2">Quellen und Läufe ansehen</Link>
          </>
        ) : (
          <>
            {`${String(verbundene)} Quelle(n) verbunden. `}
            <Link href={`/portal/${mandant}/crm/akquise/quellen`}
                  className="underline underline-offset-2">Läufe ansehen</Link>
          </>
        )}
      </Hinweis>

      {/*
        * Der Satz steht UNTER dem Quellenkasten und nicht in einer Fussnote:
        * er erklaert, warum hier kein Ansprechpartner steht, und das ist die
        * Frage, die jeder Vertriebler als erste hat.
        */}
      <p className="mb-s5 text-sm text-text-muted">
        Gespeichert werden <strong>nur Firmendaten</strong> — kein Name, keine persönliche
        Durchwahl, keine persönliche E-Mail-Adresse. Wer Daten nicht bei der betroffenen
        Person erhebt, muss sie nach Art. 14 DSGVO binnen eines Monats informieren; was
        nicht gespeichert wird, löst diese Pflicht nicht aus. Ein Ansprechpartner entsteht
        erst, wenn ein Mensch ihn anlegt — und mit ihm die Rechtsgrundlage (§7 UWG).
      </p>

      {ziele.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine recherchierte Firma in der Liste.
        </p>
      ) : (
        <DataTable
          beschriftung="Recherchierte Firmen nach Punktzahl"
          zeilen={[...ziele]}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'firma',
              kopf: 'Firma',
              zelle: (z) => (
                <span>
                  <Link
                    href={`/portal/${mandant}/crm/akquise/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.firmenname}
                  </Link>
                  <span className="block text-xs text-text-muted">
                    {[z.branche, z.ort].filter((t) => t !== null).join(' · ') || 'ohne Angabe'}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'punktzahl',
              kopf: 'Punkte',
              numerisch: true,
              zelle: (z) => (z.punktzahl === null ? '—' : (
                /*
                 * Die Begruendung haengt am `title`, damit die Zahl nicht
                 * allein dasteht. Eine Bewertung ohne Begruendung ist eine
                 * Zahl, der man glauben muss.
                 */
                <span title={z.punktzahlBegruendung ?? undefined}>{String(z.punktzahl)}</span>
              )),
            },
            {
              schluessel: 'bereich',
              kopf: 'Passt zu',
              zelle: (z) => (z.passenderBereich === null
                ? <span className="text-text-subtle" title="Die Regeln ergeben keinen eindeutigen Treffer.">keine Zuordnung</span>
                : (BEREICH_WORT[z.passenderBereich] ?? z.passenderBereich)),
            },
            {
              schluessel: 'erreichbar',
              kopf: 'Erreichbar über',
              zelle: (z) => {
                const wege = [
                  z.telefon === null ? null : 'Telefon',
                  z.allgemeineEmail === null ? null : 'Postfach',
                  z.website === null ? null : 'Website',
                ].filter((t): t is string => t !== null);
                return wege.length === 0
                  ? <span className="text-warning">kein Weg hinterlegt</span>
                  : wege.join(' · ');
              },
            },
            {
              schluessel: 'quelle',
              kopf: 'Quelle',
              zelle: (z) => z.quelleBezeichnung ?? 'von Hand erfasst',
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span>
                  <StatusPill zustand={STATUS_PILLE[z.status] ?? 'Offen'} />
                  <span className="block text-xs text-text-muted">
                    {STATUS_WORT[z.status] ?? z.status}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
