import { Icon } from '@/components/ui/Icon';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { bindeAnfrage } from '@/server/kontext/index';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { zaehleUngelesen } from '@/server/benachrichtigung/posteingang';
import type postgres from 'postgres';

/**
 * Die Glocke der Kopfzeile — ungelesene Benachrichtigungen (NOT-01).
 *
 * **Eine eigene, asynchrone Komponente und kein Prop.** `PortalRahmen` wird
 * von ueber hundert Seiten aufgerufen; ein weiteres Prop haette hundert
 * Dateien angefasst, und die hundertunderste haette es vergessen — eine
 * Glocke, die auf manchen Seiten fehlt, ist schlimmer als keine, weil man
 * sich an ihr Fehlen gewoehnt.
 *
 * **Sie kostet eine indizierte Zaehlung je Seite.**
 * `benachrichtigung_posteingang_idx` ist ein Teilindex auf
 * `(empfaenger_id, erstellt_am desc) where gelesen_am is null` — genau diese
 * Abfrage. Ein Zwischenspeicher waere eine zweite Wahrheit, die zeigt, was
 * gestern galt.
 *
 * **Kein Ziel ohne Bereich.** Der Posteingang liegt unter
 * `/portal/[mandant]/benachrichtigungen`; in der Gruppenansicht gibt es
 * keinen Bereich, und dann erscheint die Glocke gar nicht, statt auf 404 zu
 * fuehren.
 */
export async function Glocke({ wurzel }: { readonly wurzel: string }) {
  if (!/^\/portal\/[a-z0-9-]+$/u.test(wurzel)) return null;

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return null;

  const offen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
    return zaehleUngelesen({ abfrage });
  }) as Promise<number>);

  return (
    <a
      href={`${wurzel}/benachrichtigungen`}
      data-cse="glocke"
      data-offen={String(offen)}
      /*
       * Ein Symbol allein traegt den Namen selbst (DESIGN §5): ohne
       * `aria-label` hoerte ein Screenreader „Link" und sonst nichts. Die
       * Zahl steht im Namen, nicht nur im Abzeichen — Farbe und Groesse
       * allein sind kein Signal (§9).
       */
      aria-label={offen === 0
        ? 'Benachrichtigungen — nichts Ungelesenes'
        : `Benachrichtigungen — ${String(offen)} ungelesen`}
      className="relative flex min-h-11 min-w-11 items-center justify-center rounded-md
                 text-text-muted transition-colors duration-fast ease-brand
                 hover:bg-surface-2 hover:text-text"
    >
      <Icon name="glocke" groesse="md" />
      {offen > 0 && (
        <span
          aria-hidden="true"
          className="absolute end-1 top-1 inline-flex min-w-4 items-center justify-center
                     rounded-full bg-brand px-1 text-[10px] font-semibold leading-4 text-white"
        >
          {offen > 99 ? '99+' : offen}
        </span>
      )}
    </a>
  );
}
