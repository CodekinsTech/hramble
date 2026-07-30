import assert from "node:assert/strict"
import { unique } from "./dedupe.js"
assert.deepEqual(unique([1, 2, 2, 3, 1, 4]), [1, 2, 3, 4])
assert.deepEqual(unique(["a", "a", "b"]), ["a", "b"])
console.log("ok")
