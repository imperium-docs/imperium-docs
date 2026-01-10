import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());

const targets = [
  {
    example: path.join(root, "apps", "api", ".env.example"),
    dest: path.join(root, "apps", "api", ".env")
  },
  {
    example: path.join(root, "apps", "web", ".env.example"),
    dest: path.join(root, "apps", "web", ".env")
  }
];

for (const target of targets) {
  if (fs.existsSync(target.dest)) continue;
  if (!fs.existsSync(target.example)) continue;
  fs.copyFileSync(target.example, target.dest);
  console.log(`Created ${target.dest}`);
}
