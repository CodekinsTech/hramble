import assert from "node:assert/strict"
import { fib } from "./fib.js"
assert.equal(fib(0), 0)
assert.equal(fib(1), 1)
assert.equal(fib(10), 55)
console.log("ok")
