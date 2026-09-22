import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/einstellungen/benutzer` — die Konten dieser Gesellschaft
 * (AUT-01, AUT-02, AUT-08), lesend.
 *
 * Gelesen wird `benutzer_mandant` im aktiven Bereich; die Policy `t_bm_lesen`
 * verlangt dafuer `system.benutzer_lesen` in genau diesem Bereich (K-03).
 * Der zweite Faktor kommt aus `app.hat_zweiten_faktor` — die Funktion liest
 * `auth.mfa_factors`, die Seite sieht nur ja oder nein.
 */
export const dynamic = 'force-dynamic';

const STATUS: Readonly<Record<string, PillZustand>> = {
  eingeladen: 'Wartet', aktiv: 'Aktiv', gesperrt: 'Fehler', deaktiviert: 'Inaktiv',
};
const STATUS_TEXT: Readonly<Record<string, string>> = {
  eingeladen: 'eingeladen', aktiv: 'aktiv', gesperrt: 'gesperrt', deaktiviert: 'deaktiviert',
};

interface Zeile {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly status: string;
  readonly rolle: string;
  readonly rolle_schluessel: string;
  readonly module: readonly string[] | null;
  readonly aus_anstellung: boolean;
  readonly gueltig_bis: string | null;
  readonly zweiter_faktor: boolean;
  readonly erfordert_2fa: boolean;
  readonly letzter_login: string | null;
}

export default async function Benutzerliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/benutzer`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  /*
   * **Das Recht der Einladeseite — VOR dem Rendern** (AUT-06, D-567).
   *
   * `/einstellungen/benutzer/einladen` verlangt `system.verwaltungskonto_erstellen`;
   * ein Knopf davor, den jeder sieht, führte für den Rest auf 404 und verriete
   * damit die Existenz dessen, was er nicht zeigen darf.
   */
  const darf = await haeltRechte(zugang.sitzung, 'system.verwaltungskonto_erstellen');

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<Zeile>(
      `select b.id, b.name, b.email, b.status::text as status,
              r.bezeichnung as rolle, r.schluessel as rolle_schluessel,
              bm.module, bm.aus_anstellung,
              to_char(bm.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
              app.hat_zweiten_faktor(b.id) as zweiter_faktor, r.erfordert_2fa,
              to_char(b.letzter_login_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as letzter_login
         from benutzer_mandant bm
         join benutzer b on b.id = bm.benutzer_id
         join rolle r on r.id = bm.rolle_id
        where bm.mandant_id = $1 and bm.entzogen_am is null and not b.ist_dienstkonto
        order by r.schluessel, b.name`, [mandantId]))) as Promise<readonly Zeile[]>);

  return (
    <PortalRahmen
      titel="Benutzer"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Benutzer</h1>
      <p data-cse="benutzer-zaehler" data-anzahl={zeilen.length} className="mb-s5 text-sm text-text-muted">
        {String(zeilen.length)} Konten mit Zugang zu dieser Gesellschaft. Dienstkonten
        (Formulare, Website) stehen nicht in dieser Liste.
      </p>

      {/*
        * ═══════════════════════════════════════════════════════════════════
        * **Der Weg zum ersten Konto — er fehlte** (V-125).
        * ═══════════════════════════════════════════════════════════════════
        *
        * `/einstellungen/benutzer/einladen` war gebaut, bewacht und im
        * Manifest geführt — und **von keiner Seite aus erreichbar**. Wer ein
        * Verwaltungskonto anlegen wollte, musste die Adresse kennen. Eine
        * Seite ohne Eingang ist keine Seite; für den Betrieb ist sie nicht
        * vorhanden, und gerade diese hier ist der erste Schritt nach der
        * Einrichtung.
        */}
      {darf['system.verwaltungskonto_erstellen'] === true ? (
        <p className="mb-s5">
          <Link
            href={`/portal/${mandant}/einstellungen/benutzer/einladen`}
            data-cse="zum-einladen"
            className="inline-flex min-h-11 items-center rounded-md border border-line-strong
                       px-s5 py-s3 text-sm text-text no-underline hover:bg-surface-2"
          >
            Konto einladen
          </Link>
        </p>
      ) : (
        <p className="mb-s5 text-sm text-text-muted" data-cse="kein-einladen">
          Ein neues Verwaltungskonto anzulegen verlangt{' '}
          <Recht schluessel="system.verwaltungskonto_erstellen" sprache={zugang.sprache} />.
        </p>
      )}

      <DataTable
        beschriftung="Konten dieser Gesellschaft"
        zeilen={zeilen}
        schluessel={(z) => z.id}
        spalten={[
          { schluessel: 'name', kopf: 'Name',
            zelle: (z) => (
              <Link href={`/portal/${mandant}/einstellungen/benutzer/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline">
                {z.name}
              </Link>
            ) },
          { schluessel: 'email', kopf: 'E-Mail', zelle: (z) => z.email },
          { schluessel: 'rolle', kopf: 'Rolle',
            zelle: (z) => `${z.rolle}${z.aus_anstellung ? ' · aus Anstellung' : ''}` },
          { schluessel: 'module', kopf: 'Module',
            zelle: (z) => (z.module === null ? 'alle der Rolle' : z.module.join(', ') || 'keine') },
          { schluessel: 'faktor', kopf: 'Zweiter Faktor',
            zelle: (z) => (z.zweiter_faktor
              ? 'eingerichtet'
              : <span className={z.erfordert_2fa ? 'text-danger' : 'text-text-subtle'}>
                  {z.erfordert_2fa ? 'fehlt — Pflicht (AUT-02)' : 'nicht eingerichtet'}
                </span>) },
          { schluessel: 'login', kopf: 'Letzte Anmeldung', zelle: (z) => z.letzter_login ?? '—' },
          { schluessel: 'gueltig', kopf: 'Zugang bis', zelle: (z) => z.gueltig_bis ?? 'unbefristet' },
          { schluessel: 'status', kopf: 'Status',
            zelle: (z) => (
              <span className="flex items-center gap-s2">
                <StatusPill zustand={STATUS[z.status] ?? 'Inaktiv'} />
                <span className="text-xs text-text-muted">{STATUS_TEXT[z.status] ?? z.status}</span>
              </span>
            ) },
        ]}
      />
      <p className="mt-s5 max-w-[72ch] text-sm text-text-subtle">
        Einladen, Rollen ändern und Zugänge entziehen sind Schreibvorgänge mit
        Zwei-Faktor-Pflicht (`system.benutzer_verwalten`, K-15) — sie kommen mit
        der Benutzerverwaltung (Phase 1, AUT-01).
      </p>
    </PortalRahmen>
  );
}
