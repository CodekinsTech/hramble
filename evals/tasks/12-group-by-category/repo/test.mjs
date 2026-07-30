import assert from "node:assert/strict"
import { byCategory } from "./group.js"
const items = [
  { name: "apple", category: "fruit" },
  { name: "carrot", category: "veg" },
  { name: "banana", category: "fruit" },
]
assert.deepEqual(byCategory(items), { fruit: ["apple", "banana"], veg: ["carrot"] })
console.log("ok")
