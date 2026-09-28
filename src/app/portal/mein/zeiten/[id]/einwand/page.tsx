import { notFound } from 'next/navigation';
import { tagInSprache } from '@/lib/datum/kalendertag';
import { EINWAND_ARTEN, EINWAND_ART_TEXTE } from '@/lib/i18n/texte';
import { EINWAND_FORM_TEXTE } from '@/lib/i18n/mein-formulare';
import {
  findeEigenenZeiteintrag, type EigenerZeiteintrag,
} from '@/server/services/mitarbeiter/zeiten';
import { listeEigeneEinwaende, type EinwandZeile }
  from '@/server/services/zeit/einwand';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../../rahmen';
import { EinwandListe, Feld, Felder } from '../../../bausteine';
import { EinwandGesendet, FormularFehler } from '../../../FormularAntwort';

/**
 * `/portal/mein/zeiten/[id]/einwand` — der EINZIGE Schreibweg des Menschen in
 * der Zeitdomaene (EMP-07, TIM-11, LEG-02).
 *
 * **Und er aendert nichts.** Er legt einen Vorgang an: `zeit_einwand` mit
 * `behauptet_beginn`, `behauptet_ende`, `behauptet_pause_minuten` — die
 * BEHAUPTUNG, nie ein massgeblicher Zeitpunkt (Invariante 5). Der Zeiteintrag
 * bleibt, wie er ist, inklusive der Zeit, die die Person fuer falsch haelt,
 * bis die Planung entschieden und `korrigiereZeiteintrag` eine neue Fassung
 * gepraegt hat. Genau das ist der Grund, warum der Datensatz im Lohnstreit
 * etwas wert ist.
 *
 * **Der Weg ist die vorhandene Route `POST /api/zeit/einwand`** (PR 36) und
 * keine zweite daneben: sie loest den Mandanten serverseitig aus der
 * Beschaeftigung auf (K-02), betritt `withTenant` neu — im Personen-Scope ist
 * `app.aktiver_mandant()` NULL und keine Schreibpolicy traefe zu (K-18) — und
 * wird von der Policy `t_selbst_einreichen` bewacht, die nur Zeilen zulaesst,
 * deren Anstellung dem angemeldeten Menschen gehoert.
 *
 * Ein echtes `<form method="post">`: das Formular muss auf einem alten
 * Diensttelefon in einem Treppenhaus funktionieren, und das heisst ohne
 * JavaScript (SEITENKARTE §13).
 *
 * **Nach dem Absenden kommt diese Seite zurueck** (V-189, V-198): das
 * Formular schickt `zurueck` (diese Seite mit `?gesendet=1`) und `fehlerweg`
 * (diese Seite); die Route leitet den Erfolg dorthin und eine Abweisung mit
 * `?fehler=`. Vorher endete das Absenden auf einer weissen Seite mit
 * `{"einwand": "…"}`.
 *
 * **Fuer eine Schicht OHNE Eintrag gibt es diese Seite nicht** — sie braucht
 * einen Eintrag. Dafuer steht `/portal/mein/zeiten/einwand` („Eine Zeit
 * fehlt"), verlinkt von „Meine Zeiten" und vom Blatt der Schicht.
 */
export const dynamic = 'force-dynamic';

interface Daten {
  readonly eintrag: EigenerZeiteintrag | null;
  readonly eigene: readonly EinwandZeile[];
}

export default async function EinwandFormular(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { id } = await params;
  /*
   * **Wohin ein abgeschickter Einwand führt** (V-189, V-198, D-692, D-599).
   * Die Route antwortete auch bei ERFOLG mit `{"einwand":"<uuid>"}` — eine
   * weisse Seite mit einer Kennung. Jetzt kommt sie hierher zurück:
   * `?gesendet=1` nach dem Eingang, `?fehler=<grund>` nach einer Abweisung.
   */
  const suche = await searchParams;
  const fehler = suche['fehler'];
  const gesendet = suche['gesendet'] === '1';
  const ergebnis = await meinPortal<Daten>(
    `/portal/mein/zeiten/${id}/einwand`,
    async (kontext) => ({
      eintrag: await findeEigenenZeiteintrag(kontext, id),
      eigene: await listeEigeneEinwaende(kontext),
    }),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const z = daten.eintrag;
  // Ein fremder Eintrag ist fuer diese Anmeldung nicht vorhanden (AUT-06).
  if (z === null) notFound();
  const t = basis.texte;
  const ft = EINWAND_FORM_TEXTE[basis.sprache];
  const arten = EINWAND_ART_TEXTE[basis.sprache];
  const zuDiesem = daten.eigene.filter((e) => e.zeiteintragId === z.id);
  const eingabe =
    'min-h-11 w-full rounded-md border border-line-strong bg-surface px-s3 py-s2 '
    + 'text-base text-text';

  return (
    <MeinRahmen basis={basis} titel={t.einwandMelden} aktiverTab="stunden"
      zurueck={{ ziel: `/portal/mein/zeiten/${z.id}`, text: t.zeiten }}
    >

      <h1 className="mb-s4 text-h1 text-text">{t.einwandMelden}</h1>

      {/* Eine Abweisung und „eingegangen" zugleich wäre ein Widerspruch (V-189). */}
      {gesendet && fehler === undefined && <EinwandGesendet sprache={basis.sprache} />}
      {/* Die Sätze dieser Maske zuerst (`EINWAND_FORM_TEXTE`), dann die des Portals. */}
      <FormularFehler sprache={basis.sprache} grund={fehler} maske={ft}
        zusatz={suche['begruendung_neu'] === 'ja' ? ft.begruendungErneut : null} />

      <section className="mb-s5 rounded-lg border border-line bg-surface p-s4">
        <Felder>
          <Feld label={t.datum}>
            <span className="cse-zahl">{tagInSprache(z.tag, basis.sprache)}</span>
          </Feld>
          <Feld label={t.beginn}><span className="cse-zahl">{z.beginnLokal}</span></Feld>
          <Feld label={t.ende}><span className="cse-zahl">{z.endeLokal ?? '—'}</span></Feld>
          <Feld label={t.gesellschaft}>{z.mandantName}</Feld>
        </Felder>
      </section>

      <form
        method="post"
        action="/api/zeit/einwand"
        data-cse="einwand-formular"
        className="flex max-w-prose flex-col gap-s4"
      >
        {/*
          Beschaeftigung und Eintrag reisen als versteckte Felder mit — und
          werden vom Dienst gegen die Personen-RLS geprueft, nicht geglaubt:
          eine fremde `anstellung` liefert dort null Zeilen und damit 404
          (AUT-06). Der Mandant steht bewusst NICHT im Formular; er wird
          serverseitig aus der Beschaeftigung abgeleitet (K-02).
        */}
        <input type="hidden" name="anstellung" value={z.anstellungId} />
        <input type="hidden" name="zeiteintrag" value={z.id} />
        <input type="hidden" name="datum" value={z.tag} />
        {/*
          Nach dem Absenden zurück auf DIESE Seite (V-189, V-198): sie bestätigt
          den Eingang und zeigt die Meldung unten in der Liste — oder den
          Grund, warum sie nicht gespeichert wurde.
        */}
        <input type="hidden" name="zurueck" value={`/portal/mein/zeiten/${z.id}/einwand?gesendet=1`} />
        <input type="hidden" name="fehlerweg" value={`/portal/mein/zeiten/${z.id}/einwand`} />

        <div className="flex flex-col gap-s2">
          <label htmlFor="einwand-art" className="text-base text-text">
            {t.einwandArt} <span aria-hidden="true">*</span>
            <span className="sr-only">{t.pflichtfeld}</span>
          </label>
          <select id="einwand-art" name="art" required className={eingabe}>
            {EINWAND_ARTEN.map((a) => (
              <option key={a} value={a}>{arten[a]}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-s2">
          <label htmlFor="einwand-begruendung" className="text-base text-text">
            {t.einwandBegruendung} <span aria-hidden="true">*</span>
            <span className="sr-only">{t.pflichtfeld}</span>
          </label>
          <textarea
            id="einwand-begruendung"
            name="begruendung"
            required
            rows={4}
            className={eingabe}
          />
        </div>

        {/*
          Die BEHAUPTETEN Zeiten sind freiwillig: wer nur sagen will „die
          Schicht fehlt", soll nicht an einem Uhrzeitfeld haengenbleiben. Was
          hier eingetragen wird, landet in `behauptet_*` und wird nie ein
          massgeblicher Zeitpunkt (Invariante 5, §1.8).
        */}
        <div className="grid gap-s4 sm:grid-cols-2">
          <div className="flex flex-col gap-s2">
            <label htmlFor="einwand-beginn" className="text-base text-text">
              {t.beginn}
            </label>
            <input
              id="einwand-beginn" name="beginn" type="datetime-local" className={eingabe}
            />
          </div>
          <div className="flex flex-col gap-s2">
            <label htmlFor="einwand-ende" className="text-base text-text">
              {t.ende}
            </label>
            <input
              id="einwand-ende" name="ende" type="datetime-local" className={eingabe}
            />
          </div>
        </div>

        <div className="flex flex-col gap-s2">
          <label htmlFor="einwand-pause" className="text-base text-text">
            {t.pauseMinuten}
          </label>
          <input
            id="einwand-pause" name="pause" type="number" min={0} step={1}
            inputMode="numeric" className={eingabe}
          />
        </div>

        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand
                     px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
        >
          {t.absenden}
        </button>
      </form>

      {/*
        * **Was aus der Meldung wurde** (V-051, V-189, EMP-07) — `EinwandListe`,
        * derselbe Baustein wie auf „Eine Zeit fehlt".
        *
        * Vorher stand hier der rohe Enum-Wert — `teilweise_anerkannt` — und
        * sonst nichts. Wann entschieden wurde und mit welcher Begruendung
        * lag in `zeit_einwand`, wurde von `listeEigeneEinwaende` geladen und
        * nie gezeigt. Eine Person, die einen falschen Lohn meldet, las damit
        * ein Wort ihrer Datenbank und erfuhr nie, warum.
        *
        * Die Begruendung steht in der Sprache, in der die Planung sie
        * geschrieben hat, und wird NICHT uebersetzt: sie ist eine Aussage
        * eines Menschen ueber einen Einzelfall, keine Beschriftung. Was
        * uebersetzt wird, sind die Woerter darum herum. Eingangs- und
        * Entscheidungstag stehen in derselben Form wie der Tag oben
        * (`tagVonZeitpunktInSprache`, V-201).
        */}
      <section className="mt-s6">
        <h2 className="mb-s3 text-h3 text-text">{t.meineMeldungen}</h2>
        <EinwandListe einwaende={zuDiesem} texte={t} sprache={basis.sprache} />
      </section>
    </MeinRahmen>
  );
}
