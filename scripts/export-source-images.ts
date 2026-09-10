import { config } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
config({path:'.env.local',quiet:true});
async function main(){
 const {getDb,schema}=await import('../lib/db'); const {sourceImage}=await import('../lib/providers/source-images');
 const db=await getDb();
 const traders=await db.select({id:schema.traders.id,source:schema.traders.avatar}).from(schema.traders);
 const tokens=await db.select({id:schema.tokens.address,source:schema.tokens.image}).from(schema.tokens);
 const root=path.resolve('.data/image-export');await mkdir(root,{recursive:true});
 const rows=[...traders.map(r=>({...r,kind:'traders'})),...tokens.map(r=>({...r,kind:'tokens'}))];
 const manifest:{id:string;kind:string;source:string|null;file?:string;status:string}[]=[];
 const extension:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','image/avif':'avif'};
 let next=0;
 async function worker(){for(;;){const row=rows[next++];if(!row)return;if(!row.source){manifest.push({...row,status:'No source image'});continue;}try{const photo=await sourceImage(row.source);const file=`${row.kind}/${row.id}.${extension[photo.type]}`;await mkdir(path.join(root,row.kind),{recursive:true});await writeFile(path.join(root,file),photo.bytes);manifest.push({...row,file,status:'Exported'});}catch{manifest.push({...row,status:'Source unavailable'});}if(manifest.length%100===0)console.log({processed:manifest.length,total:rows.length});}}
 await Promise.all([worker(),worker(),worker()]);await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log({path:root,counts:manifest.reduce((a,r)=>{const k=r.kind+': '+r.status;a[k]=(a[k]||0)+1;return a},{} as Record<string,number>)});
}
main().then(()=>process.exit(0)).catch(()=>{console.error('Image export failed');process.exit(1)});
