import assert from "node:assert/strict"
import { sumAll } from "./sum.js"
const r = await sumAll([Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)])
assert.equal(r, 6)
console.log("ok")
