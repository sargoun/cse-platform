/**
 * **Ein Verweis mit Anker als `UrlObject`** (V-204).
 *
 * Die §14-Vorabprüfung verweist seit V-204 auf den Kopf des Entwurfs
 * (`…/rechnungen/<id>#kopf`). Next.js kodiert ein `#` im `pathname` eines
 * `UrlObject` als `%23` — der Verweis führte dann auf eine Seite, die es
 * nicht gibt. Der Anker gehört deshalb in `hash`, und diese Funktion trennt
 * ihn an EINER Stelle ab.
 */
export function alsVerweis(link: string): { pathname: string; hash?: string } {
  const stelle = link.indexOf('#');
  if (stelle < 0) return { pathname: link };
  const hash = link.slice(stelle + 1);
  return hash === ''
    ? { pathname: link.slice(0, stelle) }
    : { pathname: link.slice(0, stelle), hash };
}
