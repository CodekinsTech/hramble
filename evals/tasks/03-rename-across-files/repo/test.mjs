import { getUser } from "./user.js"
import { handler } from "./api.js"
if (getUser(1).id !== 1) { console.error("getUser broken"); process.exit(1) }
if (handler(2).id !== 2) { console.error("handler broken"); process.exit(1) }
console.log("ok")
