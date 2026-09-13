const CHUNK=90000,MAX=25*1024*1024;
export async function audioEvent(room,ws,event,p){
 const m=ws.deserializeAttachment();if(m.role!=='gm')return {ok:false,error:'Ação exclusiva do mestre.'};
 const storage=room.ctx.storage;
 if(event==='gm:audio_start'){
  if(!Number.isInteger(p.size)||p.size<1||p.size>MAX||!/^audio\/[a-z0-9.+-]+$/i.test(p.mime))return {ok:false,error:'Áudio inválido ou maior que 25 MB.'};
  if(!await room.findPlayerById(p.playerId))return {ok:false,error:'Escolha um jogador.'};
  const id=crypto.randomUUID();await storage.put('audio:'+id,{owner:m.sessionId,playerId:p.playerId,size:p.size,mime:p.mime,name:String(p.name||'Pista de áudio').slice(0,120),notes:String(p.notes||'').slice(0,6000),received:0,chunks:0,ready:false,created:Date.now()});return {ok:true,id};
 }
 if(!/^[a-f0-9-]{36}$/.test(p.id||''))return {ok:false,error:'Envio inválido.'};
 const key='audio:'+p.id,a=await storage.get(key);if(!a||a.owner!==m.sessionId)return {ok:false,error:'Envio não encontrado.'};
 if(event==='gm:audio_chunk'){
  if(a.ready||p.index!==a.chunks||typeof p.data!=='string'||p.data.length>120000||!/^[A-Za-z0-9+/]*={0,2}$/.test(p.data))return {ok:false,error:'Trecho de áudio inválido.'};
  const bytes=Uint8Array.from(atob(p.data),c=>c.charCodeAt(0));if(bytes.length!==Math.min(CHUNK,a.size-a.received)||bytes.length>CHUNK||a.received+bytes.length>a.size)return {ok:false,error:'Tamanho de áudio inválido.'};
  await storage.put(key+':'+a.chunks,bytes);a.received+=bytes.length;a.chunks++;await storage.put(key,a);return {ok:true};
 }
 if(a.received!==a.size)return {ok:false,error:'O envio do áudio está incompleto.'};
 if(a.ready)return {ok:true};
 const found=await room.findPlayerById(a.playerId);if(!found)return {ok:false,error:'Jogador não encontrado.'};
 a.ready=true;await storage.put(key,a);
 const packet={type:'audio_clue',data:{id:p.id,name:a.name,notes:a.notes,url:'/api/audio?mesa='+encodeURIComponent(m.table)+'&id='+p.id},sentAt:new Date().toISOString()};
 const targets=room.sockets(x=>x.role==='player'&&x.playerCode===found.code);
 if(targets.length)for(const target of targets)room.sendEvent(target,'player:gm_event',packet);else await room.queueEvent(found.code,packet);
 return {ok:true,delivered:targets.length>0};
}
export async function audioResponse(request,storage){
 const id=new URL(request.url).searchParams.get('id');if(!/^[a-f0-9-]{36}$/.test(id||''))return new Response('Not found',{status:404});
 const key='audio:'+id,a=await storage.get(key);if(!a?.ready)return new Response('Not found',{status:404});
 let start=0,end=a.size-1;const range=request.headers.get('range');
 if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416});if(!match[1])start=Math.max(0,a.size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}if(start>end||start>=a.size)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+a.size}});}
 const headers={'Content-Type':a.mime,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'};if(range)headers['Content-Range']=`bytes ${start}-${end}/${a.size}`;
 let cursor=start;const stream=new ReadableStream({async pull(controller){try{if(cursor>end){controller.close();return;}const index=Math.floor(cursor/CHUNK);const data=await storage.get(key+':'+index);if(!data)throw Error('Áudio incompleto');const bytes=new Uint8Array(data);const offset=cursor%CHUNK;const part=bytes.slice(offset,Math.min(bytes.length,offset+end-cursor+1));if(!part.length)throw Error('Áudio inválido');cursor+=part.length;controller.enqueue(part);}catch(error){controller.error(error);}}});
 return new Response(request.method==='HEAD'?null:stream,{status:range?206:200,headers});
}


