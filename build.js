import { build } from "esbuild";
import { promises as fs } from "fs";
import path from "path";

const cliFolder = "./cli";
const distFolder = "./dist";

async function getEntryPoints() {
  const files = await fs.readdir(cliFolder);
  return files
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => ({
      input: `${cliFolder}/${file}`,
      output: `${distFolder}/${path.basename(file, ".mjs")}.cjs`,
    }));
}

async function buildAndAddShebang(entry) {
  await build({
    entryPoints: [entry.input],
    bundle: true,
    platform: "node",
    outfile: entry.output,
    format: "cjs",
    target: ["node18"],
    external: ["zx"],
  });

  const shebang = "#!/usr/bin/env node\n";
  const content = await fs.readFile(entry.output, "utf8");
  await fs.writeFile(entry.output, content.startsWith(shebang) ? content : shebang + content);
}

const entryPoints = await getEntryPoints();
await Promise.all(entryPoints.map(buildAndAddShebang));
console.log("Build complete.");
