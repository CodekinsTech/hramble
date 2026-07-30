import assert from "node:assert/strict"
import { parseQuery } from "./query.js"
assert.deepEqual(parseQuery("a=1&b=hello&c="), { a: "1", b: "hello", c: "" })
assert.deepEqual(parseQuery("?x=9"), { x: "9" })
assert.deepEqual(parseQuery(""), {})
console.log("ok")
