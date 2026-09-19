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
import { kennungOder404 } from '../../../kennung';
import { haeltRechte } from '../../../rechte';

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
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/auftraege/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * Kunde, Objekt und Angebot verlangen laut Manifest `crm.lesen`,
   * `objekt.lesen` bzw. `angebot.lesen`; diese Seite oeffnet mit
   * `auftrag.lesen` allein. Wer den Auftrag lesen darf, darf nicht
   * zwangslaeufig den Kunden, das Objekt oder das Angebot oeffnen — der
   * Verweis fuehrte dann auf 404 und verriet, was er nicht zeigen darf
   * (AUT-06, Copilot-Runde auf PR 16 / D-581). Ohne Recht steht der
   * blosse Name.
   */
  /**
   * Die beiden neuen Nachbarseiten tragen EIGENE Rechte, nicht
   * `auftrag.schreiben`: der Abschluss `auftrag.abschliessen` (er stellt nach
   * D-366 die FIN-18-Warnung im Rechnungsweg scharf), die Kundenfreigabe
   * `referenz.kundenfreigabe_erfassen` (sie entscheidet ueber eine
   * Veroeffentlichung). Ohne diese Pruefung fuehrte jeder Verweis fuer manche
   * Rollen auf 404 und verriete damit, was er nicht zeigen darf (AUT-06).
   */
  const darf = await haeltRechte(
    sitzung, 'crm.lesen', 'objekt.lesen', 'angebot.lesen',
    'auftrag.abschliessen', 'referenz.kundenfreigabe_erfassen');

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
    ['Kunde', darf['crm.lesen'] === true ? (
      <Link
        href={`/portal/${mandant}/crm/kunden/${kopf.kunde_id}`}
        className="text-text underline-offset-2 hover:text-brand hover:underline"
      >
        {kopf.kunde}
      </Link>
    ) : kopf.kunde],
    ['Ort', kopf.objekt === null || kopf.objekt_id === null
      ? 'ohne festen Ort'
      : darf['objekt.lesen'] === true ? (
        <Link
          href={`/portal/${mandant}/objekte/${kopf.objekt_id}`}
          className="text-text underline-offset-2 hover:text-brand hover:underline"
        >
          {kopf.objekt}
        </Link>
      ) : kopf.objekt],
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
    ['Aus Angebot', kopf.angebotsnummer === null || kopf.angebot_id === null
      ? '—'
      : darf['angebot.lesen'] === true ? (
        <Link
          href={`/portal/${mandant}/angebote/${kopf.angebot_id}`}
          className="text-text underline-offset-2 hover:text-brand hover:underline"
        >
          {kopf.angebotsnummer}
        </Link>
      ) : kopf.angebotsnummer],
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

      {/*
        * Die zwei Wege, die es von hier aus bisher nicht gab: der Abschluss
        * (OPS-05, mit der FIN-18-Pruefliste davor) und die Kundenfreigabe
        * (PRO-05, der Beleg fuer eine oeffentliche Referenz). Beide sind
        * eigene Vorgaenge mit eigenem Recht, und beide stehen hier als Weg —
        * nicht als Knopf: was sie tun, gehoert auf ihre Seite, mit dem, was
        * dagegen spricht.
        */}
      <nav aria-label="Vorgänge" className="mb-s6 flex flex-wrap gap-s3">
        {darf['auftrag.abschliessen'] === true && (
          <Link
            href={`/portal/${mandant}/auftraege/${id}/abschluss`}
            data-cse="zum-abschluss"
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
          >
            {kopf.status === 'abgeschlossen' ? 'Abschluss ansehen' : 'Auftrag abschließen'}
          </Link>
        )}
        {darf['referenz.kundenfreigabe_erfassen'] === true && (
          <Link
            href={`/portal/${mandant}/auftraege/${id}/kundenfreigabe`}
            data-cse="zur-kundenfreigabe"
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
          >
            Kundenfreigabe (Referenz)
          </Link>
        )}
      </nav>

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
