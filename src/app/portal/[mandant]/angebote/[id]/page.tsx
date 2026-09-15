import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinKalendertag } from '@/server/services/zeit/dauer';
import { kennungOder404 } from '../../../kennung';

/**
 * `/portal/[mandant]/angebote/[id]` — ein Angebot, seine Positionen und die
 * beiden Uebergaenge, die es hat.
 *
 * **Die Knoepfe sind Formulare, keine Links.** Versenden und Wandeln sind
 * POST auf `/api/angebot`: ein GET, das etwas aus dem Haus laesst, waere eine
 * Handlung, die ein weitergeleiteter Link ausloest — und Invariante 7 verlangt
 * eine Handlung, die jemand entschieden hat.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf', in_pruefung: 'In Prüfung', versendet: 'Angebot',
  angenommen: 'Aktiv', abgelehnt: 'Abgelehnt', zurueckgezogen: 'Archiviert',
  abgelaufen: 'Überfällig',
};

interface Kopf {
  readonly id: string;
  readonly angebotsnummer: string | null;
  readonly titel: string;
  readonly einleitungstext: string | null;
  readonly status: string;
  readonly kunde: string;
  readonly kunde_id: string;
  readonly objekt: string | null;
  readonly netto_cent: string;
  readonly gueltig_bis: string | null;
  readonly versendet_am: string | null;
  readonly auftragsnummer: string | null;
  readonly kalkulation_offen: boolean;
  /**
   * Zwei Rechte, die das Tor dieser Seite NICHT verlangt.
   *
   * Die Seite steht hinter `angebot.lesen`, liest aber zwei Tabellen mit
   * eigenen Policies: `auftrag` verlangt `auftrag.lesen`, die Sicht
   * `kalkulation_platzhalter` (security_invoker) verlangt
   * `kalkulation.lesen`. Wem eines davon fehlt, dem antwortet die Datenbank
   * korrekt mit NICHTS — und ohne diese beiden Merker haette die Seite daraus
   * „es gibt keinen Auftrag“ und „die Kalkulation ist bestaetigt“ gemacht.
   * Beides waere eine Aussage ueber die DATEN gewesen statt ueber die
   * Berechtigung, und die zweite haette den Versandknopf freigegeben.
   */
  readonly darf_auftrag_lesen: boolean;
  readonly darf_kalkulation_lesen: boolean;
}

interface PositionZeile {
  readonly id: string;
  readonly position_nr: number;
  readonly typ: string;
  readonly kurztext: string;
  readonly langtext: string | null;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelpreis_cent: string | null;
  readonly gesamtpreis_cent: string;
  readonly steuersatz_bp: number;
}

interface SteuerZeile {
  readonly steuersatz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

export default async function AngebotDetail(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/angebote/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select a.id, a.angebotsnummer, a.titel, a.einleitungstext, a.status::text as status,
                k.name as kunde, a.kunde_id, o.bezeichnung as objekt,
                a.netto_cent::text,
                to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
                to_char(a.versendet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as versendet_am,
                (select t.auftragsnummer from auftrag t where t.angebot_id = a.id)
                  as auftragsnummer,
                exists (select 1 from kalkulation_platzhalter kp where kp.angebot_id = a.id)
                  as kalkulation_offen,
                (select app.hat_recht('auftrag.lesen', app.aktiver_mandant()))
                  as darf_auftrag_lesen,
                (select app.hat_recht('kalkulation.lesen', app.aktiver_mandant()))
                  as darf_kalkulation_lesen
           from angebot a
           join kunde k on k.id = a.kunde_id
           left join objekt o on o.id = a.objekt_id
          where a.id = $1`, [id]);
      if (kopf === undefined) return null;
      const positionen = await kontext.abfrage<PositionZeile>(
        `select id, position_nr, typ::text as typ, kurztext, langtext,
                menge::text, einheit, einzelpreis_cent::text, gesamtpreis_cent::text,
                steuersatz_bp
           from angebotsposition where angebot_id = $1 order by position_nr`, [id]);
      const steuer = await kontext.abfrage<SteuerZeile>(
        `select steuersatz_bp, netto_cent::text, steuer_cent::text
           from angebot_steuer where angebot_id = $1 order by steuersatz_bp`, [id]);
      return { kopf, positionen, steuer };
    })) as Promise<{
      kopf: Kopf; positionen: readonly PositionZeile[]; steuer: readonly SteuerZeile[];
    } | null>);

  if (daten === null) notFound();
  const { kopf, positionen, steuer } = daten;
  const versendet = kopf.versendet_am !== null;
  const steuerSumme = steuer.reduce((s, z) => s + BigInt(z.steuer_cent), 0n);

  return (
    <PortalRahmen
      titel={kopf.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={versendet}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="angebote"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/angebote`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Angebote
        </Link>
      </nav>

      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.titel}</h1>
        <StatusPill zustand={PILLE[kopf.status] ?? 'Entwurf'} />
      </div>

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Nummer</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.angebotsnummer ?? (
              <span className="text-text-subtle">entsteht beim Versand</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Kunde</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.kunde}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Objekt</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.objekt ?? <span className="text-text-subtle">—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Versendet</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.versendet_am ?? <span className="text-text-subtle">noch nicht</span>}
          </dd>
        </div>
      </dl>

      {kopf.kalkulation_offen ? (
        <p
          data-cse="kalkulation-offen"
          className="mb-s5 rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          <strong>Die Kalkulation steht auf unbestätigten Werten (O-16).</strong> Solange
          das so ist, lässt sich dieses Angebot nicht versenden — ein
          eingefrorener Preis auf offenen Fragen sieht prüfbar aus und ist es
          nicht.
        </p>
      ) : null}

      {kopf.kalkulation_offen && kopf.darf_kalkulation_lesen ? (
        <p className="mb-s5 text-sm text-text">
          {/*
            * Als Zeichenkette, NICHT als `{ pathname, query }`.
            *
            * Im App Router setzt `Link` die dynamischen Segmente eines
            * Objektziels nicht ein: `/portal/[mandant]/…` bleibt woertlich
            * stehen, und der Klick landet auf einer Adresse mit eckigen
            * Klammern — also auf 404. In den Pages Router war es umgekehrt.
            * Der Build merkt es nicht, weil das Muster gueltig ist.
            */}
          <Link
            href={`/portal/${mandant}/angebote/${id}/kalkulation`}
            data-cse="zur-kalkulation"
            /*
             * `text-text` mit Marke erst beim Hover — wie jeder andere Link
             * im Portal. CSE-Rot auf dem dunklen Grund erreicht den
             * WCAG-AA-Kontrast nicht (DESIGN §9: Farbe ist nie das einzige
             * Signal, und sie muss lesbar sein).
             */
            className="text-text underline underline-offset-2 hover:text-brand"
          >
            Werte bestätigen und den Rechenweg ansehen →
          </Link>
        </p>
      ) : null}

      {kopf.darf_kalkulation_lesen ? null : (
        <p
          data-cse="kalkulation-verdeckt"
          className="mb-s5 rounded-md border border-line bg-surface-2 p-s4 text-sm text-text-muted"
        >
          <strong>Der Kalkulationsstand ist Ihnen nicht sichtbar.</strong> Ihnen
          fehlt <code className="text-text">kalkulation.lesen</code>; die
          Datenbank antwortet deshalb mit nichts, und das heißt hier
          ausdrücklich nicht „alles bestätigt“. Der Versand bleibt gesperrt,
          weil sich seine Voraussetzung von hier aus nicht prüfen lässt.
        </p>
      )}

      <DataTable
        beschriftung="Positionen dieses Angebots"
        zeilen={positionen}
        schluessel={(z) => z.id}
        spalten={[
          { schluessel: 'nr', kopf: 'Pos.', numerisch: true, zelle: (z) => String(z.position_nr) },
          {
            schluessel: 'text',
            kopf: 'Leistung',
            zelle: (z) => (
              <span>
                {z.kurztext}
                {z.langtext === null ? null : (
                  <span className="block text-xs text-text-muted">{z.langtext}</span>
                )}
              </span>
            ),
          },
          {
            schluessel: 'menge',
            kopf: 'Menge',
            numerisch: true,
            zelle: (z) => (z.menge === null
              ? <span className="text-text-subtle">—</span>
              : `${formatiereMenge(mengeAusPostgresOderNull(z.menge))} ${z.einheit ?? ''}`),
          },
          {
            schluessel: 'einzel',
            kopf: 'Einzelpreis',
            numerisch: true,
            zelle: (z) => (z.einzelpreis_cent === null
              ? <span className="text-text-subtle">—</span>
              : formatiereGeld(cent(BigInt(z.einzelpreis_cent)))),
          },
          {
            schluessel: 'gesamt',
            kopf: 'Gesamt',
            numerisch: true,
            zelle: (z) => formatiereGeld(cent(BigInt(z.gesamtpreis_cent))),
          },
          {
            schluessel: 'steuer',
            kopf: 'USt.',
            numerisch: true,
            zelle: (z) => `${(z.steuersatz_bp / 100).toLocaleString('de-DE')} %`,
          },
        ]}
      />

      <dl
        data-cse="angebot-summe"
        className="m-0 mt-s5 grid grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2"
      >
        <dt className="text-sm text-text-muted">Netto</dt>
        <dd data-cse="netto" className="m-0 cse-zahl text-sm text-text">
          {formatiereGeld(cent(BigInt(kopf.netto_cent)))}
        </dd>
        {steuer.map((z) => (
          <div key={z.steuersatz_bp} className="contents">
            <dt className="text-sm text-text-muted">
              {`Umsatzsteuer ${(z.steuersatz_bp / 100).toLocaleString('de-DE')} %`}
            </dt>
            <dd className="m-0 cse-zahl text-sm text-text">
              {formatiereGeld(cent(BigInt(z.steuer_cent)))}
            </dd>
          </div>
        ))}
        {versendet ? (
          <>
            <dt className="text-h3 text-text">Brutto</dt>
            <dd className="m-0 cse-zahl text-h3 text-text">
              {formatiereGeld(cent(BigInt(kopf.netto_cent) + steuerSumme))}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-sm text-text-muted">Brutto</dt>
            <dd className="m-0 text-sm text-text-subtle">
              entsteht beim Versand, je Steuersatzgruppe
            </dd>
          </>
        )}
      </dl>

      <div className="mt-s6 flex flex-wrap items-center gap-s4">
        {versendet ? (
          <Link
            href={`/portal/${mandant}/angebote/${id}/pdf`}
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
          >
            Angebotsdokument
          </Link>
        ) : (
          <form method="post" action={`/api/angebot?mandant=${mandant}`}>
            <input type="hidden" name="aktion" value="versenden" />
            <input type="hidden" name="angebotId" value={id} />
            <button
              type="submit"
              data-cse="versenden"
              disabled={kopf.kalkulation_offen || !kopf.darf_kalkulation_lesen}
              className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover disabled:opacity-50"
            >
              Angebot versenden
            </button>
          </form>
        )}

        {versendet && kopf.auftragsnummer === null && kopf.darf_auftrag_lesen ? (
          <form method="post" action={`/api/angebot?mandant=${mandant}`}>
            <input type="hidden" name="aktion" value="in_auftrag" />
            <input type="hidden" name="angebotId" value={id} />
            <input type="hidden" name="art" value="rahmenvertrag" />
            <input
              type="hidden"
              name="startDatum"
              /**
               * Der BERLINER Kalendertag, nicht der von UTC. In den ersten
               * Stunden eines Berliner Tages liegt `toISOString()` noch auf
               * dem Vortag — und der Auftrag begaenne einen Tag zu frueh.
               */
              value={berlinKalendertag(new Date())}
            />
            <button
              type="submit"
              data-cse="in-auftrag"
              className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
            >
              Angenommen — Auftrag anlegen
            </button>
          </form>
        ) : null}

        {kopf.auftragsnummer === null ? null : (
          <p className="m-0 text-sm text-text-muted">
            {`Auftrag ${kopf.auftragsnummer} entstanden.`}
          </p>
        )}

        {kopf.darf_auftrag_lesen ? null : (
          <p data-cse="auftrag-verdeckt" className="m-0 text-sm text-text-muted">
            Ob aus diesem Angebot bereits ein Auftrag entstanden ist, ist Ihnen
            nicht sichtbar — dafür fehlt <code className="text-text">auftrag.lesen</code>.
            Deshalb steht hier auch kein Knopf, der einen zweiten anlegen würde.
          </p>
        )}
      </div>
    </PortalRahmen>
  );
}
