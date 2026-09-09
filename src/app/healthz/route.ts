/**
 * The deployment health probe. Thin by construction: it authorises nothing,
 * reads no tenant data and touches no database — which is why `route-ohne-db`
 * can be asserted over this directory from the first commit.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({
    status: 'ok',
    build_id: process.env['VERCEL_GIT_COMMIT_SHA'] ?? 'lokal',
    region: process.env['VERCEL_REGION'] ?? 'fra1',
  });
}
