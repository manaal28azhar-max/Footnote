// Serve Bryntum's prebuilt UMD bundle and themes as static files instead of
// bundling 4.6 MB through the build (which needs several GB of build memory).
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("@bryntum/scheduler/package.json"));
const out = path.join(process.cwd(), "public", "vendor", "bryntum");
mkdirSync(out, { recursive: true });
for (const f of ["scheduler.umd.js", "scheduler.css", "svalbard-light.css"]) cpSync(path.join(pkgDir, f), path.join(out, f));
for (const dir of ["fontawesome", "fonts"]) if (existsSync(path.join(pkgDir, dir))) cpSync(path.join(pkgDir, dir), path.join(out, dir), { recursive: true });
console.log("Bryntum assets copied to public/vendor/bryntum");
