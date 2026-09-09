/**
 * Der Feldvertrag eines Angebotsanfrage-Formulars (REQ-01 … REQ-04, PUB-09).
 *
 * **Warum ein Feld mehr braucht als einen Typ.** Ein barrierefreies Formular
 * (BFSG, WCAG 2.1 AA) verlangt je Feld ein programmatisch verknuepftes Label
 * (3.3.2), eine SPEZIFISCHE Fehlermeldung (3.3.1/3.3.3 — "ungültig" sagt
 * niemandem, was zu tun ist) und, wo es um die Person geht, ein
 * `autocomplete`-Token (1.3.5). Stuenden nur Typ und Pflicht hier, waere die
 * Barrierefreiheit eine Sache der Sorgfalt beim Rendern — und damit eine
 * Frage, die je Formular neu falsch beantwortet wird.
 *
 * Diese Datei ist die EINZIGE Quelle: die Definition in der Datenbank wird
 * gegen sie validiert, das Rendern liest sie, und die Annahme validiert die
 * Einsendung gegen dieselbe Feldliste (SEC-A4).
 */
import { z } from 'zod';

const FeldBasis = z.object({
  schluessel: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/u),
  label: z.string().min(1),
  hilfetext: z.string().optional(),
  // WCAG 3.3.1/3.3.3: was ist zu tun, nicht dass etwas falsch ist.
  fehlermeldung: z.string().min(1),
  pflicht: z.boolean(),
  autocomplete: z.string().optional(),
  sortierung: z.number().int(),
});

const Option = z.object({ wert: z.string().min(1), label: z.string().min(1) });

export const FormularFeld = z.discriminatedUnion('typ', [
  FeldBasis.extend({ typ: z.literal('text'), maxLaenge: z.number().int().optional() }),
  FeldBasis.extend({ typ: z.literal('textarea'), maxLaenge: z.number().int().optional() }),
  FeldBasis.extend({ typ: z.literal('zahl'), min: z.number().optional(), max: z.number().optional() }),
  FeldBasis.extend({
    typ: z.literal('dezimal'),
    min: z.number().optional(), max: z.number().optional(),
    nachkommastellen: z.number().int().max(3),
  }),
  FeldBasis.extend({ typ: z.literal('datum') }),
  FeldBasis.extend({ typ: z.literal('datum_zeit') }),
  FeldBasis.extend({ typ: z.literal('auswahl'), optionen: z.array(Option).min(1) }),
  FeldBasis.extend({ typ: z.literal('mehrfachauswahl'), optionen: z.array(Option).min(1) }),
  FeldBasis.extend({ typ: z.literal('checkbox') }),
  FeldBasis.extend({ typ: z.literal('email') }),
  FeldBasis.extend({ typ: z.literal('telefon') }),
  FeldBasis.extend({
    typ: z.literal('datei'),
    mime: z.array(z.string()).min(1),
    maxBytes: z.number().int().positive(),
  }),
]);

export type FormularFeld = z.infer<typeof FormularFeld>;

export const Felder = z.array(FormularFeld).min(1);

export class FormularFehler extends Error {
  constructor(
    nachricht: string,
    /** Feldschluessel → Meldung. Leer, wenn der Fehler nicht an einem Feld haengt. */
    readonly felder: Readonly<Record<string, string>> = {},
  ) {
    super(nachricht);
    this.name = 'FormularFehler';
  }
}

/* ── Aus der Feldliste wird der Prüfer der Einsendung ───────────────────── */

/**
 * Baut das Zod-Schema fuer die EINGABE aus der Felddefinition.
 *
 * Die Alternative — ein festes Schema je Bereich — waere eine zweite Quelle:
 * ein Feld, das jemand der Definition hinzufuegt, wuerde entgegengenommen und
 * stillschweigend verworfen, oder ein entferntes bliebe Pflicht. Der Pruefer
 * entsteht deshalb aus derselben Zeile, die auch gerendert wird.
 *
 * Dateifelder stehen NICHT darin: eine Datei kommt nicht als JSON-Wert an,
 * sondern als Teil des `multipart`-Koerpers, und wird von `upload.ts` gegen
 * ihre MAGIC BYTES geprueft — nie gegen das, was der Browser behauptet.
 */
export function eingabeSchema(felder: readonly FormularFeld[]): z.ZodType<Record<string, unknown>> {
  const form: Record<string, z.ZodTypeAny> = {};

  for (const f of felder) {
    if (f.typ === 'datei') continue;
    let s: z.ZodTypeAny;
    switch (f.typ) {
      case 'zahl':
        s = z.coerce.number().int();
        if (f.min !== undefined) s = (s as z.ZodNumber).min(f.min);
        if (f.max !== undefined) s = (s as z.ZodNumber).max(f.max);
        break;
      case 'dezimal':
        s = z.coerce.number();
        if (f.min !== undefined) s = (s as z.ZodNumber).min(f.min);
        if (f.max !== undefined) s = (s as z.ZodNumber).max(f.max);
        break;
      case 'checkbox':
        // Ein nicht angehaktes Kästchen kommt als fehlender Wert an, nicht als
        // `false` — deshalb ist die Vorgabe hier `false` und nicht `undefined`.
        s = z.coerce.boolean().default(false);
        break;
      case 'email':
        s = z.string().email();
        break;
      case 'telefon':
        s = z.string().min(3).max(40);
        break;
      case 'datum':
        s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
        break;
      case 'datum_zeit':
        s = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u);
        break;
      case 'auswahl':
        s = z.enum(f.optionen.map((o) => o.wert) as [string, ...string[]]);
        break;
      case 'mehrfachauswahl':
        s = z.array(z.enum(f.optionen.map((o) => o.wert) as [string, ...string[]])).min(1);
        break;
      default: {
        let t = z.string().min(1);
        if (f.maxLaenge !== undefined) t = t.max(f.maxLaenge);
        s = t;
      }
    }
    // Ein Pflichtfeld mit `checkbox` heisst: es MUSS angehakt sein (etwa der
    // Datenschutzhinweis). `optional()` waere hier die falsche Übersetzung.
    if (f.pflicht && f.typ === 'checkbox') s = z.coerce.boolean().refine((v) => v === true);
    else if (!f.pflicht) {
      /**
       * Ein LEERES Feld ist ein nicht ausgefuelltes Feld.
       *
       * Ein HTML-Formular schickt jedes Feld mit, auch die unberuehrten — als
       * leere Zeichenkette. `optional()` allein laesst nur `undefined` durch,
       * also wies eine Anfrage ohne Nachricht die ganze Einsendung ab, mit der
       * Meldung "Bitte kürzen Sie Ihre Nachricht" an einem leeren Feld.
       * Freiwillig heisst freiwillig.
       */
      s = z.preprocess((w) => (w === '' ? undefined : w), s.optional());
    }
    form[f.schluessel] = s;
  }

  // `strict()`: ein Feld, das nicht in der Definition steht, wird ABGEWIESEN
  // und nicht stillschweigend mitgespeichert. Sonst waere `daten` ein
  // Ablageort für alles, was jemand an die Route schickt (SEC-A4).
  return z.object(form).strict();
}

/** Die Feldfehler als `schluessel → fehlermeldung` aus der Definition. */
export function fehlerAbbilden(
  felder: readonly FormularFeld[], fehler: z.ZodError,
): Readonly<Record<string, string>> {
  const nach = new Map(felder.map((f) => [f.schluessel, f.fehlermeldung]));
  const raus: Record<string, string> = {};
  for (const problem of fehler.issues) {
    const schluessel = String(problem.path[0] ?? '');
    // Die Meldung aus der Definition, nicht die von Zod: die ist auf Englisch
    // und beschreibt einen Typfehler, nicht was der Mensch tun soll.
    raus[schluessel] = nach.get(schluessel)
      ?? 'Bitte prüfen Sie diese Eingabe.';
  }
  return raus;
}
