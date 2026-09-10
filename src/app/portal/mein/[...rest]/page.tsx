import { Unterseite } from '../../unterseite';

/** Jede noch nicht gebaute Route unter `/portal/mein/…`. Siehe `unterseite.tsx`. */
export const dynamic = 'force-dynamic';

export default async function MeinRest(
  { params }: { params: Promise<{ rest: string[] }> },
) {
  const { rest } = await params;
  return (
    <Unterseite
      pfad={`/portal/mein/${rest.join('/')}`}
      wurzel="/portal/mein"
      bereich={null}
    />
  );
}
