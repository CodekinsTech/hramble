import assert from "node:assert/strict"
import { sortByAge } from "./sort.js"
const input = [
  { name: "A", age: 30 },
  { name: "B", age: 20 },
  { name: "C", age: 30 },
]
const out = sortByAge(input)
assert.deepEqual(out.map((p) => p.name), ["B", "A", "C"])
assert.equal(input[0].name, "A", "must not mutate input order")
console.log("ok")
