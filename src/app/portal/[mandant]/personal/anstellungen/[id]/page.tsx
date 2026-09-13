import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { MONATSNAMEN } from '@/lib/datum/kalendertag';
import { stundenMinutenText } from '@/lib/datum/stunden';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';

/**
 * `/portal/[mandant]/personal/anstellungen/[id]` — eine Beschaeftigung in
 * dieser Gesellschaft (D-09, EMP-04): Vertragseckdaten, Stundenkonto,
 * Abwesenheiten — lesend.
 *
 * **Die Beschaeftigung, nicht der Mensch.** Was am Menschen haengt
 * (Nachweise, Sprache, Zugang), steht auf dem Personenblatt; hier steht, was
 * diese Gesellschaft mit ihm vereinbart hat und was daraus wurde. Der
 * Stundensatz fehlt mit Absicht: er hat ein eigenes Recht und eine eigene
 * Seite (`entgelt`, K-05).
 *
 * **Ein Strich, wo das Recht fehlt.** Stundenkonto (`zeit.konto_lesen`) und
 * Abwesenheiten (`zeit.abwesenheit_lesen`) stehen unter eigenen Policies;
 * ohne Recht gaebe die Datenbank null Zeilen, und null Zeilen saehen aus wie
 * „kein Konto". Deshalb wird das Recht vorher gefragt.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const STATUS: Readonly<Record<string, PillZustand>> = { aktiv: 'Aktiv', ruhend: 'Wartet', beendet: 'Abgeschlossen' };
const STATUS_TEXT: Readonly<Record<string, string>> = { aktiv: 'aktiv', ruhend: 'ruhend', beendet: 'beendet' };
const KONTO_STATUS: Readonly<Record<string, string>> = { offen: 'offen', vorlaeufig: 'vorläufig', gesperrt: 'abgeschlossen' };
const ABWESENHEIT: Readonly<Record<string, PillZustand>> = {
  beantragt: 'Wartet', genehmigt: 'Bereit', abgelehnt: 'Abgelehnt', storniert: 'Archiviert', erfasst: 'Abgeschlossen',
};

interface Kopf {
  readonly id: string;
  readonly person_id: string;
  readonly name: string;
  readonly telefon: string | null;
  readonly personalnummer: string | null;
  readonly eintritt: string;
  readonly austritt: string | null;
  readonly status: string;
  readonly arbeitszeitmodell: string | null;
  readonly wochenstunden: string | null;
  readonly weitere: number;
}

interface Konto {
  readonly id: string;
  readonly jahr: number;
  readonly monat: number;
  readonly sollMinuten: number;
  readonly istMinuten: number;
  readonly saldoMinuten: number;
  readonly urlaub: string | null;
  readonly krank: string | null;
  readonly status: string;
}

interface Abwesenheit {
  readonly id: string;
  readonly von: string;
  readonly bis: string;
  readonly halbtags: boolean;
  readonly tage: string | null;
  readonly status: string;
}

function Feld({ label, wert }: { readonly label: string; readonly wert: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 text-sm text-text">{wert}</dd>
    </div>
  );
}

export default async function Anstellungsblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/personal/anstellungen/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select a.id, a.person_id, (p.vorname || ' ' || p.nachname) as name, p.telefon,
                a.personalnummer,
                to_char(a.eintritt, 'DD.MM.YYYY') as eintritt,
                to_char(a.austritt, 'DD.MM.YYYY') as austritt,
                a.status::text as status, a.arbeitszeitmodell, a.wochenstunden::text as wochenstunden,
                (select count(*) from anstellung a2
                  where a2.person_id = a.person_id and a2.id <> a.id and a2.geloescht_am is null)::int as weitere
           from anstellung a join person p on p.id = a.person_id
          where a.id = $1 and a.geloescht_am is null`, [id]);
      if (kopf === undefined) return null;
      const [rechte] = await kontext.abfrage<{ konto: boolean; abwesenheit: boolean }>(
        `select app.hat_recht('zeit.konto_lesen', $1::uuid) as konto,
                app.hat_recht('zeit.abwesenheit_lesen', $1::uuid) as abwesenheit`, [mandantId]);
      const konten = rechte?.konto === true ? await kontext.abfrage<Konto>(
        `select k.id, k.jahr, k.monat, k.soll_minuten as "sollMinuten", k.ist_minuten as "istMinuten",
                k.saldo_minuten as "saldoMinuten", k.urlaub_tage::text as urlaub, k.krank_tage::text as krank,
                k.status::text as status
           from stundenkonto k
          where k.anstellung_id = $1
          order by k.jahr desc, k.monat desc
          limit 6`, [id]) : null;
      // Ohne die Art: `abwesenheitsart_id` gehoert nicht zu den Spalten, die
      // `cse_app` lesen darf — die Art einer Abwesenheit ist gesundheitsnah
      // und bleibt dem Abwesenheitsmodul mit seinem eigenen Weg vorbehalten.
      const abwesenheiten = rechte?.abwesenheit === true ? await kontext.abfrage<Abwesenheit>(
        `select ab.id,
                to_char(ab.von, 'DD.MM.YYYY') as von, to_char(ab.bis, 'DD.MM.YYYY') as bis,
                (ab.von_halbtags or ab.bis_halbtags) as halbtags,
                ab.tage_angerechnet::text as tage, ab.status::text as status
           from abwesenheit ab
          where ab.anstellung_id = $1 and ab.storniert_am is null
            and ab.bis >= (now() at time zone 'Europe/Berlin')::date - 365
          order by ab.von desc
          limit 20`, [id]) : null;
      return { kopf, konten, abwesenheiten };
    })) as Promise<{
      kopf: Kopf; konten: readonly Konto[] | null; abwesenheiten: readonly Abwesenheit[] | null;
    } | null>);
  if (daten === null) notFound();
  const { kopf, konten, abwesenheiten } = daten;
  const verweis = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text';

  return (
    <PortalRahmen
      titel={kopf.name}
      wurzelTitel="Beschäftigungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}/personal/anstellungen`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div data-cse="anstellung-kopf" className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.name}</h1>
        <span className="flex items-center gap-s2">
          <StatusPill zustand={STATUS[kopf.status] ?? 'Aktiv'} />
          <span className="text-sm text-text-muted">{STATUS_TEXT[kopf.status] ?? kopf.status}</span>
        </span>
      </div>
      <nav className="mb-s5 flex flex-wrap gap-s2">
        <Link href={`/portal/${mandant}/personal/personen/${kopf.person_id}`} className={verweis}>Personenblatt</Link>
        <Link href={`/portal/${mandant}/personal/stundenkonten/${kopf.id}`} className={verweis}>Stundenkonto</Link>
        <Link href={`/portal/${mandant}/personal/abwesenheiten`} className={verweis}>Abwesenheiten</Link>
        <Link href={`/portal/${mandant}/dienstplan/woche`} className={verweis}>Dienstplan</Link>
      </nav>

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 text-h3 text-text">Beschäftigung</h2>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
          <Feld label="Personalnummer" wert={kopf.personalnummer ?? '—'} />
          <Feld label="Eintritt" wert={kopf.eintritt} />
          <Feld label="Austritt" wert={kopf.austritt ?? 'unbefristet'} />
          <Feld label="Arbeitszeitmodell" wert={kopf.arbeitszeitmodell ?? 'nicht hinterlegt'} />
          <Feld label="Wochenstunden" wert={kopf.wochenstunden === null ? 'nicht hinterlegt' : `${kopf.wochenstunden} h`} />
          <Feld label="Telefon" wert={kopf.telefon ?? '—'} />
          <Feld label="Weitere Beschäftigungen" wert={kopf.weitere === 0 ? 'keine' : `${String(kopf.weitere)} — in anderen Gesellschaften (D-09); Arbeitszeitgrenzen gelten je Person, siehe Gruppenansicht`} />
        </dl>
        <p className="mt-s4 text-sm text-text-subtle">
          Der interne Stundensatz steht auf einer eigenen Seite mit eigenem Recht (K-05).
          Vertrag ändern und Beschäftigung beenden sind Schreibvorgänge und kommen mit
          der Personalverwaltung.
        </p>
      </section>

      <h2 className="mb-s3 text-h2 text-text">Stundenkonto — letzte Monate</h2>
      {konten === null ? (
        <p data-cse="konto-kein-recht" className="mb-s6 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Leserecht auf das Stundenkonto in dieser Gesellschaft.
        </p>
      ) : konten.length === 0 ? (
        <p className="mb-s6 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">Noch kein Monat abgerechnet.</p>
      ) : (
        <div data-cse="konto-monate" className="mb-s6">
          <DataTable
            beschriftung="Stundenkonto der letzten Monate"
            zeilen={konten}
            schluessel={(k) => k.id}
            spalten={[
              { schluessel: 'monat', kopf: 'Monat',
                zelle: (k) => `${MONATSNAMEN[k.monat - 1] ?? String(k.monat)} ${String(k.jahr)}` },
              { schluessel: 'soll', kopf: 'Soll', numerisch: true, zelle: (k) => stundenMinutenText(k.sollMinuten) },
              { schluessel: 'ist', kopf: 'Ist', numerisch: true, zelle: (k) => stundenMinutenText(k.istMinuten) },
              { schluessel: 'saldo', kopf: 'Saldo', numerisch: true,
                zelle: (k) => <span className={k.saldoMinuten < 0 ? 'text-danger' : ''}>{stundenMinutenText(k.saldoMinuten)}</span> },
              { schluessel: 'urlaub', kopf: 'Urlaub (Tage)', numerisch: true, zelle: (k) => k.urlaub ?? '0' },
              { schluessel: 'krank', kopf: 'Krank (Tage)', numerisch: true, zelle: (k) => k.krank ?? '0' },
              { schluessel: 'status', kopf: 'Status', zelle: (k) => KONTO_STATUS[k.status] ?? k.status },
            ]}
          />
        </div>
      )}

      <h2 className="mb-s3 text-h2 text-text">Abwesenheiten — letzte zwölf Monate</h2>
      <p className="mb-s3 max-w-[72ch] text-sm text-text-subtle">
        Zeitraum und Status; die Art der Abwesenheit ist gesundheitsnah und steht nur im
        Abwesenheitsmodul, mit eigenem Recht.
      </p>
      {abwesenheiten === null ? (
        <p data-cse="abwesenheit-kein-recht" className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Leserecht auf Abwesenheiten in dieser Gesellschaft.
        </p>
      ) : abwesenheiten.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">Keine Abwesenheit.</p>
      ) : (
        <div data-cse="abwesenheiten">
          <DataTable
            beschriftung="Abwesenheiten der letzten zwölf Monate"
            zeilen={abwesenheiten}
            schluessel={(a) => a.id}
            spalten={[
              { schluessel: 'von', kopf: 'Von', zelle: (a) => a.von },
              { schluessel: 'bis', kopf: 'Bis', zelle: (a) => a.bis },
              { schluessel: 'tage', kopf: 'Tage', numerisch: true,
                zelle: (a) => `${a.tage ?? '—'}${a.halbtags ? ' (halbtags)' : ''}` },
              { schluessel: 'status', kopf: 'Status',
                zelle: (a) => <StatusPill zustand={ABWESENHEIT[a.status] ?? 'Offen'} /> },
            ]}
          />
        </div>
      )}
    </PortalRahmen>
  );
}
