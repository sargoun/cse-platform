import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { istUuid } from '@/lib/uuid';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
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

const MELDUNG: Readonly<Record<string, string>> = {
  zugeordnet: 'Der Umsatz ist zugeordnet; die Zahlung ist angelegt.',
  ohne_bezug: 'Der Umsatz ist als „ohne Bezug" vermerkt.',
};

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
        return { kopf: null, umsaetze: [] as UmsatzRoh[], posten: [] as PostenAuswahl[] };
      }

      const umsaetze = await kontext.abfrage<UmsatzRoh>(
        `select u.id, u.laufnummer, u.richtung::text as richtung,
                u.betrag_cent::text, u.buchungsdatum::text, u.valuta::text,
                u.referenz, u.verwendungszweck, u.gegenpartei, u.gebucht,
                u.zustand::text as zustand, u.klaerungsnotiz, u.vorschlag_text,
                r.nummer
           from kontoumsatz u
           left join umsatz_zuordnung uz on uz.kontoumsatz_id = u.id
                                        and uz.mandant_id = u.mandant_id
                                        and uz.widerrufen_am is null
           left join zahlung_zuordnung zz on zz.zahlung_id = uz.zahlung_id
                                         and zz.mandant_id = uz.mandant_id
           left join offener_posten op on op.id = zz.offener_posten_id
                                      and op.mandant_id = zz.mandant_id
           left join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
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
      return { kopf, umsaetze, posten };
    }))) as { kopf: KopfRoh | null; umsaetze: readonly UmsatzRoh[];
      posten: readonly PostenAuswahl[] };

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

  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const fehlerText = typeof suche['meldung'] === 'string' && fehler !== null ? suche['meldung'] : null;
  const wartend = daten.umsaetze.filter((u) => u.zustand === 'offen' || u.zustand === 'in_klaerung');
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const knopf = 'min-h-11 rounded-md bg-brand px-s4 text-sm font-semibold text-white hover:bg-brand-hover';
  const knopfStill = 'min-h-11 rounded-md border border-line-strong px-s4 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel={`Auszug ${k.auszug_id}`}
      wurzelTitel="Bank"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bank"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Auszug {k.auszug_id}</h1>
        <Link
          href={`/portal/${mandant}/buchhaltung/bank`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Zur Liste
        </Link>
      </div>

      {meldung !== null && fehler === null ? (
        <p role="status" data-cse="bank-meldung"
           className="mb-s5 rounded-lg border border-success bg-success-soft p-s4 text-sm text-success">
          {MELDUNG[meldung] ?? meldung}
          {suche['abgeglichen'] === '1' ? ' Der Auszug ist damit vollständig abgeglichen.' : ''}
        </p>
      ) : null}
      {fehler !== null ? (
        <p role="alert" data-cse="bank-fehler"
           className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          {fehlerText ?? 'Die Klärung wurde abgewiesen.'}
        </p>
      ) : null}

      <dl className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        {[
          ['Bankkonto', k.bankkonto],
          ['IBAN', k.iban],
          ['Zeitraum', k.von === null ? '—' : `${k.von} – ${k.bis ?? k.von}`],
          ['Zeilen', String(k.zeilen)],
          ['Anfangssaldo', anfang === null ? '—' : formatiereGeld(cent(anfang))],
          ['Endsaldo', ende === null ? '—' : formatiereGeld(cent(ende))],
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
          Anfangssaldo {formatiereGeld(cent(anfang!))} plus die Bewegung der
          Zeilen ({formatiereGeld(cent(bewegung))})
          {stimmt
            ? ' ergibt den Endsaldo — der Auszug ist vollständig eingelesen.'
            : ` ergibt ${formatiereGeld(cent(anfang! + bewegung))}, der Auszug `
              + `nennt aber ${formatiereGeld(cent(ende!))}. Es fehlt eine Zeile.`}
        </section>
      ) : null}

      {daten.umsaetze.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Dieser Auszug trägt keine Zeile.
        </p>
      ) : (
        <DataTable
          beschriftung="Die Umsätze dieses Auszugs und warum sie stehen, wo sie stehen"
          zeilen={daten.umsaetze}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'nr', kopf: 'Nr.', numerisch: true, zelle: (z) => z.laufnummer },
            { schluessel: 'datum', kopf: 'Datum', zelle: (z) => z.buchungsdatum },
            {
              schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
              zelle: (z) => (
                <span className={z.richtung === 'eingang' ? 'text-text' : 'text-text-muted'}>
                  {z.richtung === 'eingang' ? '' : '− '}
                  {formatiereGeld(cent(BigInt(z.betrag_cent)))}
                </span>
              ),
            },
            {
              schluessel: 'partei', kopf: 'Gegenpartei',
              zelle: (z) => z.gegenpartei ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'zweck', kopf: 'Verwendungszweck',
              zelle: (z) => (
                <span className="break-words">
                  {z.verwendungszweck === '' ? '—' : z.verwendungszweck}
                </span>
              ),
            },
            {
              schluessel: 'zustand', kopf: 'Zustand',
              zelle: (z) => (
                <span className="inline-flex items-center gap-s2">
                  <StatusPill zustand={ZUSTAND[z.zustand] ?? 'Offen'} />
                  {z.gebucht ? null : (
                    <span className="text-xs text-text-muted">Vormerkung</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'begruendung', kopf: 'Warum',
              zelle: (z) => {
                if (z.zustand === 'zugeordnet') {
                  return (
                    <span className="text-xs text-text-muted">
                      Zugeordnet{z.nummer === null ? '' : ` zu ${z.nummer}`}
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
                    {z.vorschlag_text ?? 'Noch nicht abgeglichen'}
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
          <h2 className="mb-s3 text-h2 text-text">Klärung</h2>
          <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
            {String(wartend.length)} Zeile(n) warten auf eine Entscheidung. Zugeordnet wird
            der Betrag der Bank; gerechnet wird hier nichts.
          </p>
          <ul className="m-0 flex list-none flex-col gap-s4 p-0">
            {wartend.map((z) => (
              <li key={z.id} data-cse="klaerung-zeile" data-umsatz={z.id}
                  className="rounded-lg border border-line bg-surface p-s5">
                <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
                  <span className="text-sm text-text">
                    Nr. {z.laufnummer} · {z.buchungsdatum} ·{' '}
                    <strong>{z.richtung === 'eingang' ? '' : '− '}{formatiereGeld(cent(BigInt(z.betrag_cent)))}</strong>
                    {z.gegenpartei === null ? '' : ` · ${z.gegenpartei}`}
                  </span>
                  <span className="text-xs text-warning">{z.vorschlag_text ?? 'Noch nicht abgeglichen'}</span>
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
                        Offener Posten
                        <select name="postenId" required className={feld} defaultValue="">
                          <option value="" disabled>— wählen —</option>
                          {daten.posten.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nummer} · {formatiereGeld(cent(BigInt(p.offen_cent)))}
                              {p.kunde === null ? '' : ` · ${p.kunde}`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" data-cse="klaerung-zuordnen" className={knopf}
                              disabled={daten.posten.length === 0}>
                        Zuordnen
                      </button>
                    </form>
                  ) : (
                    <p className="text-sm text-text-subtle">
                      {z.gebucht
                        ? 'Ein Ausgang wird keiner Forderung zugeordnet.'
                        : 'Eine Vormerkung wird erst zugeordnet, wenn die Bank gebucht hat.'}
                    </p>
                  )}
                  <form method="post" action="/api/buchhaltung/bank/umsatz"
                        className="flex flex-col gap-s2 sm:flex-row sm:items-end">
                    <input type="hidden" name="mandant" value={mandant} />
                    <input type="hidden" name="auszugId" value={k.id} />
                    <input type="hidden" name="umsatzId" value={z.id} />
                    <input type="hidden" name="aktion" value="ohne_bezug" />
                    <label className="flex min-w-0 flex-1 flex-col gap-s1 text-sm text-text">
                      Ohne Bezug — warum
                      <input name="notiz" type="text" required minLength={5} className={feld}
                             placeholder="z. B. Kontoführungsgebühr September" />
                    </label>
                    <button type="submit" data-cse="klaerung-ohne-bezug" className={knopfStill}>
                      Ohne Bezug
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
          Keine Archivkopie der Datei — der Objektspeicher ist nicht verbunden.
        </p>
      ) : null}
    </PortalRahmen>
  );
}
