import type { Route } from 'next';
import { headers } from 'next/headers';
import { KOPF_PFAD } from '@/lib/kopf';
import { Zustandsseite, ZustandKnopf } from '@/components/ui/Zustandsseite';

/**
 * Die 404-Seite der ganzen Anwendung (DESIGN §5 „Status pages").
 *
 * **Sie steht an der WURZEL, nicht in einer Gruppe.** Next.js sucht die
 * naechste `not-found.tsx` oberhalb der Stelle, an der `notFound()` faellt —
 * und eine Route ausserhalb von `(public)` und `portal` (etwa `/auth/…` oder
 * eine Adresse, die es nie gab) findet in einer Gruppendatei nichts. Die
 * Wurzel ist die einzige Stelle, die JEDEN Fall abdeckt.
 *
 * **Der Text muss fuer zwei verschiedene Faelle stimmen.** AUT-06 beantwortet
 * ein fehlendes RECHT mit demselben 404 wie eine fehlende SEITE — sonst waere
 * der Statuscode ein Orakel. Also sagt dieser Satz beides und verraet keines:
 * „gibt es hier nicht" ist wahr, wenn die Seite fehlt, und wahr, wenn sie
 * jemand anderem gehoert.
 *
 * **Sie traegt NICHT den Portalrahmen** — und das ist eine Grenze des
 * Rahmenwerks, keine Bequemlichkeit. `not-found.tsx` bekommt in Next.js keine
 * `params`, weiss also nicht, in welcher Gesellschaft es steht; und der Lader,
 * der es wuesste (`mandantTor`), ruft selbst `notFound()` — auf einer
 * Nichtgefunden-Seite waere das eine Schleife auf genau dem Bildschirm, der nie
 * scheitern darf. Der Weg zurueck kommt deshalb aus dem Pfad, den die
 * Middleware in einen Kopf schreibt.
 */

/** `/portal/reinigung/social/posts/x` → `/portal/reinigung`. Sonst `null`. */
function portalWurzel(pfad: string): Route | null {
  const teile = pfad.split('/').filter((t) => t !== '');
  if (teile[0] !== 'portal' || teile[1] === undefined) return null;
  /*
   * Nur Buchstaben, Ziffern und Bindestriche — der Pfad kommt vom Aufrufer,
   * und ein Verweis, der ungeprueft daraus gebaut wird, ist die Stelle, an der
   * jemand `/portal/..%2f..` unterbringt.
   */
  if (!/^[a-z0-9-]{1,64}$/u.test(teile[1])) return null;
  return `/portal/${teile[1]}` as Route;
}

export default async function NichtGefunden() {
  const pfad = (await headers()).get(KOPF_PFAD) ?? '/';
  const wurzel = portalWurzel(pfad);

  return (
    <Zustandsseite
      cse="seite-404"
      code="404"
      titel="Diese Seite gibt es hier nicht."
      erklaerung={
        <>
          <p>
            Vielleicht ist die Adresse veraltet, vielleicht gehört der Eintrag zu einer
            anderen Gesellschaft. Beides sieht von aussen gleich aus — und das ist
            Absicht.
          </p>
          <p className="mt-s3">
            Wer hier sein sollte und es nicht ist, meldet sich an und geht den Weg über
            das Menü: ein Verweis, der aus einer alten E-Mail kommt, zeigt manchmal auf
            etwas, das inzwischen umgezogen ist.
          </p>
        </>
      }
      /*
       * **Hoechstens zwei** (DESIGN §5). Drei Wege weiter sind kein Weg
       * weiter, sondern eine Auswahl — und wer hier steht, hat gerade keine
       * Lust, eine zu treffen. Im Portal ist der erste die Portalwurzel; davor
       * die Startseite.
       */
      aktionen={wurzel === null ? (
        <>
          <ZustandKnopf href="/" variante="primary" cse="zu-start">
            Zur Startseite
          </ZustandKnopf>
          <ZustandKnopf href="/auth/login" cse="zur-anmeldung">Anmelden</ZustandKnopf>
        </>
      ) : (
        <>
          <ZustandKnopf href={wurzel} variante="primary" cse="zum-portal">
            Zurück ins Portal
          </ZustandKnopf>
          <ZustandKnopf href="/" cse="zu-start">Startseite</ZustandKnopf>
        </>
      )}
    />
  );
}
