import { add, multiply } from "./math.js"
if (add(2, 3) !== 5) { console.error("add broken"); process.exit(1) }
if (multiply(3, 4) !== 12) { console.error("multiply wrong"); process.exit(1) }
console.log("ok")
