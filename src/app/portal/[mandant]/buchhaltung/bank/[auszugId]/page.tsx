import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/buchhaltung/bank/[auszugId]` — die Zeilen eines Auszugs
 * und warum jede dort steht, wo sie steht (ACC-04).
 *
 * **Jede Zeile trägt ihre Begründung, nicht nur ihren Zustand.** „In Klärung"
 * allein sagt niemandem, was zu tun ist; „Der Betrag passt auf 2 offene
 * Posten, aber im Verwendungszweck steht keine Rechnungsnummer" sagt es.
 * Der Satz stammt aus dem Abgleich und wurde an der Zeile festgehalten —
 * er wird hier nicht neu gebildet.
 *
 * **Die Salden werden verglichen, nicht gerechnet.** Anfangs- und Endsaldo
 * stehen im Auszug; die Summe der Zeilen daneben ist die Probe. Weichen sie
 * ab, fehlt eine Zeile — und das gehört auf den Bildschirm, nicht in ein Log.
 */
export const dynamic = 'force-dynamic';

interface KopfRoh {
  readonly id: string;
  readonly auszug_id: string;
  readonly von: string | null;
  readonly bis: string | null;
  readonly status: string;
  readonly zeilen: number;
  readonly anfangssaldo_cent: string | null;
  readonly endsaldo_cent: string | null;
  readonly bankkonto: string;
  readonly iban: string;
  readonly dokument_id: string | null;
}

interface UmsatzRoh {
  readonly id: string;
  readonly laufnummer: number;
  readonly richtung: string;
  readonly betrag_cent: string;
  readonly buchungsdatum: string;
  readonly valuta: string | null;
  readonly referenz: string | null;
  readonly verwendungszweck: string;
  readonly gegenpartei: string | null;
  readonly gebucht: boolean;
  readonly zustand: string;
  readonly klaerungsnotiz: string | null;
  readonly vorschlag_text: string | null;
  readonly nummer: string | null;
}

const ZUSTAND: Readonly<Record<string, 'Bereit' | 'Abgeschlossen' | 'Wartet' | 'Archiviert'>> = {
  offen: 'Wartet', in_klaerung: 'Wartet',
  zugeordnet: 'Abgeschlossen', ohne_bezug: 'Archiviert',
};

export default async function BankAuszug(
  { params }: { params: Promise<{ mandant: string; auszugId: string }> },
) {
  const { mandant, auszugId } = await params;
  const zugang = await portalZugang(
    `/portal/${mandant}/buchhaltung/bank/${auszugId}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<KopfRoh>(
        `select a.id, a.auszug_id, a.von::text, a.bis::text,
                a.status::text as status, a.zeilen,
                a.anfangssaldo_cent::text, a.endsaldo_cent::text, a.dokument_id,
                b.bezeichnung as bankkonto, b.iban
           from kontoauszug a
           join bankkonto b on b.id = a.bankkonto_id and b.mandant_id = a.mandant_id
          where a.id = $1`,
        [auszugId]);
      if (kopf === undefined) return { kopf: null, umsaetze: [] as UmsatzRoh[] };

      const umsaetze = await kontext.abfrage<UmsatzRoh>(
        `select u.id, u.laufnummer, u.richtung::text as richtung,
                u.betrag_cent::text, u.buchungsdatum::text, u.valuta::text,
                u.referenz, u.verwendungszweck, u.gegenpartei, u.gebucht,
                u.zustand::text as zustand, u.klaerungsnotiz, u.vorschlag_text,
                r.nummer
           from kontoumsatz u
           left join umsatz_zuordnung uz on uz.kontoumsatz_id = u.id
                                        and uz.mandant_id = u.mandant_id
                                        and uz.widerrufen_am is null
           left join zahlung_zuordnung zz on zz.zahlung_id = uz.zahlung_id
                                         and zz.mandant_id = uz.mandant_id
           left join offener_posten op on op.id = zz.offener_posten_id
                                      and op.mandant_id = zz.mandant_id
           left join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
          where u.kontoauszug_id = $1
          order by u.laufnummer`,
        [auszugId]);

      return { kopf, umsaetze };
    }))) as { kopf: KopfRoh | null; umsaetze: readonly UmsatzRoh[] };

  if (daten.kopf === null) notFound();
  const k = daten.kopf;

  /*
   * Die Probe: Anfangssaldo plus die Summe der Zeilen muss der Endsaldo sein.
   * Kein Rechnen im Sinne von Invariante 6 — zwei gespeicherte Cent-Beträge
   * zu addieren ist eine Kontrolle, keine Bildung einer neuen Zahl.
   */
  const bewegung = daten.umsaetze.reduce(
    (s, u) => s + (u.richtung === 'eingang' ? BigInt(u.betrag_cent) : -BigInt(u.betrag_cent)),
    0n);
  const anfang = k.anfangssaldo_cent === null ? null : BigInt(k.anfangssaldo_cent);
  const ende = k.endsaldo_cent === null ? null : BigInt(k.endsaldo_cent);
  const stimmt = anfang !== null && ende !== null && anfang + bewegung === ende;
  const pruefbar = anfang !== null && ende !== null;

  return (
    <PortalRahmen
      titel={`Auszug ${k.auszug_id}`}
      wurzelTitel="Bank"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bank"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Auszug {k.auszug_id}</h1>
        <Link
          href={`/portal/${mandant}/buchhaltung/bank`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Zur Liste
        </Link>
      </div>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        {[
          ['Bankkonto', k.bankkonto],
          ['IBAN', k.iban],
          ['Zeitraum', k.von === null ? '—' : `${k.von} – ${k.bis ?? k.von}`],
          ['Zeilen', String(k.zeilen)],
          ['Anfangssaldo', anfang === null ? '—' : formatiereGeld(cent(anfang))],
          ['Endsaldo', ende === null ? '—' : formatiereGeld(cent(ende))],
        ].map(([titel, wert]) => (
          <div key={titel} className="min-w-0">
            <dt className="text-sm text-text-subtle">{titel}</dt>
            <dd className="break-words text-text">{wert}</dd>
          </div>
        ))}
      </dl>

      {/* Die Probe. */}
      {pruefbar ? (
        <section
          data-cse="bank-saldoprobe"
          data-stimmt={String(stimmt)}
          className={`mb-s7 rounded-lg border p-s5 text-sm ${
            stimmt ? 'border-line bg-surface text-text'
                   : 'border-warning bg-warning-soft text-warning'}`}
        >
          Anfangssaldo {formatiereGeld(cent(anfang!))} plus die Bewegung der
          Zeilen ({formatiereGeld(cent(bewegung))})
          {stimmt
            ? ' ergibt den Endsaldo — der Auszug ist vollständig eingelesen.'
            : ` ergibt ${formatiereGeld(cent(anfang! + bewegung))}, der Auszug `
              + `nennt aber ${formatiereGeld(cent(ende!))}. Es fehlt eine Zeile.`}
        </section>
      ) : null}

      {daten.umsaetze.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Dieser Auszug trägt keine Zeile.
        </p>
      ) : (
        <DataTable
          beschriftung="Die Umsätze dieses Auszugs und warum sie stehen, wo sie stehen"
          zeilen={daten.umsaetze}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'nr', kopf: 'Nr.', numerisch: true, zelle: (z) => z.laufnummer },
            { schluessel: 'datum', kopf: 'Datum', zelle: (z) => z.buchungsdatum },
            {
              schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
              zelle: (z) => (
                <span className={z.richtung === 'eingang' ? 'text-text' : 'text-text-muted'}>
                  {z.richtung === 'eingang' ? '' : '− '}
                  {formatiereGeld(cent(BigInt(z.betrag_cent)))}
                </span>
              ),
            },
            {
              schluessel: 'partei', kopf: 'Gegenpartei',
              zelle: (z) => z.gegenpartei ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'zweck', kopf: 'Verwendungszweck',
              zelle: (z) => (
                <span className="break-words">
                  {z.verwendungszweck === '' ? '—' : z.verwendungszweck}
                </span>
              ),
            },
            {
              schluessel: 'zustand', kopf: 'Zustand',
              zelle: (z) => (
                <span className="inline-flex items-center gap-s2">
                  <StatusPill zustand={ZUSTAND[z.zustand] ?? 'Offen'} />
                  {z.gebucht ? null : (
                    <span className="text-xs text-text-muted">Vormerkung</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'begruendung', kopf: 'Warum',
              zelle: (z) => {
                if (z.zustand === 'zugeordnet') {
                  return (
                    <span className="text-xs text-text-muted">
                      Zugeordnet{z.nummer === null ? '' : ` zu ${z.nummer}`}
                    </span>
                  );
                }
                if (z.zustand === 'ohne_bezug') {
                  return (
                    <span className="text-xs text-text-muted">{z.klaerungsnotiz}</span>
                  );
                }
                return (
                  <span className="text-xs text-warning">
                    {z.vorschlag_text ?? 'Noch nicht abgeglichen'}
                  </span>
                );
              },
            },
          ]}
        />
      )}

      {k.dokument_id === null ? (
        <p className="mt-s5 text-sm text-text-muted">
          Keine Archivkopie der Datei — der Objektspeicher ist nicht verbunden.
        </p>
      ) : null}
    </PortalRahmen>
  );
}
