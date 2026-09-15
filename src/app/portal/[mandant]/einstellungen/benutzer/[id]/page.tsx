import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { kennungOder404 } from '../../../../kennung';

/**
 * `/portal/[mandant]/einstellungen/benutzer/[id]` — ein Konto in dieser
 * Gesellschaft: Mitgliedschaft, zweiter Faktor, Sitzungen (AUT-08).
 *
 * **Sitzungen sieht nur, wem sie gehoeren.** `t_sitzung_eigene` gibt die
 * eigenen Zeilen und keine anderen — auch der Administration nicht. Die
 * Seite sagt das, statt eine leere Tabelle als „keine Sitzung" auszugeben.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface Kopf {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly status: string;
  readonly sprache: string | null;
  readonly zweiter_faktor: boolean;
  readonly letzter_login: string | null;
  readonly erstellt_am: string;
  readonly deaktiviert_am: string | null;
}

interface Mitgliedschaft {
  readonly id: string;
  readonly rolle: string;
  readonly erfordert_2fa: boolean;
  readonly module: readonly string[] | null;
  readonly aus_anstellung: boolean;
  readonly ist_standard: boolean;
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
  readonly entzogen_am: string | null;
  readonly entzugsgrund: string | null;
}

interface Sitzung {
  readonly id: string;
  readonly ansicht: string;
  readonly aal: string;
  readonly geraet: string | null;
  readonly letzte_aktivitaet: string;
  readonly ablauf: string;
  readonly beendet: string | null;
  readonly ende_grund: string | null;
}

const ENDE: Readonly<Record<string, string>> = {
  abmeldung: 'abgemeldet', ablauf: 'abgelaufen', inaktivitaet: 'Untätigkeit',
  gesperrt: 'gesperrt', wechsel: 'Wechsel',
};

function Feld({ label, wert }: { readonly label: string; readonly wert: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 text-sm text-text">{wert}</dd>
    </div>
  );
}

export default async function Benutzerblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/benutzer/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;
  const selbst = id.toLowerCase() === zugang.sitzung.benutzerId.toLowerCase();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select b.id, b.name, b.email, b.status::text as status, b.sprache::text as sprache,
                app.hat_zweiten_faktor(b.id) as zweiter_faktor,
                to_char(b.letzter_login_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as letzter_login,
                to_char(b.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as erstellt_am,
                to_char(b.deaktiviert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as deaktiviert_am
           from benutzer b
          where b.id = $1
            and exists (select 1 from benutzer_mandant bm
                         where bm.benutzer_id = b.id and bm.mandant_id = $2)`,
        [id, mandantId]);
      if (kopf === undefined) return null;
      const mitgliedschaften = await kontext.abfrage<Mitgliedschaft>(
        `select bm.id, r.bezeichnung as rolle, r.erfordert_2fa, bm.module, bm.aus_anstellung,
                bm.ist_standard,
                to_char(bm.gueltig_ab, 'DD.MM.YYYY') as gueltig_ab,
                to_char(bm.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
                to_char(bm.entzogen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as entzogen_am,
                bm.entzugsgrund
           from benutzer_mandant bm join rolle r on r.id = bm.rolle_id
          where bm.benutzer_id = $1 and bm.mandant_id = $2
          order by bm.entzogen_am nulls first, bm.gueltig_ab desc`, [id, mandantId]);
      const sitzungen = selbst ? await kontext.abfrage<Sitzung>(
        `select s.id, s.ansicht::text as ansicht, s.aal::text as aal, s.geraet,
                to_char(s.letzte_aktivitaet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as letzte_aktivitaet,
                to_char(s.ablauf_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as ablauf,
                to_char(s.beendet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as beendet,
                s.ende_grund::text as ende_grund
           from benutzer_sitzung s
          where s.benutzer_id = $1
          order by s.letzte_aktivitaet_am desc
          limit 20`, [id]) : [];
      return { kopf, mitgliedschaften, sitzungen };
    })) as Promise<{
      kopf: Kopf; mitgliedschaften: readonly Mitgliedschaft[]; sitzungen: readonly Sitzung[];
    } | null>);
  if (daten === null) notFound();
  const { kopf, mitgliedschaften, sitzungen } = daten;

  return (
    <PortalRahmen
      titel={kopf.name}
      wurzelTitel="Benutzer"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">{kopf.name}</h1>
      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 text-h3 text-text">Konto</h2>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
          <Feld label="E-Mail" wert={kopf.email} />
          <Feld label="Status" wert={kopf.status} />
          <Feld label="Sprache" wert={kopf.sprache ?? 'Deutsch'} />
          <Feld label="Zweiter Faktor" wert={kopf.zweiter_faktor ? 'eingerichtet' : 'nicht eingerichtet'} />
          <Feld label="Letzte Anmeldung" wert={kopf.letzter_login ?? '—'} />
          <Feld label="Konto seit" wert={kopf.erstellt_am} />
          {kopf.deaktiviert_am === null ? null : <Feld label="Deaktiviert am" wert={kopf.deaktiviert_am} />}
        </dl>
      </section>

      <h2 className="mb-s3 text-h2 text-text">Mitgliedschaft in dieser Gesellschaft</h2>
      <div data-cse="mitgliedschaften" className="mb-s6">
        <DataTable
          beschriftung="Mitgliedschaften dieses Kontos in dieser Gesellschaft"
          zeilen={mitgliedschaften}
          schluessel={(m) => m.id}
          spalten={[
            { schluessel: 'rolle', kopf: 'Rolle',
              zelle: (m) => `${m.rolle}${m.erfordert_2fa ? ' · 2FA-Pflicht' : ''}` },
            { schluessel: 'module', kopf: 'Module',
              zelle: (m) => (m.module === null ? 'alle der Rolle' : m.module.join(', ') || 'keine') },
            { schluessel: 'herkunft', kopf: 'Herkunft',
              zelle: (m) => (m.aus_anstellung ? 'aus Anstellung (K-14)' : 'vergeben') },
            { schluessel: 'ab', kopf: 'Gültig ab', zelle: (m) => m.gueltig_ab },
            { schluessel: 'bis', kopf: 'Gültig bis', zelle: (m) => m.gueltig_bis ?? 'unbefristet' },
            { schluessel: 'entzogen', kopf: 'Entzogen',
              zelle: (m) => (m.entzogen_am === null ? '—'
                : `${m.entzogen_am}${m.entzugsgrund === null ? '' : ` · ${m.entzugsgrund}`}`) },
          ]}
        />
      </div>

      <h2 className="mb-s3 text-h2 text-text">Sitzungen</h2>
      {!selbst ? (
        <p data-cse="sitzungen-fremd" className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Sitzungen sind nur für das eigene Konto lesbar (`t_sitzung_eigene`, AUT-08).
          Das Widerrufen fremder Sitzungen kommt mit `system.sitzung_widerrufen`.
        </p>
      ) : sitzungen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">Keine Sitzung.</p>
      ) : (
        <DataTable
          beschriftung="Die letzten zwanzig Sitzungen dieses Kontos"
          zeilen={sitzungen}
          schluessel={(s) => s.id}
          spalten={[
            { schluessel: 'aktiv', kopf: 'Letzte Aktivität', zelle: (s) => s.letzte_aktivitaet },
            { schluessel: 'ansicht', kopf: 'Ansicht', zelle: (s) => s.ansicht },
            { schluessel: 'aal', kopf: 'Stufe', zelle: (s) => (s.aal === 'aal2' ? 'zwei Faktoren' : 'ein Faktor') },
            { schluessel: 'geraet', kopf: 'Gerät', zelle: (s) => s.geraet ?? '—' },
            { schluessel: 'ende', kopf: 'Ende',
              zelle: (s) => (s.beendet === null ? `läuft bis ${s.ablauf}`
                : `${s.beendet} · ${ENDE[s.ende_grund ?? ''] ?? (s.ende_grund ?? '')}`) },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
