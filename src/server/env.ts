import 'server-only';
import { z } from 'zod';

/**
 * Environment, validated once at the boundary (SEC-A4, SEC-A5).
 *
 * `server-only` makes an accidental client import a build error rather than a
 * secret in a bundle. Nothing here has a default that would let the platform
 * start against the wrong database: an absent variable fails the boot, loudly,
 * which is the one moment it is cheap to notice.
 */
const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  /** D-04: every service in an EU region. Asserted, not assumed. */
  SUPABASE_REGION: z.string().regex(/^eu-/u, 'D-04: die Region muss in der EU liegen'),
});

export type Env = z.infer<typeof Schema>;

let zwischengespeichert: Env | null = null;

export function env(): Env {
  if (zwischengespeichert !== null) return zwischengespeichert;
  const ergebnis = Schema.safeParse(process.env);
  if (!ergebnis.success) {
    const felder = ergebnis.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Ungültige Umgebung:\n  ${felder}`);
  }
  zwischengespeichert = ergebnis.data;
  return zwischengespeichert;
}
