const fs = require("fs");
const path = require("path");

const file = path.join(
  __dirname,
  "frontend",
  "src",
  "pages",
  "LandingPage.tsx"
);

const content = fs.readFileSync(file, "utf8");
const classes = new Set();

const classNameRegex = /className\s*=\s*(["'`])([\s\S]*?)\1/g;
let match;

while ((match = classNameRegex.exec(content)) !== null) {
  match[2]
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => classes.add(value));
}

console.log([...classes].sort().join("\n"));
console.log(`\nFound ${classes.size} distinct static class tokens.`);
