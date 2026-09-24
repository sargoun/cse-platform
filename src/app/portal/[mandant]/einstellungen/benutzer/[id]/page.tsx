import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { haeltRechte } from '@/app/portal/rechte';
import { KontoHandlungen } from '../KontoHandlungen';
import { ModulZuweisung } from '../ModulZuweisung';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { ZUGANG_TEXTE } from '@/lib/i18n/verwaltung/einstellungen/zugang';
import {
  MODUL_ZUWEISUNG_TEXTE, modulName,
} from '@/lib/i18n/verwaltung/einstellungen/module-zuweisung';
import { internSprache } from '@/lib/i18n/intern';
import { modulKatalog } from '@/server/services/system/mitgliedschaft-module';
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
  /** `admin` mit `rolle.mandant_id is null` — nur ihr werden Module zugewiesen (0416). */
  readonly plattform_admin: boolean;
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
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/benutzer/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;
  const selbst = id.toLowerCase() === zugang.sitzung.benutzerId.toLowerCase();
  const darf = await haeltRechte(
    zugang.sitzung, 'system.benutzer_verwalten', 'system.sitzung_widerrufen',
    'system.module_zuweisen');
  const suche = await searchParams;
  const stand = typeof suche['konto'] === 'string' ? suche['konto'] : null;
  const anzahl = typeof suche['anzahl'] === 'string' ? suche['anzahl'] : null;
  const tZugang = nachSprache(ZUGANG_TEXTE, zugang.sprache);
  /* AUT-01 (V-164): der Stand der Modulzuweisung kommt als `?module=` zurueck. */
  const modulStand = typeof suche['module'] === 'string' ? suche['module'] : null;
  const tModule = nachSprache(MODUL_ZUWEISUNG_TEXTE, zugang.sprache);
  const sprache = internSprache(zugang.sprache);

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
        `select bm.id, r.bezeichnung as rolle,
                (r.schluessel = 'admin' and r.mandant_id is null) as plattform_admin,
                r.erfordert_2fa, bm.module, bm.aus_anstellung,
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
      /* Der Katalog nur, wenn es etwas zuzuweisen gibt — eine Abfrage weniger sonst. */
      const katalog = darf['system.module_zuweisen'] === true
        ? await modulKatalog(kontext) : [];
      return { kopf, mitgliedschaften, sitzungen, katalog };
    })) as Promise<{
      kopf: Kopf; mitgliedschaften: readonly Mitgliedschaft[]; sitzungen: readonly Sitzung[];
      katalog: readonly string[];
    } | null>);
  if (daten === null) notFound();
  const { kopf, mitgliedschaften, sitzungen, katalog } = daten;
  /*
   * Zuweisbar ist eine LEBENDE Mitgliedschaft mit der Plattformrolle `admin`
   * (0416). Der Knopf erscheint nur mit `system.module_zuweisen` — die
   * Datenbank fragt es beim Speichern ein zweites Mal.
   */
  const zuweisbar = darf['system.module_zuweisen'] === true
    ? mitgliedschaften.filter((m) => m.plattform_admin && m.entzogen_am === null)
      .map((m) => ({ id: m.id, module: m.module }))
    : [];

  return (
    <PortalRahmen
      titel={kopf.name}
      wurzelTitel="Benutzer"
      bereich={mandant as BereichSchluessel}
      /*
       * **Das Blatt ist nicht mehr nur lesend** (V-022, V-074, V-075, V-076).
       * Die Marke stand hier, solange es nichts zu tun gab; neben vier
       * Knöpfen wäre sie eine Aussage, die das Blatt selbst widerlegt. Die
       * Gruppenansicht bleibt lesend — dort greift Invariante 10.
       */
      nurLesen={zugang.sitzung.ansicht === 'gruppe'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">{kopf.name}</h1>

      {stand === null ? null : (
        <Hinweis
          art={stand.endsWith('_unveraendert') ? 'hinweis' : 'erfolg'}
          cse="konto-stand"
          className="mb-s5 max-w-prose"
        >
          {tZugang.meldung[stand] ?? stand}
          {anzahl === null ? null : ` (${anzahl})`}
        </Hinweis>
      )}

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
            /* Benannt, nicht als Schluessel (V-164): `crm, finanzen` sagt niemandem etwas. */
            { schluessel: 'module', kopf: 'Module',
              zelle: (m) => (m.module === null ? tModule.alleDerRolle
                : m.module.map((x) => modulName(x, sprache)).join(', ')) },
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

      {modulStand === null ? null : (
        <Hinweis
          art={modulStand === 'module_gesetzt' ? 'erfolg'
            : modulStand === 'module_unveraendert' ? 'hinweis' : 'warnung'}
          cse="modul-stand"
          className="mb-s5 max-w-prose"
        >
          {tModule.meldung[modulStand] ?? tModule.meldung['nicht_erlaubt']}
        </Hinweis>
      )}

      <ModulZuweisung
        mandant={mandant}
        benutzerId={kopf.id}
        selbst={selbst}
        mitgliedschaften={zuweisbar}
        katalog={katalog}
        sprache={sprache}
        t={tModule}
      />

      <KontoHandlungen
        mandant={mandant}
        benutzerId={kopf.id}
        status={kopf.status}
        selbst={selbst}
        darfVerwalten={darf['system.benutzer_verwalten'] === true}
        darfWiderrufen={darf['system.sitzung_widerrufen'] === true}
        t={tZugang}
      />

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
