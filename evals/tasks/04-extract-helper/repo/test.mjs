import { normalize } from "./util.js"
import { greet } from "./app.js"
if (normalize("  Bob ") !== "bob") { console.error("normalize wrong"); process.exit(1) }
if (greet("  Bob ") !== "hello bob") { console.error("greet broken"); process.exit(1) }
console.log("ok")
