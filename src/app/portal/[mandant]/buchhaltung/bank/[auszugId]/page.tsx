import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { istUuid } from '@/lib/uuid';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeldIn, type Cent } from '@/server/services/finanz/geld';
import { tagInSprache } from '@/lib/datum/kalendertag';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KONTOAUSZUG_TEXTE } from '@/lib/i18n/verwaltung/finanzen/kontoauszug';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { Hinweis } from '@/components/ui/Hinweis';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/buchhaltung/bank/[auszugId]` — die Zeilen eines Auszugs
 * und warum jede dort steht, wo sie steht (ACC-04).
 *
 * **Jede Zeile trägt ihre Begründung, nicht nur ihren Zustand.** „In Klärung"
 * allein sagt niemandem, was zu tun ist; „Der Betrag passt auf 2 offene
 * Posten, aber im Verwendungszweck steht keine Rechnungsnummer" sagt es.
 * Der Satz stammt aus dem Abgleich und wurde an der Zeile festgehalten —
 * er wird hier nicht neu gebildet.
 *
 * **Die Salden werden verglichen, nicht gerechnet.** Anfangs- und Endsaldo
 * stehen im Auszug; die Summe der Zeilen daneben ist die Probe. Weichen sie
 * ab, fehlt eine Zeile — und das gehört auf den Bildschirm, nicht in ein Log.
 */
export const dynamic = 'force-dynamic';

interface KopfRoh {
  readonly id: string;
  readonly auszug_id: string;
  readonly von: string | null;
  readonly bis: string | null;
  readonly status: string;
  readonly zeilen: number;
  readonly anfangssaldo_cent: string | null;
  readonly endsaldo_cent: string | null;
  readonly bankkonto: string;
  readonly iban: string;
  readonly dokument_id: string | null;
}

interface UmsatzRoh {
  readonly id: string;
  readonly laufnummer: number;
  readonly richtung: string;
  readonly betrag_cent: string;
  readonly buchungsdatum: string;
  readonly valuta: string | null;
  readonly referenz: string | null;
  readonly verwendungszweck: string;
  readonly gegenpartei: string | null;
  readonly gebucht: boolean;
  readonly zustand: string;
  readonly klaerungsnotiz: string | null;
  readonly vorschlag_text: string | null;
  readonly nummer: string | null;
}

const ZUSTAND: Readonly<Record<string, 'Bereit' | 'Abgeschlossen' | 'Wartet' | 'Archiviert'>> = {
  offen: 'Wartet', in_klaerung: 'Wartet',
  zugeordnet: 'Abgeschlossen', ohne_bezug: 'Archiviert',
};

interface PostenAuswahl {
  readonly id: string;
  readonly nummer: string;
  readonly offen_cent: string;
  readonly kunde: string | null;
}

/** Eine offene Verbindlichkeit — was ein Mensch einem Ausgang zuordnen kann (V-216). */
interface KreditorAuswahl {
  readonly id: string;
  readonly nummer: string | null;
  readonly offen_cent: string;
  readonly lieferant: string | null;
}

export default async function BankAuszug(
  { params, searchParams }: {
    params: Promise<{ mandant: string; auszugId: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, auszugId } = await params;
  const suche = await searchParams;
  /* Ein Wort im Pfad ist ein 404, kein 500 — die Umwandlung nach uuid geschieht sonst in der Datenbank. */
  if (!istUuid(auszugId)) notFound();
  const zugang = await portalZugang(
    `/portal/${mandant}/buchhaltung/bank/${auszugId}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<KopfRoh>(
        `select a.id, a.auszug_id, a.von::text, a.bis::text,
                a.status::text as status, a.zeilen,
                a.anfangssaldo_cent::text, a.endsaldo_cent::text, a.dokument_id,
                b.bezeichnung as bankkonto, b.iban
           from kontoauszug a
           join bankkonto b on b.id = a.bankkonto_id and b.mandant_id = a.mandant_id
          where a.id = $1`,
        [auszugId]);
      if (kopf === undefined) {
        return {
          kopf: null, umsaetze: [] as UmsatzRoh[], posten: [] as PostenAuswahl[],
          kreditoren: [] as KreditorAuswahl[],
        };
      }

      const umsaetze = await kontext.abfrage<UmsatzRoh>(
        `select u.id, u.laufnummer, u.richtung::text as richtung,
                u.betrag_cent::text, u.buchungsdatum::text, u.valuta::text,
                u.referenz, u.verwendungszweck, u.gegenpartei, u.gebucht,
                u.zustand::text as zustand, u.klaerungsnotiz, u.vorschlag_text,
                coalesce(r.nummer, er.rechnungsnummer_lieferant, er.interne_belegnummer) as nummer
           from kontoumsatz u
           left join umsatz_zuordnung uz on uz.kontoumsatz_id = u.id
                                        and uz.mandant_id = u.mandant_id
                                        and uz.widerrufen_am is null
           left join zahlung_zuordnung zz on zz.zahlung_id = uz.zahlung_id
                                         and zz.mandant_id = uz.mandant_id
           left join offener_posten op on op.id = zz.offener_posten_id
                                      and op.mandant_id = zz.mandant_id
           left join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
           left join eingangsrechnung er on er.id = op.eingangsrechnung_id
                                        and er.mandant_id = op.mandant_id
          where u.kontoauszug_id = $1
          order by u.laufnummer`,
        [auszugId]);

      /*
       * Die offenen Posten fuer die Klaerung — was ein Mensch einem
       * wartenden Eingang zuordnen kann. Nur offene, nur mit Nummer: ein
       * Entwurf ist keine Forderung.
       */
      const posten = await kontext.abfrage<PostenAuswahl>(
        `select op.id, r.nummer, op.offen_cent::text, k.name as kunde
           from offener_posten op
           join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
           left join kunde k on k.id = r.kunde_id and k.mandant_id = r.mandant_id
          where op.ausgeglichen_am is null and op.offen_cent > 0 and r.nummer is not null
          order by r.nummer
          limit 200`);
      /*
       * Die offenen Verbindlichkeiten fuer einen Ausgang (V-216) — die
       * Kreditorposten gebuchter Eingangsrechnungen, mit der Nummer des
       * Lieferanten, wie sie im Verwendungszweck steht.
       */
      const kreditoren = await kontext.abfrage<KreditorAuswahl>(
        `select op.id, coalesce(er.rechnungsnummer_lieferant, er.interne_belegnummer) as nummer,
                op.offen_cent::text, l.name as lieferant
           from offener_posten op
           join eingangsrechnung er on er.id = op.eingangsrechnung_id
                                   and er.mandant_id = op.mandant_id
           left join lieferant l on l.id = op.lieferant_id and l.mandant_id = op.mandant_id
          where op.art = 'kreditor' and op.ausgeglichen_am is null and op.offen_cent > 0
          order by l.name nulls last, er.rechnungsdatum nulls last
          limit 200`);
      return { kopf, umsaetze, posten, kreditoren };
    }))) as { kopf: KopfRoh | null; umsaetze: readonly UmsatzRoh[];
      posten: readonly PostenAuswahl[]; kreditoren: readonly KreditorAuswahl[] };

  if (daten.kopf === null) notFound();
  const k = daten.kopf;

  /*
   * Die Probe: Anfangssaldo plus die Summe der Zeilen muss der Endsaldo sein.
   * Kein Rechnen im Sinne von Invariante 6 — zwei gespeicherte Cent-Beträge
   * zu addieren ist eine Kontrolle, keine Bildung einer neuen Zahl.
   */
  /*
   * Nur GEBUCHTE Zeilen: eine Vormerkung (`PDNG`) steht im Auszug, aber noch
   * nicht im Schlusssaldo — mit ihr in der Summe meldete die Probe eine
   * fehlende Zeile, die keine ist.
   */
  const bewegung = daten.umsaetze.filter((u) => u.gebucht).reduce(
    (s, u) => s + (u.richtung === 'eingang' ? BigInt(u.betrag_cent) : -BigInt(u.betrag_cent)),
    0n);
  const anfang = k.anfangssaldo_cent === null ? null : BigInt(k.anfangssaldo_cent);
  const ende = k.endsaldo_cent === null ? null : BigInt(k.endsaldo_cent);
  const stimmt = anfang !== null && ende !== null && anfang + bewegung === ende;
  const pruefbar = anfang !== null && ende !== null;

  /*
   * Die Sprache dieser Sitzung (V-217, D-710) — vorher war das Blatt ganz
   * deutsch, auch die mit V-216 neue Maske für den Ausgang. Tage und Beträge
   * in der Schreibweise der Sprache.
   */
  const t = nachSprache(KONTOAUSZUG_TEXTE, zugang.sprache);
  const geld = (c: Cent): string => formatiereGeldIn(c, zugang.sprache);
  const tag = (d: string | null): string => tagInSprache(d, zugang.sprache);
  /*
   * Rückmeldung und Abweisung sind SCHLÜSSEL (V-217): die Route schickt den
   * Grund, nicht den deutschen Satz des Dienstes. Ein unbekannter Schlüssel
   * wird nie gezeigt (`eigenerEintrag`).
   */
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const meldungText = fehler === null && typeof suche['meldung'] === 'string'
    ? (eigenerEintrag(t.meldungen, suche['meldung']) ?? null) : null;
  const fehlerText = fehler === null ? null : (eigenerEintrag(t.fehler, fehler) ?? t.fehlerSonst);
  const wartend = daten.umsaetze.filter((u) => u.zustand === 'offen' || u.zustand === 'in_klaerung');
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const knopf = 'min-h-11 rounded-md bg-brand px-s4 text-sm font-semibold text-white hover:bg-brand-hover';
  const knopfStill = 'min-h-11 rounded-md border border-line-strong px-s4 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel={`${t.auszug} ${k.auszug_id}`}
      wurzelTitel={t.wurzelTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bank"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{t.auszug} {k.auszug_id}</h1>
        <Link
          href={`/portal/${mandant}/buchhaltung/bank`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          {t.zurListe}
        </Link>
      </div>

      {meldungText !== null ? (
        <Hinweis art="erfolg" rolle="status" cse="bank-meldung" className="mb-s5">
          {meldungText}
          {suche['abgeglichen'] === '1' ? ` ${t.abgeglichen}` : ''}
        </Hinweis>
      ) : null}
      {fehlerText !== null ? (
        <Hinweis art="warnung" rolle="alert" cse="bank-fehler" className="mb-s5">
          {fehlerText}
        </Hinweis>
      ) : null}

      <dl className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        {[
          [t.bankkonto, k.bankkonto],
          [t.iban, k.iban],
          [t.zeitraum, k.von === null ? '—' : `${tag(k.von)} – ${tag(k.bis ?? k.von)}`],
          [t.zeilen, String(k.zeilen)],
          [t.anfangssaldo, anfang === null ? '—' : geld(cent(anfang))],
          [t.endsaldo, ende === null ? '—' : geld(cent(ende))],
        ].map(([titel, wert]) => (
          <div key={titel} className="min-w-0">
            <dt className="text-sm text-text-subtle">{titel}</dt>
            <dd className="break-words text-text">{wert}</dd>
          </div>
        ))}
      </dl>

      {/* Die Probe. */}
      {pruefbar ? (
        <section
          data-cse="bank-saldoprobe"
          data-stimmt={String(stimmt)}
          className={`mb-s7 rounded-lg border p-s5 text-sm ${
            stimmt ? 'border-line bg-surface text-text'
                   : 'border-warning bg-warning-soft text-warning'}`}
        >
          {stimmt
            ? t.probeStimmt(geld(cent(anfang!)), geld(cent(bewegung)))
            : t.probeFehlt(geld(cent(anfang!)), geld(cent(bewegung)),
              geld(cent(anfang! + bewegung)), geld(cent(ende!)))}
        </section>
      ) : null}

      {daten.umsaetze.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.keineZeile}
        </p>
      ) : (
        <DataTable
          beschriftung={t.tabelle}
          zeilen={daten.umsaetze}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'nr', kopf: t.nr, numerisch: true, zelle: (z) => z.laufnummer },
            { schluessel: 'datum', kopf: t.datum, zelle: (z) => tag(z.buchungsdatum) },
            {
              schluessel: 'betrag', kopf: t.betrag, numerisch: true,
              zelle: (z) => (
                <span className={z.richtung === 'eingang' ? 'text-text' : 'text-text-muted'}>
                  {z.richtung === 'eingang' ? '' : '− '}
                  {geld(cent(BigInt(z.betrag_cent)))}
                </span>
              ),
            },
            {
              schluessel: 'partei', kopf: t.gegenpartei,
              zelle: (z) => z.gegenpartei ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'zweck', kopf: t.verwendungszweck,
              zelle: (z) => (
                <span className="break-words">
                  {z.verwendungszweck === '' ? '—' : z.verwendungszweck}
                </span>
              ),
            },
            {
              schluessel: 'zustand', kopf: t.zustand,
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={eigenerEintrag(ZUSTAND, z.zustand) ?? 'Offen'}
                              sprache={zugang.sprache} />
                  {z.gebucht ? null : (
                    <span className="text-xs text-text-muted">{t.vormerkung}</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'begruendung', kopf: t.warum,
              zelle: (z) => {
                if (z.zustand === 'zugeordnet') {
                  return (
                    <span className="text-xs text-text-muted">
                      {z.nummer === null ? t.zugeordnet : t.zugeordnetZu(z.nummer)}
                    </span>
                  );
                }
                if (z.zustand === 'ohne_bezug') {
                  return (
                    <span className="text-xs text-text-muted">{z.klaerungsnotiz}</span>
                  );
                }
                return (
                  <span className="text-xs text-warning">
                    {z.vorschlag_text ?? t.nochNichtAbgeglichen}
                  </span>
                );
              },
            },
          ]}
        />
      )}

      {/*
        * **Die Klaerung — hier entscheidet ein Mensch** (ACC-04).
        *
        * Bis PR 12 (Copilot-Befund) gab es diesen Abschnitt nicht: was der
        * Abgleich nicht eindeutig fand, blieb fuer immer „in Klaerung", und
        * kein Auszug wurde je abgeglichen. Je wartender Zeile zwei Wege:
        * einen offenen Posten bestaetigen oder den Umsatz als „ohne Bezug"
        * vermerken — mit einem Satz, der spaeter allein steht.
        */}
      {wartend.length > 0 ? (
        <section data-cse="bank-klaerung" className="mt-s7">
          <h2 className="mb-s3 text-h2 text-text">{t.klaerung}</h2>
          <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
            {t.wartend(wartend.length)}
          </p>
          <ul className="m-0 flex list-none flex-col gap-s4 p-0">
            {wartend.map((z) => (
              <li key={z.id} data-cse="klaerung-zeile" data-umsatz={z.id}
                  className="rounded-lg border border-line bg-surface p-s5">
                <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
                  <span className="text-sm text-text">
                    {t.nrKurz} {z.laufnummer} · {tag(z.buchungsdatum)} ·{' '}
                    <strong>{z.richtung === 'eingang' ? '' : '− '}{geld(cent(BigInt(z.betrag_cent)))}</strong>
                    {z.gegenpartei === null ? '' : ` · ${z.gegenpartei}`}
                  </span>
                  <span className="text-xs text-warning">{z.vorschlag_text ?? t.nochNichtAbgeglichen}</span>
                </div>
                <p className="mb-s4 text-sm text-text-muted">
                  {z.verwendungszweck === '' ? '—' : z.verwendungszweck}
                </p>
                <div className="grid grid-cols-1 gap-s4 lg:grid-cols-2">
                  {z.richtung === 'eingang' && z.gebucht ? (
                    <form method="post" action="/api/buchhaltung/bank/umsatz"
                          className="flex flex-col gap-s2 sm:flex-row sm:items-end">
                      <input type="hidden" name="mandant" value={mandant} />
                      <input type="hidden" name="auszugId" value={k.id} />
                      <input type="hidden" name="umsatzId" value={z.id} />
                      <input type="hidden" name="aktion" value="zuordnen" />
                      <label className="flex min-w-0 flex-1 flex-col gap-s1 text-sm text-text">
                        {t.offenerPosten}
                        <select name="postenId" required className={feld} defaultValue="">
                          <option value="" disabled>{t.waehlen}</option>
                          {daten.posten.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nummer} · {geld(cent(BigInt(p.offen_cent)))}
                              {p.kunde === null ? '' : ` · ${p.kunde}`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" data-cse="klaerung-zuordnen" className={knopf}
                              disabled={daten.posten.length === 0}>
                        {t.zuordnen}
                      </button>
                    </form>
                  ) : z.richtung === 'ausgang' && z.gebucht ? (
                    /*
                     * **Ein Ausgang an einen Lieferanten** (V-216). Bis hierher
                     * stand hier „Ein Ausgang wird keiner Forderung zugeordnet",
                     * und die bezahlte Eingangsrechnung blieb für immer offen.
                     * Zur Wahl stehen nur Verbindlichkeiten — nie eine
                     * Ausgangsrechnung (die Datenbank weist das ab, 0130).
                     */
                    <form method="post" action="/api/buchhaltung/bank/umsatz"
                          className="flex flex-col gap-s2 sm:flex-row sm:items-end">
                      <input type="hidden" name="mandant" value={mandant} />
                      <input type="hidden" name="auszugId" value={k.id} />
                      <input type="hidden" name="umsatzId" value={z.id} />
                      <input type="hidden" name="aktion" value="zuordnen" />
                      <label className="flex min-w-0 flex-1 flex-col gap-s1 text-sm text-text">
                        {t.offeneVerbindlichkeit}
                        <select name="postenId" required className={feld} defaultValue="">
                          <option value="" disabled>{t.waehlen}</option>
                          {daten.kreditoren.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.lieferant ?? '—'} · {p.nummer ?? '—'} ·{' '}
                              {geld(cent(BigInt(p.offen_cent)))}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" data-cse="klaerung-ausgang" className={knopf}
                              disabled={daten.kreditoren.length === 0}>
                        {t.zuordnen}
                      </button>
                    </form>
                  ) : (
                    <p className="text-sm text-text-subtle">
                      {t.vormerkungWartet}
                    </p>
                  )}
                  <form method="post" action="/api/buchhaltung/bank/umsatz"
                        className="flex flex-col gap-s2 sm:flex-row sm:items-end">
                    <input type="hidden" name="mandant" value={mandant} />
                    <input type="hidden" name="auszugId" value={k.id} />
                    <input type="hidden" name="umsatzId" value={z.id} />
                    <input type="hidden" name="aktion" value="ohne_bezug" />
                    <label className="flex min-w-0 flex-1 flex-col gap-s1 text-sm text-text">
                      {t.ohneBezugWarum}
                      <input name="notiz" type="text" required minLength={5} className={feld}
                             placeholder={t.ohneBezugBeispiel} />
                    </label>
                    <button type="submit" data-cse="klaerung-ohne-bezug" className={knopfStill}>
                      {t.ohneBezug}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {k.dokument_id === null ? (
        <p className="mt-s5 text-sm text-text-muted">
          {t.keineArchivkopie}
        </p>
      ) : null}
    </PortalRahmen>
  );
}
