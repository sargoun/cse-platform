import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgres } from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]` — **Entwurfseditor ODER
 * festgeschriebene Ansicht, nie beides** (04-SEITENKARTE.md §5).
 *
 * Das ist keine Darstellungsfrage. Ein Formular auf einem festgeschriebenen
 * Beleg verspricht eine Aenderung, die die Datenbank anschliessend ablehnt —
 * und der Mensch, der es ausfuellt, lernt aus einer Fehlermeldung, was die
 * Oberflaeche ihm haette sagen muessen.
 *
 * **Eine Position laesst sich nicht ENTFERNEN, nur korrigieren.** Invariante 8
 * kennt in dieser Domaene keinen Hard Delete, und `rechnungsposition` traegt
 * keine Zustandsspalte. Wer neu anfangen will, verwirft den Entwurf — der
 * bleibt mit Grund stehen und kostet keine Nummer. Der Knopf dafuer steht
 * unten.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  festgeschrieben: 'Abgeschlossen',
  verworfen: 'Archiviert',
};

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsart: string;
  readonly kunde: string;
  readonly kunde_id: string;
  readonly objekt: string | null;
  readonly rechnungsdatum: string | null;
  readonly leistung_von: string | null;
  readonly leistung_bis: string | null;
  readonly zahlungsziel_tage: number | null;
  readonly faellig_am: string | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly kopftext: string | null;
  readonly verworfen_grund: string | null;
  readonly hash: string | null;
  readonly kette_position: string | null;
  readonly storniert_durch: string | null;
  readonly ersetzt_durch: string | null;
}

interface Pos {
  readonly id: string;
  readonly position_nr: number;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly unece_code: string | null;
  readonly einzelpreis_cent: string | null;
  readonly netto_cent: string | null;
  readonly gruppe: string;
  readonly satz_bp: number;
}

interface Steuer {
  readonly gruppe: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

interface Einheit { readonly schluessel: string; readonly bezeichnung: string;
  readonly ist_platzhalter: boolean }
interface Gruppe { readonly schluessel: string; readonly bezeichnung: string }

export default async function Rechnungsblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/rechnungen/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kopf: (await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status,
                r.rechnungsart::text as rechnungsart,
                k.name as kunde, k.id::text as kunde_id, o.bezeichnung as objekt,
                to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                to_char(r.leistung_von, 'DD.MM.YYYY') as leistung_von,
                to_char(r.leistung_bis, 'DD.MM.YYYY') as leistung_bis,
                r.zahlungsziel_tage, to_char(r.faellig_am, 'DD.MM.YYYY') as faellig_am,
                r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text, r.brutto_cent::text,
                r.kopftext, r.verworfen_grund,
                h.hash, h.kette_position::text,
                (select s.nummer from rechnung_beziehung b
                   join rechnung s on s.id = b.von_rechnung_id
                  where b.zu_rechnung_id = r.id and b.art = 'storno' limit 1) as storniert_durch,
                (select s.nummer from rechnung_beziehung b
                   join rechnung s on s.id = b.von_rechnung_id
                  where b.zu_rechnung_id = r.id and b.art = 'ersetzt' limit 1) as ersetzt_durch
           from rechnung r
           join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
           left join objekt o on o.mandant_id = r.mandant_id and o.id = r.objekt_id
           left join rechnung_hash h on h.rechnung_id = r.id
          where r.id = $1`, [id]))[0] ?? null,
      positionen: await kontext.abfrage<Pos>(
        `select p.id, p.position_nr, p.bezeichnung, p.menge::text, p.einheit,
                e.unece_code, p.einzelpreis_cent::text, p.netto_cent::text,
                g.schluessel as gruppe, p.satz_bp
           from rechnungsposition p
           join steuersatz_gruppe g on g.id = p.steuersatz_gruppe_id
           left join masseinheit e on e.id = p.masseinheit_id
          where p.rechnung_id = $1 order by p.position_nr`, [id]),
      steuer: await kontext.abfrage<Steuer>(
        `select g.schluessel as gruppe, s.satz_bp, s.netto_cent::text, s.steuer_cent::text
           from rechnung_steuer s
           join steuersatz_gruppe g on g.id = s.steuersatz_gruppe_id
          where s.rechnung_id = $1 and (s.netto_cent <> 0 or s.steuer_cent <> 0)
          order by g.schluessel`, [id]),
      einheiten: await kontext.abfrage<Einheit>(
        `select schluessel, bezeichnung, ist_platzhalter from masseinheit order by schluessel`),
      gruppen: await kontext.abfrage<Gruppe>(
        `select schluessel, bezeichnung from steuersatz_gruppe
          where app.berlin_heute() >= gueltig_von
            and (gueltig_bis is null or app.berlin_heute() <= gueltig_bis)
          order by satz_bp desc`),
    }))) as Promise<{
      kopf: Kopf | null; positionen: readonly Pos[]; steuer: readonly Steuer[];
      einheiten: readonly Einheit[]; gruppen: readonly Gruppe[];
    }>);

  const k = daten.kopf;
  if (k === null) notFound();
  const entwurf = k.status === 'entwurf';
  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel={k.nummer ?? 'Rechnungsentwurf'}
      bereich={mandant as BereichSchluessel}
      nurLesen={!entwurf}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/rechnungen`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Rechnungen
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">
          {k.nummer ?? 'Entwurf ohne Nummer'}
        </h1>
        <StatusPill zustand={PILLE[k.status] ?? 'Entwurf'} />
      </div>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div><dt className="text-xs text-text-muted">Kunde</dt>
          <dd className="text-sm text-text">{k.kunde}</dd></div>
        <div><dt className="text-xs text-text-muted">Leistungsort</dt>
          <dd className="text-sm text-text">{k.objekt ?? '—'}</dd></div>
        <div><dt className="text-xs text-text-muted">Leistungszeitraum</dt>
          <dd className="text-sm text-text">
            {k.leistung_von ?? '—'} – {k.leistung_bis ?? '—'}
          </dd></div>
        <div><dt className="text-xs text-text-muted">Rechnungsdatum</dt>
          <dd className="text-sm text-text">{k.rechnungsdatum ?? '—'}</dd></div>
        <div><dt className="text-xs text-text-muted">Zahlungsziel</dt>
          <dd className="text-sm text-text">
            {k.zahlungsziel_tage === null
              ? <span className="text-warning">nicht hinterlegt (O-66)</span>
              : `${String(k.zahlungsziel_tage)} Tage`}
          </dd></div>
        <div><dt className="text-xs text-text-muted">Fällig</dt>
          <dd className="text-sm text-text">{k.faellig_am ?? '—'}</dd></div>
      </dl>

      {k.verworfen_grund === null ? null : (
        <p className="mb-s5 rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text-muted">
          Verworfen: {k.verworfen_grund}
        </p>
      )}
      {k.storniert_durch === null ? null : (
        <p className="mb-s5 rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text-muted">
          Aufgehoben durch Stornorechnung {k.storniert_durch}
          {k.ersetzt_durch === null ? '' : `, neu ausgestellt als ${k.ersetzt_durch}`}.
          Dieser Beleg bleibt unverändert lesbar — korrigiert wird durch
          Gegenbuchung, nie durch Änderung.
        </p>
      )}

      <h2 className="mb-s3 text-h3 text-text">Positionen</h2>
      {daten.positionen.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch keine Position. Ohne Leistungsposition gibt es nichts abzurechnen
          (§14 Abs. 4 Nr. 5 UStG).
        </p>
      ) : (
        <div className="mb-s5">
          <DataTable
            beschriftung="Positionen der Rechnung mit Menge, Einzelpreis und Steuersatz"
            zeilen={daten.positionen}
            schluessel={(p) => p.id}
            spalten={[
              { schluessel: 'nr', kopf: 'Nr.', numerisch: true,
                zelle: (p) => String(p.position_nr) },
              { schluessel: 'bez', kopf: 'Bezeichnung', zelle: (p) => p.bezeichnung },
              { schluessel: 'menge', kopf: 'Menge', numerisch: true,
                zelle: (p) => p.menge === null ? '—'
                  : `${formatiereMenge(mengeAusPostgres(p.menge))} ${p.einheit ?? ''}` },
              { schluessel: 'code', kopf: 'BT-130',
                zelle: (p) => p.unece_code ?? (
                  <span className="text-warning" title="Unbestätigter Wert (O-174)">
                    offen
                  </span>
                ) },
              { schluessel: 'preis', kopf: 'Einzelpreis', numerisch: true,
                zelle: (p) => p.einzelpreis_cent === null ? '—'
                  : formatiereGeld(cent(BigInt(p.einzelpreis_cent))) },
              { schluessel: 'satz', kopf: 'USt', numerisch: true,
                zelle: (p) => `${(p.satz_bp / 100).toFixed(2).replace('.', ',')} %` },
              { schluessel: 'netto', kopf: 'Netto', numerisch: true,
                zelle: (p) => p.netto_cent === null ? '—'
                  : formatiereGeld(cent(BigInt(p.netto_cent))) },
            ]}
          />
        </div>
      )}

      <h2 className="mb-s3 text-h3 text-text">Umsatzsteuer je Steuergruppe</h2>
      <table className="mb-s5 w-full max-w-prose border-collapse text-sm">
        <caption className="sr-only">
          Aufschlüsselung nach Steuersätzen (§14 Abs. 4 Nr. 8 UStG)
        </caption>
        <tbody>
          {daten.steuer.map((s) => (
            <tr key={s.gruppe} className="border-b border-line">
              <th scope="row" className="py-s2 text-left font-normal text-text-muted">
                {s.gruppe} ({(s.satz_bp / 100).toFixed(2).replace('.', ',')} %)
              </th>
              <td className="cse-zahl py-s2 text-text">
                {formatiereGeld(cent(BigInt(s.netto_cent)))}
              </td>
              <td className="cse-zahl py-s2 text-text">
                {formatiereGeld(cent(BigInt(s.steuer_cent)))}
              </td>
            </tr>
          ))}
          <tr className="border-b border-line">
            <th scope="row" className="py-s2 text-left font-normal text-text-muted">Netto</th>
            <td className="cse-zahl py-s2 text-text" colSpan={2}>
              {formatiereGeld(cent(BigInt(k.netto_gesamt_cent)))}
            </td>
          </tr>
          <tr className="border-b border-line">
            <th scope="row" className="py-s2 text-left font-normal text-text-muted">
              Umsatzsteuer
            </th>
            <td className="cse-zahl py-s2 text-text" colSpan={2}>
              {formatiereGeld(cent(BigInt(k.steuer_gesamt_cent)))}
            </td>
          </tr>
          <tr>
            <th scope="row" className="py-s2 text-left text-text">Brutto</th>
            <td className="cse-zahl py-s2 font-semibold text-text" colSpan={2}>
              {formatiereGeld(cent(BigInt(k.brutto_cent)))}
            </td>
          </tr>
        </tbody>
      </table>

      {entwurf ? (
        <>
          <h2 className="mb-s3 text-h3 text-text">Position hinzufügen</h2>
          <form
            method="post"
            action={`/api/rechnungen?mandant=${mandant}`}
            className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="aktion" value="position" />
            <input type="hidden" name="rechnungId" value={k.id} />

            <label className="block text-sm text-text" htmlFor="bezeichnung">
              Handelsübliche Bezeichnung
            </label>
            <input id="bezeichnung" name="bezeichnung" type="text" required className={feld} />

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                {/*
                  * Die Menge wird in TAUSENDSTELN eingegeben, der Preis in
                  * CENT. Beides sind ganze Zahlen — K-16 und Invariante 1 —
                  * und eine Umrechnung in der Oberflaeche waere genau die
                  * Gleitkommastelle, die diese Plattform nicht hat.
                  */}
                <label className="block text-sm text-text" htmlFor="menge">
                  Menge (Tausendstel)
                </label>
                <input id="menge" name="menge" type="number" step="1" required className={feld} />
                <p className="mt-s1 text-xs text-text-muted">30870 = 30,870</p>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="einheit">Einheit</label>
                <select id="einheit" name="einheit" required className={feld}>
                  {daten.einheiten.map((e) => (
                    <option key={e.schluessel} value={e.schluessel}>
                      {e.bezeichnung}{e.ist_platzhalter ? ' — unbestätigter Wert' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="einzelpreisCent">
                  Einzelpreis (Cent)
                </label>
                <input
                  id="einzelpreisCent" name="einzelpreisCent" type="number" step="1" required
                  className={feld}
                />
                <p className="mt-s1 text-xs text-text-muted">1999 = 19,99 €</p>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="steuergruppe">
                  Steuergruppe
                </label>
                <select id="steuergruppe" name="steuergruppe" required className={feld}>
                  {daten.gruppen.map((g) => (
                    <option key={g.schluessel} value={g.schluessel}>{g.bezeichnung}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
            >
              Position hinzufügen
            </button>
          </form>

          <div className="flex flex-wrap gap-s5">
            <form
              method="post"
              action={`/api/rechnungen/festschreiben?mandant=${mandant}`}
              className="rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="rechnungId" value={k.id} />
              <h2 className="text-h3 text-text">Festschreiben</h2>
              <p className="mt-s2 max-w-prose text-sm text-text-muted">
                Vergibt die nächste Nummer aus dem Kreis dieser Gesellschaft und
                schreibt den Kettensatz — in derselben Transaktion.
                <strong className="text-text"> Danach ist der Beleg unveränderlich.</strong>
                {' '}Eine Korrektur ist dann ein Storno mit Neuausstellung.
              </p>
              <button
                type="submit"
                disabled={daten.positionen.length === 0}
                className="mt-s4 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                Rechnung festschreiben
              </button>
            </form>

            <form
              method="post"
              action={`/api/rechnungen/verwerfen?mandant=${mandant}`}
              className="rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="rechnungId" value={k.id} />
              <h2 className="text-h3 text-text">Verwerfen</h2>
              <p className="mt-s2 max-w-prose text-sm text-text-muted">
                Der Entwurf wird nicht gelöscht — er bleibt mit Grund stehen und
                kostet keine Nummer.
              </p>
              <label className="mt-s4 block text-sm text-text" htmlFor="grund">Grund</label>
              <input id="grund" name="grund" type="text" required className={feld} />
              <button
                type="submit"
                className="mt-s4 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
              >
                Entwurf verwerfen
              </button>
            </form>
          </div>
        </>
      ) : (
        <>
          <h2 className="mb-s3 text-h3 text-text">Kettenbindung</h2>
          <p className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {k.hash === null ? 'Kein Kettensatz — das darf nicht vorkommen.' : (
              <>
                Position {k.kette_position} der Kette,{' '}
                <code className="break-all text-xs text-text">{k.hash}</code>
              </>
            )}
          </p>

          {k.status === 'festgeschrieben' && k.storniert_durch === null ? (
            <form
              method="post"
              action={`/api/rechnungen/storno?mandant=${mandant}`}
              className="max-w-prose rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="rechnungId" value={k.id} />
              <h2 className="text-h3 text-text">Korrigieren</h2>
              <p className="mt-s2 text-sm text-text-muted">
                Eine festgeschriebene Rechnung wird nicht geändert. Die
                stornierende Buchung erzeugt einen eigenen Beleg mit eigener
                Nummer; die Neuausstellung einen zweiten.
              </p>
              <label className="mt-s4 block text-sm text-text" htmlFor="stornogrund">
                Grund (mindestens zehn Zeichen, auditfähig)
              </label>
              <input
                id="stornogrund" name="grund" type="text" required minLength={10}
                className={feld}
              />
              <label className="mt-s4 block text-sm text-text" htmlFor="form">Form</label>
              <select id="form" name="form" defaultValue="korrektur" className={feld}>
                <option value="korrektur">Storno und Neuausstellung</option>
                <option value="nur_storno">Nur Storno</option>
              </select>
              <button
                type="submit"
                className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
              >
                Stornieren
              </button>
            </form>
          ) : null}
        </>
      )}
    </PortalRahmen>
  );
}
