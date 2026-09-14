import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/** `/portal/[mandant]/auftraege/[id]` — ein Auftrag mit dem, was OPS-10 verlangt. */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  angelegt: 'Geplant', aktiv: 'In Arbeit', pausiert: 'Wartet',
  abgeschlossen: 'Abgeschlossen', storniert: 'Abgelehnt',
};

interface Kopf {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly art: string;
  readonly status: string;
  readonly kunde: string;
  readonly kunde_id: string;
  readonly objekt: string | null;
  readonly objekt_id: string | null;
  readonly leitung: string | null;
  readonly start: string;
  readonly laufzeit_bis: string | null;
  readonly personalbedarf: number | null;
  readonly wochenstunden: string | null;
  readonly ausstattung: string | null;
  readonly wert: string | null;
  readonly angebotsnummer: string | null;
  readonly angebot_id: string | null;
  readonly freigegeben: boolean;
}

export default async function AuftragDetail(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/auftraege/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const [kopf] = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<Kopf>(
      `select a.id, a.auftragsnummer, a.bezeichnung, a.beschreibung,
              a.art::text as art, a.status::text as status,
              k.name as kunde, a.kunde_id, o.bezeichnung as objekt, a.objekt_id,
              b.name as leitung,
              to_char(a.start_datum, 'DD.MM.YYYY') as start,
              to_char(a.laufzeit_bis, 'DD.MM.YYYY') as laufzeit_bis,
              a.personalbedarf_anzahl as personalbedarf,
              a.wochenstunden_soll::text as wochenstunden,
              a.ausstattung_hinweis as ausstattung,
              a.auftragswert_netto_cent::text as wert,
              ang.angebotsnummer, a.angebot_id,
              a.freigegeben_vom_kunden as freigegeben
         from auftrag a
         join kunde k on k.id = a.kunde_id
         left join objekt o on o.id = a.objekt_id
         left join benutzer b on b.id = a.verantwortlich_benutzer_id
         left join angebot ang on ang.id = a.angebot_id
        where a.id = $1`, [id],
    ))) as Promise<readonly Kopf[]>);

  if (kopf === undefined) notFound();

  const felder: readonly (readonly [string, React.ReactNode])[] = [
    ['Nummer', kopf.auftragsnummer],
    ['Kunde', (
      <Link
        href={`/portal/${mandant}/crm/kunden/${kopf.kunde_id}`}
        className="text-text underline-offset-2 hover:text-brand hover:underline"
      >
        {kopf.kunde}
      </Link>
    )],
    ['Ort', kopf.objekt === null || kopf.objekt_id === null ? 'ohne festen Ort' : (
      <Link
        href={`/portal/${mandant}/objekte/${kopf.objekt_id}`}
        className="text-text underline-offset-2 hover:text-brand hover:underline"
      >
        {kopf.objekt}
      </Link>
    )],
    ['Verantwortlich', kopf.leitung ?? '—'],
    ['Start', kopf.start],
    ['Laufzeit bis', kopf.laufzeit_bis ?? 'unbefristet'],
    ['Personalbedarf', kopf.personalbedarf === null
      ? <span className="text-text-subtle">nicht angegeben</span>
      : `${String(kopf.personalbedarf)} Personen`],
    ['Wochenstunden', kopf.wochenstunden === null
      ? <span className="text-text-subtle">nicht angegeben</span>
      : formatiereMenge(mengeAusPostgresOderNull(kopf.wochenstunden))],
    ['Wert netto', kopf.wert === null
      ? <span className="text-text-subtle">offen</span>
      : formatiereGeld(cent(BigInt(kopf.wert)))],
    ['Aus Angebot', kopf.angebotsnummer === null || kopf.angebot_id === null ? '—' : (
      <Link
        href={`/portal/${mandant}/angebote/${kopf.angebot_id}`}
        className="text-text underline-offset-2 hover:text-brand hover:underline"
      >
        {kopf.angebotsnummer}
      </Link>
    )],
  ];

  return (
    <PortalRahmen
      titel={kopf.bezeichnung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="auftraege"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/auftraege`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Aufträge
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.bezeichnung}</h1>
        <StatusPill zustand={PILLE[kopf.status] ?? 'Geplant'} />
      </div>

      <dl
        data-cse="auftrag-felder"
        className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {felder.map(([label, wert]) => (
          <div key={label}>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
            <dd className="m-0 mt-s1 text-sm text-text">{wert}</dd>
          </div>
        ))}
      </dl>

      {kopf.ausstattung === null ? null : (
        <section className="mt-s6">
          <h2 className="text-h3 text-text">Ausstattung</h2>
          <p className="whitespace-pre-line text-sm text-text">{kopf.ausstattung}</p>
        </section>
      )}

      {kopf.beschreibung === null ? null : (
        <section className="mt-s6">
          <h2 className="text-h3 text-text">Beschreibung</h2>
          <p className="whitespace-pre-line text-sm text-text">{kopf.beschreibung}</p>
        </section>
      )}

      <p className="mt-s6 max-w-prose text-xs text-text-muted">
        {kopf.freigegeben
          ? 'Der Kunde hat diesen Auftrag als Referenz freigegeben (PRO-05).'
          : 'Nicht als öffentliche Referenz freigegeben. Ohne schriftliche '
            + 'Freigabe des Kunden erscheint kein Auftrag auf der Website (PRO-05).'}
      </p>
    </PortalRahmen>
  );
}
