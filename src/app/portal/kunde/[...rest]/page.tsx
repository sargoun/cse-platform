import { Unterseite } from '../../unterseite';

/** Jede noch nicht gebaute Route unter `/portal/kunde/…`. Siehe `unterseite.tsx`. */
export const dynamic = 'force-dynamic';

export default async function KundeRest(
  { params }: { params: Promise<{ rest: string[] }> },
) {
  const { rest } = await params;
  return (
    <Unterseite
      pfad={`/portal/kunde/${rest.join('/')}`}
      wurzel="/portal/kunde"
      bereich={null}
    />
  );
}
