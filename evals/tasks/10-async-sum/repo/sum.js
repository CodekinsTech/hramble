// BUG: does not await the promises, so it adds Promise objects.
export async function sumAll(promises) {
  let total = 0
  for (const p of promises) total += p
  return total
}
