import assert from "node:assert/strict"
import { debounce } from "./debounce.js"

let calls = 0
let lastArg = null
const d = debounce((x) => {
  calls++
  lastArg = x
}, 50)

d(1)
d(2)
d(3)
// Nothing should have fired synchronously.
assert.equal(calls, 0)

await new Promise((r) => setTimeout(r, 120))
// Only the trailing call should have fired, with the latest argument.
assert.equal(calls, 1)
assert.equal(lastArg, 3)
console.log("ok")
