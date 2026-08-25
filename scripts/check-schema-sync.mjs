#!/usr/bin/env node
// Detecta DRIFT entre `scripts/plugin-schema.mjs` (copia vendorizada) e o
// `src/plugin.js` original do mgr-method. Se o registry validar com um schema mais velho
// que o do instalador, ele aceita manifest que o `mgr add` recusaria — e o usuario so
// descobre na hora de instalar. Esta checagem faz esse desencontro falhar no CI daqui.
//
//   node scripts/check-schema-sync.mjs                 compara com a main do mgr-method
//   node scripts/check-schema-sync.mjs --ref <ref>     compara com outro ref
//   node scripts/check-schema-sync.mjs --source <url|caminho>
//
// ATIVACAO AUTOMATICA: enquanto `src/plugin.js` nao existir no ref (a fundacao de plugins
// ainda nao chegou na main), a checagem se declara INATIVA e passa — nao ha o que comparar.
// No momento em que o arquivo aparecer la, ela passa a valer sozinha, sem ninguem lembrar
// de ligar nada.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VENDORED = path.join(ROOT, "scripts", "plugin-schema.mjs");
const UPSTREAM_PATH = "src/plugin.js";
const rawUrl = (ref) => `https://raw.githubusercontent.com/maurigre/mgr-method/${ref}/${UPSTREAM_PATH}`;

// A copia local carrega um cabecalho proprio explicando a vendorizacao; ele nao existe no
// original e nao entra na comparacao. Delimitadores: as duas linhas de "// ===...".
const HEADER_RE = /^\/\/ ={10,}\n[\s\S]*?\n\/\/ ={10,}\n\n/;

export const stripVendorHeader = (text) => text.replace(HEADER_RE, "");

// Primeira linha divergente, para o log do CI apontar onde olhar em vez de despejar o
// arquivo inteiro.
export function firstDifference(left, right) {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  for (let i = 0; i < Math.max(leftLines.length, rightLines.length); i++) {
    if (leftLines[i] !== rightLines[i]) {
      return { line: i + 1, vendored: leftLines[i] ?? "<fim do arquivo>", upstream: rightLines[i] ?? "<fim do arquivo>" };
    }
  }
  return null;
}

async function readUpstream(source) {
  if (!/^https?:\/\//.test(source)) {
    return { found: true, text: readFileSync(source, "utf8") };
  }
  const response = await fetch(source);
  if (response.status === 404) return { found: false, text: "" };
  if (!response.ok) throw new Error(`upstream unreachable: ${source} (HTTP ${response.status})`);
  return { found: true, text: await response.text() };
}

async function main() {
  const argv = process.argv.slice(2);
  const refAt = argv.indexOf("--ref");
  const sourceAt = argv.indexOf("--source");
  const ref = refAt === -1 ? "main" : argv[refAt + 1];
  const source = sourceAt === -1 ? rawUrl(ref) : argv[sourceAt + 1];

  const upstream = await readUpstream(source);
  if (!upstream.found) {
    console.log(`schema drift check INATIVA: ${UPSTREAM_PATH} ainda nao existe em ${source}.`);
    console.log("Passa a valer sozinha assim que a fundacao de plugins chegar la.");
    return;
  }

  const vendored = stripVendorHeader(readFileSync(VENDORED, "utf8"));
  if (vendored === upstream.text) {
    console.log(`scripts/plugin-schema.mjs esta identico a ${UPSTREAM_PATH} de ${source}.`);
    return;
  }

  const diff = firstDifference(vendored, upstream.text);
  console.error("DRIFT: scripts/plugin-schema.mjs divergiu do schema do mgr-method.");
  console.error(`  primeira divergencia na linha ${diff.line} (ja sem o cabecalho da copia)`);
  console.error(`    copia:    ${diff.vendored}`);
  console.error(`    original: ${diff.upstream}`);
  console.error("  sincronize: cp <mgr-method>/src/plugin.js scripts/plugin-schema.mjs");
  console.error("  e recoloque o bloco de cabecalho no topo do arquivo.");
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("check-schema-sync.mjs")) {
  main().catch((error) => {
    console.error(`schema drift check failed: ${error.message}`);
    process.exit(1);
  });
}
