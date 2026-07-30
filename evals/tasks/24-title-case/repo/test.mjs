import assert from "node:assert/strict"
import { titleCase } from "./title.js"
assert.equal(titleCase("hello world"), "Hello World")
assert.equal(titleCase("the QUICK brown FOX"), "The Quick Brown Fox")
assert.equal(titleCase("a"), "A")
assert.equal(titleCase(""), "")
console.log("ok")
