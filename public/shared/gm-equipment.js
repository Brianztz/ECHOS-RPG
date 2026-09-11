/* equipments */
let equipmentEditingId=null;

function openEquipmentModal(id=null){
 equipmentEditingId=id;
 delete byId('equipmentModal').dataset.catalogMetadata;
 let item=id?state.equipments.find(x=>x.id===id):null;

 byId('equipmentModalTitle').textContent=item?'Editar equipamento':'Novo equipamento';
 byId('equipmentType').value=item?.type||'weapon';
 byId('equipmentName').value=item?.name||'';
 byId('equipmentCategory').value=item?.category||'';
 byId('equipmentLoad').value=item?.load??0;
 byId('equipmentSpaces').value=item?.spaces??1;
 byId('equipmentDamage').value=item?.damage||'';
 byId('equipmentCrit').value=item?.crit||'';
 byId('equipmentRange').value=item?.range||'';
 byId('equipmentDesc').value=item?.desc||'';

 byId('equipmentDeleteButton').hidden=!item;
 if(item)byId('equipmentModal').dataset.catalogMetadata=JSON.stringify({test:item.test,atk:item.atk,ammo:item.ammo,capacity:item.capacity,img:item.img});

 toggleEquipmentFields();
 openModal('equipmentModal');
 setTimeout(()=>byId('equipmentName')?.focus(),40);
}

function toggleEquipmentFields(){
 let weapon=byId('equipmentType')?.value==='weapon';
 document.querySelectorAll('#equipmentModal .weapon-only').forEach(el=>el.hidden=!weapon);
}

function saveEquipment(){
 let name=(byId('equipmentName').value||'').trim();
 if(!name){
  alert('Informe o nome do equipamento.');
  return;
 }

 let data={
  ...JSON.parse(byId('equipmentModal').dataset.catalogMetadata || '{}'),
  type:byId('equipmentType').value||'item',
  name,
  category:(byId('equipmentCategory').value||'').trim(),
  load:Math.max(0,+byId('equipmentLoad').value||0),
  spaces:Math.max(0,+byId('equipmentSpaces').value||0),
  damage:(byId('equipmentDamage').value||'').trim(),
  crit:(byId('equipmentCrit').value||'').trim(),
  range:(byId('equipmentRange').value||'').trim(),
  desc:(byId('equipmentDesc').value||'').trim()
 };

 if(equipmentEditingId){
  let item=state.equipments.find(x=>x.id===equipmentEditingId);
  if(item)Object.assign(item,data);
 }else{
  state.equipments.push({id:uid(),...data});
 }

 closeModal('equipmentModal');
 renderEquipments();
 autosave();
 toast('Equipamento salvo');
}

function deleteEquipmentFromModal(){
 if(!equipmentEditingId)return;
 let item=state.equipments.find(x=>x.id===equipmentEditingId);
 if(!item)return;

 if(!confirm(`Excluir ${item.name}?`))return;

 state.equipments=state.equipments.filter(x=>x.id!==equipmentEditingId);
 equipmentEditingId=null;
 closeModal('equipmentModal');
 renderEquipments();
 autosave();
 toast('Equipamento excluído');
}

function renderEquipments(){
 let box=byId('equipmentList');
 if(!box)return;

 if(!Array.isArray(state.equipments))state.equipments=[];

 if(!state.equipments.length){
  box.innerHTML='<div class="equipment-empty">Nenhum equipamento cadastrado.<br>Use o botão <b>+ Equipamento</b> para criar uma arma ou item.</div>';
  return;
 }

 box.innerHTML=state.equipments.map(item=>{
  let weapon=item.type==='weapon';
  let metas=[
   item.category?`<span>${esc(item.category)}</span>`:'',
   `<span>Carga ${item.load??0}</span>`,
   `<span>${item.spaces??0} esp.</span>`,
   weapon&&item.damage?`<span>Dano ${esc(item.damage)}</span>`:'',
   weapon&&item.crit?`<span>Crítico ${esc(item.crit)}</span>`:'',
   weapon&&item.range?`<span>${esc(item.range)}</span>`:''
  ].filter(Boolean).join('');

  return `<article class="equipment-entry" data-type="${weapon?'weapon':'item'}" onclick="openEquipmentModal('${item.id}')" title="Clique para editar">
    <div class="equipment-entry-head">
      <span class="equipment-kind">${weapon?'Arma':'Item'}</span>
    </div>
    <h3>${esc(item.name)}</h3>
    <div class="equipment-meta">${metas}</div>
    <p>${esc(item.desc||'Sem descrição.')}</p>
  </article>`;
 }).join('');
}


/* Catálogo e entrega usam o mesmo formato dos equipamentos personalizados. */
(function () {
  'use strict';
  const source = window.RPG_CATALOG || {items:[],meleeWeapons:[],rangedWeapons:[]};
  const entries = [
    ...source.meleeWeapons.map(x => ({...x,kind:'melee',label:'Corpo a corpo',type:'weapon'})),
    ...source.rangedWeapons.map(x => ({...x,kind:'ranged',label:'Disparo',type:'weapon'})),
    ...source.items.map(x => ({...x,kind:x.ammo?'ammo':'item',label:x.ammo?'Munição':'Item',type:'item'}))
  ];
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let selected = null, opener = null;
  function toEquipment(x) {
    const details = [x.desc, x.dmg && `Dano: ${x.dmg}`, x.crit && `Crítico: ${x.crit}`, x.range && `Alcance: ${x.range}`, x.skill && `Perícia: ${x.skill}`, x.atk != null && `Ataques: ${x.atk}`, x.ammo && `Munição: ${x.ammo}`, x.capacity != null && `Capacidade: ${x.capacity}`].filter(Boolean);
    return {type:x.type,name:x.name,category:x.label,load:x.weight ?? 0,spaces:x.weight ?? 1,damage:x.dmg || '',crit:x.crit || '',range:x.range || '',test:x.skill || '',atk:x.atk,ammo:x.ammo || '',capacity:x.capacity,img:x.img || '',desc:details.join('\n')};
  }
  window.EchosCatalog = {entries,toEquipment};
  function setup() {
    const root = document.getElementById('equipmentCatalog');
    if (!root || root.children.length) return;
    root.innerHTML = `<div class="eq-catalog-toolbar"><div><label for="eqSearch">Buscar no catálogo</label><input id="eqSearch" type="search" placeholder="Nome, descrição, dano ou munição..."></div><div><label for="eqFilter">Tipo de equipamento</label><select id="eqFilter"><option value="all">Todos</option><option value="melee">Corpo a corpo</option><option value="ranged">Disparo</option><option value="item">Itens</option><option value="ammo">Munições</option></select></div><p id="eqCount" role="status" aria-live="polite"></p></div><div class="eq-catalog-grid" id="eqGrid"></div>`;
    root.querySelector('#eqSearch').addEventListener('input',render);
    root.querySelector('#eqFilter').addEventListener('change',render);
    root.querySelector('#eqGrid').addEventListener('click',e=>{const button=e.target.closest('[data-eq-index]');if(button)openEntry(Number(button.dataset.eqIndex),button);});
    const modal=document.createElement('div');modal.id='eqDeliveryModal';modal.className='modal';
    modal.innerHTML=`<section class="modal-panel eq-delivery-panel" role="dialog" aria-modal="true" aria-labelledby="eqDeliveryTitle"><div class="modal-head"><div><div class="kicker">Catálogo do Outro Lado</div><h2 id="eqDeliveryTitle"></h2></div><button type="button" class="modal-close" id="eqDeliveryClose" aria-label="Fechar catálogo">×</button></div><p id="eqDeliveryDescription" class="eq-description"></p><div class="eq-delivery-fields"><label for="eqRecipient">Enviar para o inventário de</label><select id="eqRecipient" data-live-player-select><option value="">Selecione um jogador conectado</option></select></div><p id="eqDeliveryStatus" role="status" aria-live="polite"></p><div class="modal-actions"><button id="eqCustomize" type="button">Criar versão personalizada</button><button id="eqSend" class="primary" type="button">Enviar ao inventário</button></div></section>`;
    document.body.appendChild(modal);
    const close=()=>{closeModal('eqDeliveryModal');opener?.focus();};
    modal.addEventListener('click',e=>{if(e.target===modal)close();});
    document.getElementById('eqDeliveryClose').addEventListener('click',close);
    modal.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();close();}
      if(e.key==='Tab'){
        const buttons=[...modal.querySelectorAll('button:not(:disabled),select')];const first=buttons[0],last=buttons.at(-1);
        if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
    document.getElementById('eqCustomize').addEventListener('click',()=>{
      const item=toEquipment(selected);close();openEquipmentModal();
      for(const [key,id] of Object.entries({type:'equipmentType',name:'equipmentName',category:'equipmentCategory',load:'equipmentLoad',spaces:'equipmentSpaces',damage:'equipmentDamage',crit:'equipmentCrit',range:'equipmentRange',desc:'equipmentDesc'}))document.getElementById(id).value=item[key]??'';
      document.getElementById('equipmentModal').dataset.catalogMetadata=JSON.stringify({test:item.test,atk:item.atk,ammo:item.ammo,capacity:item.capacity,img:item.img});
      toggleEquipmentFields();
    });
    document.getElementById('eqSend').addEventListener('click',async()=>{
      const recipient=document.getElementById('eqRecipient').value,status=document.getElementById('eqDeliveryStatus'),button=document.getElementById('eqSend');
      if(!recipient){status.textContent='Selecione um jogador conectado à mesa.';return;}
      if(!selected || button.disabled)return;
      button.disabled=true;status.textContent='Enviando equipamento...';
      try {await window.EchosEquipment.send(recipient,toEquipment(selected));status.textContent=`${selected.name} enviado ao inventário do jogador.`;toast('Equipamento enviado');}
      catch(error){status.textContent=error.message;}
      finally{button.disabled=false;}
    });
    render();
  }
  function render(){
    const grid=document.getElementById('eqGrid');if(!grid)return;
    const q=normalize(document.getElementById('eqSearch').value),filter=document.getElementById('eqFilter').value;
    const filtered=entries.map((entry,index)=>({entry,index})).filter(({entry:x})=>(filter==='all'||filter===x.kind)&&normalize([x.name,x.desc,x.dmg,x.ammo,x.label,x.skill].join(' ')).includes(q));
    document.getElementById('eqCount').textContent=`${filtered.length} de ${entries.length} equipamentos`;
    grid.innerHTML=filtered.length?filtered.map(({entry:x,index})=>`<button type="button" class="eq-catalog-card" data-eq-index="${index}" aria-label="${escape(x.name)} — ver detalhes e enviar"><span class="eq-image"><span aria-hidden="true">${x.type==='weapon'?'⚔':'▣'}</span>${x.img?`<img src="${escape(x.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}</span><span class="eq-card-content"><span class="eq-kind">${escape(x.label)}</span><strong>${escape(x.name)}</strong><span class="eq-stats">${escape([x.dmg && `Dano ${x.dmg}`,x.crit,x.range,`${x.weight} espaço(s)`].filter(Boolean).join(' • '))}</span><span class="eq-card-description">${escape(x.desc || [x.skill,x.ammo && `Munição ${x.ammo}`,x.capacity != null && `Capacidade ${x.capacity}`].filter(Boolean).join(' • '))}</span><span class="eq-card-action">Ver detalhes e enviar →</span></span></button>`).join(''):'<p class="equipment-empty">Nenhum equipamento encontrado. Tente outro nome ou filtro.</p>';
    grid.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));
  }
  function openEntry(index,button){
    selected=entries[index];if(!selected)return;opener=button;
    document.getElementById('eqDeliveryTitle').textContent=selected.name;
    document.getElementById('eqDeliveryDescription').textContent=toEquipment(selected).desc || `${selected.label} • ${selected.weight} espaço(s)`;
    document.getElementById('eqDeliveryStatus').textContent='Escolha o jogador que receberá este equipamento.';
    window.EchosEquipment?.refreshRecipients();openModal('eqDeliveryModal');document.getElementById('eqRecipient').focus();
  }
  window.addEventListener('DOMContentLoaded',setup);
})();
