import assert from "node:assert/strict"
import { wordCount } from "./words.js"
assert.equal(wordCount("hello world"), 2)
assert.equal(wordCount("  one   two  three "), 3)
assert.equal(wordCount(""), 0)
assert.equal(wordCount("   "), 0)
console.log("ok")
