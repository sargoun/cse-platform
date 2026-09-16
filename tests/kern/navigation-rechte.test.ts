/**
 * **Jeder Menüpunkt trägt GENAU das Recht, das seine Seite verlangt.**
 *
 * Ein Menüpunkt, der auf 404 führt, ist schlechter als keiner: er verrät die
 * Existenz dessen, was er nicht zeigen darf (AUT-06). Ein Menüpunkt, der zu
 * MILD bewacht ist, ist derselbe Fehler von der anderen Seite: er öffnet einen
 * Bildschirm, dessen Daten die Policies dann leer lassen — und ein leerer
 * Bildschirm sieht aus wie „nichts vorhanden", nicht wie „nicht erlaubt".
 *
 * Diese Prüfung hat dieses Projekt zweimal gebraucht und beide Male gefehlt:
 *
 *  - **Social** stand im Manifest auf `social.schreiben`, während die
 *    SELECT-Policies in `0163` `social.lesen` verlangen (D-573). Wer schreiben
 *    durfte und nicht lesen, sah überall leere Listen; wer lesen durfte und
 *    nicht schreiben, bekam 404 auf einen Bildschirm, den er lesen darf.
 *  - **Recruiting/Stellen** hatte dieselbe Lücke eine Ebene tiefer (D-574).
 *
 * Beide Male fiel es erst einer Durchsicht auf, nie einer Prüfung. Deshalb
 * steht die Bedingung jetzt als Vergleich da, und zwar gegen dieselbe Quelle,
 * die das Tor fragt: `findeRoute()`.
 */
import { describe, expect, it } from 'vitest';
import {
  GRUPPEN_NAVIGATION, NAVIGATION,
} from '../../src/server/registry/navigation.js';
import { findeRoute, leserechte } from '../../src/server/registry/routen.js';

/**
 * Ein Punkt ohne Manifestzeile ist ein Punkt ins Leere — das prüft der erste
 * Fall. Der zweite prüft die Rechte.
 */
function pfadVon(wurzel: string, p: string): string {
  return p === '' ? wurzel : `${wurzel}/${p}`;
}

describe('die Portalnavigation steht auf dem Routenmanifest', () => {
  it('jeder Punkt der Mandantsnavigation hat eine Route', () => {
    const ohne = NAVIGATION
      .map((n) => pfadVon('/portal/reinigung', n.pfad))
      .filter((pfad) => findeRoute(pfad) === undefined);
    expect(ohne, 'Menuepunkte ohne Zeile in der Seitenkarte').toEqual([]);
  });

  it('jeder Punkt der Gruppennavigation hat eine Route', () => {
    const ohne = GRUPPEN_NAVIGATION
      .map((n) => pfadVon('/portal/gruppe', n.pfad))
      .filter((pfad) => findeRoute(pfad) === undefined);
    expect(ohne, 'Gruppenpunkte ohne Zeile in der Seitenkarte').toEqual([]);
  });

  /**
   * **Das Recht des Punktes muss unter den Leserechten der Route stehen.**
   *
   * Nicht „gleich": eine Route darf MEHR verlangen als der Menüpunkt anzeigt
   * (`/recruiting/bedarf` braucht zusätzlich `dienstplan.lesen`) — dann bleibt
   * der Punkt sichtbar und die Seite sperrt. Was NICHT sein darf, ist ein
   * Recht am Punkt, das die Route gar nicht kennt: dann ist der Punkt entweder
   * strenger als nötig (ein Mensch sieht seinen Bildschirm nicht) oder milder
   * (er sieht ihn leer).
   */
  function fremdeRechte(
    eintraege: readonly { readonly pfad: string; readonly recht: string }[],
    wurzel: string,
  ): readonly string[] {
    return eintraege.flatMap((n) => {
      const pfad = pfadVon(wurzel, n.pfad);
      const route = findeRoute(pfad);
      if (route === undefined) return [];
      const rechte = leserechte(route);
      if (rechte.length === 0) return [];
      return rechte.includes(n.recht)
        ? []
        : [`${pfad}: Menue verlangt ${n.recht}, Route verlangt ${rechte.join(' + ')}`];
    });
  }

  it('kein Menuepunkt traegt ein Recht, das seine Route nicht kennt', () => {
    expect(fremdeRechte(NAVIGATION, '/portal/reinigung')).toEqual([]);
  });

  it('und dasselbe in der Gruppenansicht', () => {
    expect(fremdeRechte(GRUPPEN_NAVIGATION, '/portal/gruppe')).toEqual([]);
  });
});
