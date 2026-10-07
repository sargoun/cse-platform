import Link from 'next/link';
import type { Route } from 'next';
import { Hinweis } from '@/components/ui/Hinweis';
import { mitSprache, type Sprache } from '@/lib/sprache';
import { EMAIL_MUSTER } from './meldung';
import { KARRIERE_TEXTE } from './texte';

/**
 * Das Bewerbungsformular — einmal geschrieben, an zwei Stellen benutzt
 * (REC-03).
 *
 * **Der Datenschutzhinweis steht ÜBER dem Knopf, nicht darunter.** Art. 13
 * DSGVO verlangt die Information zum Zeitpunkt der Erhebung; ein Hinweis
 * unter dem Absendeknopf ist nach der Erhebung. Und er nennt die
 * Aufbewahrungsfrist in Tagen, weil „wir löschen nach angemessener Zeit"
 * keine Angabe ist (REC-07, LEG-11).
 *
 * **Kein Lebenslauf-Upload in dieser Fassung.** Der Belegspeicher ist nicht
 * verbunden (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), und ein Feld, das eine
 * Datei annimmt und sie nirgends ablegt, ist schlimmer als keines: der Mensch
 * glaubt, sie sei angekommen. Das steht als Satz auf der Seite, nicht als
 * Fussnote — und `// TODO(client, O-375)` hält fest, was fehlt.
 *
 * **Was erhoben wird — Voreinstellung (O-199, D-797).** Name, E-Mail,
 * Telefon (freiwillig) und eine Nachricht; bei der Initiativbewerbung der
 * Bereich. Kein Geburtsdatum, keine Staatsangehörigkeit, kein Foto, keine
 * Anschrift: Art. 5 Abs. 1 lit. c DSGVO, und jedes dieser Merkmale lädt zu
 * einem Benachteiligungsvorwurf nach dem AGG ein. Führerschein, Sachkunde
 * nach § 34a GewO oder Arbeitserlaubnis klärt das Gespräch, wenn die Stelle
 * sie verlangt; nachgewiesen werden sie bei der Einstellung.
 * // TODO(client, O-199): Voreinstellung — nur Name, E-Mail, Telefon (freiwillig), Nachricht und bei der Initiativbewerbung der Bereich; keine Merkmale, die eine Benachteiligung nach dem AGG nahelegen. Wie gebaut. D-797.
 *
 * **Deutsch und englisch, dieselben Felder** (V-393, D-82, D-83): nur die
 * Beschriftungen kommen aus `KARRIERE_TEXTE`; das Feld `sprache` sagt der
 * Route, auf welche Seite die Antwort zurückführt.
 */
export function Bewerbungsformular(
  { stelleId, aufbewahrungTage, bereiche, meldung, sprache = 'de' }: {
  readonly stelleId: string | null;
  readonly aufbewahrungTage: number;
  /** Nur bei der Initiativbewerbung: der Bereich ist dort eine Wahl. */
  readonly bereiche?: readonly { readonly slug: string; readonly name: string }[];
  /**
   * Der Satz zu einer Abweisung (`?fehler=` → `bewerbungsMeldung`, V-158) —
   * über dem Formular, als `Hinweis` `warnung` mit `role="alert"`, wie beim
   * Angebotsformular (D-599, DESIGN §5 „Notices").
   */
  readonly meldung?: string | undefined;
  readonly sprache?: Sprache;
}) {
  const t = KARRIERE_TEXTE[sprache];
  const eingabe = 'mt-s1 w-full rounded-md border border-line bg-surface px-s4 py-s3 '
    + 'text-base text-text';
  const beschriftung = 'text-sm text-text-muted';

  return (
    <form
      method="post"
      action="/api/karriere/bewerbung"
      data-cse="bewerbungsformular"
      className="flex max-w-form flex-col gap-s4"
    >
      {meldung !== undefined && (
        <Hinweis art="warnung" rolle="alert" cse="bewerbung-meldung">
          {meldung}
        </Hinweis>
      )}
      {/*
        * **Ein Browser bekommt eine Seite, kein JSON** (D-599, V-158). Das
        * Feld sagt es der Route ausdrücklich; ein Programm schickt es nicht
        * mit und bekommt JSON wie bisher.
        */}
      <input type="hidden" name="antwort" value="seite" />
      {sprache !== 'de' && <input type="hidden" name="sprache" value={sprache} />}
      {stelleId !== null && <input type="hidden" name="stelle" value={stelleId} />}
      {/*
        * Der Honigtopf — dieselbe Idee wie beim Angebotsformular: ein Feld,
        * das ein Mensch nie ausfuellt, weil er es nicht sieht.
        */}
      <input
        type="text" name="webseite" tabIndex={-1} autoComplete="off"
        aria-hidden="true" className="absolute left-[-9999px] h-0 w-0"
      />

      {bereiche !== undefined && (
        <div>
          <label className={beschriftung} htmlFor="bereich">{t.bereichLabel}</label>
          <select id="bereich" name="bereich" required className={eingabe} defaultValue="">
            <option value="" disabled>{t.bitteWaehlen}</option>
            {bereiche.map((b) => (
              <option key={b.slug} value={b.slug}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={beschriftung} htmlFor="name">{t.nameLabel}</label>
        <input id="name" name="name" type="text" required autoComplete="name"
               className={eingabe} />
      </div>
      <div>
        <label className={beschriftung} htmlFor="email">{t.emailLabel}</label>
        {/*
          * `pattern` aus der Regel des Dienstes (V-158): `type="email"` allein
          * nimmt `name@firma` an, der Dienst nicht — und eine Abweisung NACH
          * dem Absenden kostet die Nachricht, weil sie nicht in eine Adresse
          * zurückreist. `title` ist der Satz, den der Browser dann zeigt.
          */}
        <input id="email" name="email" type="email" required autoComplete="email"
               pattern={EMAIL_MUSTER}
               title={t.emailTitel}
               className={eingabe} />
      </div>
      <div>
        <label className={beschriftung} htmlFor="telefon">{t.telefonLabel}</label>
        <input id="telefon" name="telefon" type="tel" autoComplete="tel"
               className={eingabe} />
      </div>
      <div>
        <label className={beschriftung} htmlFor="nachricht">
          {t.nachrichtLabel}
        </label>
        <textarea id="nachricht" name="nachricht" rows={6} className={eingabe} />
      </div>

      {/* TODO(client, O-375): Voreinstellung — Unterlagen in den privaten Belegspeicher, gelöscht mit der Bewerbung; das Dateifeld ist nicht gebaut (V-387), den Speicher verbindet der Betreiber (D-803). */}
      <p className="m-0 max-w-prose rounded-md border border-line bg-surface-2 p-s4 text-sm text-text-muted">
        <strong className="text-text">{t.uploadTitel}</strong> {t.uploadText}
      </p>

      <p className="m-0 max-w-prose text-sm text-text-muted" data-cse="datenschutz-hinweis">
        {t.datenschutzVor}{' '}
        <strong className="text-text">{t.datenschutzTage(aufbewahrungTage)}</strong>{' '}
        {t.datenschutzNach}{' '}
        <Link href={mitSprache('/datenschutz', sprache) as Route}
              className="underline underline-offset-2">
          {t.datenschutzLink}
        </Link>.
      </p>

      <button
        type="submit"
        data-cse="bewerbung-absenden"
        className="inline-flex min-h-11 w-fit items-center rounded-md bg-brand px-s5 text-base font-semibold text-white hover:bg-brand-hover"
      >
        {t.absenden}
      </button>
    </form>
  );
}
