import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [path.join(repositoryRoot, 'src', 'components'), path.join(repositoryRoot, 'src', 'app')];
const excludedDirectories = new Set(['ui', 'ai-elements']);
const forbiddenColor = /(bg|text|border)-(green|emerald|red|orange|yellow|amber|blue)-(400|500|600|700)/;
const findings = [];

function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) scan(path.join(directory, entry.name));
      continue;
    }
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;

    const filePath = path.join(directory, entry.name);
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (forbiddenColor.test(line) && !line.includes('lint-allow-raw-color')) {
        findings.push(`${path.relative(repositoryRoot, filePath)}:${index + 1}:${line.trim()}`);
      }
    });
  }
}

for (const root of roots) scan(root);
if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log('[lint:colors] ok');
