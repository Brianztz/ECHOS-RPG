const BOARD='uXjVHnvk6fY=';
export async function publishClues(env,storage,nodes,fetcher=fetch){
 if(!env.MIRO_ACCESS_TOKEN)throw new Error('Configure MIRO_ACCESS_TOKEN no Worker.');
 if(!Array.isArray(nodes)||nodes.length>20)throw new Error('Envie até 20 pistas por vez.');
 const publicNodes=nodes.filter(n=>n&&Array.isArray(n.audience)&&n.audience.includes('all'));let sent=0,skipped=0;
 for(const node of publicNodes){
  const image=String(node.image||''),title=String(node.title||'Pista').slice(0,200);
  if(!node.id||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>1500000)throw new Error(`Adicione uma imagem válida à pista: ${title}`);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(title+image));const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  const key='miro:clue:'+String(node.id).slice(0,120),saved=(await storage.get(key))||{};
  const request=async(path,method,body)=>{let response;try{response=await fetcher(`https://api.miro.com/v2/boards/${encodeURIComponent(BOARD)}${path}`,{method,headers:{Authorization:`Bearer ${env.MIRO_ACCESS_TOKEN}`,Accept:'application/json'},...(body?{body}:{}),signal:AbortSignal.timeout(15000)});}catch{throw new Error('O Miro não respondeu. Tente novamente.');}if(!response.ok&&!(method==='DELETE'&&response.status===404)){let detail='';try{const error=await response.json();detail=String(error.message||error.type||'').replaceAll(env.MIRO_ACCESS_TOKEN,'[oculto]').replace(/data:image\/[^\s"']+/g,'[imagem]').slice(0,250);}catch{}const hint=response.status===401?'A chave do Miro não foi aceita.':response.status===403?'O aplicativo precisa de acesso de escrita ao quadro.':response.status===400?'O Miro recusou o formato da imagem.':'Não foi possível concluir o envio.';throw new Error(`Miro (${response.status}): ${hint}${detail?' '+detail:''}`);}return response;};
  if(saved.imageHash!==hash){const metadata={data:{title},geometry:{width:400}};if(!saved.imageId)metadata.position={x:Number(node.x)||0,y:Number(node.y)||0};const mime=image.slice(5,image.indexOf(';')),bytes=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0));const body=new FormData();body.append('resource',new Blob([bytes],{type:mime}),'pista.'+(mime==='image/jpeg'?'jpg':mime.split('/')[1]));body.append('data',new Blob([JSON.stringify(metadata)],{type:'application/json'}));const response=await request(saved.imageId?`/images/${encodeURIComponent(saved.imageId)}`:'/images',saved.imageId?'PATCH':'POST',body);const result=await response.json();if(!result.id)throw new Error('Imagem não confirmada pelo Miro.');saved.imageId=result.id;saved.imageHash=hash;await storage.put(key,saved);sent++;}else skipped++;
  if(saved.id){await request(`/cards/${encodeURIComponent(saved.id)}`,'DELETE');delete saved.id;delete saved.signature;await storage.put(key,saved);}
 }
 return {ok:true,sent,skipped,privateSkipped:nodes.length-publicNodes.length};
}

