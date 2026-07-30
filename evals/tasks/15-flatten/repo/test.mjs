import assert from "node:assert/strict"
import { flatten } from "./flatten.js"
assert.deepEqual(flatten([1, [2, [3, [4]], 5]]), [1, 2, 3, 4, 5])
assert.deepEqual(flatten([]), [])
console.log("ok")
