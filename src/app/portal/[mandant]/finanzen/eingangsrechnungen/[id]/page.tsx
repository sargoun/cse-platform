import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/finanzen/eingangsrechnungen/[id]` — der Beleg und sein
 * Weg (FIN-14, ACC-05, APR-01).
 *
 * **Die Seite zeigt genau die Handlung, die als NÄCHSTES möglich ist.** Die
 * Übergangstabelle steht in der Datenbank (0123); hier stünde sonst eine
 * zweite Fassung davon, und zwei Fassungen gehen beim ersten Widerspruch
 * auseinander. Was nicht erlaubt ist, wird deshalb nicht angeboten — und
 * wenn die Datenbank es doch abweist, sagt sie warum.
 *
 * **Freigeben und Buchen tragen ein eigenes Recht** (`eingang.freigeben`).
 * Wer erfasst, gibt nicht schon deswegen frei (Invariante 7). Die Freigabe
 * selbst friert ein, worüber entschieden wurde — Lieferant, Nummer, Datum,
 * Betrag —, damit eine nachträgliche Änderung sie nicht mehr deckt (K-13).
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  eingegangen: 'Entwurf', in_pruefung: 'In Prüfung', freigegeben: 'Bereit',
  gebucht: 'Abgeschlossen', abgelehnt: 'Abgelehnt',
};

interface Kopf {
  readonly id: string;
  readonly status: string;
  readonly interne_belegnummer: string | null;
  readonly lieferant: string | null;
  readonly rechnungsnummer_lieferant: string | null;
  readonly rechnungsdatum: string | null;
  readonly leistungsdatum: string | null;
  readonly faellig_am: string | null;
  readonly netto_cent: string | null;
  readonly steuer_cent: string | null;
  readonly brutto_cent: string | null;
  readonly bauabzugsteuer_cent: string;
  readonly abgelehnt_grund: string | null;
  readonly beleg_sha: string;
  readonly offen_cent: string | null;
}

interface SteuerZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

/** Ein extrahiertes Feld des Vorschlags, aus dem diese Rechnung entstand (PR 63, APR-03). */
interface HerkunftFeld {
  readonly id: string;
  readonly freigabe_id: string;
  readonly bezeichnung: string;
  readonly wert_nachher: string | null;
  readonly konfidenz: string | null;
  readonly unsicher: boolean;
  readonly quelle_zelle: string | null;
  readonly quelle_zitat: string | null;
}

export default async function EingangsrechnungDetail(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/eingangsrechnungen/[id]`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kopf: (await kontext.abfrage<Kopf>(
        `select er.id, er.status::text as status, er.interne_belegnummer,
                l.name as lieferant, er.rechnungsnummer_lieferant,
                to_char(er.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                to_char(er.leistungsdatum, 'DD.MM.YYYY') as leistungsdatum,
                to_char(er.faellig_am, 'DD.MM.YYYY') as faellig_am,
                er.netto_cent::text, er.steuer_cent::text, er.brutto_cent::text,
                er.bauabzugsteuer_cent::text, er.abgelehnt_grund,
                b.datei_sha256 as beleg_sha,
                (select op.offen_cent::text from offener_posten op
                  where op.eingangsrechnung_id = er.id) as offen_cent
           from eingangsrechnung er
           join beleg b on b.id = er.beleg_id and b.mandant_id = er.mandant_id
           left join lieferant l on l.id = er.lieferant_id and l.mandant_id = er.mandant_id
          where er.id = $1::uuid`, [id]))[0] ?? null,
      steuer: await kontext.abfrage<SteuerZeile>(
        `select s.id, g.bezeichnung, s.satz_bp, s.netto_cent::text, s.steuer_cent::text
           from eingangsrechnung_steuer s
           join steuersatz_gruppe g on g.id = s.steuersatz_gruppe_id
          where s.eingangsrechnung_id = $1::uuid
          order by s.satz_bp desc`, [id]),
      /*
       * Die Herkunft: wurde diese Rechnung aus einem E-Rechnungs-Vorschlag
       * uebernommen, stehen hier seine Felder mit Quelle und Konfidenz
       * (SEITENKARTE: „extracted fields with source and confidence").
       */
      herkunft: await kontext.abfrage<HerkunftFeld>(
        `select ff.id, ff.freigabe_id, ff.bezeichnung, ff.wert_nachher, ff.konfidenz::text as konfidenz,
                ff.unsicher, ff.quelle_zelle, ff.quelle_zitat
           from freigabe f
           join freigabe_feld ff on ff.freigabe_id = f.id and ff.mandant_id = f.mandant_id
          where f.bezug_typ = 'eingangsrechnung' and f.bezug_id = $1::uuid
            and f.aktion = 'eingangsrechnung_uebernehmen'
          order by ff.feld_pfad`, [id]),
    }))) as Promise<{ kopf: Kopf | null; steuer: readonly SteuerZeile[];
      herkunft: readonly HerkunftFeld[] }>);

  if (daten.kopf === null) notFound();
  const kopf = daten.kopf;
  const ziel = `/api/finanzen/eingangsrechnungen?mandant=${mandant}`;
  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const knopf = 'min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold '
    + 'text-white hover:bg-brand-hover';
  const knopfStill = 'min-h-11 rounded-md border border-line-strong px-s5 py-s3 '
    + 'text-base text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel={kopf.interne_belegnummer ?? 'Eingangsrechnung'}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/eingangsrechnungen`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Eingangsrechnungen
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">
          {kopf.lieferant ?? 'Ohne Lieferant'} ·{' '}
          {kopf.rechnungsnummer_lieferant ?? 'ohne Nummer'}
        </h1>
        <StatusPill zustand={PILLE[kopf.status] ?? 'Entwurf'} />
      </div>

      {kopf.abgelehnt_grund === null ? null : (
        <p className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          Abgelehnt: {kopf.abgelehnt_grund}
        </p>
      )}

      <dl className="mb-s7 grid max-w-prose grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">Interne Belegnummer</dt>
          <dd className="text-text" data-cse="belegnummer">
            {kopf.interne_belegnummer
              ?? <span className="text-text-subtle">entsteht beim Buchen</span>}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Rechnungsdatum</dt>
          <dd className="text-text">{kopf.rechnungsdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Leistungsdatum</dt>
          <dd className="text-text">{kopf.leistungsdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Fällig</dt>
          <dd className="text-text">{kopf.faellig_am ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Brutto</dt>
          <dd className="text-text">
            {kopf.brutto_cent === null ? '—' : formatiereGeld(cent(BigInt(kopf.brutto_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Offen an den Lieferanten</dt>
          <dd className="text-text">
            {kopf.offen_cent === null
              ? <span className="text-text-subtle">noch kein Posten — nicht gebucht</span>
              : formatiereGeld(cent(BigInt(kopf.offen_cent)))}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="steuer-titel" className="mb-s7">
        <h2 id="steuer-titel" className="mb-s3 text-h2 text-text">
          Entgelt je Steuersatz (§15 UStG)
        </h2>
        {daten.steuer.length === 0 ? (
          <p className="rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
            Keine Aufteilung erfasst. Ohne sie wird nicht gebucht — ein Brutto
            mit einem Mischsatz ergibt keinen Vorsteuerabzug.
          </p>
        ) : (
          <DataTable
            beschriftung="Entgelt und Steuer je Steuersatzgruppe"
            zeilen={daten.steuer}
            schluessel={(s) => s.id}
            spalten={[
              { schluessel: 'gruppe', kopf: 'Steuersatz', zelle: (s) => s.bezeichnung },
              {
                schluessel: 'netto', kopf: 'Netto', numerisch: true,
                zelle: (s) => formatiereGeld(cent(BigInt(s.netto_cent))),
              },
              {
                schluessel: 'steuer', kopf: 'Steuer', numerisch: true,
                zelle: (s) => formatiereGeld(cent(BigInt(s.steuer_cent))),
              },
            ]}
          />
        )}
      </section>

      {daten.herkunft.length > 0 ? (
        <section aria-labelledby="herkunft-titel" className="mb-s7" data-cse="herkunft-erechnung">
          <h2 id="herkunft-titel" className="mb-s3 text-h2 text-text">
            Aus einer E-Rechnung übernommen
          </h2>
          <p className="mb-s4 max-w-prose text-sm text-text-muted">
            Jeder Wert nennt das Element der Datei, aus dem er stammt, und die Prüfung,
            die er bestanden hat. Entschieden wurde in{' '}
            <Link href={`/portal/${mandant}/freigaben/${daten.herkunft[0]!.freigabe_id}`}
                  className="underline underline-offset-2">
              der Freigabe
            </Link>.
          </p>
          <DataTable
            beschriftung="Extrahierte Felder mit Quelle und Konfidenz"
            zeilen={daten.herkunft}
            schluessel={(h) => h.id}
            spalten={[
              { schluessel: 'feld', kopf: 'Feld', zelle: (h) => h.bezeichnung },
              { schluessel: 'wert', kopf: 'Wert',
                zelle: (h) => h.wert_nachher ?? <span className="text-text-subtle">—</span> },
              { schluessel: 'konfidenz', kopf: 'Konfidenz', numerisch: true,
                zelle: (h) => h.konfidenz ?? '—' },
              { schluessel: 'quelle', kopf: 'Quelle',
                zelle: (h) => (
                  <span className="flex min-w-0 flex-col text-xs text-text-muted">
                    <span className="break-all font-mono">{h.quelle_zelle ?? '—'}</span>
                    {h.quelle_zitat === null ? null : <q className="text-text">{h.quelle_zitat}</q>}
                  </span>
                ) },
            ]}
          />
        </section>
      ) : null}

      <section aria-labelledby="weg-titel">
        <h2 id="weg-titel" className="mb-s3 text-h2 text-text">Der nächste Schritt</h2>

        {kopf.status === 'gebucht' ? (
          <p className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Gebucht unter {kopf.interne_belegnummer}. Eine gebuchte Rechnung
            wird nicht mehr umgestellt — korrigiert wird durch eine
            Gegenbuchung.
          </p>
        ) : kopf.status === 'abgelehnt' ? (
          <p className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Abgelehnt. Eine abgelehnte Rechnung wird neu erfasst, nicht
            wiederbelebt — und sie blockiert die Neuerfassung nicht.
          </p>
        ) : (
          <div className="flex max-w-prose flex-col gap-s5">
            {kopf.status === 'eingegangen' ? (
              <form method="post" action={ziel}
                className="rounded-lg border border-line bg-surface p-s5">
                <input type="hidden" name="aktion" value="pruefen" />
                <input type="hidden" name="id" value={kopf.id} />
                <p className="mb-s3 text-sm text-text-muted">
                  In die Prüfung geben. Ab hier ist der Lieferant gesetzt und
                  der Beleg zugeordnet.
                </p>
                <button type="submit" className={knopf}>In Prüfung geben</button>
              </form>
            ) : null}

            {kopf.status === 'in_pruefung' ? (
              <form method="post" action={ziel}
                className="rounded-lg border border-line bg-surface p-s5">
                <input type="hidden" name="aktion" value="freigeben" />
                <input type="hidden" name="id" value={kopf.id} />
                <label className="block text-sm text-text" htmlFor="begruendung">
                  Grund der Freigabe
                </label>
                <input
                  id="begruendung" name="begruendung" type="text" minLength={5}
                  placeholder="Sachlich und rechnerisch geprüft" className={feld}
                />
                <p className="mt-s2 max-w-prose text-xs text-text-muted">
                  Die Freigabe friert ein, worüber entschieden wurde: Lieferant,
                  Nummer, Datum und Betrag. Wer die Rechnung danach ändert, hat
                  für das, was er bucht, keine Freigabe mehr (K-13).
                </p>
                <button type="submit" className={`mt-s4 ${knopf}`}>Freigeben</button>
              </form>
            ) : null}

            {kopf.status === 'freigegeben' ? (
              <form method="post" action={ziel}
                className="rounded-lg border border-line bg-surface p-s5">
                <input type="hidden" name="aktion" value="buchen" />
                <input type="hidden" name="id" value={kopf.id} />
                <p className="mb-s3 text-sm text-text-muted">
                  Buchen zieht die interne Belegnummer und öffnet die
                  Verbindlichkeit gegenüber dem Lieferanten. Danach ist der
                  Beleg unveränderlich.
                </p>
                <button type="submit" className={knopf}>Buchen</button>
              </form>
            ) : null}

            <form method="post" action={ziel}
              className="rounded-lg border border-line bg-surface p-s5">
              <input type="hidden" name="aktion" value="ablehnen" />
              <input type="hidden" name="id" value={kopf.id} />
              <label className="block text-sm text-text" htmlFor="grund">
                Zurückweisen — mit Grund
              </label>
              <input
                id="grund" name="grund" type="text" minLength={5}
                placeholder="Leistung wurde nie erbracht" className={feld}
              />
              <p className="mt-s2 max-w-prose text-xs text-text-muted">
                Die Zeile bleibt stehen (Invariante 8). Der Grund ist das, was
                später allein dasteht.
              </p>
              <button type="submit" className={`mt-s4 ${knopfStill}`}>Zurückweisen</button>
            </form>
          </div>
        )}
      </section>
    </PortalRahmen>
  );
}
