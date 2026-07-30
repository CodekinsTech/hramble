import assert from "node:assert/strict"
import { clamp } from "./clamp.js"
assert.equal(clamp(5, 1, 10), 5)
assert.equal(clamp(-3, 1, 10), 1)
assert.equal(clamp(99, 1, 10), 10)
assert.equal(clamp(1, 1, 10), 1)
assert.equal(clamp(10, 1, 10), 10)
console.log("ok")
