import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFile(resolve(root,file),'utf8');
const [html,css,app,workbook,finance,seed]=await Promise.all([
  read('src/deal-intelligence/ui/index.html'),read('src/deal-intelligence/ui/styles.css'),
  read('src/deal-intelligence/ui/app.js'),read('src/deal-intelligence/ui/workbook.js'),
  read('src/deal-intelligence/finance.mjs'),read('src/deal-intelligence/seed.mjs'),
]);
const strip=s=>s.replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm,'');
const safeScript=s=>s.replace(/<\/script/gi,'<\\/script');
const safeStyle=s=>s.replace(/<\/style/gi,'<\\/style');
const financeGlobal='(()=>{'+strip(finance)+'\nwindow.DealFinance={defaultInputs,inputFields,calculate,auditModel,irr};})();';
const seedGlobal='(()=>{'+strip(seed)+'\nwindow.DealSeed=initialState;})();';
const scripts=[financeGlobal,seedGlobal,workbook,app].join('\n');
const page=html
  .replace(/<script\b[^>]*src=["'](?:\.\/)?workbook\.js["'][^>]*><\/script>/i,'')
  .replace(/<link\b[^>]*href=["'](?:\.\/)?styles\.css["'][^>]*>/i,()=>'<style>'+safeStyle(css)+'</style>')
  .replace(/<script\b[^>]*src=["'](?:\.\/)?app\.js["'][^>]*><\/script>/i,()=>'<script>'+safeScript(scripts)+'</script>');
if(!page.includes('window.DealFinance=')||!page.includes('/api/deal-intelligence'))throw Error('Incomplete Deal Intelligence page');
await mkdir(resolve(root,'public/deal-intelligence'),{recursive:true});
await writeFile(resolve(root,'public/deal-intelligence/index.html'),page);
console.log('Built the Sun Nourie Deal Intelligence branch.');
