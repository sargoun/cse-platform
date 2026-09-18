import type postgres from 'postgres';
import Image from 'next/image';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { listeGalerie, type GaleriePflegeZeile } from '@/server/services/inhalt/redaktion';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { WebsiteSpruenge } from '../spruenge';

/**
 * `/portal/[mandant]/website/galerie` — welche Bilder öffentlich stehen
 * (§5.21, PUB-04).
 *
 * **Warum die Galerie kuratiert wird und nicht einfach „alle Bilder" zeigt.**
 * `t_medien_oeffentlich` liest `medien` mit `using (true)`: JEDE Zeile ist
 * öffentlich lesbar. Eine Galerie, die einfach je Gesellschaft liest, zeigt
 * den Schnappschuss aus dem Wachbuch und den Scan eines Belegs. Deshalb
 * entscheidet `galerie_rang` — eine Zahl heisst drin, nichts heisst draussen
 * (0170).
 *
 * **Ohne JavaScript.** Jede Zeile ist ein eigenes kleines Formular; das ist
 * mehr Markup als ein Skript, und es funktioniert auf einem Diensttelefon mit
 * schlechtem Netz.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Galerie' };

export default async function WebsiteGalerie(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/website/galerie`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const mandantId = zugang.sitzung.aktiverMandantId;

  const bilder = mandantId === null ? [] : await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, (kontext) => listeGalerie(kontext, mandantId)),
  ) as Promise<readonly GaleriePflegeZeile[]>);

  const drin = bilder.filter((b) => b.rang !== null);
  const draussen = bilder.filter((b) => b.rang === null);
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';

  return (
    <PortalRahmen
      titel="Galerie"
      wurzelTitel="Website"
      bereich={mandant as BereichSchluessel}
      nurLesen={nurLesen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="galerie"
                       sitzung={zugang.sitzung} />
      <h1 className="mb-s4 text-h1 text-text">Galerie</h1>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Nur Bilder mit einer Reihenfolge stehen auf der öffentlichen Seite. Alles
        andere bleibt draussen — auch dann, wenn es dieser Gesellschaft gehört.
      </p>

      <h2 className="mb-s3 text-h3 text-text">
        Auf der Website ({String(drin.length)})
      </h2>
      {drin.length === 0 ? (
        <Hinweis art="hinweis" cse="galerie-leer">
          Noch kein Bild aufgenommen. Die öffentliche Galerie dieser Gesellschaft
          ist damit leer, und die Seite sagt das auch so.
        </Hinweis>
      ) : (
        <Raster bilder={drin} mandant={mandant} nurLesen={nurLesen} drin />
      )}

      <h2 className="mb-s3 mt-s6 text-h3 text-text">
        Nicht in der Galerie ({String(draussen.length)})
      </h2>
      {draussen.length === 0 ? (
        <p className="m-0 text-sm text-text-subtle">
          Jedes Bild dieser Gesellschaft steht in der Galerie.
        </p>
      ) : (
        <Raster bilder={draussen} mandant={mandant} nurLesen={nurLesen} drin={false} />
      )}
    </PortalRahmen>
  );
}

function Raster(
  { bilder, mandant, nurLesen, drin }: {
    readonly bilder: readonly GaleriePflegeZeile[];
    readonly mandant: string;
    readonly nurLesen: boolean;
    readonly drin: boolean;
  },
) {
  return (
    <ul data-cse="galerie-pflege" className="m-0 grid list-none grid-cols-1 gap-s4 p-0 md:grid-cols-3">
      {bilder.map((b) => (
        <li
          key={b.id}
          data-cse="galerie-zeile"
          data-drin={drin ? 'ja' : 'nein'}
          className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s3"
        >
          <span className="relative block aspect-[3/2] overflow-hidden rounded-md">
            <Image src={b.pfad} alt={b.alt} fill sizes="(min-width: 768px) 33vw, 100vw"
                   className="object-cover" />
            {b.platzhalter && (
              <span
                data-cse="platzhalter-marke"
                className="absolute right-s2 top-s2 rounded-full bg-warning-soft px-s3 py-s1 text-micro text-warning"
              >
                Platzhalterbild
              </span>
            )}
          </span>
          <span className="min-w-0 break-words text-sm text-text">{b.alt}</span>
          {/*
            * **`flex-wrap` unten, und das ist eine gemessene Korrektur.**
            *
            * Die Zeile trug ein Zahlenfeld und zwei Knoepfe in einer Flexzeile
            * ohne Umbruch: bei 390 px stand sie 83 px ueber den Rand hinaus,
            * und die ganze Seite bekam einen waagerechten Rollbalken.
            * Aufgefallen ist das erst, als diese Seite ueberhaupt erreichbar
            * wurde — `abmessungen.spec.ts` faehrt jede Adresse der Karte, und
            * bis heute frueh fuehrte kein Weg hierher.
            *
            * Dieselbe Ursache wie D-594: eine Reihe, die auf einem breiten
            * Bildschirm entworfen wurde und auf einem schmalen keinen
            * Umbruchpunkt hat.
            */}
          {!nurLesen && (
            <form method="post" action="/api/website/galerie"
                  className="flex flex-wrap items-center gap-s2">
              <input type="hidden" name="medienId" value={b.id} />
              <input type="hidden" name="zurueck" value={`/portal/${mandant}/website/galerie`} />
              {drin ? (
                <>
                  {/*
                    * Die Reihenfolge ist dieselbe Spalte wie „drin oder
                    * draussen" (0170). Wer sie ändert, ändert den Platz; wer
                    * „Herausnehmen" drückt, setzt sie auf nichts.
                    */}
                  <label className="flex items-center gap-s2 text-xs text-text-muted">
                    Platz
                    <input
                      type="number" name="rang" min={0} defaultValue={b.rang ?? 0}
                      className="min-h-11 w-20 rounded-md border border-line bg-surface-2 px-s2 text-sm text-text"
                    />
                  </label>
                  <Button type="submit" variante="secondary">Speichern</Button>
                  <Button type="submit" name="entfernen" value="1" variante="ghost">
                    Herausnehmen
                  </Button>
                </>
              ) : (
                <>
                  <input type="hidden" name="rang" value="0" />
                  <Button type="submit" variante="secondary">In die Galerie</Button>
                </>
              )}
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
