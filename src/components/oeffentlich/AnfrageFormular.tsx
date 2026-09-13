import { Button } from '@/components/ui/Button';
import type { FormularFeld } from '@/lib/formular/schema';
import { ANFRAGE_TEXTE } from '@/lib/i18n/texte';
import { VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * Das Angebotsanfrage-Formular (REQ-01 … REQ-04, PUB-09, LEG-07).
 *
 * **Es rendert die Felder der Definition, nicht eine Kopie davon.** Ein fest
 * verdrahtetes Formular je Bereich waere eine zweite Quelle: ein Feld, das
 * jemand der Definition hinzufuegt, erschiene nie, und die Annahme wiese es
 * als unbekannt ab.
 *
 * **Barrierefreiheit ist hier keine Sorgfaltsfrage.** Jedes Feld traegt ein
 * echtes `<label for>` (WCAG 3.3.2), seinen Hilfetext ueber
 * `aria-describedby` (3.3.2), `aria-required` (3.3.2) und, wo vorhanden, das
 * `autocomplete`-Token (1.3.5). Fehlermeldungen kommen aus der Definition und
 * sind spezifisch (3.3.1/3.3.3) — "ungültig" sagt niemandem, was zu tun ist.
 * Das steht in dieser einen Komponente, damit es nicht je Formular neu falsch
 * gemacht wird.
 */
export interface AnfrageFormularProps {
  /** Die Sprache der Seite. Die Feldbeschriftungen sind bereits übersetzt. */
  readonly sprache?: Sprache;
  readonly bereich: string;
  readonly titel: string;
  readonly felder: readonly FormularFeld[];
  readonly fehler?: Readonly<Record<string, string>> | undefined;
  readonly meldung?: string | undefined;
}

function Feld({ f, fehler, t }: {
  readonly f: FormularFeld;
  readonly fehler?: string | undefined;
  readonly t: (typeof ANFRAGE_TEXTE)[Sprache];
}) {
  const id = `f_${f.schluessel}`;
  const hilfeId = f.hilfetext === undefined ? undefined : `${id}_hilfe`;
  const fehlerId = fehler === undefined ? undefined : `${id}_fehler`;
  const beschrieben = [hilfeId, fehlerId].filter((x) => x !== undefined).join(' ');
  const gemeinsam = {
    id,
    name: f.schluessel,
    required: f.pflicht,
    'aria-required': f.pflicht,
    'aria-invalid': fehler === undefined ? undefined : true,
    ...(beschrieben === '' ? {} : { 'aria-describedby': beschrieben }),
    ...(f.autocomplete === undefined ? {} : { autoComplete: f.autocomplete }),
    /*
     * Dieselbe Feldoptik wie `FormField` (DESIGN §5 Forms): `--surface-3`,
     * 44px Mindesthoehe, Rand auf `--red` im Fokus. Hier stand `bg-surface-2`
     * mit `p-s3` und ohne Mindesthoehe — das einzige Formular, das ein Kunde
     * je sieht, sah anders aus als jedes Feld im Portal.
     */
    className: 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 '
      + 'text-base text-text transition-colors duration-fast ease-brand '
      + 'placeholder:text-text-subtle focus:border-brand',
  } as const;

  const beschriftung = (
    <>
      {f.label}
      {f.pflicht && <span aria-hidden="true" className="text-brand"> *</span>}
    </>
  );

  /*
   * **Der Kasten steht NEBEN seiner Beschriftung, und die Zeile ist das
   * Tippziel.**
   *
   * Er stand darunter: ein 20px-Quadrat unter einem 22px hohen Label. DESIGN §8
   * verlangt 44px, WCAG 2.5.8 mindestens 24 — und getroffen werden musste es
   * von jemandem, der auf dem Telefon die Pflichtzustimmung zum Datenschutz
   * gibt (LEG-07). Wer sie nicht trifft, bekommt beim Absenden „Pflichtfeld"
   * fuer ein Feld, das er anzuklicken glaubte. `<label>` umschliesst hier
   * beides, also ist die ganze 44px-Zeile die Klickflaeche; `htmlFor` bleibt
   * stehen, damit die Bindung auch explizit ist.
   */
  if (f.typ === 'checkbox') {
    return (
      <div className="flex flex-col gap-s2" data-cse="formularfeld">
        <label htmlFor={id} className="flex min-h-11 items-center gap-s3 text-sm text-text">
          <input {...gemeinsam} type="checkbox" className="size-5 shrink-0 accent-brand" />
          <span>{beschriftung}</span>
        </label>
        {f.hilfetext !== undefined && (
          <p id={hilfeId} className="text-xs text-text-subtle">{f.hilfetext}</p>
        )}
        {fehler !== undefined && (
          <p id={fehlerId} className="text-xs text-danger">{fehler}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-s2" data-cse="formularfeld">
      {/* Das Label steht IMMER über dem Feld (DESIGN §5) und ist nie ein
          Platzhalter: ein Platzhalter verschwindet beim Tippen. */}
      <label htmlFor={id} className="text-sm text-text">
        {beschriftung}
      </label>

      {f.typ === 'textarea' && <textarea {...gemeinsam} rows={5} maxLength={f.maxLaenge} />}
      {f.typ === 'auswahl' && (
        <select {...gemeinsam}>
          {/* Die AUSWAHL ist uebersetzt, die WERTE sind es nie (D-83): der
              Wert reist in die Datenbank und ist Teil der Definition. */}
          <option value="">{t.bitteWaehlen}</option>
          {f.optionen.map((o) => <option key={o.wert} value={o.wert}>{o.label}</option>)}
        </select>
      )}
      {f.typ === 'datei' && (
        <input {...gemeinsam} type="file" accept={f.mime.join(',')} />
      )}
      {['text', 'email', 'telefon', 'zahl', 'dezimal', 'datum', 'datum_zeit'].includes(f.typ) && (
        <input
          {...gemeinsam}
          type={f.typ === 'email' ? 'email'
            : f.typ === 'telefon' ? 'tel'
              : f.typ === 'datum' ? 'date'
                : f.typ === 'datum_zeit' ? 'datetime-local'
                  : f.typ === 'zahl' || f.typ === 'dezimal' ? 'number' : 'text'}
          {...(f.typ === 'dezimal' ? { step: 10 ** -f.nachkommastellen } : {})}
        />
      )}

      {f.hilfetext !== undefined && (
        <p id={hilfeId} className="text-xs text-text-subtle">{f.hilfetext}</p>
      )}
      {/* `--danger` als TEXT (DESIGN §5 Forms) — `--danger-strong` ist die
          Flaeche fuer weisse Schrift und als Text auf Dunkel zu dunkel (§1). */}
      {fehler !== undefined && (
        <p id={fehlerId} className="text-xs text-danger">{fehler}</p>
      )}
    </div>
  );
}

export function AnfrageFormular(
  { bereich, titel, felder, fehler, meldung, sprache = VORGABE_SPRACHE }: AnfrageFormularProps,
) {
  const sortiert = [...felder].sort((a, b) => a.sortierung - b.sortierung);
  const t = ANFRAGE_TEXTE[sprache];
  return (
    <section className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s6">
      {/**
        * `hyphens: auto` und `break-words` — wegen der deutschen Komposita.
        *
        * "Gebäudereinigung" passt in `text-h1` nicht in 375 px, bricht ohne
        * Trennhilfe nicht um und schob die ganze Seite seitwärts. Das ist
        * WCAG 1.4.10 (Reflow): bei 320 px CSS-Breite darf nichts waagerecht
        * scrollen. `lang="de"` steht am `<html>`, also trennt der Browser
        * nach deutschen Regeln.
        */}
      <h1 className="text-h1 text-text [hyphens:auto] break-words">{titel}</h1>

      {/* `role="alert"` und nicht nur roter Text: ein Screenreader-Nutzer
          bekommt sonst keine Rückmeldung, dass die Absendung fehlschlug. */}
      {meldung !== undefined && (
        <p role="alert" data-cse="formular-meldung"
           className="rounded-md border border-danger bg-danger-soft p-s4 text-base text-text">
          {meldung}
        </p>
      )}

      <form
        method="post"
        action="/api/anfrage"
        encType="multipart/form-data"
        data-cse="anfrage-formular"
        className="flex flex-col gap-s4"
        noValidate
      >
        <input type="hidden" name="bereich" value={bereich} />
        {/**
          * Die Sprache reist MIT.
          *
          * Ohne sie antwortete `/api/anfrage` auf ein englisches Formular
          * deutsch — an genau der Stelle, an der jemand etwas kaufen wollte.
          * Nicht aus `Accept-Language`: der Header sagt, was der Browser
          * eingestellt hat, nicht welche Fassung der Seite der Besucher
          * bewusst geoeffnet hat.
          */}
        <input type="hidden" name="sprache" value={sprache} />

        {/**
          * Der Honigtopf.
          *
          * Kein CAPTCHA: ein CAPTCHA kostet genau die Menschen etwas, für die
          * BFSG gilt. Dieses Feld ist aus dem Layout genommen, `tabindex="-1"`
          * und `aria-hidden` — ein Mensch sieht es nicht, ein Screenreader
          * liest es nicht vor, ein Formularausfüller-Bot füllt es aus.
          */}
        {/**
          * Versteckt durch ZUSCHNITT, nicht durch Verschieben.
          *
          * `left: -9999px` vergrössert den scrollbaren Bereich — bei 375 px
          * lief die Seite dadurch waagerecht weg, und ein Formular, das man
          * seitwärts schieben muss, füllt auf einer Baustelle niemand aus.
          * `clip-path` nimmt das Feld aus dem Fluss, ohne die Seite zu
          * verbreitern; `display: none` schiede aus, weil ein Bot es dann
          * nicht ausfüllt und der Honigtopf leer bliebe.
          */}
        <div
          aria-hidden="true"
          className="absolute size-px overflow-hidden border-0 p-0"
          style={{ clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}
        >
          <label htmlFor="f_website">{t.honigtopf}</label>
          {/* Auch das Feld selbst ist 1 px breit. Ein zugeschnittener Container
              allein genügte nicht: das voreingestellte 200-px-Textfeld
              verbreiterte den scrollbaren Bereich weiterhin, und die Seite lief
              bei 375 px seitwärts weg. */}
          <input
            id="f_website" name="website" type="text" tabIndex={-1} autoComplete="off"
            className="w-px"
          />
        </div>

        {sortiert.map((f) => (
          <Feld key={f.schluessel} f={f} fehler={fehler?.[f.schluessel]} t={t} />
        ))}

        {/* Der eine Primaerknopf der Seite — aus der Komponente, nicht nachgebaut. */}
        <Button type="submit" variante="primary" className="self-start">
          {t.absenden}
        </Button>
      </form>
    </section>
  );
}
