import {readFile, writeFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('./lib/deal.ts', import.meta.url), 'utf8');
const result = ts.transpileModule(source, {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022},
});
await writeFile(new URL('../src/dealDeskModel.js', import.meta.url),
  '// Generated from deal-desk/lib/deal.ts; run npm run build in deal-desk.\n' + result.outputText);

const review = await readFile(new URL('./lib/review.ts', import.meta.url), 'utf8');
const reviewResult = ts.transpileModule(review, {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022},
});
await writeFile(new URL('../src/dealDeskReview.js', import.meta.url),
  '// Generated from deal-desk/lib/review.ts.\n' + reviewResult.outputText.replace("from './deal'", "from './dealDeskModel.js'"));

const sites=ts.transpileModule(await readFile(new URL('./lib/sites.ts',import.meta.url),'utf8'),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},
});
await writeFile(new URL('../src/dealDeskSites.js',import.meta.url),'// Generated from deal-desk/lib/sites.ts.\n'+sites.outputText);
