export function probe(flag: boolean): string {
  if (flag) return "covered";
  return "not covered by any test";
}
