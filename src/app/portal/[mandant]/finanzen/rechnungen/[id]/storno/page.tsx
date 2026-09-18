import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { cent, formatiereGeld, negiere } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgres, milliMenge } from '@/server/services/finanz/menge';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]/storno` — die **stornierende
 * Buchung** (04-SEITENKARTE.md §5.14.1, FIN-02, LEG-01, Invariante 4).
 *
 * **Nichts wird geändert.** Eine festgeschriebene Rechnung ist unveränderlich;
 * korrigiert wird durch einen ZWEITEN Beleg mit gespiegelten Beträgen, eigener
 * Nummer aus demselben Kreis und eigenem Kettenglied. Diese Seite zeigt die
 * Gegenrechnung Position für Position, damit vorher sichtbar ist, was gleich
 * in die Bücher geht — ein Storno, dessen Zahlen man erst hinterher sieht, ist
 * einer, den man hinterher erklären muss.
 *
 * **Der Grund ist Pflicht, mindestens zehn Zeichen**, und er landet in
 * `rechnung_beziehung.grund`. `storniere()` weist kürzere ab; die Seite
 * verlangt dieselbe Länge, damit die Abweisung nicht erst nach dem Absenden
 * kommt. „Fehler" ist keine Begründung, und die Seite sagt das.
 *
 * **Zwei Ausgänge, und die Wahl ist nicht kosmetisch.** „Nur Storno" hebt auf.
 * „Storno und Neuausstellung" legt zusätzlich einen neuen Entwurf an, der die
 * Quellen des Originals neu beansprucht — möglich, weil das Original sie im
 * selben Vorgang freigegeben hat. Wer nur aufheben will, soll nicht
 * versehentlich einen Entwurf erzeugen, den niemand erwartet.
 *
 * **FIN-18 hält einen Storno nie auf.** Er hebt einen Beleg auf, der schon
 * draussen ist; ihn wegen fehlender Zeiterfassung zu sperren wäre die Sperre
 * ausgerechnet auf dem Vorgang, mit dem man eine zu Unrecht gestellte
 * Rechnung loswird.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Storno — Rechnung' };

const STORNO_MINDESTLAENGE = 10;

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsart: string;
  readonly kunde: string;
  readonly rechnungsdatum: string | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly hash: string | null;
  readonly kette_position: string | null;
  readonly storniert_durch: string | null;
  readonly storniert_durch_id: string | null;
  readonly storno_grund: string | null;
  readonly ersetzt_durch: string | null;
  readonly ersetzt_durch_id: string | null;
  readonly storniert_beleg: string | null;
  readonly storniert_beleg_id: string | null;
}

interface Pos {
  readonly id: string;
  readonly position_nr: number;
  /**
   * `leistung`, `textzeile` oder `zwischensumme`. **`storniere()` spiegelt
   * ausschliesslich `leistung`** — die beiden anderen Arten stehen hier
   * deshalb mit dem Vermerk „wird nicht übernommen" und ohne negierte Zahl.
   *
   * Vorher las diese Seite ALLE Zeilen und zeigte auch eine `zwischensumme`
   * mit negiertem Netto, obwohl der Stornobeleg sie nicht enthält. Eine
   * Vorschau, die etwas anderes zeigt als das, was gebucht wird, ist
   * schlimmer als keine: sie wird nachgerechnet und stimmt.
   */
  readonly positionsart: string;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly netto_cent: string | null;
}

const POSITIONSART_TEXT: Readonly<Record<string, string>> = {
  leistung: 'Leistung',
  textzeile: 'Textzeile',
  zwischensumme: 'Zwischensumme',
};

export default async function Stornoblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/finanzen/rechnungen/${id}/storno`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* Diese Seite öffnet mit `finanzen.stornieren`; der Beleg daneben verlangt
     `finanzen.lesen` (AUT-06, D-581). */
  const darf = await haeltRechte(sitzung, 'finanzen.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status,
                r.rechnungsart::text as rechnungsart, k.name as kunde,
                to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text,
                r.brutto_cent::text,
                h.hash, h.kette_position::text as kette_position,
                /* Wer DIESE Rechnung aufhebt (sie ist das Original). */
                (select sr.nummer from rechnung_beziehung bz
                   join rechnung sr
                     on sr.mandant_id = bz.mandant_id and sr.id = bz.von_rechnung_id
                  where bz.mandant_id = r.mandant_id and bz.zu_rechnung_id = r.id
                    and bz.art = 'storno' limit 1) as storniert_durch,
                (select bz.von_rechnung_id::text from rechnung_beziehung bz
                  where bz.mandant_id = r.mandant_id and bz.zu_rechnung_id = r.id
                    and bz.art = 'storno' limit 1) as storniert_durch_id,
                (select bz.grund from rechnung_beziehung bz
                  where bz.mandant_id = r.mandant_id and bz.zu_rechnung_id = r.id
                    and bz.art = 'storno' limit 1) as storno_grund,
                /* Welche Neuausstellung sie ersetzt. */
                (select er.nummer from rechnung_beziehung bz
                   join rechnung er
                     on er.mandant_id = bz.mandant_id and er.id = bz.von_rechnung_id
                  where bz.mandant_id = r.mandant_id and bz.zu_rechnung_id = r.id
                    and bz.art = 'ersetzt' limit 1) as ersetzt_durch,
                (select bz.von_rechnung_id::text from rechnung_beziehung bz
                  where bz.mandant_id = r.mandant_id and bz.zu_rechnung_id = r.id
                    and bz.art = 'ersetzt' limit 1) as ersetzt_durch_id,
                /* Und falls DIESE Rechnung selbst ein Storno ist: wen hebt sie auf. */
                (select orr.nummer from rechnung_beziehung bz
                   join rechnung orr
                     on orr.mandant_id = bz.mandant_id and orr.id = bz.zu_rechnung_id
                  where bz.mandant_id = r.mandant_id and bz.von_rechnung_id = r.id
                    and bz.art = 'storno' limit 1) as storniert_beleg,
                (select bz.zu_rechnung_id::text from rechnung_beziehung bz
                  where bz.mandant_id = r.mandant_id and bz.von_rechnung_id = r.id
                    and bz.art = 'storno' limit 1) as storniert_beleg_id
           from rechnung r
           join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
           left join rechnung_hash h
             on h.mandant_id = r.mandant_id and h.rechnung_id = r.id
          where r.id = $1`, [id]);
      if (kopf === undefined) return { kopf: null, positionen: [] };
      return {
        kopf,
        positionen: await kontext.abfrage<Pos>(
          `select p.id, p.position_nr, p.positionsart::text as positionsart,
                  p.bezeichnung, p.menge::text as menge,
                  e.bezeichnung as einheit, p.netto_cent::text
             from rechnungsposition p
             left join masseinheit e on e.id = p.masseinheit_id
            where p.rechnung_id = $1
            order by p.position_nr`, [id]),
      };
    })) as Promise<{ kopf: Kopf | null; positionen: readonly Pos[] }>);

  const k = daten.kopf;
  if (k === null) notFound();

  const festgeschrieben = k.status === 'festgeschrieben';
  const schonStorniert = k.storniert_durch_id !== null;
  const istSelbstStorno = k.rechnungsart === 'storno';
  const moeglich = festgeschrieben && !schonStorniert && !istSelbstStorno;

  const feld = 'mt-s2 block min-h-11 w-full max-w-prose rounded-md border '
    + 'border-line bg-surface-3 p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="Storno"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['finanzen.lesen'] === true ? (
        <nav aria-label="Zurück" className="mb-s3">
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${id}`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            ← {k.nummer ?? 'Entwurf ohne Nummer'}
          </Link>
        </nav>
      ) : null}

      <h1 className="mb-s3 text-h1 text-text">Stornieren — ein zweiter Beleg, kein Eingriff</h1>

      <Hinweis art="warnung" cse="storno-erklaerung" className="mb-s5">
        <p className="m-0 max-w-prose">
          An dieser Rechnung wird <strong>nichts geändert</strong>. Es entsteht
          ein zweiter Beleg mit gespiegelten Beträgen, eigener Nummer aus
          demselben Kreis und eigenem Kettenglied. Beide Belege bleiben für
          immer stehen und verweisen aufeinander — das ist die einzige
          rechtmässige Korrektur (Invariante 4, LEG-01).
        </p>
      </Hinweis>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">Kunde</dt>
          <dd className="text-sm text-text">{k.kunde}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Rechnungsdatum</dt>
          <dd className="text-sm text-text">{k.rechnungsdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Kettenbindung</dt>
          <dd className="font-mono text-xs text-text-muted" data-cse="storno-kette">
            {k.hash === null
              ? 'kein Kettensatz'
              : `#${String(k.kette_position)} · ${k.hash.slice(0, 16)}`}
          </dd>
        </div>
      </dl>

      {schonStorniert ? (
        <Hinweis art="hinweis" cse="storno-schon-storniert" className="mb-s5">
          <p className="m-0 max-w-prose">
            Diese Rechnung ist durch <strong>{k.storniert_durch}</strong> aufgehoben.
            {k.storno_grund === null ? '' : ` Grund: „${k.storno_grund}".`}
            {k.ersetzt_durch === null
              ? ''
              : ` Ersetzt wurde sie durch ${k.ersetzt_durch}.`}
          </p>
          {darf['finanzen.lesen'] === true && k.storniert_durch_id !== null ? (
            <p className="m-0 mt-s2">
              <Link
                href={`/portal/${mandant}/finanzen/rechnungen/${k.storniert_durch_id}`}
                className="text-sm underline underline-offset-2"
              >
                Zum Stornobeleg →
              </Link>
            </p>
          ) : null}
        </Hinweis>
      ) : null}

      {istSelbstStorno ? (
        <Hinweis art="hinweis" cse="storno-ist-storno" className="mb-s5">
          <p className="m-0 max-w-prose">
            Dieser Beleg IST eine stornierende Buchung
            {k.storniert_beleg === null ? '' : ` und hebt ${k.storniert_beleg} auf`}.
            Ein Storno wird nicht selbst storniert — eine erneute Korrektur ist
            eine neue Rechnung.
          </p>
          {darf['finanzen.lesen'] === true && k.storniert_beleg_id !== null ? (
            <p className="m-0 mt-s2">
              <Link
                href={`/portal/${mandant}/finanzen/rechnungen/${k.storniert_beleg_id}`}
                className="text-sm underline underline-offset-2"
              >
                Zum aufgehobenen Beleg →
              </Link>
            </p>
          ) : null}
        </Hinweis>
      ) : null}

      {!festgeschrieben ? (
        <Hinweis art="hinweis" cse="storno-nicht-festgeschrieben" className="mb-s5">
          <p className="m-0 max-w-prose">
            {k.status === 'entwurf'
              ? 'Dieser Beleg ist ein Entwurf. Ein Entwurf wird verworfen, nicht '
                + 'storniert — er hat keine Nummer und keine rechtliche Existenz.'
              : 'Dieser Entwurf ist verworfen. Es gibt nichts aufzuheben.'}
          </p>
          {k.status === 'entwurf' ? (
            <p className="m-0 mt-s2">
              <Link
                href={`/portal/${mandant}/finanzen/rechnungen/${id}/verwerfen`}
                className="text-sm underline underline-offset-2"
              >
                Zur Verwerfen-Seite →
              </Link>
            </p>
          ) : null}
        </Hinweis>
      ) : null}

      <h2 className="mb-s3 text-h2 text-text">Die Gegenrechnung, Position für Position</h2>
      {daten.positionen.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Dieser Beleg hat keine Position.
        </p>
      ) : (
        <DataTable
          beschriftung="Die Positionen des Stornos — gespiegelte Mengen und Beträge"
          zeilen={daten.positionen}
          schluessel={(p) => p.id}
          spalten={[
            {
              schluessel: 'nr', kopf: 'Nr.', numerisch: true,
              zelle: (p) => p.position_nr,
            },
            { schluessel: 'bezeichnung', kopf: 'Bezeichnung', zelle: (p) => p.bezeichnung },
            {
              schluessel: 'art', kopf: 'Art',
              zelle: (p) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="text-sm text-text">
                    {POSITIONSART_TEXT[p.positionsart] ?? p.positionsart}
                  </span>
                  {p.positionsart === 'leistung' ? null : (
                    <span className="text-xs text-warning">
                      wird nicht übernommen
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'menge', kopf: 'Menge im Storno', numerisch: true,
              zelle: (p) => (p.positionsart !== 'leistung' || p.menge === null
                ? '—'
                : `${formatiereMenge(milliMenge(-mengeAusPostgres(p.menge)))}${
                  p.einheit === null ? '' : ` ${p.einheit}`}`),
            },
            {
              schluessel: 'netto', kopf: 'Netto im Storno', numerisch: true,
              zelle: (p) => (p.positionsart !== 'leistung' || p.netto_cent === null
                ? '—'
                : formatiereGeld(negiere(cent(BigInt(p.netto_cent))))),
            },
          ]}
        />
      )}
      {daten.positionen.some((p) => p.positionsart !== 'leistung') ? (
        <p className="mt-s3 max-w-prose text-xs text-text-muted"
           data-cse="storno-nicht-gespiegelt">
          Nur <strong>Leistungszeilen</strong> werden gespiegelt.
          Textzeilen und Zwischensummen stehen oben mit dem Vermerk „wird nicht
          übernommen" und ohne Zahl: eine negierte Zwischensumme wäre eine
          Summe über Zeilen, die der Stornobeleg gar nicht führt. Die
          Kopfsummen darunter sind die des Originals, negiert — sie rechnen
          nicht über die Zeilen dieser Tabelle.
        </p>
      ) : null}

      <dl
        data-cse="storno-summen"
        className="mb-s5 mt-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3"
      >
        <div>
          <dt className="text-xs text-text-muted">Netto im Storno</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(negiere(cent(BigInt(k.netto_gesamt_cent))))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">USt im Storno</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(negiere(cent(BigInt(k.steuer_gesamt_cent))))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Brutto im Storno</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(negiere(cent(BigInt(k.brutto_cent))))}
          </dd>
        </div>
      </dl>

      {moeglich ? (
        <form
          method="post"
          action={`/api/rechnungen/storno?mandant=${mandant}`}
          className="max-w-prose rounded-lg border border-line-strong bg-surface p-s5"
          data-cse="storno-formular"
        >
          <input type="hidden" name="rechnungId" value={k.id} />
          <label className="block text-sm text-text" htmlFor="stornogrund">
            Grund (mindestens {STORNO_MINDESTLAENGE} Zeichen, auditfähig)
          </label>
          <input
            id="stornogrund" name="grund" type="text" required
            minLength={STORNO_MINDESTLAENGE} className={feld}
          />
          <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
            Er wird in <code>rechnung_beziehung</code> festgehalten und steht
            danach auf beiden Belegen. „Fehler" ist keine Begründung — der Grund
            muss den Vorgang benennen.
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="form">Form</label>
          <select id="form" name="form" defaultValue="nur_storno" className={feld}>
            <option value="nur_storno">Nur Storno — die Rechnung wird aufgehoben</option>
            <option value="korrektur">
              Storno und Neuausstellung — es entsteht zusätzlich ein neuer Entwurf
            </option>
          </select>
          <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
            Die Neuausstellung übernimmt die Positionen und beansprucht die
            Quellen des Originals neu. Sie ist ein <strong>Entwurf</strong> — sie
            wird nicht automatisch festgeschrieben und hält keine Nummer.
          </p>

          <button
            type="submit"
            className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
            data-cse="storno-knopf"
          >
            Stornieren
          </button>
        </form>
      ) : null}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        Der Storno zieht seine eigene Nummer aus demselben Kreis und hängt sich
        an dieselbe Hashkette. Wer darf stornieren, ist noch offen (O-77) — bis
        dahin gilt die Katalogvorgabe für <code>finanzen.stornieren</code>.
      </p>
    </PortalRahmen>
  );
}
