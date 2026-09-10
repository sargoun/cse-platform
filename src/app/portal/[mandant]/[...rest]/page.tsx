import { MandantUnterseite } from '../../unterseite';

/** Jede noch nicht gebaute Route unter `/portal/[mandant]/…`. Siehe `unterseite.tsx`. */
export const dynamic = 'force-dynamic';

export default async function MandantRest(
  { params }: { params: Promise<{ mandant: string; rest: string[] }> },
) {
  const { mandant, rest } = await params;
  return <MandantUnterseite mandant={mandant} segmente={rest} />;
}
