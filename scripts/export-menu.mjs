// Writes the canteen menu (Gold Coin prices + options) for the Twin Hearts server, which re-prices every order itself.
//   npm run export-menu  ->  ../lib/canteen-menu.json   (or: node scripts/export-menu.mjs <output path>)
import {MENU} from '../src/menu.js';import fs from 'fs';
const out=process.argv[2]||'../lib/canteen-menu.json';
const items=MENU.map(i=>({id:i.id,name:i.name,price:i.price,groups:i.groups.map(g=>({name:g.name,multi:!!g.multi,req:!!g.req,opts:g.opts.map(o=>({n:o.n,p:o.p}))}))}));
fs.writeFileSync(out,JSON.stringify({v:1,items},null,1));console.log(items.length+' items ->',out);
