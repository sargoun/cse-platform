import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  bezugskandidaten, fristlage, istBezugTyp, istOffen, listeAufgaben, zaehleJeZustand,
  type AufgabeFilter, type AufgabeZeile, type Bezugskandidat, type Fristlage,
} from '@/server/services/kern/aufgabe';
import { AnmeldungNoetig } from '../../Anmeldung';
import { MandantAntwort, mandantTor } from '../../unterseite';
import { Recht } from '@/components/ui/Recht';

/**
 * Die sechs Bezugsarten mit einer Detailseite, in der Reihenfolge, in der ein
 * Mensch sie sucht — und mit denselben Schlüsseln wie `AUFLOESER` im Dienst.
 */
const BEZUGSGRUPPEN: readonly (readonly [string, string])[] = [
  ['auftrag', 'Auftrag'],
  ['objekt', 'Objekt'],
  ['kunde', 'Kunde'],
  ['lead', 'Lead'],
  ['angebot', 'Angebot'],
  ['rechnung', 'Rechnung'],
];

/**
 * `/portal/[mandant]/aufgaben` — die offene Pflicht (OPS-11, DSH-01, SPEC §14).
 *
 * **Nach FRIST sortiert, offene zuerst** — nicht nach Eingang. Ein
 * Aufgabenzettel nach Datum sortiert sieht ordentlich aus und lässt die
 * überfällige Sache unten liegen; dieselbe Begründung wie beim
 * Lead-Posteingang (CRM-07).
 *
 * **Die Frist rechnet der Dienst, nicht diese Seite.** „Überfällig" ist für
 * einen Zeitpunkt und für einen Tag eine verschiedene Frage — ein Tag endet
 * um 24:00 Berliner Zeit —, und das gehört in eine geprüfte Funktion
 * (`fristlage`, Invariante 2).
 *
 * **Woher eine Aufgabe kommt, steht in der Zeile.** Die Wächter aus SPEC §14
 * schreiben nachts Befunde hierher; `quelle_job` sagt, welcher. Eine Aufgabe,
 * von der niemand weiss, wer sie gestellt hat, wird nicht erledigt, sondern
 * ignoriert.
 */
export const dynamic = 'force-dynamic';

const STATUS_PILLE: Readonly<Record<string, PillZustand>> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  wartend: 'Wartet',
  erledigt: 'Abgeschlossen',
  abgebrochen: 'Archiviert',
};

const PRIORITAET_TEXT: Readonly<Record<string, string>> = {
  niedrig: 'niedrig', normal: 'normal', hoch: 'hoch', dringend: 'dringend',
};

/** Die Farbe der Prioritaet aus dem semantischen Satz (DESIGN §1, §5). */
const PRIORITAET_KLASSE: Readonly<Record<string, string>> = {
  niedrig: 'text-text-subtle',
  normal: 'text-text-muted',
  hoch: 'text-warning',
  dringend: 'text-danger',
};

const QUELLE_TEXT: Readonly<Record<string, string>> = {
  mensch: 'von Hand', zeitplan: 'Wächter', ereignis: 'Ereignis', agent: 'Agent',
};

const BEZUG_TEXT: Readonly<Record<string, string>> = {
  auftrag: 'Auftrag', objekt: 'Objekt', lead: 'Lead', kunde: 'Kunde',
  rechnung: 'Rechnung', angebot: 'Angebot',
};

function frist(z: AufgabeZeile, jetzt: Date): { text: string; lage: Fristlage } {
  const lage = fristlage(z, jetzt);
  if (z.faelligAm !== null) {
    /*
     * **Mit Jahr.** Ohne stand „14.06. 16:00" für eine seit einem Jahr
     * überfällige Aufgabe und für eine Frist in zwei Tagen dasselbe da —
     * dieselbe `dateStyle`/`timeStyle`-Kombination wie auf der Detailseite,
     * damit zwei Seiten derselben Aufgabe nicht zwei Fristen zeigen.
     */
    return {
      lage,
      text: new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin',
      }).format(z.faelligAm),
    };
  }
  if (z.faelligDatum !== null) {
    const [jahr, monat, tag] = z.faelligDatum.split('-');
    return { lage, text: `${String(tag)}.${String(monat)}.${String(jahr)}` };
  }
  return { lage, text: '—' };
}

export default async function Aufgabenliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/aufgaben`;

  const nurOffene = suche['alle'] !== '1';
  const nurMeine = suche['meine'] === '1';
  /*
   * **Gegen die Werteliste geprüft, nicht gegen eine Form.** `/^[a-z_]+$/`
   * liess `?bezug=foo` durch, und daraus wurde `$1::bezug_typ` — ein 22P02
   * und eine Fehlerseite, wo eine leere Liste hingehört. Ein unbekanntes Wort
   * ist keine Störung, sondern eine Eingabe.
   */
  const bezugTyp = typeof suche['bezug'] === 'string' && istBezugTyp(suche['bezug'])
    ? suche['bezug'] : undefined;

  const tor = await mandantTor(pfad, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const jetzt = new Date();
  /** EIN Filter für Liste und Kopfzahl — sonst zählen sie zwei Mengen. */
  const filter: AufgabeFilter = {
    ...(nurOffene ? { nurOffene: true } : {}),
    ...(nurMeine ? { nurMeine: true } : {}),
    ...(bezugTyp === undefined ? {} : { bezugTyp }),
  };

  const { zeilen, jeZustand, darfSchreiben, kandidaten } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, async (kontext) => {
        /*
         * `aufgabe.schreiben` in DERSELBEN gebundenen Transaktion, in der
         * gelesen wird: die Route trägt nur `aufgabe.lesen`, ein reines
         * Lesekonto erreicht diese Seite also. Ohne die Frage stünde hier
         * ein Formular, dessen „Anlegen" von `/api/aufgaben` mit einer nackten
         * 404 beantwortet wird — richtig nach AUT-06 und unerklärt.
         */
        const [recht] = await kontext.abfrage<{ schreiben: boolean }>(
          `select app.hat_recht('aufgabe.schreiben', app.aktiver_mandant()) as schreiben`);
        const darf = recht?.schreiben === true;
        return {
          zeilen: await listeAufgaben(kontext, filter),
          jeZustand: await zaehleJeZustand(kontext, filter),
          darfSchreiben: darf,
          /*
           * Nur für das Anlegeformular — ein reines Lesekonto sieht es nicht
           * und braucht die sechs Abfragen deshalb auch nicht (V-096).
           */
          kandidaten: darf ? await bezugskandidaten(kontext) : [],
        };
      }),
  ) as Promise<{
    zeilen: readonly AufgabeZeile[];
    jeZustand: Readonly<Record<string, number>>;
    darfSchreiben: boolean;
    kandidaten: readonly Bezugskandidat[];
  }>);

  const offenGesamt = (jeZustand['offen'] ?? 0) + (jeZustand['in_arbeit'] ?? 0)
    + (jeZustand['wartend'] ?? 0);
  /*
   * Beide Zahlen über derselben Menge: offene Aufgaben dieses Filters. Eine
   * erledigte Aufgabe mit alter Frist ist nicht überfällig, sie ist fertig.
   */
  const ueberfaellig = zeilen.filter(
    (z) => istOffen(z.status) && fristlage(z, jetzt) === 'ueberfaellig').length;

  /** Die Filterlinks — zusammengesetzt, also über `alsRoute` (D-504). */
  const filterLink = (
    aenderung: { alle?: boolean; meine?: boolean; bezug?: string | null },
  ) => {
    const q = new URLSearchParams();
    const alle = aenderung.alle ?? !nurOffene;
    const meine = aenderung.meine ?? nurMeine;
    const bezug = aenderung.bezug === undefined ? bezugTyp : aenderung.bezug;
    if (alle) q.set('alle', '1');
    if (meine) q.set('meine', '1');
    if (bezug !== null && bezug !== undefined) q.set('bezug', bezug);
    const s = q.toString();
    return alsRoute(s === '' ? pfad : `${pfad}?${s}`);
  };

  return (
    <PortalRahmen
      titel="Aufgaben"
      wurzelTitel="Portal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="aufgaben"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Aufgaben</h1>
        <p className="m-0 flex flex-wrap items-center gap-s4 text-sm text-text-muted">
          <span data-cse="offen-gesamt" data-anzahl={String(offenGesamt)}>
            {offenGesamt === 0 ? 'Nichts offen.' : `${String(offenGesamt)} offen`}
          </span>
          {ueberfaellig > 0 && (
            <span data-cse="ueberfaellig" className="text-danger">
              {`${String(ueberfaellig)} überfällig`}
            </span>
          )}
        </p>
      </div>

      <div className="mb-s5 flex flex-wrap items-center gap-s2">
        <Link href={filterLink({ meine: false })} data-cse="filter-alle"
              className={`inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                          ${nurMeine
                            ? 'border-line text-text-muted hover:border-line-strong'
                            : 'border-line-strong bg-surface-3 text-text'}`}>
          Alle
        </Link>
        <Link href={filterLink({ meine: true })} data-cse="filter-meine"
              className={`inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                          ${nurMeine
                            ? 'border-line-strong bg-surface-3 text-text'
                            : 'border-line text-text-muted hover:border-line-strong'}`}>
          Nur meine
        </Link>
        {Object.keys(BEZUG_TEXT).map((typ) => (
          <Link key={typ} href={filterLink({ bezug: bezugTyp === typ ? null : typ })}
                data-cse={`filter-bezug-${typ}`}
                className={`inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                            ${bezugTyp === typ
                              ? 'border-line-strong bg-surface-3 text-text'
                              : 'border-line text-text-muted hover:border-line-strong'}`}>
            {BEZUG_TEXT[typ]}
          </Link>
        ))}
        <Link href={filterLink({ alle: nurOffene })}
              data-cse="umschalter-erledigte"
              className="ml-auto inline-flex min-h-11 items-center text-sm text-text-muted
                         underline underline-offset-4 hover:text-text">
          {nurOffene ? 'Auch erledigte zeigen' : 'Nur offene'}
        </Link>
      </div>

      <section aria-labelledby="neue-aufgabe" className="mb-s6">
        <h2 id="neue-aufgabe" className="text-h2 text-text">Neue Aufgabe</h2>
        {!darfSchreiben ? (
          <p data-cse="anlegen-fehlt" className="mt-s3 max-w-prose text-sm text-text-muted">
            Zum Anlegen fehlt das Recht <Recht schluessel="aufgabe.schreiben" />. Die
            Liste bleibt sichtbar — wer eine Aufgabe sieht, soll wissen, was
            offen ist.
          </p>
        ) : (
        <form
          method="post"
          action={`/api/aufgaben?mandant=${mandant}`}
          className="mt-s3 max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="was" value="anlegen" />

          <label className="block text-sm text-text" htmlFor="titel">Titel</label>
          <input
            id="titel" name="titel" type="text" required maxLength={200}
            className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="beschreibung">
            Worum geht es?
          </label>
          <textarea
            id="beschreibung" name="beschreibung" rows={2}
            className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          />

          <div className="mt-s4 flex flex-wrap gap-s4">
            <span>
              <label className="block text-sm text-text" htmlFor="prioritaet">Priorität</label>
              <select
                id="prioritaet" name="prioritaet" defaultValue="normal"
                className="mt-s2 min-h-11 rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
              >
                <option value="niedrig">niedrig</option>
                <option value="normal">normal</option>
                <option value="hoch">hoch</option>
                <option value="dringend">dringend</option>
              </select>
            </span>
            <span>
              <label className="block text-sm text-text" htmlFor="faelligDatum">
                Fällig bis
              </label>
              <input
                id="faelligDatum" name="faelligDatum" type="date"
                className="mt-s2 min-h-11 rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
              />
            </span>
          </div>

          {/*
            * **Woran hängt diese Aufgabe?** (V-096)
            *
            * `aufgabe` trägt fünf Bezugsfelder, die Route nimmt alle fünf
            * entgegen, `loeseBezugAuf` löst sechs Arten auf, und die
            * Detailseite zeigt den Verweis — **dieses Formular schickte
            * keines davon**. Jede von Hand angelegte Aufgabe stand damit frei
            * in der Luft: „Rechnung prüfen" — welche?
            *
            * Angeboten wird genau das, was zurückführt: die sechs Arten mit
            * einer Detailseite. Ein Bezug, dem man nicht folgen kann, ist
            * eine Notiz mit Kennung.
            */}
          {kandidaten.length === 0 ? null : (
            <>
              <label className="mt-s4 block text-sm text-text" htmlFor="bezug">
                Woran hängt sie? (freiwillig)
              </label>
              <select
                id="bezug" name="bezug" defaultValue=""
                data-cse="aufgabe-bezug"
                className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
              >
                <option value="">ohne Bezug</option>
                {BEZUGSGRUPPEN.map(([typ, beschriftung]) => {
                  const dieser = kandidaten.filter((k) => k.typ === typ);
                  return dieser.length === 0 ? null : (
                    <optgroup key={typ} label={beschriftung}>
                      {dieser.map((k) => (
                        <option key={`${k.typ}:${k.id}`} value={`${k.typ}:${k.id}`}>
                          {k.titel}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <p className="mt-s2 m-0 text-xs text-text-muted">
                Der Bezug macht aus „Rechnung prüfen" eine Aufgabe, von der aus man zu
                der Rechnung kommt — und er sammelt die Aufgaben eines Vorgangs auf
                dessen Blatt. Was hier fehlt, sieht diese Sitzung nicht.
              </p>
            </>
          )}

          <Button type="submit" variante="primary" data-cse="aufgabe-anlegen"
                  className="mt-s4">
            Anlegen
          </Button>
        </form>
        )}
      </section>

      {zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="aufgaben-leer">
          <strong>Nichts hier.</strong>{' '}
          {nurOffene
            ? 'Keine offene Aufgabe. Erledigte stehen unter „Auch erledigte zeigen".'
            : 'Für diesen Filter gibt es keine Aufgabe.'}
        </Hinweis>
      ) : (
        <DataTable
          beschriftung="Aufgaben nach Frist, offene zuerst"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'titel',
              kopf: 'Aufgabe',
              zelle: (z) => (
                <span>
                  <Link
                    href={`/portal/${mandant}/aufgaben/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.titel}
                  </Link>
                  <span className="block text-xs text-text-muted">
                    {QUELLE_TEXT[z.quelle] ?? z.quelle}
                    {z.quelleJob === null ? '' : ` · ${z.quelleJob}`}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'frist',
              kopf: 'Frist',
              zelle: (z) => {
                const f = frist(z, jetzt);
                if (f.lage === 'ohne') return <span className="text-text-subtle">—</span>;
                return (
                  <span data-cse="frist" data-lage={f.lage}
                        className={f.lage === 'ueberfaellig' ? 'text-danger'
                          : f.lage === 'heute' ? 'text-warning' : 'text-text'}>
                    {f.text}
                    {f.lage === 'ueberfaellig' && (
                      <span className="block text-xs">überfällig</span>
                    )}
                  </span>
                );
              },
            },
            {
              schluessel: 'prioritaet',
              kopf: 'Priorität',
              zelle: (z) => (
                <span className={PRIORITAET_KLASSE[z.prioritaet] ?? 'text-text'}>
                  {PRIORITAET_TEXT[z.prioritaet] ?? z.prioritaet}
                </span>
              ),
            },
            {
              schluessel: 'zustaendig',
              kopf: 'Zuständig',
              zelle: (z) => (z.zugewiesenAn ?? z.team ?? (
                <span className="text-warning">niemand</span>
              )),
            },
            {
              schluessel: 'bezug',
              kopf: 'Bezug',
              zelle: (z) => {
                if (z.bezug === null) return <span className="text-text-subtle">—</span>;
                const art = BEZUG_TEXT[z.bezug.typ] ?? z.bezug.typ;
                if (z.bezug.pfad === null) {
                  /*
                   * Ein Typ ohne Auflöser ergibt eine Zeile MIT Art und OHNE
                   * Verweis — nie eine tote Verknüpfung (§7.2).
                   */
                  return <span className="text-text-muted">{art}</span>;
                }
                return (
                  <Link href={`/portal/${mandant}/${z.bezug.pfad}`}
                        className="text-text underline-offset-2 hover:text-brand hover:underline">
                    <span className="block text-xs text-text-subtle">{art}</span>
                    {z.bezug.titel}
                  </Link>
                );
              },
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => <StatusPill zustand={STATUS_PILLE[z.status] ?? 'Offen'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
