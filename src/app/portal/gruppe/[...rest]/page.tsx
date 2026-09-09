import { Unterseite } from '../../unterseite';

/** Jede noch nicht gebaute Route unter `/portal/gruppe/…`. Siehe `unterseite.tsx`. */
export const dynamic = 'force-dynamic';

export default async function GruppeRest(
  { params }: { params: Promise<{ rest: string[] }> },
) {
  const { rest } = await params;
  return (
    <Unterseite
      pfad={`/portal/gruppe/${rest.join('/')}`}
      wurzel="/portal/gruppe"
      bereich={null}
    />
  );
}
