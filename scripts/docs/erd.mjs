// Regenerates the ERD in docs/data-model.md from apps/api/prisma/schema.prisma: every model and foreign key,
// with key columns and a few identifying ones. Run with `pnpm docs:erd`.
import { readFileSync, writeFileSync } from "node:fs";

const SCHEMA = "apps/api/prisma/schema.prisma";
const DOC = "docs/data-model.md";
const KEEP = /^(displayId|loginId|sku|name|status|state|role|seq|version|revision|date|depot|kind|singleton)$/;
const FIELD = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/;

const models = [...readFileSync(SCHEMA, "utf8").matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
const names = new Set(models.map((m) => m[1]));
const relations = [];
const entities = [];

for (const [, name, body] of models) {
  const fields = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => FIELD.test(l) && !l.startsWith("@@") && !l.startsWith("//"))
    .map((l) => {
      const [, field, type, list, optional, rest] = l.match(FIELD);
      return { field, type, list: Boolean(list), optional: Boolean(optional), rest };
    });
  const foreignKeys = new Set();
  for (const f of fields) {
    const columns = f.rest
      .match(/fields:\s*\[([^\]]+)\]/)?.[1]
      .split(",")
      .map((c) => c.trim());
    if (!names.has(f.type) || !columns) continue;
    columns.forEach((c) => foreignKeys.add(c));
    const oneToOne = columns.length === 1 && fields.some((x) => x.field === columns[0] && /@unique\b/.test(x.rest));
    relations.push(
      `  ${f.type} ${f.optional ? "|o" : "||"}--${oneToOne ? "o|" : "o{"} ${name} : "${columns.join(", ")}"`,
    );
  }
  const attributes = fields
    .filter((f) => !names.has(f.type))
    .map((f) => {
      const keys = [/@id\b/.test(f.rest) && "PK", foreignKeys.has(f.field) && "FK", /@unique\b/.test(f.rest) && "UK"];
      return { ...f, keys: keys.filter(Boolean) };
    })
    .filter((f) => f.keys.length > 0 || KEEP.test(f.field))
    .map((f) => `    ${f.type}${f.list ? "_array" : ""} ${f.field}${f.keys.length ? " " + f.keys.join(", ") : ""}`);
  entities.push(`  ${name} {\n${attributes.join("\n")}\n  }`);
}

const diagram = ["```mermaid", "erDiagram", ...relations, ...entities, "```"].join("\n");
const doc = readFileSync(DOC, "utf8");
const block = /(<!-- erd:start -->\n)[\s\S]*?(\n<!-- erd:end -->)/;
if (!block.test(doc)) throw new Error(`${DOC} has no <!-- erd:start --> ... <!-- erd:end --> block`);
writeFileSync(DOC, doc.replace(block, `$1${diagram}$2`));
console.log(`Updated ${DOC}: ${models.length} models, ${relations.length} relations.`);
