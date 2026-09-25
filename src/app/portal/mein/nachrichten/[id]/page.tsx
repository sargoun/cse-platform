import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { findeEintrag, type Eintrag } from '@/server/benachrichtigung/posteingang';
import {
  ANLAGEN_ABRUFBAR, ladeMeinenFaden, type MeinFaden,
} from '@/server/services/mitarbeiter/nachricht';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Feld, Felder, Gesellschaft, Hinweis } from '../../bausteine';
import { FormularFehler } from '../../FormularAntwort';

/**
 * `/portal/mein/nachrichten/[id]` — EIN Eintrag, und es gibt zwei Arten davon
 * (EMP-11, NOT-01, NOT-03, AUT-06).
 *
 * **Eine Adresse für beide Quellen.** Der Posteingang führt Systemmeldungen
 * (`benachrichtigung`) und Nachrichtenfäden (`nachricht`) in einer Liste; die
 * Detailseite muss deshalb beides öffnen können. Sie fragt in dieser
 * Reihenfolge: erst die Meldung, dann den Faden. Das ist kein Raten — eine
 * Meldungs-Id und eine Faden-Id sind beides `gen_random_uuid()`, sie kollidieren
 * nicht, und die Reihenfolge hält jeden ALTEN Verweis auf eine Meldung gültig.
 * Eine zweite Adresse (`…/faden/[id]`) hätte dieselbe Seite zweimal gebraucht
 * und jeden verschickten Link auf die Frage gestellt, welcher Art er ist.
 *
 * **Die Seite stempelt NICHT.** Lesen ist ein GET; `gelesen_am` setzt nur ein
 * POST — für die Meldung `/api/benachrichtigungen/[id]/oeffnen`, für den Faden
 * `/api/mein/nachrichten/[id]`. Wer das Stempeln in den Seitenaufruf legt,
 * lässt den Posteingang von einem Vorauslader oder einem weitergeleiteten
 * Link leeren (D-504) — und danach behauptet das Protokoll, der Mensch habe
 * gelesen, was er nie gesehen hat.
 *
 * **Ein fremder Eintrag ist nicht vorhanden**, nicht verboten (AUT-06):
 * `t_benachrichtigung_eigene` bindet an `empfaenger_id =
 * app.aktueller_benutzer()`, `t_nachricht_eigene` und `p_beteiligt` (0231) an
 * die Fadenbeteiligung — je Empfängerart, `person` gegen die Personen-Id und
 * `benutzer` gegen die Anmelde-Id (D-09). Beide liefern null Zeilen, und diese
 * Seite antwortet 404.
 *
 * **Antworten bleibt im Portal.** `richtung = 'intern'`, `kanal = 'portal'`;
 * nichts verlässt das System (Invariante 7). Der Satz steht auch auf dem
 * Bildschirm, damit niemand eine Antwort tippt und sie für eine E-Mail hält.
 */
export const dynamic = 'force-dynamic';

type Gefunden =
  | { readonly art: 'meldung'; readonly meldung: Eintrag }
  | { readonly art: 'faden'; readonly faden: MeinFaden };

/**
 * Was der POST gemeldet hat — aus `?getan=`.
 *
 * **Eine geschlossene Menge, kein durchgereichter Text.** Was in der Adresse
 * steht, hat der Absender des Links geschrieben; auf den Bildschirm kommt nur
 * ein Satz aus `MEIN_TEXTE`, in der Sprache dieses Menschen (EMP-12).
 */
const GETAN = ['gelesen', 'gelesen_schon', 'geantwortet'] as const;
type Getan = typeof GETAN[number];

export default async function MeineNachricht(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const roh = (await params).id;
  const id = kennungOder404(roh);
  const suche = await searchParams;
  const getanRoh = typeof suche['getan'] === 'string' ? suche['getan'] : null;
  const getan: Getan | null = GETAN.find((g) => g === getanRoh) ?? null;

  const ergebnis = await meinPortal<Gefunden | null>(
    `/portal/mein/nachrichten/${id}`,
    async (kontext) => {
      const meldung = await findeEintrag(kontext, id);
      if (meldung !== null) return { art: 'meldung', meldung };
      const faden = await ladeMeinenFaden(kontext, id);
      return faden === null ? null : { art: 'faden', faden };
    },
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const t = basis.texte;
  const zeitpunkt = new Intl.DateTimeFormat(basis.sprache === 'de' ? 'de-DE' : basis.sprache, {
    timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
  });

  /*
   * Der Rueckweg als EIGENSCHAFT der Huelle, nicht als Knoten im Rumpf
   * (DESIGN §5, D-613). Beide Zweige dieser Seite gaben ihn hier aus — und
   * seit die Huelle ihn aus der Adresse ableitet, standen zwei Pfeile
   * untereinander. Als Eigenschaft ersetzt er den abgeleiteten, statt sich
   * daneben zu stellen; die Beschriftung bleibt dieselbe.
   */
  const zurueck = { ziel: '/portal/mein/nachrichten', text: t.nachrichten };

  if (ergebnis.daten.art === 'meldung') {
    const e = ergebnis.daten.meldung;
    return (
      <MeinRahmen basis={basis} titel={t.nachrichten} aktiverTab="nachrichten"
                  zurueck={zurueck}>

        <div className="mb-s5 flex flex-wrap items-center gap-s3">
          <h1 className="m-0 text-h1 text-text">{e.titel}</h1>
          <span data-cse="eintrag-art" className="text-sm text-text-subtle">
            {t.systemmeldung}
          </span>
          <StatusPill sprache={basis.sprache} zustand={e.gelesenAm === null ? 'Wartet' : 'Inaktiv'} />
        </div>

        <section
          data-cse="nachricht"
          data-art="meldung"
          data-gelesen={String(e.gelesenAm !== null)}
          className={`mb-s5 rounded-lg border p-s4 ${
            e.gelesenAm === null ? 'border-brand bg-brand-soft' : 'border-line bg-surface'
          }`}
        >
          <p className="m-0 mb-s4 max-w-[60ch] whitespace-pre-line text-base text-text">
            {e.text}
          </p>
          <Felder>
            {e.mandantSlug !== null && (
              <Feld label={t.gesellschaft}>
                <Gesellschaft slug={e.mandantSlug} name={e.mandantName ?? e.mandantSlug} />
              </Feld>
            )}
            <Feld label={t.empfangenAm}>
              <time dateTime={e.erstelltAm.toISOString()} className="cse-zahl">
                {zeitpunkt.format(e.erstelltAm)}
              </time>
            </Feld>
            <Feld label={t.status}>
              {e.gelesenAm === null ? t.ungelesen : (
                <>
                  {t.gelesen}
                  {' · '}
                  <time dateTime={e.gelesenAm.toISOString()} className="cse-zahl">
                    {zeitpunkt.format(e.gelesenAm)}
                  </time>
                </>
              )}
            </Feld>
          </Felder>
        </section>

        {/*
          Genau zwei Wege: zum Datensatz (stempelt dabei) und zurueck in den
          Posteingang. NOT-03 verlangt, dass jede Meldung auf ihren Datensatz
          zeigt — eine Meldung ohne Weg dorthin ist eine Nachricht ueber etwas,
          das man danach suchen muss. Das Ziel kommt aus der ZEILE
          (`benachrichtigung.ziel`), nie aus einem Feld dieses Formulars: das
          waere eine offene Weiterleitung mit einer echten Anmeldung davor.
        */}
        <form method="post" action={`/api/benachrichtigungen/${e.id}/oeffnen`}>
          <Button type="submit" data-cse="nachricht-oeffnen">{t.zumDatensatz}</Button>
        </form>
      </MeinRahmen>
    );
  }

  const f = ergebnis.daten.faden;
  const titel = f.betreff ?? t.nachricht;

  return (
    <MeinRahmen basis={basis} titel={t.nachrichten} aktiverTab="nachrichten"
                zurueck={zurueck}>

      {getan !== null && (
        <p data-cse="getan" data-was={getan} className="mb-s4 m-0 text-base text-text">
          {getan === 'gelesen_schon'
            ? t.schonGelesen
            : getan === 'geantwortet'
              ? `${t.gespeichert} ${t.antwortImVorgang}`
              : t.gespeichert}
        </p>
      )}

      {/* Eine abgewiesene Antwort — leer, oder der Faden ist inzwischen zu (V-198). */}
      <FormularFehler sprache={basis.sprache} grund={suche['fehler']} />

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{titel}</h1>
        <span data-cse="eintrag-art" className="text-sm text-text-subtle">
          {t.nachrichtenFaden}
        </span>
        <StatusPill sprache={basis.sprache}
          zustand={f.geschlossen ? 'Abgeschlossen' : f.ungelesen > 0 ? 'Wartet' : 'Inaktiv'}
        />
      </div>

      {f.mandantSlug !== null && (
        <p className="mb-s5">
          <Gesellschaft slug={f.mandantSlug} name={f.mandantName ?? f.mandantSlug} />
        </p>
      )}

      <h2 className="mb-s3 text-h3 text-text">{t.verlauf}</h2>
      <ul
        data-cse="faden"
        data-zeilen={String(f.zeilen.length)}
        className="m-0 mb-s5 flex list-none flex-col gap-s3 p-0"
      >
        {f.zeilen.map((z) => (
          <li
            key={z.id}
            data-cse="faden-zeile"
            data-eigene={String(z.vonMir)}
            data-gelesen={String(!z.anMich || z.gelesenAm !== null)}
            className={`rounded-lg border p-s4 ${
              z.anMich && z.gelesenAm === null
                ? 'border-brand bg-brand-soft'
                : 'border-line bg-surface'
            }`}
          >
            <p className="m-0 mb-s2 flex flex-wrap items-baseline justify-between gap-s2
                          text-sm text-text-muted">
              {/*
                * Der Name kommt aus `kern.nachricht_absender_name()` (0350) —
                * `benutzer` ist im Personen-Scope bis auf die eigene Zeile
                * unlesbar (K-20), und ein `join` lieferte hier stillschweigend
                * nichts. `null` heisst „nicht auflösbar" und wird benannt,
                * statt als Gedankenstrich dazustehen.
                */}
              <span data-cse="absender">
                {z.vonMir ? t.ichSelbst : z.absender ?? t.unbekannterAbsender}
              </span>
              <time dateTime={z.erstelltAm.toISOString()} className="cse-zahl">
                {zeitpunkt.format(z.erstelltAm)}
              </time>
            </p>
            <p className="m-0 max-w-[60ch] whitespace-pre-line text-base text-text">
              {z.koerper}
            </p>
            {/*
              * **Die ZAHL der Anlagen, und der Satz dazu** (O-831). Eine
              * Nachricht mit einer Anlage, die aussieht wie eine ohne, ist die
              * schlechtere Antwort: dann sucht niemand nach der Datei, von der
              * die Nachricht spricht. Ein Verweis stünde dagegen vor einem 404
              * — `dokument` hat im Personen-Scope keinen Lesepfad.
              */}
            {z.anhaenge > 0 && (
              <p data-cse="anlagen" data-anzahl={String(z.anhaenge)}
                 className="m-0 mt-s3 text-sm text-text-muted">
                {t.anlagen}: <span className="cse-zahl">{z.anhaenge}</span>
                {ANLAGEN_ABRUFBAR ? null : <> — {t.anlagenNichtAbrufbar}</>}
              </p>
            )}
          </li>
        ))}
      </ul>

      {/*
        * „Als gelesen markieren" steht nur da, wenn es etwas zu stempeln GIBT.
        * Ein Knopf, der null eigene Zeilen trifft und danach „Gespeichert."
        * meldet, ist eine Behauptung — derselbe Befund, den `ladeFaden` in
        * `services/kern/nachricht.ts` am Feld `ungelesen` beschreibt.
        */}
      {f.ungelesen > 0 && (
        <form
          method="post"
          action={`/api/mein/nachrichten/${f.threadId}`}
          className="mb-s5"
        >
          <input type="hidden" name="was" value="gelesen" />
          <Button type="submit" variante="secondary" data-cse="faden-gelesen">
            {t.alsGelesenMarkieren}
          </Button>
        </form>
      )}

      {f.geschlossen ? (
        <Hinweis text={t.fadenGeschlossen} marke="faden-geschlossen" />
      ) : (
        <form
          method="post"
          action={`/api/mein/nachrichten/${f.threadId}`}
          className="max-w-prose rounded-lg border border-line bg-surface p-s4"
        >
          <input type="hidden" name="was" value="antworten" />
          <label className="block text-sm text-text" htmlFor="koerper">
            {t.ihreAntwort}
          </label>
          <textarea
            id="koerper" name="koerper" rows={4} required
            className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3
                       text-base text-text"
          />
          <Button type="submit" variante="secondary" data-cse="faden-antworten"
                  className="mt-s4">
            {t.antworten}
          </Button>
          <p className="m-0 mt-s3 text-sm text-text-subtle">{t.antwortNurImPortal}</p>
        </form>
      )}
    </MeinRahmen>
  );
}
