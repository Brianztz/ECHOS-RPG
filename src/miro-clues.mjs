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
  const request=async(path,method,body)=>{let response;try{response=await fetcher(`https://api.miro.com/v2/boards/${encodeURIComponent(BOARD)}${path}`,{method,headers:{Authorization:`Bearer ${env.MIRO_ACCESS_TOKEN}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}catch{throw new Error('O Miro não respondeu. Tente novamente.');}if(!response.ok&&!(method==='DELETE'&&response.status===404)){await response.text();throw new Error(`Miro recusou o envio (${response.status}). Verifique a permissão do quadro.`);}return response;};
  if(saved.imageHash!==hash){const body={data:{url:image,title},geometry:{width:400}};if(!saved.imageId)body.position={x:Number(node.x)||0,y:Number(node.y)||0};const response=await request(saved.imageId?`/images/${encodeURIComponent(saved.imageId)}`:'/images',saved.imageId?'PATCH':'POST',body);const result=await response.json();if(!result.id)throw new Error('Imagem não confirmada pelo Miro.');saved.imageId=result.id;saved.imageHash=hash;await storage.put(key,saved);sent++;}else skipped++;
  if(saved.id){await request(`/cards/${encodeURIComponent(saved.id)}`,'DELETE');delete saved.id;delete saved.signature;await storage.put(key,saved);}
 }
 return {ok:true,sent,skipped,privateSkipped:nodes.length-publicNodes.length};
}
