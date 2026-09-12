const BOARD='uXjVHnvk6fY=';
const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function publishClues(env,storage,nodes,fetcher=fetch){
  if(!env.MIRO_ACCESS_TOKEN)throw new Error('Salve MIRO_ACCESS_TOKEN como Secret no Worker echos-rpg e publique a configuração.');
  if(!Array.isArray(nodes)||nodes.length>20)throw new Error('Envie até 20 pistas por vez.');
  const publicNodes=nodes.filter(n=>n&&Array.isArray(n.audience)&&n.audience.includes('all'));
  let sent=0,skipped=0;
  for(const node of publicNodes){
    if(!node.id||!String(node.title||'').trim())continue;
    const title=String(node.title).slice(0,200),description=String(node.desc||'').slice(0,5000);
    const signature=JSON.stringify([title,description]);
    const key='miro:clue:'+String(node.id).slice(0,120);
    const saved=await storage.get(key);
    if(saved?.signature===signature){skipped++;continue;}
    const path=saved?.id?`/cards/${encodeURIComponent(saved.id)}`:'/cards';
    const body={data:{title:escape(title),description:escape(description).replace(/\n/g,'<br>')}};
    if(!saved?.id)body.position={x:Number.isFinite(+node.x)?+node.x:0,y:Number.isFinite(+node.y)?+node.y:0};
    let response;
    try{response=await fetcher(`https://api.miro.com/v2/boards/${encodeURIComponent(BOARD)}${path}`,{method:saved?.id?'PATCH':'POST',headers:{Authorization:`Bearer ${env.MIRO_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});}catch{throw new Error('O Miro não respondeu. Tente novamente; pistas já confirmadas não serão duplicadas.');}
    if(!response.ok){await response.text();throw new Error(response.status===401?'O token do Miro expirou ou é inválido.':response.status===403||response.status===404?'O token não tem acesso de escrita a este quadro.':response.status===429?'O Miro limitou os envios. Aguarde e tente novamente.':`Não foi possível enviar a pista ao Miro (${response.status}).`);}
    const result=await response.json();
    if(!result.id)throw new Error('O Miro não confirmou a criação da pista.');
    await storage.put(key,{id:result.id,signature});sent++;
  }
  return {ok:true,sent,skipped,privateSkipped:nodes.length-publicNodes.length};
}
