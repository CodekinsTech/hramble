import assert from "node:assert/strict"
import { extractEmails } from "./emails.js"
const t = "Contact a@x.com or bob.smith@mail.co.uk, not '@nope'."
assert.deepEqual(extractEmails(t), ["a@x.com", "bob.smith@mail.co.uk"])
assert.deepEqual(extractEmails("no emails here"), [])
console.log("ok")
