#!/usr/bin/env node
// Confere que o `index.json` publicado descreve a realidade: baixa CADA arquivo pela URL
// raw anunciada e confere o sha256 individual e o checksum agregado da skill — exatamente
// o que o `mgr add` faz na maquina do usuario. Um index correto sobre URLs quebradas
// falharia so no primeiro `mgr add`; aqui falha no CI.
//
//   node scripts/verify-published.mjs [--index <url-ou-caminho>]
//
// Zero dependencias: `fetch` nativo do Node.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateChecksum, sha256 } from "./plugin-schema.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

async function readIndex(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`index unavailable: ${source} (HTTP ${response.status})`);
    return response.json();
  }
  return JSON.parse(readFileSync(source, "utf8"));
}

export async function verifyEntry(entry, { fetchImpl = fetch } = {}) {
  const files = [];
  for (const file of entry.files) {
    const response = await fetchImpl(file.url);
    if (!response.ok) {
      throw new Error(`${entry.name}: ${file.path} unreachable at ${file.url} (HTTP ${response.status})`);
    }
    const content = Buffer.from(await response.arrayBuffer());
    const digest = sha256(content);
    if (digest !== file.sha256) {
      throw new Error(`${entry.name}: ${file.path} sha256 mismatch (index says ${file.sha256}, published file is ${digest})`);
    }
    files.push({ path: file.path, content });
  }
  const checksum = aggregateChecksum(files);
  if (checksum !== entry.checksum) {
    throw new Error(`${entry.name}: aggregate checksum mismatch (index says ${entry.checksum}, published files give ${checksum})`);
  }
  return checksum;
}

async function main() {
  const flagAt = process.argv.indexOf("--index");
  const source = flagAt === -1 ? path.join(ROOT, "index.json") : process.argv[flagAt + 1];
  const index = await readIndex(source);
  const entries = Object.values(index.categories).flat();

  for (const entry of entries) {
    const checksum = await verifyEntry(entry);
    console.log(`ok  ${entry.name}@${entry.version}  ${checksum}`);
  }
  console.log(`${entries.length} skill(s) verified against the published files.`);
}

if (process.argv[1] && process.argv[1].endsWith("verify-published.mjs")) {
  main().catch((error) => {
    console.error(`verification failed: ${error.message}`);
    process.exit(1);
  });
}
