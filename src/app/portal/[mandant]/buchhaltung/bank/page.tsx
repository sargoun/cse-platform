import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/buchhaltung/bank` — die eingelesenen Kontoauszüge und
 * die Klärungsschlange (ACC-04, FIN-14).
 *
 * **Die Schlange steht OBEN, die Auszüge darunter.** Wer diese Seite öffnet,
 * hat selten die Frage „welche Dateien habe ich eingelesen" — er hat die
 * Frage „was wartet auf mich". Die Zahl der offenen Umsätze ist die Antwort,
 * und sie gehört vor die Liste.
 *
 * **Es gibt keinen Abruf bei der Bank, und die Seite sagt es.** Kein PSD2,
 * kein FinTS, keine Zugangsdaten. Ein Knopf „Umsätze abrufen" wäre eine
 * vorgetäuschte Schnittstelle.
 */
export const dynamic = 'force-dynamic';

interface AuszugRoh {
  readonly id: string;
  readonly auszug_id: string;
  readonly von: string | null;
  readonly bis: string | null;
  readonly status: string;
  readonly zeilen: number;
  readonly endsaldo_cent: string | null;
  readonly bankkonto: string;
  readonly erstellt_am: string;
  readonly offen: string;
}

interface SchlangeRoh {
  readonly zustand: string;
  readonly anzahl: string;
  readonly summe_cent: string;
}

const STATUS: Readonly<Record<string, 'Bereit' | 'Abgeschlossen' | 'Abgelehnt'>> = {
  eingelesen: 'Bereit', abgeglichen: 'Abgeschlossen', verworfen: 'Abgelehnt',
};

export default async function Bank(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/buchhaltung/bank`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const auszuege = await kontext.abfrage<AuszugRoh>(
        `select a.id, a.auszug_id, a.von::text, a.bis::text,
                a.status::text as status, a.zeilen, a.endsaldo_cent::text,
                b.bezeichnung as bankkonto,
                to_char(a.erstellt_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as erstellt_am,
                (select count(*) from kontoumsatz u
                  where u.kontoauszug_id = a.id
                    and u.zustand in ('offen', 'in_klaerung'))::text as offen
           from kontoauszug a
           join bankkonto b on b.id = a.bankkonto_id and b.mandant_id = a.mandant_id
          order by a.von desc nulls last, a.erstellt_am desc
          limit 100`);

      const schlange = await kontext.abfrage<SchlangeRoh>(
        `select zustand::text as zustand, count(*)::text as anzahl,
                coalesce(sum(betrag_cent), 0)::text as summe_cent
           from kontoumsatz
          group by zustand
          order by zustand`);

      return { auszuege, schlange };
    }))) as { auszuege: readonly AuszugRoh[]; schlange: readonly SchlangeRoh[] };

  const offen = daten.schlange
    .filter((s) => s.zustand === 'offen' || s.zustand === 'in_klaerung')
    .reduce((n, s) => n + Number(s.anzahl), 0);
  const zugeordnet = Number(
    daten.schlange.find((s) => s.zustand === 'zugeordnet')?.anzahl ?? '0');

  return (
    <PortalRahmen
      titel="Bank"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bank"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Bank</h1>
        <Link
          href={`/portal/${mandant}/buchhaltung/bank/import`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Auszug einlesen
        </Link>
      </div>

      {/* Was wartet — vor der Liste, nicht darunter. */}
      <section
        data-cse="bank-schlange"
        data-offen={String(offen)}
        className={`mb-s5 rounded-lg border p-s5 ${
          offen === 0
            ? 'border-line bg-surface text-text'
            : 'border-warning bg-warning-soft text-warning'}`}
      >
        <h2 className="text-h3 text-text">
          {offen === 0
            ? 'Nichts in Klärung'
            : `${String(offen)} Umsatz/Umsätze warten auf eine Entscheidung`}
        </h2>
        <p className="mt-s2 text-sm text-text-muted">
          {offen === 0
            ? 'Jeder eingelesene Umsatz ist entschieden — zugeordnet oder '
              + 'ausdrücklich ohne Bezug.'
            : 'Ein Umsatz wird nur dann automatisch zugeordnet, wenn Betrag, '
              + 'Rechnungsnummer UND die IBAN des Zahlers übereinstimmen. Alles '
              + 'darunter entscheidet ein Mensch — eine Rechnung fälschlich als '
              + 'bezahlt zu führen ist teurer als ein Klick.'}
          {zugeordnet === 0 ? '' : ` Bisher automatisch zugeordnet: ${String(zugeordnet)}.`}
        </p>
      </section>

      <section
        data-cse="bank-nicht-verbunden"
        className="mb-s7 rounded-lg border border-line bg-surface p-s5"
      >
        <h2 className="text-h3 text-text">Kein Bankabruf — und das bleibt so</h2>
        <p className="mt-s2 text-sm text-text-muted">
          Die Plattform ruft keine Umsätze bei der Bank ab: kein PSD2, kein
          FinTS, keine Zugangsdaten, und sie erzeugt auch keine SEPA-Datei.
          Sie liest den CAMT.053-Auszug, den ein Mensch aus dem
          Onlinebanking herunterlädt und hier hochlädt.
        </p>
      </section>

      {daten.auszuege.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Es wurde noch kein Kontoauszug eingelesen.
        </p>
      ) : (
        <DataTable
          beschriftung="Eingelesene Kontoauszüge"
          zeilen={daten.auszuege}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'auszug', kopf: 'Auszug',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/buchhaltung/bank/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.auszug_id}
                </Link>
              ),
            },
            { schluessel: 'konto', kopf: 'Bankkonto', zelle: (z) => z.bankkonto },
            {
              schluessel: 'zeitraum', kopf: 'Zeitraum',
              zelle: (z) => (z.von === null ? '—' : `${z.von} – ${z.bis ?? z.von}`),
            },
            { schluessel: 'eingelesen', kopf: 'Eingelesen', zelle: (z) => z.erstellt_am },
            { schluessel: 'zeilen', kopf: 'Zeilen', numerisch: true, zelle: (z) => z.zeilen },
            {
              schluessel: 'offen', kopf: 'In Klärung', numerisch: true,
              zelle: (z) => (Number(z.offen) === 0
                ? <span className="text-text-muted">—</span>
                : <span className="text-warning">{z.offen}</span>),
            },
            {
              schluessel: 'saldo', kopf: 'Endsaldo', numerisch: true,
              zelle: (z) => (z.endsaldo_cent === null
                ? '—'
                : formatiereGeld(cent(BigInt(z.endsaldo_cent)))),
            },
            {
              schluessel: 'status', kopf: 'Status',
              zelle: (z) => <StatusPill zustand={STATUS[z.status] ?? 'Offen'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
