// Switches prisma/schema.prisma between "sqlite" (local) and "postgresql" (pilot/production).
// The schema avoids provider-specific types (enums and JSON are strings), so only the provider changes.
//   node scripts/prisma-provider.mjs postgresql
import { readFileSync, writeFileSync } from "node:fs";
const target = process.argv[2];
if (!["sqlite", "postgresql"].includes(target)) { console.error("Usage: prisma-provider.mjs sqlite|postgresql"); process.exit(1); }
const file = "prisma/schema.prisma";
const s = readFileSync(file, "utf8");
const next = s.replace(/(datasource db \{\s*provider\s*=\s*)"(sqlite|postgresql)"/, `$1"${target}"`);
if (next === s && !s.includes(`provider = "${target}"`)) { console.error("Could not find the datasource provider."); process.exit(1); }
writeFileSync(file, next);
console.log(`Prisma provider: ${target}`);
