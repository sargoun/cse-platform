import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/angebote/[id]/kalkulation` — der Rechenweg, und der
 * Ort, an dem aus geschaetzten Werten verantwortete werden (OPS-07).
 *
 * Diese Seite ist die Gegenseite der Sperre: `kern.angebot_versand_pruefen`
 * laesst kein Angebot hinaus, dessen Preis auf O-16 und O-17 ruht, und ohne
 * einen Weg, die Werte zu bestaetigen, waere das eine Sackgasse.
 *
 * Sie zeigt zuerst, WORAUF der Preis beruht — Flaeche, Leistungswert,
 * Stunden, Stundensatz, je Zeile — und erst dann das Formular. Wer Zahlen
 * bestaetigt, ohne den Rechenweg gesehen zu haben, bestaetigt eine
 * Ueberschrift.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly id: string;
  readonly titel: string;
  readonly status: string;
  readonly kalkulation_id: string | null;
  readonly kalkulation_status: string | null;
  readonly ist_platzhalter: boolean | null;
  readonly satz_cent: string | null;
  readonly gemeinkosten_basis: string | null;
  readonly gemeinkosten_bp: number | null;
  readonly wagnis_gewinn_bp: number | null;
  readonly bemerkung: string | null;
  readonly versendet: boolean;
  readonly leistungswert_offen: boolean;
  readonly frequenz_offen: boolean;
}

interface Zeile {
  readonly id: string;
  readonly position_nr: number;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelbetrag_cent: string | null;
  readonly betrag_cent: string;
  readonly leistungswert: string | null;
  readonly berechnungsweg: string;
}

/** Basispunkte als deutsche Prozentanzeige: `1550` → `15,5`. */
function alsProzent(bp: number | null): string {
  if (bp === null) return '';
  const ganz = Math.trunc(bp / 100);
  const rest = bp % 100;
  return rest === 0 ? String(ganz) : `${String(ganz)},${String(rest).padStart(2, '0')}`;
}

export default async function KalkulationSeite(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/angebote/${id}/kalkulation`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'angebot.lesen');
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select a.id, a.titel, a.status::text as status,
                k.id as kalkulation_id, k.status::text as kalkulation_status,
                k.ist_platzhalter, k.stundenverrechnungssatz_cent::text as satz_cent,
                k.gemeinkosten_basis::text as gemeinkosten_basis,
                k.gemeinkosten_bp, k.wagnis_gewinn_bp, k.bemerkung,
                (a.versendet_am is not null) as versendet,
                exists (select 1 from kalkulation_position p
                         where p.kalkulation_id = k.id
                           and p.leistungswert_ist_platzhalter)
                  as leistungswert_offen,
                coalesce(k.frequenz_ist_platzhalter, false) as frequenz_offen
           from angebot a
           join kunde ku on ku.id = a.kunde_id
           left join kalkulation k on k.angebot_id = a.id
          where a.id = $1`, [id]);
      if (kopf === undefined) return null;
      const zeilen = kopf.kalkulation_id === null ? [] : await kontext.abfrage<Zeile>(
        `select id, position_nr, bezeichnung, menge::text, einheit,
                einzelbetrag_cent::text, betrag_cent::text,
                leistungswert_qm_pro_stunde::text as leistungswert, berechnungsweg
           from kalkulation_position
          where kalkulation_id = $1 order by position_nr`, [kopf.kalkulation_id]);
      return { kopf, zeilen };
    })) as Promise<{ kopf: Kopf; zeilen: readonly Zeile[] } | null>);

  if (daten === null) notFound();
  const { kopf, zeilen } = daten;
  const offen = kopf.ist_platzhalter === true || kopf.leistungswert_offen
    || kopf.frequenz_offen;
  const eingefroren = kopf.kalkulation_status === 'festgeschrieben' || kopf.versendet;

  return (
    <PortalRahmen
      titel={`Kalkulation — ${kopf.titel}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={eingefroren}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="angebote"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {/*
        * Das Angebot dahinter öffnet mit `angebot.lesen` (Manifest); diese
        * Seite mit `kalkulation.lesen`. Zwei Rechte, je Mandant getrennt
        * entziehbar — ohne das erste führte „Zum Angebot" auf 404 und verriet
        * damit, was es nicht zeigen darf (AUT-06, D-581).
        */}
      {darf['angebot.lesen'] === true && (
        <nav aria-label="Zurück" className="mb-s3">
          <Link
            href={`/portal/${mandant}/angebote/${id}`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            ← Zum Angebot
          </Link>
        </nav>
      )}

      <h1 className="mb-s4 text-h1 text-text">Kalkulation</h1>

      {kopf.kalkulation_id === null ? (
        <p data-cse="keine-kalkulation" className="max-w-[72ch] text-base text-text-muted">
          Zu diesem Angebot gibt es keine Kalkulation. Angebote, die aus einem
          Raumbuch entstehen, bringen eine mit; ein von Hand angelegtes Angebot
          trägt seinen Preis dagegen selbst.
        </p>
      ) : (
        <>
          <section aria-labelledby="rechenweg" className="mb-s7">
            <h2 id="rechenweg" className="text-h2 text-text">Der Rechenweg</h2>
            <DataTable
              beschriftung="Positionen dieser Kalkulation"
              zeilen={zeilen}
              schluessel={(z) => z.id}
              spalten={[
                {
                  schluessel: 'nr', kopf: 'Pos.', numerisch: true,
                  zelle: (z) => String(z.position_nr),
                },
                { schluessel: 'was', kopf: 'Belagsart', zelle: (z) => z.bezeichnung },
                {
                  schluessel: 'lw', kopf: 'Leistungswert', numerisch: true,
                  zelle: (z) => (z.leistungswert === null ? '—' : `${z.leistungswert} m²/h`),
                },
                {
                  schluessel: 'menge', kopf: 'Stunden', numerisch: true,
                  zelle: (z) => `${z.menge ?? '—'} ${z.einheit ?? ''}`,
                },
                {
                  schluessel: 'satz', kopf: 'Stundensatz', numerisch: true,
                  zelle: (z) => (z.einzelbetrag_cent === null
                    ? '—' : formatiereGeld(cent(BigInt(z.einzelbetrag_cent)))),
                },
                {
                  schluessel: 'betrag', kopf: 'Lohnkosten', numerisch: true,
                  zelle: (z) => formatiereGeld(cent(BigInt(z.betrag_cent))),
                },
              ]}
            />
          </section>

          {offen ? (
            <p
              data-cse="kalkulation-offen"
              className="mb-s5 rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
            >
              <strong>Dieser Preis ruht auf unbestätigten Werten.</strong>{' '}
              {kopf.bemerkung ?? 'Stundenverrechnungssatz und Zuschläge (O-16)'}
              {kopf.leistungswert_offen
                ? ' — dazu der Reinigungsrichtwert je Belagsart (O-17).'
                : '.'}{' '}
              Solange das so ist, lässt sich das Angebot nicht versenden.
            </p>
          ) : (
            <p
              data-cse="kalkulation-bestaetigt"
              className="mb-s5 rounded-md border border-line bg-surface-2 p-s4 text-sm text-text"
            >
              Die Werte dieser Kalkulation sind bestätigt. Das Angebot kann versendet werden.
            </p>
          )}

          {eingefroren ? (
            <p data-cse="kalkulation-eingefroren" className="text-sm text-text-muted">
              Das Angebot ist versendet; die Kalkulation ist damit eingefroren und
              wird nicht mehr geändert. Ein anderer Preis braucht ein neues Angebot.
            </p>
          ) : (
            <form
              method="post"
              action={`/api/kalkulation?mandant=${mandant}`}
              data-cse="kalkulation-form"
              className="max-w-[52ch]"
            >
              <h2 className="text-h2 text-text">Werte bestätigen</h2>
              <p className="mb-s4 text-sm text-text-muted">
                Was hier eingetragen wird, gilt für <strong>dieses</strong> Angebot.
                Ein gruppenweiter Tarif ist noch nicht festgelegt (O-16) — bis er
                es ist, entscheidet die Leitung je Angebot, und die Kalkulation
                hält fest, wer wann was bestätigt hat.
              </p>
              <input type="hidden" name="angebotId" value={id} />

              <label className="mb-s4 block text-sm text-text">
                Stundenverrechnungssatz (€)
                <input
                  name="stundensatz"
                  data-cse="feld-stundensatz"
                  required
                  defaultValue={kopf.satz_cent === null
                    ? '' : formatiereGeld(cent(BigInt(kopf.satz_cent))).replace(' €', '')}
                  className="mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 text-text"
                />
              </label>

              <label className="mb-s4 block text-sm text-text">
                Gemeinkosten rechnen auf
                <select
                  name="gemeinkostenBasis"
                  data-cse="feld-basis"
                  required
                  defaultValue={kopf.gemeinkosten_basis ?? 'lohn'}
                  className="mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 text-text"
                >
                  <option value="lohn">Lohnkosten</option>
                  <option value="selbstkosten">Selbstkosten</option>
                  <option value="je_kostenart">je Kostenart</option>
                </select>
              </label>

              <label className="mb-s4 block text-sm text-text">
                Gemeinkostenzuschlag (%)
                <input
                  name="gemeinkosten"
                  data-cse="feld-gemeinkosten"
                  required
                  defaultValue={alsProzent(kopf.gemeinkosten_bp)}
                  className="mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 text-text"
                />
              </label>

              <label className="mb-s4 block text-sm text-text">
                Wagnis und Gewinn (%)
                <input
                  name="wagnisGewinn"
                  data-cse="feld-wagnis"
                  required
                  defaultValue={alsProzent(kopf.wagnis_gewinn_bp)}
                  className="mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 text-text"
                />
              </label>

              {kopf.frequenz_offen ? (
                <label className="mb-s4 block text-sm text-text">
                  Frequenzfaktor je Abrechnungsperiode (O-56)
                  <input
                    name="frequenzFaktor"
                    data-cse="feld-frequenz"
                    required
                    placeholder="z. B. 4,3333 für wöchentlich bei monatlicher Abrechnung"
                    className="mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface px-s3 text-text"
                  />
                  <span className="mt-s1 block text-xs text-text-muted">
                    Wie oft der Turnus in einer Abrechnungsperiode vorkommt. Bisher
                    geschätzt — ohne Ihre Zahl bleibt das Angebot gesperrt.
                  </span>
                </label>
              ) : null}

              {kopf.leistungswert_offen ? (
                <label className="mb-s4 flex items-start gap-s3 text-sm text-text">
                  <input
                    type="checkbox"
                    name="leistungswerte"
                    value="ja"
                    data-cse="feld-leistungswerte"
                    className="mt-1 min-h-5 min-w-5"
                  />
                  <span>
                    Auch die Reinigungsrichtwerte der hier benutzten Belagsarten
                    bestätigen (O-17) — <strong>für dieses Angebot</strong>. Der
                    gemeinsame Katalog bleibt unberührt: andere Kalkulationen auf
                    denselben Belagsarten bleiben gesperrt, bis sie jemand einzeln
                    ansieht.
                  </span>
                </label>
              ) : null}

              <button
                type="submit"
                data-cse="kalkulation-bestaetigen"
                className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
              >
                Werte bestätigen
              </button>
            </form>
          )}
        </>
      )}
    </PortalRahmen>
  );
}
