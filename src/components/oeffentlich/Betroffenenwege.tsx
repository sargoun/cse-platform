import { BETROFFENENWEGE_TEXTE } from '@/lib/i18n/texte';
import { verweisIn, type Sprache, type SprachVerweis } from '@/lib/sprache';

/**
 * Die zwei Pflichtwege unter der Datenschutzerklärung — Betroffenenanfrage
 * und Werbewiderspruch (V-156, D-650, LEG-09, Art. 12 Abs. 2 DSGVO).
 *
 * **Warum aus dem Code und nicht als Abschnitt der Seite.** Der Erklärungstext
 * ist redaktionell (`seite`/`abschnitt`) und kann sich ändern; der Weg zu den
 * zwei Formularen darf dabei nicht verloren gehen. Dieselbe Bauart wie die
 * Pflichtangaben unter dem Impressum (`Gesellschaften`) und die Wege unter
 * `/kontakt` (`Kontaktwege`).
 *
 * **Die Sprache des Ziels steht am Verweis.** `/werbewiderspruch` ist bewusst
 * nur deutsch (`NUR_DEUTSCH`, O-34): von der englischen Erklärung aus führt
 * der Verweis auf die deutsche Seite, mit `hrefLang="de"` und „(in German)".
 * `/datenschutz/anfrage` gibt es in beiden Sprachen (V-156).
 */
export function Betroffenenwege({ sprache }: { readonly sprache: Sprache }) {
  const t = BETROFFENENWEGE_TEXTE[sprache];
  const wege: readonly (SprachVerweis & {
    readonly schluessel: string; readonly text: string; readonly hinweis: string;
  })[] = [
    { ...verweisIn('/datenschutz/anfrage', sprache), schluessel: 'anfrage',
      text: t.anfrage, hinweis: t.anfrageHinweis },
    { ...verweisIn('/werbewiderspruch', sprache), schluessel: 'werbewiderspruch',
      text: t.werbewiderspruch, hinweis: t.werbewiderspruchHinweis },
  ];
  return (
    <section data-cse="betroffenenwege" className="mx-auto max-w-content px-s5 py-s6">
      <h2 className="mb-s3 text-h2 text-text">{t.ueberschrift}</h2>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">{t.text}</p>
      <ul className="m-0 grid list-none grid-cols-1 gap-s5 p-0 md:grid-cols-2">
        {wege.map((w) => (
          <li key={w.schluessel} className="rounded-lg border border-line bg-surface-2 p-s5">
            <a href={w.href}
               hrefLang={w.sprache === sprache ? undefined : w.sprache}
               data-cse="betroffenenweg"
               data-ziel={w.schluessel}
               className="inline-flex min-h-11 items-center gap-s2 text-base text-text underline underline-offset-4">
              {w.text} ›
              {w.sprache !== sprache && (
                <span className="text-sm text-text-muted no-underline">{t.aufDeutsch}</span>
              )}
            </a>
            <p className="m-0 mt-s1 text-sm text-text-muted">{w.hinweis}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
