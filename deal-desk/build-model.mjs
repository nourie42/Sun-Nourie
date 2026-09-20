import {readFile, writeFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('./lib/deal.ts', import.meta.url), 'utf8');
const result = ts.transpileModule(source, {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022},
});
await writeFile(new URL('../src/dealDeskModel.js', import.meta.url),
  '// Generated from deal-desk/lib/deal.ts; run npm run build in deal-desk.\n' + result.outputText);
