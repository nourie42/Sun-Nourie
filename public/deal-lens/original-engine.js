/* Evaluates the supplied workbook's existing forecast formulas. No formulas are authored here. */
(() => {
  const ERR=s=>{const e=new Error(s);e.excel=true;throw e;};
  const column=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
  const index=s=>s.replace(/\$/g,'').match(/[A-Z]+/)[0].split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
  function addresses(a,b){a=a.replace(/\$/g,'');b=(b||a).replace(/\$/g,'');const out=[];for(let r=+a.match(/\d+/)[0];r<=+b.match(/\d+/)[0];r++)for(let c=index(a);c<=index(b);c++)out.push(column(c)+r);return out;}
  function references(formula,sheet){const out=[];const pattern=/(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/g;let m;while((m=pattern.exec(formula)))for(const cell of addresses(m[3],m[4]))out.push((m[1]?.replace(/''/g,"'")||m[2]||sheet)+'!'+cell);return out;}
  const flatten=x=>Array.isArray(x)?x.flat(Infinity):[x];
  function excelIrr(flows){let r=.1;for(let k=0;k<100;k++){let v=0,derivative=0;for(let i=0;i<flows.length;i++){v+=flows[i]/(1+r)**i;if(i)derivative-=i*flows[i]/(1+r)**(i+1);}if(Math.abs(v)<1e-8*Math.max(1,Math.abs(flows[0])))return r;const next=r-v/derivative;if(!Number.isFinite(next)||next<=-1)break;if(Math.abs(next-r)<1e-12)return next;r=next;}const conventional=DealModel.irr(flows);return conventional==null?ERR('#NUM!'):conventional;}
  const number=x=>{if(x==null||x==='')return 0;if(typeof x==='boolean')return +x;if(typeof x==='number')return x;if(typeof x==='string'&&x.startsWith('#'))return ERR(x);const n=Number(x);return Number.isFinite(n)?n:ERR('#VALUE!');};
  function parse(formula){
    const tokens=[];const regex=/\s*("(?:[^"]|"")*"|'(?:[^']|'')*'|\$?[A-Z]{1,3}\$?\d+|[A-Za-z_][\w.]*|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+|<>|<=|>=|[+\-*/^&=<>(),:!%])/gy;let pos=1,m;
    while(pos<formula.length){regex.lastIndex=pos;m=regex.exec(formula);if(!m)throw Error('Unsupported formula token '+formula.slice(pos,pos+30));tokens.push(m[1]);pos=regex.lastIndex;}
    let i=0;const peek=()=>tokens[i],take=()=>tokens[i++],need=t=>{if(take()!==t)throw Error('Expected '+t+' in '+formula);};
    function primary(){let t=take();if(t==='+'||t==='-')return {op:'unary',sign:t,arg:expression(5)};if(t==='('){const x=expression();need(')');return x;}if(t?.startsWith('"'))return {literal:t.slice(1,-1).replace(/""/g,'"')};if(/^\d|^\.\d/.test(t))return {literal:Number(t)};if(peek()==='('){take();const args=[];while(peek()!==')'&&peek()!=null){args.push(peek()===','?{literal:null}:expression());if(peek()!==',')break;take();}need(')');return {fn:t.toUpperCase().replace(/^_XLFN\./,''),args};}
      if(t==='TRUE'||t==='FALSE')return {literal:t==='TRUE'};let sheet=null;if(peek()==='!'){take();sheet=t.startsWith("'")?t.slice(1,-1).replace(/''/g,"'"):t;t=take();}if(!/^\$?[A-Z]{1,3}\$?\d+$/.test(t))throw Error('Unsupported reference '+t);const a=t.replace(/\$/g,''),b=peek()===':'?(take(),take().replace(/\$/g,'')):null;return {ref:a,end:b,sheet};}
    const precedence={'=':1,'<>':1,'>':1,'<':1,'>=':1,'<=':1,'&':2,'+':3,'-':3,'*':4,'/':4,'^':6};
    function expression(min=0){let left=primary();while(peek()==='%'){take();left={op:'/',left,right:{literal:100}};}while(precedence[peek()]>=min){const op=take(),p=precedence[op];left={op,left,right:expression(op==='^'?p:p+1)};}return left;}
    const ast=expression();if(i!==tokens.length)throw Error('Unparsed formula '+formula);return ast;
  }
  function evaluate(ast,sheet,get){
    if(Object.hasOwn(ast,'literal'))return ast.literal;
    if(ast.ref){const refs=addresses(ast.ref,ast.end);return ast.end?refs.map(r=>get(ast.sheet||sheet,r)):get(ast.sheet||sheet,ast.ref);}
    if(ast.op==='unary')return number(evaluate(ast.arg,sheet,get))*(ast.sign==='-'?-1:1);
    if(ast.op){const a=evaluate(ast.left,sheet,get),b=evaluate(ast.right,sheet,get);switch(ast.op){case '+':return number(a)+number(b);case '-':return number(a)-number(b);case '*':return number(a)*number(b);case '/':return number(b)===0?ERR('#DIV/0!'):number(a)/number(b);case '^':return number(a)**number(b);case '&':return String(a??'')+String(b??'');case '=':return a===b||(a==null&&b==='')||(b==null&&a==='');case '<>':return !(a===b||(a==null&&b==='')||(b==null&&a===''));case '>':return a>b;case '<':return a<b;case '>=':return a>=b;case '<=':return a<=b;}}
    const run=i=>evaluate(ast.args[i],sheet,get),all=()=>ast.args.map((_,i)=>run(i));
    if(ast.fn==='IF')return run(0)?run(1):ast.args[2]?run(2):false;
    if(ast.fn==='IFERROR'){try{const value=run(0);return typeof value==='string'&&value.startsWith('#')?run(1):value;}catch(e){if(e.excel)return run(1);throw e;}}
    if(ast.fn==='OR')return ast.args.some((_,i)=>!!run(i));if(ast.fn==='AND')return ast.args.every((_,i)=>!!run(i));
    const values=all(),flat=values.flat(Infinity);if(flat.some(x=>typeof x==='string'&&x.startsWith('#')))return ERR(ast.fn==='IRR'?'#VALUE!':flat.find(x=>typeof x==='string'&&x.startsWith('#')));
    switch(ast.fn){case 'SUM':return flat.reduce((s,n)=>s+(typeof n==='number'?n:0),0);case 'COUNT':return flat.filter(n=>typeof n==='number').length;case 'AVERAGE':{const a=flat.filter(n=>typeof n==='number');return a.length?a.reduce((s,n)=>s+n,0)/a.length:ERR('#DIV/0!');}case 'MIN':return Math.min(...flat.filter(n=>typeof n==='number'));case 'MAX':return Math.max(...flat.filter(n=>typeof n==='number'));case 'NPV':return flatten(values[1]).reduce((s,n,i)=>s+number(n)/(1+number(values[0]))**(i+1),0);case 'IRR':return excelIrr(flat.filter(x=>typeof x==='number'));case 'ROUND':return Math.round(number(values[0])*10**number(values[1]))/10**number(values[1]);case 'ROUNDUP':return Math.sign(number(values[0]))*Math.ceil(Math.abs(number(values[0]))*10**number(values[1]))/10**number(values[1]);case 'ISNUMBER':return typeof values[0]==='number';default:throw Error('Unsupported changed formula function '+ast.fn);}
  }
  function create(data){
    const dependents=new Map(),asts=new Map();
    for(const [sheet,cells] of Object.entries(data.sheets))for(const [address,c] of Object.entries(cells))if(c.f){
      const key=sheet+'!'+address;
      for(const ref of new Set(references(c.f,sheet))){if(!dependents.has(ref))dependents.set(ref,[]);dependents.get(ref).push(key);}
    }
    return function calculate(changes){
      const dirty=new Set(Object.keys(changes)),values=new Map(Object.entries(changes)),visiting=new Set(),queue=[...dirty];
      // Follow only the formulas affected by an input. Price solving repeats this
      // calculation; rescanning every workbook formula made each edit stall.
      for(let i=0;i<queue.length;i++)for(const key of dependents.get(queue[i])||[])if(!dirty.has(key)){dirty.add(key);queue.push(key);}
      function get(sheet,address){const key=sheet+'!'+address;if(values.has(key))return values.get(key);const cell=data.sheets[sheet]?.[address];if(!cell)return null;if(!dirty.has(key)||!cell.f)return cell.v;
        if(visiting.has(key))throw Error('Circular changed formula '+key);visiting.add(key);try{let ast=asts.get(cell.f);if(!ast){ast=parse(cell.f);asts.set(cell.f,ast);}const value=evaluate(ast,sheet,get);values.set(key,value);return value;}catch(e){if(e.excel){values.set(key,e.message);return e.message;}throw e;}finally{visiting.delete(key);}}
      function snapshot(){for(const key of dirty){const p=key.lastIndexOf('!');get(key.slice(0,p),key.slice(p+1));}return Object.fromEntries(values);}
      return {get,snapshot,dirty};
    };
  }
  globalThis.OriginalFormulaEngine={create,references,parse};
})();
