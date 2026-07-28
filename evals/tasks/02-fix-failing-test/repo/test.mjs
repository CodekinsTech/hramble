import { slugify } from "./slug.js"
if (slugify("Hello World") !== "hello-world") {
  console.error("expected hello-world, got", slugify("Hello World")); process.exit(1)
}
console.log("ok")
