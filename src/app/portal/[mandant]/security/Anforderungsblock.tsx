import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import type { AnforderungTexte } from '@/lib/i18n/verwaltung/anforderung';
import type {
  AnforderungBereich, AnforderungHerkunft, AnforderungZeile,
} from '@/server/services/security/anforderung';

/**
 * Der Block „Verlangte Nachweise" — auf dem Postenblatt und auf dem Blatt
 * einer Veranstaltung (SEC-01, SEC-04, SEC-08, V-179).
 *
 * **Zeigen UND eintragen, an derselben Stelle.** Bis V-179 stand hier die
 * Liste und darunter der Satz „angelegt werden sie woanders" — ein Woanders
 * gab es nicht, und ohne Zeile meldete das SEC-04-Tor jede Einteilung als
 * erfüllt. Die Liste zeigt, was additiv gilt (Posten bzw. Veranstaltung,
 * Objekt, Gesellschaft), das Formular trägt ein, was ein Mensch mit
 * `security.schreiben` verlangt — für genau die Bereiche, die von dieser
 * Seite aus erreichbar sind.
 *
 * Ein echtes `<form method="post">` ohne Skript; die Route antwortet einem
 * Browser mit einer Seite, nie mit JSON (D-599).
 */
export function Anforderungsblock({
  texte, anforderungen, qualifikationen, herkunft, hatObjekt, darfSchreiben, zurueck, meldung,
}: {
  readonly texte: AnforderungTexte;
  readonly anforderungen: readonly AnforderungZeile[];
  readonly qualifikationen: readonly { readonly id: string; readonly bezeichnung: string }[];
  readonly herkunft: AnforderungHerkunft;
  /** Hängt der Posten bzw. die Veranstaltung an einem Objekt? */
  readonly hatObjekt: boolean;
  readonly darfSchreiben: boolean;
  /** Die Adresse DIESER Seite — Rückweg nach dem Speichern und bei einer Abweisung. */
  readonly zurueck: string;
  readonly meldung: { readonly art: 'erfolg' | 'warnung'; readonly text: string } | null;
}) {
  const bereiche: readonly AnforderungBereich[] = [
    herkunft.art === 'posten' ? 'posten' : 'veranstaltung',
    ...(hatObjekt ? ['objekt' as const] : []),
    'mandant',
  ];
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 '
    + 'text-sm text-text';
  const beschriftung = 'mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted';

  return (
    <section className="mb-s6" data-cse="anforderungen">
      <h2 className="mb-s2 text-h3 text-text">{texte.titel}</h2>

      {meldung !== null && (
        <Hinweis art={meldung.art} cse="anforderung-meldung"
                 rolle={meldung.art === 'erfolg' ? 'status' : 'alert'}
                 className="mb-s4 max-w-prose">
          {meldung.text}
        </Hinweis>
      )}

      {anforderungen.length === 0 ? (
        <p className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
           data-cse="anforderungen-leer">
          {texte.leer}
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {anforderungen.map((a) => (
            <li
              key={a.id}
              data-cse="anforderung"
              data-zwingend={a.zwingend ? 'ja' : 'nein'}
              className="mb-s2 flex flex-wrap items-center justify-between gap-s3 rounded-lg
                         border border-line bg-surface p-s4 text-sm"
            >
              <span>
                <span className="text-text">{a.qualifikation}</span>
                {' · '}
                <span className={a.zwingend ? 'text-danger' : 'text-warning'}>
                  {a.zwingend ? texte.sperre : texte.warnung}
                </span>
                {' · '}
                <span className="text-text-muted">
                  {a.geltung === 'jeder' ? texte.jede : texte.mindestens(a.mindestanzahl)}
                  {' · '}
                  {texte.bereich[a.bereich]}
                  {a.register && ` · ${texte.register}`}
                  {a.gueltigAb !== null && ` · ${texte.abDatum(a.gueltigAb)}`}
                  {a.rechtsgrundlage !== null && ` · ${a.rechtsgrundlage}`}
                </span>
                {a.platzhalter && (
                  <span className="ml-s2 text-warning">· {texte.unbestaetigt}</span>
                )}
              </span>
              {darfSchreiben && (
                <form method="post" action="/api/sicherheit/anforderungen">
                  <input type="hidden" name="aktion" value="archivieren" />
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="herkunft_art" value={herkunft.art} />
                  <input type="hidden" name="herkunft_id" value={herkunft.id} />
                  <input type="hidden" name="zurueck" value={zurueck} />
                  <Button type="submit" variante="secondary" data-cse="anforderung-archivieren">
                    {texte.archivieren}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {darfSchreiben ? (
        <form
          method="post"
          action="/api/sicherheit/anforderungen"
          data-cse="anforderung-formular"
          className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <h3 className="m-0 mb-s2 text-base text-text">{texte.neuTitel}</h3>
          <p className="m-0 mb-s4 text-sm text-text-muted">{texte.neuErklaerung}</p>
          <input type="hidden" name="aktion" value="anlegen" />
          <input type="hidden" name="herkunft_art" value={herkunft.art} />
          <input type="hidden" name="herkunft_id" value={herkunft.id} />
          <input type="hidden" name="zurueck" value={zurueck} />

          {qualifikationen.length === 0 ? (
            <p className="m-0 mb-s4 text-sm text-warning">{texte.keineQualifikation}</p>
          ) : (
            <label className="mb-s4 block">
              <span className={beschriftung}>{texte.qualifikation}</span>
              <select name="qualifikation" required defaultValue="" className={feld}
                      data-cse="anforderung-qualifikation">
                <option value="" disabled>{texte.qualifikationWaehlen}</option>
                {qualifikationen.map((q) => (
                  <option key={q.id} value={q.id}>{q.bezeichnung}</option>
                ))}
              </select>
            </label>
          )}

          <fieldset className="mb-s4 border-0 p-0">
            <legend className={beschriftung}>{texte.geltungsbereich}</legend>
            <div className="flex flex-col gap-s2">
              {bereiche.map((b, i) => (
                <label key={b} className="flex min-h-11 items-center gap-s2 text-sm text-text">
                  <input type="radio" name="bereich" value={b} defaultChecked={i === 0}
                         className="min-h-6 min-w-6" />
                  {texte.bereichWahl[b]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mb-s4 border-0 p-0">
            <legend className={beschriftung}>{texte.art}</legend>
            <div className="flex flex-col gap-s2">
              <label className="flex min-h-11 items-center gap-s2 text-sm text-text">
                <input type="radio" name="zwingend" value="ja" defaultChecked
                       className="min-h-6 min-w-6" />
                {texte.artSperre}
              </label>
              <label className="flex min-h-11 items-center gap-s2 text-sm text-text">
                <input type="radio" name="zwingend" value="nein" className="min-h-6 min-w-6" />
                {texte.artWarnung}
              </label>
            </div>
          </fieldset>

          <fieldset className="mb-s4 border-0 p-0">
            <legend className={beschriftung}>{texte.wer}</legend>
            <div className="flex flex-col gap-s2">
              <label className="flex min-h-11 items-center gap-s2 text-sm text-text">
                <input type="radio" name="geltung" value="jeder" defaultChecked
                       className="min-h-6 min-w-6" />
                {texte.werJede}
              </label>
              <label className="flex min-h-11 flex-wrap items-center gap-s2 text-sm text-text">
                <input type="radio" name="geltung" value="mindestens_einer"
                       className="min-h-6 min-w-6" />
                {texte.werMindestens}
              </label>
            </div>
            <label className="mt-s2 block max-w-[12rem]">
              <span className={beschriftung}>{texte.mindestanzahl}</span>
              <input type="number" name="mindestanzahl" min={1} max={99} defaultValue={1}
                     className={feld} />
            </label>
          </fieldset>

          <label className="mb-s4 flex min-h-11 items-center gap-s2 text-sm text-text">
            <input type="checkbox" name="register" value="ja" className="min-h-6 min-w-6" />
            {texte.registerFrage}
          </label>

          <div className="mb-s4 grid gap-s4 md:grid-cols-2">
            <label className="block">
              <span className={beschriftung}>{texte.gueltigAb}</span>
              <input type="date" name="gueltig_ab" className={feld} />
            </label>
            <label className="block">
              <span className={beschriftung}>{texte.rechtsgrundlage}</span>
              <input name="rechtsgrundlage" maxLength={120} className={feld}
                     placeholder={texte.rechtsgrundlageBeispiel} />
            </label>
          </div>

          <label className="mb-s1 flex min-h-11 items-center gap-s2 text-sm text-text">
            <input type="checkbox" name="bestaetigt" value="ja" className="min-h-6 min-w-6" />
            {texte.bestaetigt}
          </label>
          <p className="m-0 mb-s4 text-xs text-text-muted">{texte.bestaetigtErklaerung}</p>

          <p className="m-0 mb-s4 text-xs text-text-muted">{texte.nachzug}</p>
          <Button type="submit" variante="primary" data-cse="anforderung-anlegen"
                  disabled={qualifikationen.length === 0}>
            {texte.anlegen}
          </Button>
        </form>
      ) : (
        <p className="m-0 mt-s3 text-xs text-text-muted">{texte.keinSchreibrecht}</p>
      )}
    </section>
  );
}
