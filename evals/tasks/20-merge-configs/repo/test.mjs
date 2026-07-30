import assert from "node:assert/strict"
import { mergeConfig } from "./merge.js"
const base = { a: 1, b: 2 }
const over = { b: 3, c: 4 }
assert.deepEqual(mergeConfig(base, over), { a: 1, b: 3, c: 4 })
assert.deepEqual(base, { a: 1, b: 2 }, "must not mutate base")
console.log("ok")
