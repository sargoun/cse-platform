import { pruefeJsonLd } from '@/server/services/inhalt/jsonld';

/**
 * Ein JSON-LD-Block im Seitenkopf (PUB-11).
 *
 * **Er prueft sich beim Rendern.** `pruefeJsonLd` wirft, wenn Pflichtfelder
 * fehlen — und ein geworfener Fehler ist hier die richtige Antwort: ein
 * kaputter Block wird von der Suchmaschine stillschweigend verworfen, die
 * Seite sieht ausgezeichnet aus und ist es nicht. Lieber laut beim Bauen als
 * still in der Suche.
 *
 * **`<` wird maskiert.** Ein `</script>` in einem gepflegten Text — etwa in
 * einer FAQ-Antwort — wuerde den Block sonst beenden und den Rest als Markup
 * ausliefern. Das ist der klassische Weg, wie aus Inhalt Skript wird.
 */
export function JsonLd({ blocks }: { readonly blocks: readonly Record<string, unknown>[] }) {
  for (const b of blocks) pruefeJsonLd(b);
  return (
    <>
      {blocks.map((b, i) => (
        <script
          key={`${String(b['@type'])}-${String(i)}`}
          type="application/ld+json"
          data-cse="json-ld"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(b).replace(/</gu, '\\u003c'),
          }}
        />
      ))}
    </>
  );
}
