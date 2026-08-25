#!/usr/bin/env node
// Detecta DRIFT entre `scripts/plugin-schema.mjs` (copia vendorizada) e o
// `src/plugin.js` original do mgr-method. Se o registry validar com um schema mais velho
// que o do instalador, ele aceita manifest que o `mgr add` recusaria — e o usuario so
// descobre na hora de instalar. Esta checagem faz esse desencontro falhar no CI daqui.
//
//   node scripts/check-schema-sync.mjs                 compara com o primeiro ref disponivel
//   node scripts/check-schema-sync.mjs --ref <ref>     forca um ref especifico
//   node scripts/check-schema-sync.mjs --source <url|caminho>
//
// CASCATA DE REFS: a evolucao do MGR integra em `release/mgr-evolution` e so vai para a
// `main` no fim das 4 fases. Procurar so na `main` deixaria esta checagem inativa durante
// toda a evolucao — o apodrecimento silencioso que ela existe para evitar. Entao tenta a
// `main` primeiro (estado final duravel) e cai para o branch de release. Quando a evolucao
// inteira chegar na `main`, a `main` vence sozinha e o branch de release pode sumir.
//
// ATIVACAO AUTOMATICA: enquanto `src/plugin.js` nao existir em NENHUM dos refs, a checagem
// se declara INATIVA e passa — nao ha o que comparar. No momento em que o arquivo aparecer,
// ela passa a valer sozinha, sem ninguem lembrar de ligar nada.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VENDORED = path.join(ROOT, "scripts", "plugin-schema.mjs");
const UPSTREAM_PATH = "src/plugin.js";
export const REF_CASCADE = ["main", "release/mgr-evolution"];
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

// Primeiro ref da cascata que realmente serve o arquivo.
export async function resolveUpstream(refs, { read = readUpstream } = {}) {
  for (const ref of refs) {
    const result = await read(rawUrl(ref));
    if (result.found) return { ...result, ref, source: rawUrl(ref) };
  }
  return { found: false, refs };
}

async function main() {
  const argv = process.argv.slice(2);
  const refAt = argv.indexOf("--ref");
  const sourceAt = argv.indexOf("--source");
  const refs = refAt === -1 ? REF_CASCADE : [argv[refAt + 1]];

  const upstream = sourceAt === -1
    ? await resolveUpstream(refs)
    : { ...(await readUpstream(argv[sourceAt + 1])), source: argv[sourceAt + 1] };

  if (!upstream.found) {
    console.log(`schema drift check INATIVA: ${UPSTREAM_PATH} ainda nao existe em ${refs.join(" nem em ")}.`);
    console.log("Passa a valer sozinha assim que a fundacao de plugins for integrada.");
    return;
  }

  const vendored = stripVendorHeader(readFileSync(VENDORED, "utf8"));
  if (vendored === upstream.text) {
    console.log(`scripts/plugin-schema.mjs esta identico a ${UPSTREAM_PATH} de ${upstream.source}.`);
    return;
  }

  const diff = firstDifference(vendored, upstream.text);
  console.error("DRIFT: scripts/plugin-schema.mjs divergiu do schema do mgr-method.");
  console.error(`  comparado com ${upstream.source}`);
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
