import 'server-only';
import Link from 'next/link';
import { leserechte, routeMitPfad } from '@/server/registry/routen';
import { haeltRechte } from '../../rechte';
import type { Sitzung } from '@/server/kontext/index';

/**
 * Die Sprungzeile des Website-Moduls — **die einzige Stelle, von der aus
 * dreizehn Bildschirme überhaupt erreichbar sind.**
 *
 * **Warum es sie gibt.** Der Menüpunkt „Website" führt auf `website/seiten`;
 * von dort aus verwies nichts auf `profil`, `leistungen`, `news` oder
 * `formulare`. Sechs fertige Seiten waren damit nur über die Adresszeile zu
 * öffnen — und `registry/navigation.ts` schreibt dazu selbst den Satz: „drei
 * Bildschirme, die niemand öffnen kann, sind genauso gut nicht gebaut."
 * `recruiting/rahmen.tsx` löst dasselbe Problem seit D-567; diese Datei ist
 * dieselbe Lösung, nur als Zeile statt als Hülle — die dreizehn Seiten haben
 * ihr Tor und ihren `PortalRahmen` schon, und sie umzubauen hiesse dreizehn
 * laufende Seiten anzufassen, um eine `nav` einzufügen.
 *
 * **Die Zeile zeigt nur, was diese Sitzung öffnen darf** (AUT-06, D-567). Ein
 * Knopf, der auf 404 führt, verrät genau das, was 404 verschweigen soll. Die
 * Rechte kommen dabei aus dem ROUTENMANIFEST und nicht aus einer zweiten,
 * abgeschriebenen Liste: ein zusätzliches Recht an einer Route wandert damit
 * von selbst in diese Zeile. Ein Ziel ohne Manifestzeile bekommt eine LEERE
 * Rechteliste und verschwindet — das ist die sichere Richtung: ein Tippfehler
 * im Pfad kostet einen Knopf, kein Recht.
 *
 * **Was diese Zeile NICHT heilen kann: wer sie überhaupt zu sehen bekommt.**
 * Der Tab „Website" hängt an `referenz.schreiben` (`registry/navigation.ts`),
 * und dasselbe Recht bewacht `website/seiten`, das Ziel des Tabs. Gehalten
 * wird es von `admin` und `super_admin`; `leitung` — die Rolle, die unter
 * `/social/posts` die Beiträge pflegt — hält es nur, wo eine Gesellschaft es
 * ihr bindet (`bindbar`). Für sie gibt es das Modul damit nicht, auch nicht
 * die Neuigkeitenansicht. Das ist eine Entscheidung über die Rollenmatrix und
 * keine, die eine Sprungzeile treffen darf.
 *
 * // TODO(client, O-683): Soll `leitung` den öffentlichen Auftritt pflegen
 * // dürfen — also `referenz.schreiben` gebunden bekommen (heute nur
 * // `bindbar`)? Solange nicht, ist der Tab „Website" für sie unsichtbar, und
 * // `/portal/<bereich>/website/news` bleibt ihr verschlossen, obwohl sie
 * // dieselben Beiträge unter Social Media bearbeitet.
 */

const ZIELE: readonly { readonly pfad: string; readonly text: string }[] = [
  { pfad: 'seiten', text: 'Seiten' },
  { pfad: 'profil', text: 'Profil' },
  { pfad: 'leistungen', text: 'Leistungen' },
  { pfad: 'referenzen', text: 'Referenzen' },
  { pfad: 'news', text: 'Neuigkeiten' },
  { pfad: 'galerie', text: 'Galerie' },
  { pfad: 'formulare', text: 'Formulare' },
];

function rechteZu(unterpfad: string): readonly string[] {
  const r = routeMitPfad(`/portal/[mandant]/website/${unterpfad}`);
  return r === undefined ? [] : leserechte(r);
}

const SPRUENGE = ZIELE.map((z) => ({ ...z, rechte: rechteZu(z.pfad) }));

export interface WebsiteSpruengeProps {
  readonly mandant: string;
  /**
   * Der Zweig, auf dem der Mensch gerade steht — `'news'` auch dann, wenn er
   * auf `news/<id>` steht. Die Zeile hebt ihn hervor; sie springt deshalb
   * nicht mit in die Tiefe.
   */
  readonly zweig: string;
  readonly sitzung: Sitzung;
}

export async function WebsiteSpruenge(
  { mandant, zweig, sitzung }: WebsiteSpruengeProps,
) {
  const darf = await haeltRechte(sitzung, ...SPRUENGE.flatMap((s) => s.rechte));
  const sichtbar = SPRUENGE.filter(
    (s) => s.rechte.length > 0 && s.rechte.every((r) => darf[r] === true));
  if (sichtbar.length === 0) return null;

  return (
    <nav aria-label="Website" data-cse="website-spruenge"
         className="mb-s5 flex flex-wrap gap-s2">
      {sichtbar.map((s) => {
        const aktiv = s.pfad === zweig;
        return (
          <Link
            key={s.pfad}
            /*
             * Die Vorlage steht INLINE und nicht in einer `const` darüber:
             * `typedRoutes` prüft `href` gegen einen Vorlagen-Literaltyp, und
             * eine Zwischenvariable verbreitert ihn auf `string`. Dieselbe
             * Form benutzt `recruiting/rahmen.tsx`.
             */
            href={`/portal/${mandant}/website/${s.pfad}`}
            data-cse="website-sprung"
            aria-current={aktiv ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-s3 text-sm
                        transition-colors duration-fast ${aktiv
                          ? 'border-line-strong bg-surface-2 text-text'
                          : 'border-line text-text-muted hover:border-line-strong hover:text-text'}`}
          >
            {s.text}
          </Link>
        );
      })}
    </nav>
  );
}
