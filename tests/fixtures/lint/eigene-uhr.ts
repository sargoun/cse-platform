// FIXTURE — must FAIL `cse/no-client-clock`. Placed under a services path so
// the rule's file scope applies.
export function jetztFalsch(): Date {
  return new Date();
}
export function stempel(): number {
  return Date.now();
}
