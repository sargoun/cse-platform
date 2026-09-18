import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld, type Cent } from '@/server/services/finanz/geld';
import { vierAugenGrenze } from '@/server/services/finanz/eingangsrechnung';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/finanzen/eingangsrechnungen/[id]/freigabe` — die Freigabe
 * zur BUCHUNG (04-SEITENKARTE.md §5.14, FIN-14, Invariante 7, K-13).
 *
 * **Wer freigibt, sieht genau das, was der Freigabesatz bezeugt.** Der
 * API-Weg friert Lieferant, Rechnungsnummer, Rechnungsdatum und Bruttobetrag
 * in die Freigabenutzlast ein; diese Seite zeigt dieselben vier Angaben in
 * derselben Reihenfolge, gross und oben. Eine Freigabemaske, die etwas anderes
 * zeigt als der Satz festhält, ist eine Unterschrift unter ein ungelesenes
 * Dokument.
 *
 * **Die Vier-Augen-Lage steht im Klartext und wird nie behauptet.**
 * `vierAugenGrenze()` liest `eingang.vier_augen_ab_cent` aus den
 * Mandanteneinstellungen und gibt `null` zurück, wenn nichts gesetzt ist.
 * `null` heisst **„nicht konfiguriert" und nicht „keine Grenze"** — die Seite
 * sagt das wörtlich und nennt O-183. Eine erfundene Grenze wäre eine
 * Organisationsregel, die niemand beschlossen hat.
 *
 * **Die Freigabe erlaubt die BUCHUNG, nicht eine Zahlung.** Nichts verlässt
 * dabei das System (Invariante 7): es entsteht ein Freigabesatz in der
 * K-13-Kette und ein Zustandswechsel, kein Zahlungsauftrag. Die Seite sagt
 * das, weil „freigeben" im Alltag nach „Geld geht raus" klingt.
 *
 * **Die Seite schreibt selbst nichts.** Beide Formulare posten auf den
 * bestehenden Weg `/api/finanzen/eingangsrechnungen`, der `eingang.freigeben`
 * UND `freigabe.entscheiden` zieht — zwei Rechte, weil es zwei Handlungen
 * sind.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Freigabe — Eingangsrechnung' };

const PILLE: Readonly<Record<string, PillZustand>> = {
  eingegangen: 'Entwurf',
  in_pruefung: 'In Prüfung',
  freigegeben: 'Bereit',
  gebucht: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
};

const ZUSTAND: Readonly<Record<string, string>> = {
  eingegangen: 'eingegangen — noch nicht in der Prüfung',
  in_pruefung: 'in Prüfung',
  freigegeben: 'freigegeben — zur Buchung bereit',
  gebucht: 'gebucht',
  abgelehnt: 'abgelehnt',
};

interface Kopf {
  readonly id: string;
  readonly status: string;
  readonly interne_belegnummer: string | null;
  readonly lieferant: string | null;
  readonly lieferant_id: string | null;
  readonly rechnungsnummer_lieferant: string | null;
  readonly rechnungsdatum: string | null;
  readonly leistungsdatum: string | null;
  readonly netto_cent: string | null;
  readonly steuer_cent: string | null;
  readonly brutto_cent: string | null;
  readonly faellig_am: string | null;
  readonly beleg_id: string | null;
  readonly belegnummer: string | null;
  readonly reverse_charge: boolean;
  readonly bauabzugsteuer_pflichtig: boolean;
  readonly bauabzugsteuer_cent: string | null;
  readonly abgelehnt_grund: string | null;
  /** Hat DIESE Sitzung die Rechnung selbst erfasst? Die Vier-Augen-Frage. */
  readonly selbst_erfasst: boolean;
  readonly erfasst_von: string | null;
  readonly freigegeben_von: string | null;
  readonly freigegeben_am: string | null;
  readonly freigabe_begruendung: string | null;
}

export default async function Freigabeblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/finanzen/eingangsrechnungen/${id}/freigabe`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /*
   * Drei Rechte entscheiden hier, und keines davon ist das der Route.
   *
   * Die Route öffnet mit `eingang.freigeben`. Die RLS-Policy auf
   * `eingangsrechnung` verlangt zum Lesen `eingang.lesen`, und der Schreibweg
   * verlangt zusätzlich `freigabe.entscheiden` (K-13). Ein Konto mit
   * `eingang.freigeben`, aber ohne `eingang.lesen` kommt durch das Tor und
   * sieht null Zeilen — die Seite sagt dann, dass das Leserecht fehlt, statt
   * eine Rechnung zu zeigen, die es nicht gibt.
   */
  const darf = await haeltRechte(
    sitzung, 'eingang.lesen', 'freigabe.entscheiden', 'eingang.schreiben',
    /*
     * Die steuerliche Lage (§48b-Freistellungsbescheinigung) ist mit
     * `abrechnung.freistellung_pflegen` bewacht — ein eigenes Recht, kein
     * Anhaengsel von `eingang.lesen`: dort steht die Bescheinigung des
     * Lieferanten mit ihrer Gueltigkeit, und wer Rechnungen freigibt, pflegt
     * sie deshalb nicht zwangslaeufig. Ohne das Recht bleibt der Einbehalt
     * stehen und faellt der Verweis weg (D-567, AUT-06).
     */
    'abrechnung.freistellung_pflegen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kopf: (await kontext.abfrage<Kopf>(
        `select er.id, er.status::text as status, er.interne_belegnummer,
                l.name as lieferant, er.lieferant_id::text as lieferant_id,
                er.rechnungsnummer_lieferant,
                to_char(er.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                to_char(er.leistungsdatum, 'DD.MM.YYYY') as leistungsdatum,
                er.netto_cent::text, er.steuer_cent::text, er.brutto_cent::text,
                to_char(er.faellig_am, 'DD.MM.YYYY') as faellig_am,
                er.beleg_id::text as beleg_id, b.belegnummer,
                er.reverse_charge, er.bauabzugsteuer_pflichtig,
                er.bauabzugsteuer_cent::text,
                er.abgelehnt_grund,
                (er.erstellt_von = app.aktueller_benutzer()) as selbst_erfasst,
                erf.name as erfasst_von, frg.name as freigegeben_von,
                to_char(er.freigegeben_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as freigegeben_am,
                f.begruendung as freigabe_begruendung
           from eingangsrechnung er
           left join lieferant l
             on l.mandant_id = er.mandant_id and l.id = er.lieferant_id
           left join beleg b on b.mandant_id = er.mandant_id and b.id = er.beleg_id
           left join benutzer erf on erf.id = er.erstellt_von
           left join benutzer frg on frg.id = er.freigegeben_von
           left join freigabe f
             on f.mandant_id = er.mandant_id and f.id = er.freigabe_id
          where er.id = $1`, [id]))[0] ?? null,
      grenze: await vierAugenGrenze(kontext),
    }))) as Promise<{ kopf: Kopf | null; grenze: Cent | null }>);

  const k = daten.kopf;
  if (k === null) {
    /*
     * Keine Zeile heisst zweierlei, und die Seite darf nur EINES davon
     * verraten: die Rechnung gibt es nicht, ODER dieser Sitzung fehlt
     * `eingang.lesen`. Fehlt das Leserecht, ist das eine Auskunft über die
     * SITZUNG und nicht über die Rechnung — die darf sie bekommen, denn sonst
     * sucht jemand eine Rechnung, die vor ihm liegt.
     */
    if (darf['eingang.lesen'] !== true) {
      return (
        <PortalRahmen
          titel="Freigabe"
          bereich={mandant as BereichSchluessel}
          nurLesen
          leiste={zugang.leiste}
          wurzel={`/portal/${mandant}`}
          aktiverTab="eingangsrechnungen"
          sichtbareTabs={zugang.sichtbareTabs}
          navigationsRechte={zugang.navigationsRechte}
        >
          <h1 className="mb-s3 text-h1 text-text">Freigabe</h1>
          <Hinweis art="warnung" cse="freigabe-kein-leserecht">
            <p className="m-0 max-w-prose">
              Diesem Konto fehlt <strong>eingang.lesen</strong>. Es darf
              freigeben, aber nicht sehen, was es freigibt — und eine Freigabe
              ohne Einsicht ist keine. Die beiden Rechte gehören zusammen;
              wer sie vergibt, entscheidet die Rollenverwaltung.
            </p>
          </Hinweis>
        </PortalRahmen>
      );
    }
    notFound();
  }

  const ziel = `/api/finanzen/eingangsrechnungen?mandant=${mandant}`;
  const feld = 'mt-s2 block min-h-11 w-full max-w-prose rounded-md border '
    + 'border-line bg-surface-3 p-s3 text-sm text-text';
  const knopf = 'min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold '
    + 'text-white hover:bg-brand-hover';
  const knopfStill = 'min-h-11 rounded-md border border-line-strong px-s5 py-s3 '
    + 'text-base text-text hover:bg-surface-2';

  const brutto = k.brutto_cent === null ? null : cent(BigInt(k.brutto_cent));
  const imPruefstatus = k.status === 'in_pruefung';
  /*
   * Die Vier-Augen-Antwort. Sie wird hier GENAUSO gerechnet wie in
   * `freigebe()`: Grenze gesetzt UND selbst erfasst UND Brutto >= Grenze.
   * Ist die Grenze nicht konfiguriert, gibt es keine Sperre — und die Seite
   * nennt das eine offene Frage, keine Entscheidung.
   */
  const vierAugenSperrt = daten.grenze !== null && k.selbst_erfasst
    && brutto !== null && brutto >= daten.grenze;
  const darfSchreiben = darf['freigabe.entscheiden'] === true;
  const freigabeMoeglich = imPruefstatus && !vierAugenSperrt && darfSchreiben;

  return (
    <PortalRahmen
      titel="Freigabe"
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
          href={`/portal/${mandant}/finanzen/eingangsrechnungen/${id}`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {k.interne_belegnummer ?? k.rechnungsnummer_lieferant ?? 'Eingangsrechnung'}
        </Link>
      </nav>

      <h1 className="mb-s3 text-h1 text-text">Freigabe zur Buchung</h1>

      <Hinweis art="hinweis" cse="freigabe-was-passiert" className="mb-s5">
        <p className="m-0 max-w-prose">
          Die Freigabe erlaubt die <strong>Buchung</strong> — sie ist keine
          Zahlungsanweisung. Es entsteht ein Freigabesatz in der Freigabekette
          (K-13) und ein Zustandswechsel; <strong>nichts verlässt dabei das
          System</strong> (Invariante 7). Gezahlt wird später, über die
          Zahlungsseite, und von einem Menschen.
        </p>
      </Hinweis>

      <h2 className="mb-s3 text-h2 text-text">
        Worüber entschieden wird — genau diese vier Angaben friert der Freigabesatz ein
      </h2>
      <dl
        data-cse="freigabe-nutzlast"
        className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line-strong bg-surface p-s5 sm:grid-cols-2"
      >
        <div>
          <dt className="text-xs text-text-muted">Lieferant</dt>
          <dd className="text-base text-text">
            {k.lieferant ?? <span className="text-text-subtle">kein Lieferant zugeordnet</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Rechnungsnummer des Lieferanten</dt>
          <dd className="text-base text-text">{k.rechnungsnummer_lieferant ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Rechnungsdatum</dt>
          <dd className="text-base text-text">{k.rechnungsdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Bruttobetrag</dt>
          <dd className="cse-zahl text-h3 text-text" data-cse="freigabe-brutto">
            {brutto === null ? '—' : formatiereGeld(brutto)}
          </dd>
        </div>
      </dl>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">Zustand</dt>
          <dd className="text-sm text-text">
            <span className="inline-flex flex-wrap items-center gap-s2">
              <StatusPill zustand={PILLE[k.status] ?? 'Entwurf'} />
              <span className="text-xs text-text-muted">
                {ZUSTAND[k.status] ?? k.status}
              </span>
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Netto / USt</dt>
          <dd className="cse-zahl text-sm text-text">
            {k.netto_cent === null ? '—' : formatiereGeld(cent(BigInt(k.netto_cent)))}
            {' / '}
            {k.steuer_cent === null ? '—' : formatiereGeld(cent(BigInt(k.steuer_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Fällig</dt>
          <dd className="text-sm text-text">{k.faellig_am ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Beleg</dt>
          <dd className="text-sm text-text">
            {k.beleg_id === null
              ? <span className="text-warning">kein Beleg — ohne ihn wird nicht gebucht (ACC-03)</span>
              : (
                <Link
                  href={`/portal/${mandant}/finanzen/belege/${k.beleg_id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {k.belegnummer ?? 'Beleg ohne Nummer'}
                </Link>
              )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">§13b UStG</dt>
          <dd className="text-sm text-text">
            {k.reverse_charge ? 'Reverse Charge greift' : 'greift nicht'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">§48 EStG</dt>
          <dd className="text-sm text-text">
            {k.bauabzugsteuer_pflichtig
              ? `Einbehalt ${k.bauabzugsteuer_cent === null
                ? 'noch nicht gerechnet'
                : formatiereGeld(cent(BigInt(k.bauabzugsteuer_cent)))}`
              : 'kein Einbehalt'}
            {darf['abrechnung.freistellung_pflegen'] === true ? (
              <>
                {' · '}
                <Link
                  href={`/portal/${mandant}/finanzen/eingangsrechnungen/${id}/steuer`}
                  className="underline underline-offset-2"
                >
                  steuerliche Lage
                </Link>
              </>
            ) : null}
          </dd>
        </div>
      </dl>

      <h2 className="mb-s3 text-h2 text-text">Die Vier-Augen-Lage</h2>
      <div
        data-cse="freigabe-vier-augen"
        data-konfiguriert={String(daten.grenze !== null)}
        className={`mb-s5 rounded-lg border p-s5 text-sm ${
          daten.grenze === null
            ? 'border-warning bg-warning-soft text-warning'
            : 'border-line bg-surface text-text'}`}
      >
        <p className="m-0 max-w-prose">
          {daten.grenze === null
            ? 'Kein Vier-Augen-Zwang konfiguriert (O-183). Diese Gesellschaft hat '
              + 'keinen Betrag hinterlegt, ab dem eine zweite Person freigeben muss '
              + '— und die Plattform erfindet keinen. Das heisst NICHT, dass keine '
              + 'Grenze gelten soll; es heisst, dass niemand sie gesetzt hat.'
            : `Ab ${formatiereGeld(daten.grenze)} gibt eine zweite Person frei: `
              + 'wer erfasst hat, gibt nicht frei.'}
        </p>
        <p className="m-0 mt-s3 max-w-prose">
          Erfasst hat{' '}
          <strong className="text-text">
            {k.erfasst_von ?? 'ein Konto ohne Namen'}
          </strong>
          {k.selbst_erfasst ? ' — das ist dieses Konto.' : ' — nicht dieses Konto.'}
        </p>
        <p className="m-0 mt-s2 max-w-prose">
          {vierAugenSperrt
            ? 'Diese Sitzung darf deshalb NICHT freigeben: sie hat selbst erfasst, '
              + 'und der Betrag liegt über der Grenze.'
            : daten.grenze === null
              ? 'Es gibt darum keine Sperre — mangels Regel, nicht mangels Grund.'
              : 'Diese Sitzung darf freigeben.'}
        </p>
      </div>

      {k.status === 'freigegeben' || k.status === 'gebucht' ? (
        <Hinweis art="hinweis" cse="freigabe-schon-erteilt" className="mb-s5">
          <p className="m-0 max-w-prose">
            Freigegeben{k.freigegeben_am === null ? '' : ` am ${k.freigegeben_am}`}
            {k.freigegeben_von === null ? '' : ` von ${k.freigegeben_von}`}.
            {k.freigabe_begruendung === null
              ? ''
              : ` Begründung: „${k.freigabe_begruendung}".`}
            {k.status === 'gebucht'
              ? ' Die Rechnung ist gebucht; korrigiert wird durch eine Gegenbuchung.'
              : ''}
          </p>
        </Hinweis>
      ) : null}

      {k.status === 'abgelehnt' ? (
        <Hinweis art="hinweis" cse="freigabe-abgelehnt" className="mb-s5">
          <p className="m-0 max-w-prose">
            Zurückgewiesen. Grund: „{k.abgelehnt_grund ?? '—'}". Die Zeile bleibt
            stehen (Invariante 8); eine abgelehnte Rechnung wird neu erfasst,
            nicht wiederbelebt.
          </p>
        </Hinweis>
      ) : null}

      {k.status === 'eingegangen' ? (
        <Hinweis art="hinweis" cse="freigabe-noch-nicht-pruefbar" className="mb-s5">
          <p className="m-0 max-w-prose">
            Diese Rechnung ist noch nicht in der Prüfung. Freigegeben wird aus
            dem Zustand <strong>in Prüfung</strong> — dort ist der Lieferant
            gesetzt und der Beleg zugeordnet.
          </p>
          {darf['eingang.schreiben'] === true ? (
            <form method="post" action={ziel} className="mt-s3">
              <input type="hidden" name="aktion" value="pruefen" />
              <input type="hidden" name="id" value={k.id} />
              <button type="submit" className={knopfStill}>In Prüfung geben</button>
            </form>
          ) : null}
        </Hinweis>
      ) : null}

      {!imPruefstatus ? null : (
        <div className="flex max-w-prose flex-col gap-s5">
          <form
            method="post" action={ziel}
            className="rounded-lg border border-line-strong bg-surface p-s5"
            data-cse="freigabe-formular"
          >
            <input type="hidden" name="aktion" value="freigeben" />
            <input type="hidden" name="id" value={k.id} />
            <h3 className="m-0 text-h3 text-text">Freigeben</h3>
            <label className="mt-s4 block text-sm text-text" htmlFor="begruendung">
              Begründung (mindestens fünf Zeichen)
            </label>
            <input
              id="begruendung" name="begruendung" type="text" required minLength={5}
              placeholder="Sachlich und rechnerisch geprüft" className={feld}
            />
            <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
              Sie steht im Freigabesatz, zusammen mit den vier Angaben oben. Wer
              die Rechnung danach ändert, hat für das, was er bucht, keine
              Freigabe mehr (K-13).
            </p>
            {freigabeMoeglich ? null : (
              <p className="m-0 mt-s3 max-w-prose text-sm text-warning">
                {vierAugenSperrt
                  ? 'Gesperrt: diese Sitzung hat die Rechnung selbst erfasst, und der '
                    + 'Betrag liegt über der Vier-Augen-Grenze dieser Gesellschaft.'
                  : 'Diesem Konto fehlt freigabe.entscheiden — ohne dieses Recht '
                    + 'entsteht kein Satz in der Freigabekette, und ohne ihn keine '
                    + 'Freigabe.'}
              </p>
            )}
            <button
              type="submit" disabled={!freigabeMoeglich}
              className={`mt-s4 ${knopf} disabled:cursor-not-allowed disabled:opacity-40`}
              data-cse="freigabe-knopf"
            >
              Zur Buchung freigeben
            </button>
          </form>

          {darf['eingang.schreiben'] === true ? (
            <form
              method="post" action={ziel}
              className="rounded-lg border border-line bg-surface p-s5"
              data-cse="freigabe-ablehnen"
            >
              <input type="hidden" name="aktion" value="ablehnen" />
              <input type="hidden" name="id" value={k.id} />
              <h3 className="m-0 text-h3 text-text">Zurückweisen</h3>
              <label className="mt-s4 block text-sm text-text" htmlFor="grund">
                Grund (mindestens fünf Zeichen)
              </label>
              <input
                id="grund" name="grund" type="text" required minLength={5}
                placeholder="Leistung wurde nie erbracht" className={feld}
              />
              <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
                Die Zeile bleibt stehen (Invariante 8). Der Grund ist das, was
                später allein dasteht.
              </p>
              <button type="submit" className={`mt-s4 ${knopfStill}`}>
                Zurückweisen
              </button>
            </form>
          ) : null}
        </div>
      )}
    </PortalRahmen>
  );
}
