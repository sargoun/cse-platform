import { Unterseite } from '../../unterseite';

/**
 * `/portal/konto/…` — die Kontoseiten (§9, `USR`).
 *
 * Optionaler Catch-all, weil `/portal/konto` selbst KEINE Manifestroute ist:
 * die Wurzel faellt damit durch `findeRoute` auf `undefined` und `pruefeZugang`
 * auf 404 — genau wie jede andere Adresse, die es nicht gibt.
 */
export const dynamic = 'force-dynamic';

export default async function KontoRest(
  { params }: { params: Promise<{ rest?: string[] }> },
) {
  const { rest } = await params;
  const teil = rest === undefined || rest.length === 0 ? '' : `/${rest.join('/')}`;
  return (
    <Unterseite pfad={`/portal/konto${teil}`} bereich={null} />
  );
}
