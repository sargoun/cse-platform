import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { ladeKalkulationsgrundlage } from '@/server/services/kalkulation/raumbuch';
import { kalkuliere } from '@/server/services/kalkulation/index';
import { alsStundenText } from '@/server/services/kalkulation/richtzeit';
import { PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF, PLATZHALTER_TURNUSSE }
  from '@/server/services/kalkulation/tarif';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/objekte/[id]/raumbuch` — OPS-02 und das
 * Abnahmekriterium der Phase 4: ein Reinigungspreis, ohne Handrechnung.
 *
 * Die Seite tut zwei Dinge und haelt sie sichtbar auseinander:
 *
 *  1. Sie ZEIGT das Raumbuch — Raum, Etage, Fläche, Belag, Klasse.
 *  2. Sie RECHNET daraus die Richtzeit und den Preis. Keine Zahl entsteht in
 *     dieser Datei: sie kommen aus `services/kalkulation`, wo sie geprueft
 *     sind (Invariante 6).
 *
 * **Der Platzhalterhinweis ist nicht schmueckend.** Stundensatz, Zuschlaege
 * und die Umrechnung Turnus → Faktor sind offene Fragen; ein Preis, der so
 * aussieht wie ein entschiedener Preis, ist der teuerste Fehler dieser Seite.
 * Deshalb steht die Warnung ueber dem Betrag, nicht darunter.
 */
export const dynamic = 'force-dynamic';

const TURNUS_LABEL: Readonly<Record<string, string>> = {
  '5_pro_woche': '5× pro Woche',
  '3_pro_woche': '3× pro Woche',
  '2_pro_woche': '2× pro Woche',
  '1_pro_woche': 'wöchentlich',
  '14_taegig': '14-täglich',
  '1_pro_monat': 'monatlich',
  '1_pro_quartal': 'quartalsweise',
  '1_pro_jahr': 'jährlich',
  einmalig: 'einmalig',
};

interface RaumZeile {
  readonly id: string;
  readonly raumnummer: string | null;
  readonly bezeichnung: string | null;
  readonly etage: string | null;
  readonly nutzungsart: string | null;
  readonly flaeche_qm: string;
  readonly fenster_flaeche_qm: string | null;
  readonly belagsart: string | null;
  readonly reinigungsklasse: string | null;
}

export default async function Raumbuch(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  const gewuenscht = typeof suche['turnus'] === 'string' ? suche['turnus'] : '1_pro_monat';
  // Ein unbekannter Turnus aus der Adresszeile bekommt keinen Ersatzwert und
  // auch keine Fehlerseite: er faellt auf den Vorgabewert zurueck, und die
  // Auswahl darunter zeigt, womit tatsaechlich gerechnet wurde.
  const turnus = PLATZHALTER_TURNUSSE.includes(gewuenscht) ? gewuenscht : '1_pro_monat';

  const pfad = `/portal/${mandant}/objekte/${id}/raumbuch`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  const mandantId = sitzung.aktiverMandantId;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [objekt] = await kontext.abfrage<{
        id: string; bezeichnung: string; kunde_id: string | null;
      }>(
        `select id, bezeichnung, kunde_id from objekt where id = $1`, [id],
      );
      if (objekt === undefined) return null;

      const raeume = await kontext.abfrage<RaumZeile>(
        `select r.id, r.raumnummer, r.bezeichnung, r.etage, r.nutzungsart,
                r.flaeche_qm::text, r.fenster_flaeche_qm::text,
                b.bezeichnung as belagsart, rk.bezeichnung as reinigungsklasse
           from raum r
           left join belagsart b on b.id = r.belagsart_id
           left join reinigungsklasse rk on rk.id = r.reinigungsklasse_id
          where r.objekt_id = $1 and r.archiviert_am is null
          order by r.sortierung, r.etage nulls last, r.raumnummer nulls last`,
        [id],
      );
      const grundlage = await ladeKalkulationsgrundlage(kontext, id, new Date());
      return { objekt, raeume, grundlage };
    })) as Promise<{
      objekt: { id: string; bezeichnung: string; kunde_id: string | null };
      raeume: readonly RaumZeile[];
      grundlage: Awaited<ReturnType<typeof ladeKalkulationsgrundlage>>;
    } | null>);

  if (daten === null) notFound();
  const { objekt, raeume, grundlage } = daten;

  const kalkulation = kalkuliere({
    posten: grundlage.posten,
    frequenz: PLATZHALTER_FREQUENZ.frequenz(turnus),
    tarif: PLATZHALTER_TARIF.tarif(mandantId, 'reinigung'),
    flaecheOhneBelagsart: grundlage.flaecheOhneBelagsart,
  });

  return (
    <PortalRahmen
      titel={`Raumbuch · ${objekt.bezeichnung}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="objekte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/objekte/${id}`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {objekt.bezeichnung}
        </Link>
      </nav>
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Raumbuch</h1>
        <Link
          href={`/portal/${mandant}/objekte/${id}/raumbuch/import`}
          data-cse="zum-import"
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
        >
          Aus Datei importieren
        </Link>
      </div>

      {raeume.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Raum erfasst. Ohne Raumbuch gibt es keine Fläche, und ohne
          Fläche keine Kalkulation.
        </p>
      ) : (
        <section data-cse="raumbuch-tabelle">
        <DataTable
          beschriftung="Räume dieses Objekts mit Fläche, Belagsart und Reinigungsklasse"
          zeilen={raeume}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'etage', kopf: 'Etage', zelle: (z) => z.etage ?? '—' },
            {
              // Nur die Nummer. Sie hier auf die Bezeichnung zurueckfallen zu
              // lassen, schriebe denselben Text zweimal in dieselbe Zeile —
              // und liesse einen Raum ohne Nummer wie einen mit aussehen.
              schluessel: 'raum',
              kopf: 'Raum',
              zelle: (z) => z.raumnummer ?? <span className="text-text-subtle">ohne Nummer</span>,
            },
            {
              schluessel: 'bezeichnung',
              kopf: 'Bezeichnung',
              zelle: (z) => z.bezeichnung ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'nutzung',
              kopf: 'Nutzung',
              zelle: (z) => z.nutzungsart ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'flaeche',
              kopf: 'Fläche m²',
              numerisch: true,
              zelle: (z) => formatiereMenge(mengeAusPostgresOderNull(z.flaeche_qm)),
            },
            {
              schluessel: 'fenster',
              kopf: 'Glas m²',
              numerisch: true,
              zelle: (z) => (z.fenster_flaeche_qm === null
                ? <span className="text-text-subtle">—</span>
                : formatiereMenge(mengeAusPostgresOderNull(z.fenster_flaeche_qm))),
            },
            {
              schluessel: 'belag',
              kopf: 'Belag',
              zelle: (z) => z.belagsart ?? (
                <span className="text-warning">ohne Belagsart</span>
              ),
            },
            {
              schluessel: 'klasse',
              kopf: 'Klasse',
              zelle: (z) => z.reinigungsklasse ?? <span className="text-text-subtle">—</span>,
            },
          ]}
        />
        </section>
      )}

      <section aria-labelledby="kalkulation" className="mt-s7">
        <h2 id="kalkulation" className="text-h2 text-text">Kalkulation</h2>
        <p className="text-sm text-text-muted">
          Σ (m² ÷ Leistungswert) × Frequenzfaktor — gerechnet, nicht geschätzt.
        </p>

        <nav aria-label="Turnus" className="my-s4 flex flex-wrap gap-s2">
          {PLATZHALTER_TURNUSSE.map((t) => (
            <Link
              key={t}
              href={{ pathname: pfad, query: { turnus: t } }}
              aria-current={t === turnus ? 'true' : undefined}
              className={[
                'inline-flex min-h-11 items-center rounded-full px-s4 text-xs',
                t === turnus
                  ? 'bg-white text-ink'
                  : 'bg-surface-3 text-text-muted hover:text-text',
              ].join(' ')}
            >
              {TURNUS_LABEL[t] ?? t}
            </Link>
          ))}
        </nav>

        {kalkulation.istPlatzhalter ? (
          <p
            data-cse="platzhalter-hinweis"
            className="rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
          >
            <strong>Platzhalterwerte.</strong> Stundenverrechnungssatz und
            Zuschläge ({kalkulation.offeneFragen.join(', ')}) sind noch nicht
            entschieden. Diese Summe ist eine Rechnung mit vorläufigen Sätzen —
            kein Angebotspreis.
          </p>
        ) : null}

        {grundlage.flaecheOhneBelagsart > 0n ? (
          <p
            data-cse="ohne-belagsart"
            className="mt-s3 rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
          >
            {formatiereMenge(grundlage.flaecheOhneBelagsart)} m² tragen keine
            Belagsart und sind deshalb NICHT in dieser Summe enthalten.
          </p>
        ) : null}

        {grundlage.ohneGueltigenLeistungswert.length > 0 ? (
          <p
            data-cse="ohne-leistungswert"
            className="mt-s3 rounded-md border border-danger bg-danger-soft p-s4 text-sm text-danger"
          >
            {grundlage.ohneGueltigenLeistungswert.length} Belagsart(en) haben
            heute keinen gültigen Leistungswert. Die zugehörige Fläche fehlt in
            der Summe.
          </p>
        ) : null}

        {kalkulation.zeilen.length === 0 ? (
          <p className="mt-s4 text-sm text-text-muted">
            Nichts zu rechnen: keine Fläche mit gültiger Belagsart.
          </p>
        ) : (
          <>
            <div className="mt-s4">
              <DataTable
                beschriftung="Richtzeit und Lohnkosten je Belagsart"
                zeilen={kalkulation.zeilen}
                schluessel={(z) => z.belagsartId}
                spalten={[
                  { schluessel: 'belag', kopf: 'Belagsart', zelle: (z) => z.bezeichnung },
                  {
                    schluessel: 'flaeche',
                    kopf: 'Fläche m²',
                    numerisch: true,
                    zelle: (z) => formatiereMenge(z.flaeche),
                  },
                  {
                    schluessel: 'wert',
                    kopf: 'Leistung m²/h',
                    numerisch: true,
                    zelle: (z) => formatiereMenge(z.leistungswert),
                  },
                  {
                    schluessel: 'durchgang',
                    kopf: 'Std./Durchgang',
                    numerisch: true,
                    zelle: (z) => alsStundenText(z.sekundenJeDurchgang),
                  },
                  {
                    schluessel: 'periode',
                    kopf: 'Std./Periode',
                    numerisch: true,
                    zelle: (z) => alsStundenText(z.sekundenJePeriode),
                  },
                  {
                    schluessel: 'lohn',
                    kopf: 'Lohnkosten',
                    numerisch: true,
                    zelle: (z) => formatiereGeld(z.lohnkosten),
                  },
                ]}
              />
            </div>

            <dl
              data-cse="kalkulation-summe"
              className="m-0 mt-s5 grid grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2"
            >
              <dt className="text-sm text-text-muted">Richtzeit je Periode</dt>
              <dd className="m-0 cse-zahl text-sm text-text">
                {alsStundenText(kalkulation.sekundenJePeriode)} Std.
              </dd>
              <dt className="text-sm text-text-muted">Lohnkosten</dt>
              <dd className="m-0 cse-zahl text-sm text-text">
                {formatiereGeld(kalkulation.lohnkosten)}
              </dd>
              <dt className="text-sm text-text-muted">Gemeinkosten</dt>
              <dd className="m-0 cse-zahl text-sm text-text">
                {formatiereGeld(kalkulation.gemeinkosten)}
              </dd>
              <dt className="text-sm text-text-muted">Wagnis</dt>
              <dd className="m-0 cse-zahl text-sm text-text">
                {formatiereGeld(kalkulation.wagnis)}
              </dd>
              <dt className="text-sm text-text-muted">Gewinn</dt>
              <dd className="m-0 cse-zahl text-sm text-text">
                {formatiereGeld(kalkulation.gewinn)}
              </dd>
              <dt className="text-h3 text-text">Netto je Periode</dt>
              <dd data-cse="netto" className="m-0 cse-zahl text-h3 text-text">
                {formatiereGeld(kalkulation.netto)}
              </dd>
            </dl>
            <p className="mt-s2 text-xs text-text-muted">
              Netto — die Umsatzsteuer entsteht erst auf der Rechnung, je
              Steuersatzgruppe.
            </p>

            {/*
              Der Uebergang vom Rechnen zum Anbieten.

              Er ist ein POST und kein Link: aus einer Rechnung ein Angebot zu
              machen legt einen Datensatz an, und eine Adresse, die das tut,
              wird von jedem Vorschau-Abruf ausgeloest.

              Ohne Kundenbezug am Objekt fehlt dem Angebot sein Empfaenger.
              Statt einen zu erfinden, sagt die Seite, was fehlt.
            */}
            {objekt.kunde_id === null ? (
              <p
                data-cse="ohne-kunde"
                className="mt-s5 rounded-md border border-line bg-surface p-s4 text-sm text-text-muted"
              >
                Dieses Objekt hat keinen Kundenbezug — ohne ihn hat ein Angebot
                keinen Empfänger. Erst den Kunden am Objekt hinterlegen.
              </p>
            ) : (
              <form
                method="post"
                action={`/api/angebot?mandant=${mandant}`}
                className="mt-s5"
              >
                <input type="hidden" name="aktion" value="aus_raumbuch" />
                <input type="hidden" name="objektId" value={id} />
                <input type="hidden" name="kundeId" value={objekt.kunde_id} />
                <input type="hidden" name="turnus" value={turnus} />
                <input
                  type="hidden"
                  name="titel"
                  value={`Unterhaltsreinigung ${objekt.bezeichnung}`}
                />
                <button
                  type="submit"
                  data-cse="angebot-erzeugen"
                  className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
                >
                  Angebot aus dieser Kalkulation
                </button>
              </form>
            )}
          </>
        )}
      </section>
    </PortalRahmen>
  );
}
