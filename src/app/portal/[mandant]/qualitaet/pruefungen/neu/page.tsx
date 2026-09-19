import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import {
  ladePruefungAuswahl, PRUEFERGEBNISSE, ERGEBNIS_TEXT,
  type PruefungAuswahl,
} from '@/server/services/reinigung/qualitaet';

/**
 * `/portal/[mandant]/qualitaet/pruefungen/neu` — eine Prüfung erfassen
 * (OPS-11, SPEC §22).
 *
 * **Der Bezug wird ERZWUNGEN, nicht angeboten.** `qp_ein_anker` verlangt
 * mindestens ein Objekt oder ein Projekt; ein optionales Feld liesse die
 * Prüfung an der Prüfbedingung scheitern, nachdem jemand zwanzig Befunde
 * getippt hat. Das Objekt ist deshalb Pflicht, und der Kunde kommt vom Objekt
 * — nie aus dem Formular.
 *
 * **Es gibt keinen Kriterienkatalog, und deshalb wird getippt.**
 * `qualitaetspruefung_position.kriterium` ist freier Text, und eine Tabelle
 * mit vorgegebenen Prüfkriterien existiert nicht. Die Vorschläge unter den
 * Feldern sind ausdrücklich als <strong>Platzhalter</strong> beschriftet; eine
 * Auswahlliste, die aussieht wie ein Katalog, wäre eine erfundene
 * Geschäftsregel (O-29).
 *
 * **Keine Punkteskala wird vorgegeben.** Die einzelnen Befunde dürfen Punkte
 * tragen, damit nichts verloren geht, sobald der Kunde die Skala nennt; eine
 * KOPFsumme entsteht nur, wenn das Verfahren eine Skala trägt — und das
 * entscheidet der Dienst, nicht dieses Formular (siehe
 * `erfassePruefung`: die Prüfbedingung `qp_punkte_brauchen_skala` prüft die
 * eigene Spalte und nicht das Verfahren, also ist der Dienst die Sperre).
 *
 * **Nummer und Prüfzeitpunkt vergibt der Dienst.** Die Nummer kommt aus
 * `naechsteNummer` (QP-JJJJ-NNNN), die Zeit aus dem Auslöser
 * `kern.qualitaetspruefung_feldzeit` — `now()` auf der Serveruhr
 * (Invariante 5). Das Formular schickt beides nicht.
 */
export const dynamic = 'force-dynamic';

/** Befundzeilen im Formular. Ohne Skript wächst die Liste über einen GET. */
const ZEILEN_VORGABE = 6;
const ZEILEN_SCHRITT = 6;
const ZEILEN_MAX = 30;

/**
 * Vorschläge, ausdrücklich als Platzhalter beschriftet.
 *
 * Es gibt keinen Kriterienkatalog (O-29). Diese Liste ist ein `datalist` —
 * ein Vorschlag, den man überschreiben kann — und ausdrücklich KEINE
 * Auswahlliste: eine geschlossene Liste wäre ein Katalog, den niemand
 * beschlossen hat.
 */
const KRITERIUM_VORSCHLAEGE: readonly string[] = [
  'Böden — Nassreinigung',
  'Sanitärbereich — Becken und Armaturen',
  'Sanitärbereich — Verbrauchsmaterial',
  'Treppenhaus — Handläufe',
  'Glasflächen innen',
  'Abfallbehälter geleert',
  'Verkehrsflächen — Staub',
  'Dokumentation vor Ort vorhanden',
];

export default async function PruefungNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const gewuenscht = Number(typeof suche['zeilen'] === 'string' ? suche['zeilen'] : '');
  const zeilen = Number.isFinite(gewuenscht)
    ? Math.min(Math.max(Math.trunc(gewuenscht), ZEILEN_VORGABE), ZEILEN_MAX)
    : ZEILEN_VORGABE;

  const tor = await mandantTor(`/portal/${mandant}/qualitaet/pruefungen/neu`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  const heute = await berlinHeute();
  const auswahl = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) =>
      ladePruefungAuswahl(kontext))) as Promise<PruefungAuswahl>);

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const kleinfeld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s2 text-sm text-text';
  const kannErfassen = auswahl.objekte.length > 0 && auswahl.verfahren.length > 0;
  /*
   * Die Reviere nach Objekt gruppiert — nicht Zierde, sondern die einzige
   * Stelle, an der die Oberflaeche die Zusammengehoerigkeit zeigt. `revier_id`
   * und `objekt_id` stehen unabhaengig am Protokollkopf, und `qp_revier_fk`
   * kennt das Objekt nicht; der Dienst weist die falsche Paarung inzwischen ab
   * (`pruefeAnker`). Eine flache Liste aller Reviere der Gesellschaft haette
   * diese Abweisung erst NACH dem Ausfuellen gezeigt.
   */
  const objektName = new Map(auswahl.objekte.map((o) => [o.id, o.bezeichnung]));
  const reviereJeObjekt = auswahl.objekte
    .map((o) => ({
      objektId: o.id,
      name: objektName.get(o.id) ?? o.id,
      reviere: auswahl.reviere.filter((r) => r.objektId === o.id),
    }))
    .filter((g) => g.reviere.length > 0);
  const nurPlatzhalter = auswahl.verfahren.length > 0
    && auswahl.verfahren.every((v) => v.istPlatzhalter);

  return (
    <PortalRahmen
      titel="Prüfung erfassen"
      wurzelTitel="Qualität"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="qualitaet"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s4">
        <Link
          href={`/portal/${mandant}/qualitaet/pruefungen`}
          className="text-sm text-text-muted underline hover:text-text"
        >
          ← Alle Prüfungen
        </Link>
      </nav>

      <h1 className="mb-s2 text-h1 text-text">Prüfung erfassen</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Bezug, Verfahren, Prüfer — dann die Befunde. Nummer und Prüfzeitpunkt
        vergibt die Anwendung: die Zeit kommt von der{' '}
        <strong className="text-text">Serveruhr</strong>, nicht vom Gerät
        (Invariante 5).
      </p>

      {fehler !== null && (
        <Hinweis art="warnung" cse="pruefung-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht erfasst.</strong> {fehler}
        </Hinweis>
      )}

      {nurPlatzhalter && (
        <Hinweis art="hinweis" cse="pruefung-verfahren-platzhalter" className="mb-s5 max-w-prose">
          <strong>Das Prüfverfahren ist ein Platzhalter ohne Skala und ohne
          Schwelle (O-29).</strong>{' '}
          Auslöser, Punkteskala, Bestehensschwelle und die Folge einer nicht
          bestandenen Prüfung sind nicht festgelegt. Die erfasste Prüfung bleibt
          deshalb <strong>ohne Urteil</strong> — nicht „nicht bestanden" — und
          eine Kopfpunktzahl entsteht nicht. Die Punkte der einzelnen Befunde
          werden trotzdem gespeichert: sobald die Skala kommt, geht nichts
          verloren.
        </Hinweis>
      )}

      {auswahl.geprueft['objekt.lesen'] !== true && (
        <Hinweis art="warnung" cse="pruefung-kein-objektrecht" className="mb-s5 max-w-prose">
          <strong>Die Objektauswahl ist leer, weil <code>objekt.lesen</code> fehlt.</strong>{' '}
          Eine Prüfung braucht zwingend ein Objekt (oder ein Projekt) als Bezug —
          <code> qp_ein_anker</code> lässt nichts anderes zu.
        </Hinweis>
      )}

      {auswahl.geprueft['reinigung.lesen'] !== true && (
        <Hinweis art="hinweis" cse="pruefung-kein-revierrecht" className="mb-s5 max-w-prose">
          <strong>Reviere und Revierräume sind nicht wählbar, weil{' '}
          <code>reinigung.lesen</code> fehlt.</strong>{' '}
          Qualität ist ein Querschnittsmodul: eine Prüferin der Sicherheit hält
          das Recht der Reinigung nicht. Die Prüfung lässt sich trotzdem am
          Objekt erfassen — nur ohne Revierbezug.
        </Hinweis>
      )}

      <form
        method="post"
        action="/api/qualitaet/pruefungen"
        data-cse="pruefung-formular"
        className="flex flex-col gap-s6"
      >
        <input type="hidden" name="mandant" value={mandant} />
        {/*
          Die Behauptung des Geräts. Sie bleibt leer, wenn kein Skript läuft —
          und das ist in Ordnung: maßgeblich ist ohnehin die Serverzeit, und
          eine hier erfundene Gerätezeit wäre schlimmer als keine.
        */}
        <input type="hidden" name="geraete_zeit" value="" />

        {/* ---- Schritt 1: der Bezug ---------------------------------------- */}
        <fieldset className="m-0 rounded-lg border border-line bg-surface p-s5">
          <legend className="px-s2 text-h3 text-text">1 · Bezug</legend>
          <div className="mt-s4 flex max-w-form flex-col gap-s4">
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Objekt (Pflicht)</span>
              <select name="objekt" required className={feld} data-cse="pruefung-objekt">
                {auswahl.objekte.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.bezeichnung}
                    {o.kunde === null ? ' — ohne Kunde' : ` · ${o.kunde}`}
                  </option>
                ))}
              </select>
              <span className="mt-s1 block text-xs text-text-subtle">
                Der Kunde wird vom Objekt übernommen — ein Kunde aus dem Formular
                wäre ein Prüfprotokoll, das jemand einem anderen Kunden zuordnet.
              </span>
            </label>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Revier (optional)</span>
              <select name="revier" className={feld} data-cse="pruefung-revier">
                <option value="">— ganzes Objekt, kein Revier —</option>
                {reviereJeObjekt.map((g) => (
                  <optgroup key={g.objektId} label={g.name}>
                    {g.reviere.map((r) => (
                      <option key={r.id} value={r.id}>{r.bezeichnung}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="mt-s1 block text-xs text-text-subtle">
                <strong className="text-text">
                  Das Revier muss zu dem oben gewählten Objekt gehören
                </strong>{' '}
                — deshalb stehen die Reviere nach Objekt gruppiert. Eine
                Paarung aus zwei Häusern wird beim Speichern abgewiesen.
                Nennt ein Befund unten einen Revierraum, ist das Revier
                Pflicht: ohne es prüft die Datenbank die Zugehörigkeit des
                Raums nicht.
              </span>
            </label>
          </div>
        </fieldset>

        {/* ---- Schritt 2: Verfahren und Prüfer ----------------------------- */}
        <fieldset className="m-0 rounded-lg border border-line bg-surface p-s5">
          <legend className="px-s2 text-h3 text-text">2 · Verfahren und Prüfer</legend>
          <div className="mt-s4 flex max-w-form flex-col gap-s4">
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Prüfverfahren</span>
              <select name="verfahren" required className={feld} data-cse="pruefung-verfahren">
                {auswahl.verfahren.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.bezeichnung}
                    {v.istPlatzhalter ? ' — Platzhalter ohne Skala (O-29)' : ''}
                    {v.maxPunkte === null ? '' : ` · bis ${v.maxPunkte.replace('.', ',')} Punkte`}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-s1 text-sm text-text">Prüfer</legend>
              {/*
                Die EIGENE Anstellung oder ein externer Name — nie eine Liste
                über alle Beschäftigten. Wer prüft, steht in der Sitzung; eine
                Auswahlliste wäre ein Protokoll, das jemand einem Kollegen
                unterschiebt (dieselbe Regel wie beim Wachbuch, §10.5).
              */}
              {auswahl.eigeneAnstellung === null ? (
                <p className="m-0 mb-s2 text-xs text-warning">
                  Dieses Konto hat in dieser Gesellschaft keine Anstellung — dann
                  braucht die Prüfung einen externen Prüfernamen.
                </p>
              ) : (
                <label className="mb-s2 inline-flex min-h-11 items-center gap-s2 text-sm text-text">
                  <input
                    type="radio"
                    name="pruefer_art"
                    value="selbst"
                    defaultChecked
                    data-cse="pruefer-selbst"
                  />
                  Ich selbst — {auswahl.eigeneAnstellung.name}
                </label>
              )}
              <label className="mb-s2 flex min-h-11 items-center gap-s2 text-sm text-text">
                <input
                  type="radio"
                  name="pruefer_art"
                  value="extern"
                  {...(auswahl.eigeneAnstellung === null ? { defaultChecked: true } : {})}
                />
                Externer Prüfer
              </label>
              <input
                name="pruefer_extern"
                maxLength={120}
                className={feld}
                placeholder="Name des externen Prüfers"
              />
            </fieldset>
            <label className="inline-flex min-h-11 items-center gap-s2 text-sm text-text">
              <input type="checkbox" name="mit_kunde" value="ja" />
              Der Kunde war bei der Prüfung anwesend
            </label>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Bemerkung (optional)</span>
              <textarea name="bemerkung" rows={3} maxLength={2000}
                        className={`${feld} py-s2`} />
            </label>
          </div>
        </fieldset>

        {/* ---- Schritt 3: die Befunde -------------------------------------- */}
        <fieldset className="m-0 rounded-lg border border-line bg-surface p-s5">
          <legend className="px-s2 text-h3 text-text">3 · Befunde</legend>
          <p className="mt-s4 max-w-prose text-sm text-text-muted">
            Ein Befund je Zeile. Leere Zeilen werden verworfen. Bei
            „{ERGEBNIS_TEXT.nio}" ist die Mangelbeschreibung{' '}
            <strong className="text-text">Pflicht</strong> — das verlangt die
            Datenbank (<code>qpp_nio_beschrieben</code>), und eine Prüfung mit
            einem Mangel ohne Beschreibung belegt nichts.
          </p>
          <p className="mb-s4 max-w-prose text-xs text-text-subtle">
            Die Kriterienvorschläge sind <strong>Platzhalter</strong>: es gibt
            keinen Kriterienkatalog (O-29). Sie lassen sich überschreiben.
          </p>

          <datalist id="kriterium-vorschlaege">
            {KRITERIUM_VORSCHLAEGE.map((k) => <option key={k} value={k} />)}
          </datalist>

          <ul className="m-0 list-none p-0">
            {Array.from({ length: zeilen }, (_, i) => i).map((i) => (
              <li
                key={i}
                data-cse="befund-zeile"
                className="mb-s4 border-b border-line pb-s4 last:border-0"
              >
                <div className="grid grid-cols-1 gap-s3 md:grid-cols-12">
                  <label className="block md:col-span-4">
                    <span className="mb-s1 block text-xs text-text-muted">
                      Kriterium {i + 1}
                    </span>
                    <input
                      name={`kriterium_${String(i)}`}
                      maxLength={200}
                      list="kriterium-vorschlaege"
                      className={kleinfeld}
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-s1 block text-xs text-text-muted">Ergebnis</span>
                    <select name={`ergebnis_${String(i)}`} className={kleinfeld} defaultValue="io">
                      {PRUEFERGEBNISSE.map((e) => (
                        <option key={e} value={e}>{ERGEBNIS_TEXT[e]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-s1 block text-xs text-text-muted">
                      Raum im Revier (optional)
                    </span>
                    <select name={`revierraum_${String(i)}`} className={kleinfeld}>
                      <option value="">—</option>
                      {auswahl.revierRaeume.map((rr) => (
                        <option key={rr.id} value={rr.id}>{rr.bezeichnung}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block md:col-span-1">
                    <span className="mb-s1 block text-xs text-text-muted">Punkte</span>
                    <input
                      name={`punkte_${String(i)}`}
                      inputMode="decimal"
                      className={kleinfeld}
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-s1 block text-xs text-text-muted">
                      Mangel (Pflicht bei nio)
                    </span>
                    <input
                      name={`mangel_${String(i)}`}
                      maxLength={500}
                      className={kleinfeld}
                    />
                  </label>
                  <label className="block md:col-span-1">
                    <span className="mb-s1 block text-xs text-text-muted">Frist</span>
                    <input name={`frist_${String(i)}`} type="date" className={kleinfeld} />
                  </label>
                </div>
              </li>
            ))}
          </ul>

          {zeilen < ZEILEN_MAX && (
            <p className="m-0 mt-s3 text-sm">
              <Link
                href={`/portal/${mandant}/qualitaet/pruefungen/neu?zeilen=${String(Math.min(zeilen + ZEILEN_SCHRITT, ZEILEN_MAX))}`}
                className="underline hover:text-text"
                data-cse="mehr-befundzeilen"
              >
                Mehr Befundzeilen ({Math.min(zeilen + ZEILEN_SCHRITT, ZEILEN_MAX)} statt {zeilen})
              </Link>
              <span className="ml-s3 text-xs text-text-subtle">
                Öffnet das Formular neu — bereits Getipptes geht dabei verloren.
              </span>
            </p>
          )}
        </fieldset>

        <div>
          <Button
            type="submit"
            variante="primary"
            data-cse="pruefung-erfassen"
            disabled={!kannErfassen}
          >
            Prüfung erfassen
          </Button>
          {!kannErfassen && (
            <p className="m-0 mt-s3 text-xs text-warning">
              Ohne Objekt und Prüfverfahren lässt sich keine Prüfung erfassen.
            </p>
          )}
          <p className="m-0 mt-s3 max-w-prose text-xs text-text-subtle">
            Erfasst wird mit der Serverzeit von jetzt; die Nummer vergibt die
            Anwendung fortlaufend je Jahr (QP-{heute.slice(0, 4)}-NNNN).
          </p>
        </div>
      </form>
    </PortalRahmen>
  );
}
