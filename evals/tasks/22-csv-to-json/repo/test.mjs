import assert from "node:assert/strict"
import { csvToJson } from "./csv.js"
const csv = "name,age\nAlice,30\nBob,25"
assert.deepEqual(csvToJson(csv), [
  { name: "Alice", age: "30" },
  { name: "Bob", age: "25" },
])
console.log("ok")
