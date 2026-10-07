import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { leseEinwand, type EinwandBlatt } from '@/server/services/zeit/einwand';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { darfKorrigieren, ladeZeiteintrag } from '../../daten';
import { istKennung, kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { Recht } from '@/components/ui/Recht';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { beschriftung as wortFuer } from '@/lib/i18n/beschriftung/basis';
import { EINWAND_STATUS_TEXT } from '@/lib/i18n/beschriftung/zeit';
import { tagDeutsch } from '@/lib/datum/kalendertag';
import type { ReactNode } from 'react';
import {
  listeLeistungenAmTag, type AnkerbareLeistung,
} from '@/server/services/dienstplan/leistungsanker';

/**
 * `/portal/[mandant]/zeiten/[id]/korrektur` — wer korrigiert, wann und
 * **warum** (TIM-11, LEG-01, SEC-A9).
 *
 * **Der Befund, der diese Seite gebracht hat.** Der Weg war zu drei Vierteln
 * gebaut: eine Mitarbeiterin meldet eine Abweichung (EMP-07), die Planung
 * entscheidet darüber, und `korrigiereZeiteintrag` schreibt die neue Fassung —
 * geprüft, mit Kette, mit Spur. Nur rief den Dienst niemand auf. Ein
 * anerkannter Einwand führte zu einer Zeile „anerkannt" und zu einem
 * Zeiteintrag, der unverändert blieb; im Lohnstreit ist das eine Zusage ohne
 * Folge, und sie fällt erst auf, wenn jemand die Stunden nachrechnet.
 *
 * **Die Felder sind LEER, und das ist dieselbe Absicht wie bei der
 * Nacherfassung.** Was aufgezeichnet wurde und was die Person behauptet,
 * steht daneben zum Lesen. Vorbelegt wäre die Übernahme einer Behauptung ein
 * Klick, und die entstehende Fassung trüge `planer_entscheidung`, ohne dass
 * jemand entschieden hätte.
 *
 * **Was hier NICHT geht, steht hier auch.** Ein laufender Eintrag wird
 * bearbeitet und nicht korrigiert (`z_unveraenderlich` lässt ihn noch zu); eine
 * abgelöste Fassung ist nicht mehr die aktuelle, und die Kette gabelt nicht;
 * und der eigene Zeiteintrag ist für niemanden korrigierbar (`zk_nicht_selbst`,
 * EMP-07). Alle drei weist die Datenbank ab — die Seite sagt es vorher, statt
 * ein Formular anzubieten, das nur scheitern kann.
 */
export const dynamic = 'force-dynamic';

const ART_TEXT: readonly { readonly wert: string; readonly text: string }[] = [
  { wert: 'zeit_korrektur', text: 'Zeit korrigieren — Beginn oder Ende stimmt nicht' },
  { wert: 'pause_korrektur', text: 'Pause korrigieren' },
  {
    wert: 'zuordnung_korrektur',
    text: 'Zuordnung korrigieren — falsches Objekt, falscher Auftrag (Felder unten)',
  },
  { wert: 'nacherfassung', text: 'Nacherfassung — die Aufzeichnung war unvollständig' },
  { wert: 'storno', text: 'Storno — die Aufzeichnung gehört ganz weg' },
];

const GRUND_TEXT: readonly { readonly wert: string; readonly text: string }[] = [
  { wert: 'vergessen_auszustempeln', text: 'vergessen auszustempeln' },
  { wert: 'geraet_defekt', text: 'Gerät defekt' },
  { wert: 'falsches_objekt', text: 'falsches Objekt' },
  { wert: 'einwand_mitarbeiter', text: 'Einwand der Person' },
  { wert: 'nachtrag_offline', text: 'Nachtrag aus der Offline-Warteschlange' },
  { wert: 'sonstiges', text: 'Sonstiges' },
];

/**
 * Die Worte, die `api/zeit/korrektur` zurückschickt — und was sie bedeuten.
 *
 * Jedes davon ist eine Antwort der DATENBANK auf eine Eingabe, die fachlich
 * nicht geht, kein Programmfehler. Deshalb steht hier ein Satz und keine
 * Kennziffer: wer die Korrektur macht, ist Planerin und nicht Entwicklerin.
 * Ein Satz, der ein Recht nennt, nennt es mit seinem Namen (`<Recht>`, V-250)
 * — deshalb ist ein Eintrag ein `ReactNode` und nicht bloss Text.
 */
const FEHLER_TEXT: Readonly<Record<string, ReactNode>> = {
  unbrauchbare_eingabe:
    'Art, Grund und Begründung sind Pflicht. Die Begründung darf kurz sein — „Krank" '
    + 'genügt —, aber sie muss dastehen.',
  pause_unbrauchbar: 'Die Pause wird in ganzen Minuten eingetragen, höchstens vierstellig.',
  nicht_aktuell:
    'Diese Fassung ist nicht mehr die aktuelle — jemand hat den Eintrag inzwischen '
    + 'korrigiert. Korrigiert wird immer die gültige Fassung; die Kette gabelt nicht.',
  laeuft_noch:
    'Der Eintrag läuft noch. Solange nichts feststeht, wird er bearbeitet und nicht '
    + 'korrigiert — die Spur beginnt, wenn der Datensatz geschlossen ist.',
  nicht_selbst:
    'Das ist Ihr eigener Zeiteintrag. Niemand korrigiert die eigene Aufzeichnung '
    + '(EMP-07): Sie melden eine Abweichung, eine andere Person entscheidet darüber.',
  /*
   * V-065: seit die Gegenbuchung entsteht, ist der gesperrte Monat NICHT mehr
   * der haeufigste Grund fuer diese Abweisung — er hat seinen eigenen Text.
   */
  kein_kontorecht: (
    <>
      Der Monat dieses Eintrags ist abgeschlossen. Eine Korrektur daran verschiebt
      Minuten auf dem Stundenkonto in den nächsten offenen Monat, und das verlangt
      zusätzlich das Recht <Recht schluessel="zeit.konto_korrigieren" /> (§12.2). Wer
      es hält, kann die Korrektur ausführen — es ist bewusst ein zweites Recht: eine
      Zeit richtigstellen und ein Konto bewegen sind zwei Entscheidungen.
    </>
  ),
  nicht_zulaessig:
    'Die Datenbank hat die Korrektur abgewiesen. Ein möglicher Grund ist ein bereits '
    + 'gesperrter Monat: dort braucht die Differenz eine Gegenbuchung, sonst käme sie '
    + 'nirgends an (§12.2).',
  nicht_gefunden: 'Diesen Zeiteintrag gibt es in dieser Gesellschaft nicht.',
  zweiter_faktor: 'Für diesen Schritt fehlt die zweite Anmeldestufe.',
  keine_sitzung: 'Die Anmeldung ist abgelaufen. Bitte neu anmelden.',
  /* V-351 (D-827): warum die Zuordnung nicht geändert wurde. */
  zuordnung_falsche_art:
    'Objekt und Leistungszeile ändert nur eine Korrektur der Art „Zuordnung korrigieren".',
  zuordnung_unveraendert:
    'Objekt und Leistungszeile sind dieselben wie bisher — es gibt nichts zu ändern.',
  zuordnung_gesperrt:
    'Der Monat dieses Eintrags ist gesperrt. Eine falsche Zuordnung eines abgeschlossenen '
    + 'Monats berichtigt die Rechnung (Storno und neue Position), nicht der Zeiteintrag '
    + '(Voreinstellung O-891).',
  zuordnung_abgerechnet:
    'Diese Zeit steht in einer festgeschriebenen Rechnung. Berichtigt wird die Rechnung, '
    + 'nicht die Zuordnung der Zeit.',
  zuordnung_in_rechnung:
    'Diese Zeit steht in einem Rechnungsentwurf, der sie mit der bisherigen Zuordnung führt. '
    + 'Erst ihre Position aus dem Entwurf entfernen oder den Entwurf verwerfen, dann '
    + 'korrigieren.',
  objekt_unbekannt: 'Dieses Objekt gibt es in dieser Gesellschaft nicht, oder es ist archiviert.',
  objekt_aus_schicht:
    'Diese Zeit hängt an einer Schicht und damit an deren Objekt. Ein anderes Objekt heisst '
    + 'eine andere Schicht — die Leistungszeile lässt sich hier trotzdem korrigieren.',
  leistung_unbekannt:
    'Diese Leistungszeile gibt es in dieser Gesellschaft nicht, oder Ihrem Konto fehlt das '
    + 'Recht, Aufträge zu lesen.',
  leistung_ausserhalb: 'Diese Leistungszeile galt am Tag der Zeit nicht.',
  leistung_auftrag_laeuft_nicht:
    'Der Auftrag dieser Leistungszeile nimmt keine Zeit an (nur aktive und ruhende Aufträge).',
};

export default async function Korrekturblatt({
  params, searchParams,
}: {
  params: Promise<{ mandant: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/zeiten/${id}/korrektur`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: der Zeiteintrag `…/zeiten/[id]` verlangt laut Manifest `zeit.lesen`,
     dieses Blatt nur `zeit.korrigieren` — wer nur das zweite hält, sah
     „Zum Zeiteintrag", „Abbrechen" und „Zur aktuellen Fassung" und bekam
     dahinter ein 404. Ein Verweis auf 404 verraet, was er nicht zeigen darf
     (Copilot-Runde auf PR 16 / D-581). */
  /* Und das Einwandblatt (`…/zeiten/einwaende/[id]`) traegt ein DRITTES Recht:
     `zeit.einwand_entscheiden` (Routenregister, §5.11). Die Meldung zu SEHEN
     und ueber sie zu ENTSCHEIDEN ist nicht dasselbe wie einen Zeiteintrag zu
     lesen; `zeit.lesen` deckte den Verweis darauf nicht ab. */
  const darf = await haeltRechte(sitzung, 'zeit.lesen', 'zeit.einwand_entscheiden');

  const e = await ladeZeiteintrag(sitzung, id);
  if (e === null) notFound();

  /**
   * Das Recht hat das Tor schon geprüft — diese Adresse steht im Manifest mit
   * `zeit.korrigieren`. Was es NICHT prüfen kann, ist `zk_nicht_selbst`: das
   * hängt am Eintrag, nicht an der Seite. Ein Formular anzubieten, das die
   * Datenbank sicher abweist, wäre eine Einladung in eine Sackgasse.
   */
  const { eigener } = await darfKorrigieren(sitzung, e.personId);

  const frage = await searchParams;
  const fehler = typeof frage['fehler'] === 'string' ? frage['fehler'] : null;

  /**
   * `?einwand=…` — die Meldung, die diese Korrektur beantwortet (EMP-07).
   *
   * **Der Befund, der diesen Zweig gebracht hat.**
   * `zeiteintrag_korrektur.zeit_einwand_id` existiert seit der Anlage der
   * Tabelle mit eigenem Fremdschlüssel, und geschrieben hat sie niemand.
   * `leseEinwand` liest sie: auf dem Einwandblatt steht darum unter „Ist eine
   * Korrektur gefolgt?" für immer „keine" — auch für die Korrektur, die
   * genau diese Meldung beantwortet. Der Knopf dort führt jetzt hierher UND
   * bringt die Kennung mit.
   *
   * **Nicht einsehbar heisst nicht still weg.** Steht in der Adresse eine
   * Kennung, die diese Sitzung nicht lesen darf, wird die Verknüpfung nicht
   * heimlich fallengelassen: die Seite sagt es, und die Korrektur entsteht
   * ohne sie. Ein 404 wäre hier falsch — korrigiert wird der Zeiteintrag,
   * nicht die Meldung.
   */
  const einwandId = typeof frage['einwand'] === 'string' ? frage['einwand'] : null;
  const einwand: EinwandBlatt | null = einwandId === null || !istKennung(einwandId)
    ? null
    : await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => leseEinwand(kontext, einwandId)),
    ) as Promise<EinwandBlatt | null>);
  const einwandUnlesbar = einwandId !== null && einwand === null;

  /*
   * V-351 (D-827): was eine Korrektur der Zuordnung anbieten kann — die
   * Leistungszeilen, die am Berliner Tag der Zeit galten (nur mit
   * `auftrag.lesen`, sonst kein Feld), und Objekte nur für eine Zeit ohne
   * Schicht (mit `objekt.lesen`).
   */
  const zuordnungRechte = await haeltRechte(sitzung, 'auftrag.lesen', 'objekt.lesen');
  const auswahl = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [t] = await kontext.abfrage<{ tag: string }>(
        `select (beginn_zeitpunkt at time zone 'Europe/Berlin')::date::text as tag
           from zeiteintrag where id = $1::uuid`, [id]);
      const leistungen = t !== undefined && zuordnungRechte['auftrag.lesen'] === true
        ? await listeLeistungenAmTag(kontext, t.tag) : null;
      const objekte = e.einsatzId === null && zuordnungRechte['objekt.lesen'] === true
        ? await kontext.abfrage<{ id: string; bezeichnung: string }>(
          `select id, bezeichnung from objekt where archiviert_am is null
            order by bezeichnung limit 500`)
        : null;
      return { leistungen, objekte };
    })) as Promise<{
      leistungen: readonly AnkerbareLeistung[] | null;
      objekte: readonly { readonly id: string; readonly bezeichnung: string }[] | null;
    }>);
  /* `?art=zuordnung_korrektur` — der Weg vom Zeitblatt „ohne Auftrag" hierher. */
  const artVor = typeof frage['art'] === 'string'
    && ART_TEXT.some((a) => a.wert === frage['art']) ? frage['art'] : 'zeit_korrektur';

  const abgeloest = e.ersetztDurchId !== null;
  const laeuft = e.status === 'laufend';
  const sperre = abgeloest
    ? 'abgeloest' : laeuft ? 'laufend' : eigener ? 'selbst' : null;

  const eingabe = 'mt-s1 w-full rounded-md border border-line bg-surface px-s3 py-s2 text-base text-text';
  const beschriftung = 'text-micro uppercase tracking-[0.08em] text-text-subtle';

  return (
    <PortalRahmen
      titel="Zeiteintrag korrigieren"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Korrektur</h1>
        {darf['zeit.lesen'] === true && (
          <Link
            href={`/portal/${mandant}/zeiten/${id}`}
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
          >
            Zum Zeiteintrag
          </Link>
        )}
      </div>

      <p className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
        Eine Korrektur <strong className="text-text">ändert den Eintrag nicht</strong>: sie
        schreibt eine neue Fassung und lässt die alte stehen. Was hier entsteht, ist
        die Antwort auf die Frage, die im Streitfall gestellt wird — wer hat wann und
        warum etwas anderes aufgezeichnet als das Gerät (TIM-11, Invariante 8).
      </p>

      {fehler !== null && (
        <p
          data-cse="korrektur-fehler"
          className="mb-s5 max-w-prose rounded-lg border border-danger bg-danger-soft p-s4 text-sm text-danger"
        >
          {eigenerEintrag(FEHLER_TEXT, fehler)
            ?? 'Die Korrektur wurde nicht geschrieben. Prüfen Sie die Angaben und speichern Sie '
              + 'noch einmal.'}
        </p>
      )}

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s2 mt-0 text-h3 text-text">Aufgezeichnet — {e.person}</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Diese Werte gelten, bis eine Korrektur geschrieben ist. Sie stehen hier zum
          Lesen und nicht in den Feldern darunter: übernommen wäre die Behauptung eines
          Menschen von einer Entscheidung nicht mehr zu unterscheiden.
        </p>
        <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
          <Feld label="Beginn (Serveruhr)" wert={e.beginnVollLokal} />
          <Feld label="Ende (Serveruhr)" wert={e.endeVollLokal ?? 'läuft noch'} />
          <Feld label="Pause" wert={`${String(e.pauseMinuten)} min`} />
          <Feld
            label="Netto"
            wert={e.nettoMinuten === null ? '—' : stundenAusMinuten(e.nettoMinuten)}
          />
          <Feld label="Objekt" wert={e.objekt ?? 'ohne Objekt'} />
          <Feld label="Fassung" wert={`Version ${String(e.version)}`} />
        </dl>

        {(e.behauptetBeginnLokal !== null || e.behauptetEndeLokal !== null
          || e.behauptetPauseMinuten !== null) && (
          <>
            <h3 className="mb-s2 mt-s5 text-base text-text">Was die Person angegeben hat</h3>
            <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
              <Feld label="Angegebener Beginn" wert={e.behauptetBeginnLokal ?? '—'} />
              <Feld label="Angegebenes Ende" wert={e.behauptetEndeLokal ?? '—'} />
              <Feld
                label="Angegebene Pause"
                wert={e.behauptetPauseMinuten === null
                  ? '—' : `${String(e.behauptetPauseMinuten)} min`}
              />
            </dl>
          </>
        )}
      </section>

      {sperre !== null ? (
        <p
          data-cse="korrektur-gesperrt"
          className="max-w-prose rounded-lg border border-warning bg-warning-soft p-s5 text-sm text-warning"
        >
          {sperre === 'abgeloest' ? (
            <>
              Diese Fassung ist nicht mehr die aktuelle. Korrigiert wird immer die
              gültige Fassung — sonst gäbe es zwei „aktuelle" Wahrheiten über dieselbe
              Schicht, und jede Stundenauswertung zählte doppelt.
              {e.ersetztDurchId !== null && darf['zeit.lesen'] === true && (
                <>
                  {' '}
                  <Link href={`/portal/${mandant}/zeiten/${e.ersetztDurchId}`} className="underline">
                    Zur aktuellen Fassung
                  </Link>
                </>
              )}
            </>
          ) : sperre === 'laufend' ? (
            <>
              Der Eintrag läuft noch. Solange nichts feststeht, wird er bearbeitet und
              nicht korrigiert; die Korrekturspur beginnt, wenn der Datensatz
              geschlossen ist.
            </>
          ) : (
            <>
              Das ist Ihr eigener Zeiteintrag. Niemand korrigiert die eigene
              Aufzeichnung (EMP-07) — was die betroffene Person selbst schreibt, ist
              ihre Behauptung und keine Aufzeichnung mehr. Melden Sie die Abweichung
              über <Link href="/portal/mein/zeiten" className="underline">Meine Zeiten</Link>;
              entscheiden muss eine andere Person.
            </>
          )}
        </p>
      ) : (
        <form
          method="post"
          action="/api/zeit/korrektur"
          data-cse="korrektur-formular"
          className="grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="eintrag" value={id} />
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="zurueck" value={pfad} />
          {einwand !== null && (
            <input type="hidden" name="einwand" value={einwand.id} />
          )}

          {einwand !== null && (
            <p
              data-cse="antwortet-auf-einwand"
              className="m-0 rounded-md border border-line bg-surface-2 p-s3 text-sm text-text-muted"
            >
              <strong className="text-text">Antwort auf eine Meldung.</strong>{' '}
              {einwand.person} hat für den {tagDeutsch(einwand.betrifftDatum)} eine
              Abweichung gemeldet (Stand: {wortFuer(EINWAND_STATUS_TEXT, einwand.status)}).
              Diese Korrektur wird mit ihr verknüpft, damit
              auf dem Einwandblatt steht, dass sie gefolgt ist.{' '}
              {darf['zeit.einwand_entscheiden'] === true && (
                <Link
                  href={`/portal/${mandant}/zeiten/einwaende/${einwand.id}`}
                  className="underline"
                >
                  Zur Meldung
                </Link>
              )}
            </p>
          )}
          {einwandUnlesbar && (
            <p
              data-cse="einwand-unlesbar"
              className="m-0 rounded-md border border-line bg-surface-2 p-s3 text-sm text-text-muted"
            >
              <strong className="text-text">Die angegebene Meldung ist nicht
              einsehbar.</strong> Sie gehört einer anderen Gesellschaft, es gibt sie
              nicht, oder dieser Sitzung fehlt <Recht schluessel="zeit.lesen" />. Die Korrektur
              entsteht <strong>ohne</strong> Verknüpfung — sie wird nicht stillschweigend
              angehängt.
            </p>
          )}

          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <div>
              <label className={beschriftung} htmlFor="art">Art der Korrektur</label>
              <select id="art" name="art" required defaultValue={artVor} className={eingabe}>
                {ART_TEXT.map((a) => (
                  <option key={a.wert} value={a.wert}>{a.text}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={beschriftung} htmlFor="grund">Grund</label>
              <select id="grund" name="grund" required defaultValue="einwand_mitarbeiter" className={eingabe}>
                {GRUND_TEXT.map((g) => (
                  <option key={g.wert} value={g.wert}>{g.text}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-3">
            <div>
              <label className={beschriftung} htmlFor="beginn">Beginn (Berliner Zeit)</label>
              <input id="beginn" name="beginn" type="datetime-local" className={eingabe} />
            </div>
            <div>
              <label className={beschriftung} htmlFor="ende">Ende (Berliner Zeit)</label>
              <input id="ende" name="ende" type="datetime-local" className={eingabe} />
            </div>
            <div>
              <label className={beschriftung} htmlFor="pause">Pause (Minuten)</label>
              <input
                id="pause"
                name="pause"
                type="number"
                min={0}
                max={9999}
                step={1}
                inputMode="numeric"
                className={eingabe}
              />
            </div>
          </div>
          <p className="m-0 max-w-prose text-sm text-text-muted">
            Leer heisst <strong className="text-text">unverändert</strong>. Die Zeiten
            werden als Berliner Ortszeit gelesen und als UTC gespeichert — in der
            Umstellungsnacht ist das der Unterschied zwischen einer erfundenen und einer
            gearbeiteten Stunde (Invariante 2).
          </p>

          <fieldset className="m-0 grid grid-cols-1 gap-s4 border-0 p-0 sm:grid-cols-2"
                    data-cse="korrektur-zuordnung">
            <legend className="mb-s2 text-sm text-text">
              Zuordnung — nur mit „Zuordnung korrigieren"
            </legend>
            <div>
              <label className={beschriftung} htmlFor="auftrag_leistung">Leistungszeile</label>
              {auswahl.leistungen === null ? (
                <p className="m-0 mt-s1 text-sm text-text-muted">
                  Leistungszeilen sieht nur, wer Aufträge lesen darf:{' '}
                  <Recht schluessel="auftrag.lesen" />. Die Leistungszeile bleibt, wie sie ist.
                </p>
              ) : (
                <select id="auftrag_leistung" name="auftrag_leistung" defaultValue=""
                        className={eingabe} data-cse="korrektur-leistung">
                  <option value="">unverändert ({e.auftragsnummer ?? 'ohne Auftrag'})</option>
                  {auswahl.leistungen.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.auftragsnummer} · Pos. {l.positionNr} · {l.bezeichnung}
                      {l.kunde === null ? '' : ` · ${l.kunde}`}
                      {l.objekt === null ? '' : ` · ${l.objekt}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className={beschriftung} htmlFor="objekt">Objekt</label>
              {auswahl.objekte === null ? (
                <p className="m-0 mt-s1 text-sm text-text-muted">
                  {e.einsatzId !== null
                    ? 'Die Zeit hängt an einer Schicht und damit an deren Objekt.'
                    : 'Objekte sieht nur, wer sie lesen darf — das Objekt bleibt, wie es ist.'}
                </p>
              ) : (
                <select id="objekt" name="objekt" defaultValue="" className={eingabe}
                        data-cse="korrektur-objekt">
                  <option value="">unverändert ({e.objekt ?? 'ohne Objekt'})</option>
                  {auswahl.objekte.map((o) => (
                    <option key={o.id} value={o.id}>{o.bezeichnung}</option>
                  ))}
                </select>
              )}
            </div>
            <p className="m-0 max-w-prose text-sm text-text-muted sm:col-span-2">
              Angeboten werden die Leistungszeilen, die am Tag dieser Zeit galten. Im
              gesperrten oder abgerechneten Monat ändert eine Korrektur die Zuordnung
              nicht — dort berichtigt die Rechnung (Voreinstellung O-891).
            </p>
          </fieldset>

          <div>
            <label className={beschriftung} htmlFor="begruendung">Begründung (Pflicht)</label>
            <textarea
              id="begruendung"
              name="begruendung"
              rows={3}
              required
              className={eingabe}
              placeholder="Was wurde geprüft, und woran? Kurz genügt."
            />
            <p className="m-0 mt-s2 max-w-prose text-sm text-text-muted">
              Ohne Mindestlänge, mit Absicht (§5.7): „Krank" ist eine Begründung, und
              eine erzwungene Zeichenzahl erzeugt nur „xxxxxxxxxx". Was hier steht, steht
              unveränderlich in der Korrekturspur — beim Storno ist es zugleich der
              Stornogrund.
            </p>
          </div>

          <div className="flex flex-wrap gap-s3">
            <Button type="submit" variante="primary">Korrektur schreiben</Button>
            {darf['zeit.lesen'] === true && (
              <Link
                href={`/portal/${mandant}/zeiten/${id}`}
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
              >
                Abbrechen
              </Link>
            )}
          </div>
        </form>
      )}
    </PortalRahmen>
  );
}

function Feld({ label, wert }: { readonly label: string; readonly wert: string }) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd className="m-0 mt-s1 text-sm tabular-nums text-text">{wert}</dd>
    </div>
  );
}
