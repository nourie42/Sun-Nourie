// Read a workbook downloaded from Deal Lens without the model key.
// Usage: node scripts/inspectDealLensWorkbook.mjs /private/path/download.xlsx
// Does not modify the workbook or write its contents into the repository.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const file=process.argv[2];
if(!file){console.error('Pass the path to the downloaded .xlsx workbook.');process.exit(1);}
const bytes=fs.readFileSync(file),ctx=vm.createContext({module:{exports:{}},exports:{},Buffer,Uint8Array,setImmediate,clearImmediate,setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(new URL('../public/deal-lens/vendor/jszip.min.js',import.meta.url),'utf8'),ctx);
const zip=await ctx.module.exports.loadAsync(bytes);
const workbook=await zip.file('xl/workbook.xml').async('string'),rels=await zip.file('xl/_rels/workbook.xml.rels').async('string');
const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
const coop=[...workbook.matchAll(/<sheet\s[^>]*\/?\s*>/g)].map(m=>attributes(m[0])).find(s=>s.name==='COOP');
if(!coop)throw Error('COOP worksheet not found.');
const target=[...rels.matchAll(/<Relationship\s[^>]*\/?\s*>/g)].map(m=>attributes(m[0])).find(r=>r.Id===coop['r:id'])?.Target;
if(!target)throw Error('COOP worksheet relationship not found.');
const xml=await zip.file(target.startsWith('/')?target.slice(1):path.posix.normalize('xl/'+target)).async('string');
const cells=new Map([...xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(m=>[attributes(m[1]).r,m[2]||'']));
const formula=c=>(cells.get(c)?.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1]||'').replace(/[\s$]/g,'').toUpperCase();
const cached=c=>{const value=cells.get(c)?.match(/<v>([^<]*)<\/v>/)?.[1];return value!=null&&Number.isFinite(Number(value))?Number(value):null;};
console.log(JSON.stringify({
  sha256:createHash('sha256').update(bytes).digest('hex'),
  checks:{c29_is_minus_c18:formula('C29')==='-C18',c18_uses_s18_and_sites:formula('C18')==='S18*C2',b34_uses_row32:formula('B34')==='IRR(B32:Q32)',b38_uses_row37:formula('B38')==='IRR(B37:Q37)'},
  cached:{sites:cached('C2'),operator_per_site:cached('S18'),year1_draw:cached('C18'),year1_addback:cached('C29')},
  note:'Formula inspection only. Cached values have not been recalculated. A local file alone does not establish the currently deployed workbook version.'
},null,2));
