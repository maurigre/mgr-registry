#!/usr/bin/env node
// Gera o `index.json` do registry A PARTIR dos manifests das skills (ADR-0005 do
// mgr-method): o index NUNCA e editado a mao. Cada entrada carrega a URL raw e o sha256 de
// cada arquivo, mais o checksum agregado do conjunto — e isso que o `mgr add` verifica
// antes de escrever qualquer byte no disco do usuario.
//
//   node scripts/build-index.mjs            regenera o index.json
//   node scripts/build-index.mjs --check    falha se o index divergir dos manifests (CI)
//
// Zero dependencias: so `node:` builtins.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateChecksum, DESCRIPTION_MAX, MANIFEST_NAME, parseSkillName, sha256, validateManifest,
} from "./plugin-schema.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKILLS_DIR = path.join(ROOT, "skills");
const INDEX_FILE = path.join(ROOT, "index.json");

export const REGISTRY_NAME = "mgr";
export const RAW_BASE = "https://raw.githubusercontent.com/maurigre/mgr-registry/main";

// Regras de PUBLICACAO, alem do schema (D06 do kickoff: descricao nao-generica e com
// gatilho explicito; permissions obrigatorio no registry oficial). O schema sozinho aceita
// manifest sem `permissions` — fora do registry oficial isso e legitimo, aqui nao e.
const TRIGGER_RE = /\buse\s+when\b/i;

export function validateForPublication(manifest) {
  const problems = validateManifest(manifest);
  if (!Array.isArray(manifest?.permissions) || manifest.permissions.length === 0) {
    problems.push('"permissions" is required in this registry: declare what the skill needs, even if minimal');
  }
  if (typeof manifest?.description === "string" && !TRIGGER_RE.test(manifest.description)) {
    problems.push('"description" must state WHEN to use the skill with an explicit trigger clause ("Use when ...")');
  }
  if (typeof manifest?.description === "string" && manifest.description.length > DESCRIPTION_MAX) {
    problems.push(`"description" must not exceed ${DESCRIPTION_MAX} characters`);
  }
  return problems;
}

const listDirs = (dir) => readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

// Arquivos da skill em caminhos relativos, ordenados — a ordem do checksum agregado e
// lexicografica de path, entao a listagem estavel mantem o index reproduzivel.
function collectFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => (left.name < right.name ? -1 : 1))
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      return entry.isDirectory()
        ? collectFiles(full, relative)
        : [{ path: relative, content: readFileSync(full) }];
    });
}

export function buildEntry(skill, { rawBase = RAW_BASE, skillsDir = SKILLS_DIR } = {}) {
  const dir = path.join(skillsDir, skill);
  const manifestFile = path.join(dir, MANIFEST_NAME);
  if (!statSync(manifestFile, { throwIfNoEntry: false })) {
    throw new Error(`skills/${skill}: missing ${MANIFEST_NAME}`);
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const problems = validateForPublication(manifest);
  if (problems.length) {
    throw new Error(`skills/${skill}: ${problems.join("; ")}`);
  }
  if (parseSkillName(manifest.name).skill !== skill) {
    throw new Error(`skills/${skill}: manifest name ${manifest.name} does not match the folder`);
  }
  if (parseSkillName(manifest.name).registry !== REGISTRY_NAME) {
    throw new Error(`skills/${skill}: manifest scope must be "@${REGISTRY_NAME}" in this registry (got ${manifest.name})`);
  }

  const files = collectFiles(dir);
  if (!files.some((file) => file.path === "SKILL.md")) {
    throw new Error(`skills/${skill}: missing SKILL.md`);
  }
  return {
    entry: {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      // `ecosystems` viaja para o index porque a deteccao casa contra ELE, sem baixar skill
      // nenhuma (ADR-0009 do mgr-method). Skill sem o campo simplesmente nao e sugerida.
      ...(manifest.ecosystems?.length ? { ecosystems: manifest.ecosystems } : {}),
      checksum: aggregateChecksum(files),
      files: files.map((file) => ({
        path: file.path,
        url: `${rawBase}/skills/${skill}/${file.path}`,
        sha256: sha256(file.content),
      })),
    },
    category: manifest.category,
  };
}

// `generatedAt` fica FORA da comparacao do --check: um timestamp novo a cada build faria
// o CI acusar divergencia onde nao ha mudanca de conteudo.
export function buildIndex(options = {}) {
  const categories = {};
  for (const skill of listDirs(options.skillsDir || SKILLS_DIR)) {
    const { entry, category } = buildEntry(skill, options);
    categories[category] = categories[category] || [];
    categories[category].push(entry);
  }
  const sorted = Object.fromEntries(
    Object.entries(categories)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([category, entries]) => [category, entries.sort((left, right) => (left.name < right.name ? -1 : 1))]),
  );
  return { indexVersion: 1, registry: REGISTRY_NAME, generatedAt: new Date().toISOString(), categories: sorted };
}

const withoutTimestamp = ({ generatedAt, ...rest }) => rest;

function main() {
  const check = process.argv.includes("--check");
  const index = buildIndex();
  const skills = Object.values(index.categories).flat();

  if (check) {
    const current = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
    const expected = JSON.stringify(withoutTimestamp(index), null, 2);
    if (JSON.stringify(withoutTimestamp(current), null, 2) !== expected) {
      console.error("index.json is out of sync with the manifests: run `node scripts/build-index.mjs` and commit the result.");
      process.exit(1);
    }
    console.log(`index.json is in sync (${skills.length} skill(s) validated).`);
    return;
  }

  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(`index.json written with ${skills.length} skill(s):`);
  for (const entry of skills) console.log(`  ${entry.name}@${entry.version}  ${entry.checksum}`);
}

if (process.argv[1] && process.argv[1].endsWith("build-index.mjs")) {
  try {
    main();
  } catch (error) {
    // Quem le isso e um humano no log do CI de um PR: mensagem, nao stack trace.
    console.error(`publication rejected: ${error.message}`);
    process.exit(1);
  }
}
