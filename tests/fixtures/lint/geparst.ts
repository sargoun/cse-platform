// FIXTURE — must PASS. Parsing a stored instant is not reading a clock.
export function ausIso(iso: string): Date {
  return new Date(iso);
}
