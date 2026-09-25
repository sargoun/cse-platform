import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereIban } from '@/server/services/finanz/zahlung/iban';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { MAHNUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/mahnungen';
import { ZAHLUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/zahlungen';

/**
 * `/portal/[mandant]/finanzen/zahlungen/[id]` — eine Zahlung und wohin sie
 * gegangen ist (FIN-14, ACC-04).
 *
 * **Der Bildschirm, der die Frage „wo ist das Geld hin" beantwortet.** Eine
 * Überweisung deckt oft mehrere Rechnungen, und ein Teil davon ist manchmal
 * gar kein Geld — ein Skonto nach §17 UStG, eine Bankgebühr, ein abgeschriebener
 * Rest. Ohne diese Liste steht in den Büchern eine Summe, deren Verbleib
 * niemand nachvollziehen kann.
 *
 * **Zurückgenommen wird durch STORNO, nie durch Löschen** (Invariante 8). Der
 * Auslöser aus 0121 gibt die Posten anschließend von selbst wieder frei.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly id: string;
  readonly zahlungsdatum: string;
  readonly valuta: string | null;
  readonly betrag_cent: string;
  readonly zahlungsmittel: string;
  readonly referenz: string | null;
  readonly notiz: string | null;
  readonly storniert_am: string | null;
  readonly storno_grund: string | null;
  readonly konto: string | null;
  readonly iban: string | null;
  readonly richtung: string;
}

interface ZuordnungZeile {
  readonly id: string;
  readonly art: string;
  readonly betrag_cent: string;
  readonly notiz: string | null;
  readonly rechnungsnummer: string | null;
  readonly posten_art: string;
}

export default async function ZahlungDetail(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/zahlungen/[id]`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(MAHNUNGEN_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);
  /*
   * Die Wörter, die dieser Beleg mit der Zahlungsliste teilt — vor allem die
   * fünf Zahlungsmittel —, kommen aus DEREN Tabelle. Zweimal dieselbe
   * `lastschrift` wäre zweimal die Gelegenheit, sie nur einmal zu ändern.
   */
  const tz = nachSprache(ZAHLUNGEN_TEXTE, zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kopf: (await kontext.abfrage<Kopf>(
        `select z.id, to_char(z.zahlungsdatum, 'DD.MM.YYYY') as zahlungsdatum,
                to_char(z.valuta, 'DD.MM.YYYY') as valuta, z.betrag_cent::text,
                z.zahlungsmittel::text as zahlungsmittel, z.referenz, z.notiz,
                to_char(z.storniert_am, 'DD.MM.YYYY') as storniert_am, z.storno_grund,
                b.bezeichnung as konto, b.iban, z.richtung::text as richtung
           from zahlung z
           left join bankkonto b on b.id = z.bankkonto_id and b.mandant_id = z.mandant_id
          where z.id = $1::uuid`, [id]))[0] ?? null,
      zeilen: await kontext.abfrage<ZuordnungZeile>(
        `select zz.id, zz.art::text as art, zz.betrag_cent::text, zz.notiz,
                -- V-216: auf der Kreditorenseite die Nummer des Lieferanten
                coalesce(r.nummer, er.rechnungsnummer_lieferant, er.interne_belegnummer)
                  as rechnungsnummer,
                op.art::text as posten_art
           from zahlung_zuordnung zz
           join offener_posten op on op.id = zz.offener_posten_id
                                 and op.mandant_id = zz.mandant_id
           left join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
           left join eingangsrechnung er on er.id = op.eingangsrechnung_id
                                        and er.mandant_id = op.mandant_id
          where zz.zahlung_id = $1::uuid
          order by zz.erstellt_am`, [id]),
    }))) as Promise<{ kopf: Kopf | null; zeilen: readonly ZuordnungZeile[] }>);

  if (daten.kopf === null) notFound();
  const kopf = daten.kopf;

  const verteilt = daten.zeilen
    .filter((z) => ['zahlung', 'mahngebuehr', 'zins', 'ueberzahlung'].includes(z.art))
    .reduce((s, z) => s + BigInt(z.betrag_cent), 0n);
  const rest = BigInt(kopf.betrag_cent) - verteilt;

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/finanzen/zahlungen`, text: tz.titel }}
      titel={`${t.zahlung} ${t.vom} ${kopf.zahlungsdatum}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zahlungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">
          {formatiereGeld(cent(BigInt(kopf.betrag_cent)))} {t.vom} {kopf.zahlungsdatum}
        </h1>
        {kopf.storniert_am === null ? null
          : <StatusPill zustand="Archiviert" sprache={zugang.sprache} />}
      </div>

      {kopf.storniert_am === null ? null : (
        <p className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          {t.storniertAmVor} {kopf.storniert_am}: {kopf.storno_grund}
          {t.storniertAmNach}
        </p>
      )}

      <dl className="mb-s7 grid max-w-prose grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">{t.richtung}</dt>
          <dd className="text-text" data-cse="zahlung-richtung">
            {kopf.richtung === 'ausgang' ? t.richtungAusgang : t.richtungEingang}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{tz.zahlungsmittel}</dt>
          <dd className="text-text">
            {tz.mittelNamen[kopf.zahlungsmittel as keyof typeof tz.mittelNamen]
              ?? kopf.zahlungsmittel}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t.wertstellung}</dt>
          <dd className="text-text">{kopf.valuta ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t.konto}</dt>
          <dd className="text-text">
            {kopf.konto === null ? '—' : `${kopf.konto} · ${formatiereIban(kopf.iban ?? '')}`}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{tz.referenz}</dt>
          <dd className="text-text">{kopf.referenz ?? '—'}</dd>
        </div>
      </dl>

      <section aria-labelledby="zuordnung-titel" className="mb-s7">
        <h2 id="zuordnung-titel" className="mb-s3 text-h2 text-text">{t.zuordnungTitel}</h2>
        {daten.zeilen.length === 0 ? (
          <p className="rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
            {t.keineZuordnung}
          </p>
        ) : (
          <>
            <DataTable
              beschriftung={t.tabelleZuordnung}
              zeilen={daten.zeilen}
              schluessel={(z) => z.id}
              spalten={[
                {
                  schluessel: 'art', kopf: g.art,
                  zelle: (z) => t.zuordnungsarten[z.art as keyof typeof t.zuordnungsarten]
                    ?? z.art,
                },
                {
                  schluessel: 'beleg', kopf: t.beleg,
                  zelle: (z) => z.rechnungsnummer
                    ?? (z.posten_art === 'debitor_guthaben' ? t.guthabenDesKunden
                      : z.posten_art === 'kreditor_guthaben' ? t.guthabenBeimLieferanten : '—'),
                },
                {
                  schluessel: 'betrag', kopf: g.betrag, numerisch: true,
                  zelle: (z) => formatiereGeld(cent(BigInt(z.betrag_cent))),
                },
                {
                  schluessel: 'notiz', kopf: t.begruendung,
                  zelle: (z) => z.notiz ?? <span className="text-text-subtle">—</span>,
                },
              ]}
            />
            {rest === 0n ? null : (
              <p className="mt-s3 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
                {formatiereGeld(cent(rest))} {t.restOhneForderung}
              </p>
            )}
          </>
        )}
      </section>

      {kopf.storniert_am !== null ? null : (
        <section aria-labelledby="storno-titel">
          <h2 id="storno-titel" className="mb-s3 text-h2 text-text">{t.stornoTitel}</h2>
          <form
            method="post"
            action={`/api/finanzen/zahlungen?mandant=${mandant}`}
            className="max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="aktion" value="stornieren" />
            <input type="hidden" name="zahlungId" value={kopf.id} />
            <label className="block text-sm text-text" htmlFor="grund">
              {t.stornoGrundLabel}
            </label>
            <input
              id="grund" name="grund" type="text" required minLength={5}
              placeholder={t.stornoPlatzhalter} className={feld}
            />
            <p className="mt-s2 max-w-prose text-xs text-text-muted">
              {t.stornoErklaerung}
            </p>
            <button
              type="submit"
              className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
            >
              {t.stornieren}
            </button>
          </form>
        </section>
      )}
    </PortalRahmen>
  );
}
