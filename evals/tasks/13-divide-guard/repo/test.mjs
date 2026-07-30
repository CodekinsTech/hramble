import assert from "node:assert/strict"
import { divide } from "./divide.js"
assert.equal(divide(10, 2), 5)
assert.throws(() => divide(1, 0), /divide by zero/)
console.log("ok")
