import Link from 'next/link';

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
 */
export function Bewerbungsformular({ stelleId, aufbewahrungTage, bereiche }: {
  readonly stelleId: string | null;
  readonly aufbewahrungTage: number;
  /** Nur bei der Initiativbewerbung: der Bereich ist dort eine Wahl. */
  readonly bereiche?: readonly { readonly slug: string; readonly name: string }[];
}) {
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
          <label className={beschriftung} htmlFor="bereich">Bereich</label>
          <select id="bereich" name="bereich" required className={eingabe} defaultValue="">
            <option value="" disabled>— bitte wählen —</option>
            {bereiche.map((b) => (
              <option key={b.slug} value={b.slug}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={beschriftung} htmlFor="name">Name</label>
        <input id="name" name="name" type="text" required autoComplete="name"
               className={eingabe} />
      </div>
      <div>
        <label className={beschriftung} htmlFor="email">E-Mail</label>
        <input id="email" name="email" type="email" required autoComplete="email"
               className={eingabe} />
      </div>
      <div>
        <label className={beschriftung} htmlFor="telefon">Telefon (freiwillig)</label>
        <input id="telefon" name="telefon" type="tel" autoComplete="tel"
               className={eingabe} />
      </div>
      <div>
        <label className={beschriftung} htmlFor="nachricht">
          Was Sie uns sagen möchten
        </label>
        <textarea id="nachricht" name="nachricht" rows={6} className={eingabe} />
      </div>

      {/* TODO(client, O-375): Lebenslauf als Datei — braucht den Belegspeicher. */}
      <p className="m-0 max-w-prose rounded-md border border-line bg-surface-2 p-s4 text-sm text-text-muted">
        <strong className="text-text">Noch kein Datei-Upload.</strong> Der
        Dokumentenspeicher ist nicht verbunden; ein Feld, das eine Datei annimmt
        und sie nirgends ablegt, wäre schlimmer als keines. Schreiben Sie uns
        Ihren Werdegang bitte in das Feld oben — wir fragen nach Unterlagen,
        wenn es passt.
      </p>

      <p className="m-0 max-w-prose text-sm text-text-muted" data-cse="datenschutz-hinweis">
        Ihre Angaben werden für dieses Bewerbungsverfahren verarbeitet und nach{' '}
        <strong className="text-text">{aufbewahrungTage} Tagen</strong> gelöscht,
        sofern kein Arbeitsverhältnis zustande kommt. Über Einladung oder Absage
        entscheidet ein Mensch; eine automatische Auswahl findet nicht statt.
        Mehr dazu in der{' '}
        <Link href="/datenschutz" className="underline underline-offset-2">
          Datenschutzerklärung
        </Link>.
      </p>

      <button
        type="submit"
        data-cse="bewerbung-absenden"
        className="inline-flex min-h-11 w-fit items-center rounded-md bg-brand px-s5 text-base font-semibold text-white hover:bg-brand-hover"
      >
        Bewerbung absenden
      </button>
    </form>
  );
}
