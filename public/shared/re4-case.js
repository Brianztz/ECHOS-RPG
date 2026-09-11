(function () {
  'use strict';
  const model=window.RE4Weapons;
  const originalRender=renderCase,originalCollect=collect,originalLoad=loadCaseItems,originalCalc=calc,originalSelect=selectCaseItem;
  const inCase=item=>item.x>=0&&item.y>=0&&caseItemInsideCapacity(item);
  let restoring=false;
  function reconcile(){
    let active=false;
    for(const item of caseItems){
      const resized=model.upgrade(item);
      if(resized && inCase(item) && !canPlaceCase(item,item.x,item.y,item.id))item.x=item.y=-1;
      if(!inCase(item))item.equipped=false;
      if(item.equipped){if(active)item.equipped=false;else active=true;}
    }
  }
  function updateActive(){
    const weapon=caseItems.find(x=>x.weapon&&x.equipped&&inCase(x));
    const label=document.getElementById('activeWeapon');
    if(label){label.textContent=weapon ? weapon.name : 'Nenhuma arma equipada.';label.title=weapon ? [weapon.weapon.damage,weapon.weapon.crit,weapon.weapon.skill].filter(Boolean).join(' • ') : 'Selecione uma arma dentro da maleta para equipar.';}
    const status=document.getElementById('re4Active');if(status)status.textContent=weapon ? `Equipada: ${weapon.name}`:'Nenhuma arma equipada';
    const picker=document.getElementById('re4WeaponPicker');
    if(picker){
      const previous=picker.value;picker.replaceChildren();
      const available=caseItems.filter(x=>x.weapon&&inCase(x));
      for(const item of available){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;picker.appendChild(option);}
      if(available.some(x=>String(x.id)===previous))picker.value=previous;
      else if(weapon)picker.value=weapon.id;
      document.getElementById('re4SheetEquip').disabled=!available.length;
      document.getElementById('re4Attack').disabled=!weapon;
      document.getElementById('re4Damage').disabled=!weapon?.weapon.damage;
      document.getElementById('re4Attack').textContent=weapon?`Rolar ataque • ${weapon.weapon.skill}`:'Rolar ataque';
      document.getElementById('re4Damage').textContent=weapon?`Rolar dano • ${weapon.weapon.damage||'não definido'}`:'Rolar dano';
      document.getElementById('re4CombatInfo').textContent=weapon?`Crítico: ${weapon.weapon.crit||'—'} • Alcance: ${weapon.weapon.range||'—'}`:'Encaixe uma arma na maleta para equipar.';
    }
  }
  function equip(id){
    const item=caseItems.find(x=>x.id===id);
    if(!item?.weapon || !inCase(item))return;
    for(const entry of caseItems)entry.equipped=entry.id===id;
    updateActive();
  }
  function decorate(){
    const selected=caseItems.find(x=>x.id===caseSelectedId);
    const actions=document.querySelector('#caseItemInfoPanel .case-actions');
    if(actions&&!document.getElementById('re4Rotate')){
      const controls=document.createElement('div');controls.className='re4-controls';
      controls.innerHTML='<button id="re4Rotate" type="button">Girar ↻ (R)</button><button id="re4Store" type="button">Encaixar na maleta</button><button id="re4Equip" type="button">Equipar arma</button><p id="re4WeaponInfo"></p>';
      actions.before(controls);
      document.getElementById('re4Rotate').onclick=()=>rotateCaseItem();
      document.getElementById('re4Store').onclick=()=>storeCaseItem();
      document.getElementById('re4Equip').onclick=()=>{
        const item=caseItems.find(x=>x.id===caseSelectedId);if(!item?.weapon||!inCase(item))return;
        if(item.equipped)item.equipped=false;else equip(item.id);
        renderCase();changed();
      };
    }
    if(actions){
      const button=document.getElementById('re4Equip');button.hidden=!selected?.weapon;button.disabled=!selected||!inCase(selected);button.textContent=selected?.equipped?'Desequipar arma':'Equipar arma';
      document.getElementById('re4Rotate').disabled=!selected;
      document.getElementById('re4Store').disabled=!selected||inCase(selected);
      document.getElementById('re4WeaponInfo').textContent=selected?.weapon ? [selected.weapon.damage&&`Dano ${selected.weapon.damage}`,selected.weapon.crit&&`Crítico ${selected.weapon.crit}`,selected.weapon.skill,selected.weapon.ammo&&`Munição ${selected.weapon.ammo}`,`${selected.w}×${selected.h} células`,!inCase(selected)&&'Encaixe na maleta para equipar.'].filter(Boolean).join(' • '):selected?`${selected.w}×${selected.h} células`:'';
    }
    for(const button of document.querySelectorAll('#caseGrid [data-case-item-id]')){
      const item=caseItems.find(x=>x.id===Number(button.dataset.caseItemId));if(!item?.weapon)continue;
      button.classList.add('re4-weapon');button.classList.toggle('re4-equipped',!!item.equipped);
      button.setAttribute('aria-label',`${item.name}, ${item.w} por ${item.h} células${item.equipped?', equipada':''}`);
      const url=item.weapon.image;
      if(typeof url==='string'&&url.startsWith('https://')){
        const image=document.createElement('img');image.src=url;image.alt='';image.draggable=false;image.className='re4-weapon-art';image.referrerPolicy='no-referrer';
        if(item.h>item.w)image.classList.add('vertical');
        image.onerror=()=>{image.remove();button.classList.remove('re4-has-image');};
        button.classList.add('re4-has-image');button.prepend(image);
      }
      if(item.equipped){const badge=document.createElement('em');badge.className='re4-equipped-badge';badge.textContent='EQUIPADA';button.appendChild(badge);}
    }
    updateActive();
  }
  renderCase=function(){if(!restoring)reconcile();originalRender();decorate();};
  calc=function(){originalCalc();updateActive();};
  selectCaseItem=function(id,event){originalSelect(id,event);const item=caseItems.find(x=>x.id===id);if(item?.weapon&&inCase(item)){equip(id);renderCase();changed();}};
  collect=function(){const data=originalCollect();data.lists.inventory=data.lists.inventory.map((row,index)=>({...row,...model.serialize(caseItems[index])}));return data;};
  loadCaseItems=function(rows=[]){
    restoring=true;try{originalLoad(rows);}finally{restoring=false;}
    const valid=rows.filter(row=>row&&(row.name||row.cat||row.space||row.w!=null||row.h!=null));
    caseItems.forEach((item,index)=>model.restore(item,valid[index]));renderCase();
  };
  const header=document.querySelector('.case-card-head');
  const activeLabel=document.getElementById('activeWeapon');
  if(activeLabel){
    const panel=document.createElement('div');panel.className='re4-combat';
    panel.innerHTML='<label for="re4WeaponPicker">Armas na maleta</label><select id="re4WeaponPicker" aria-label="Arma para equipar"></select><button id="re4SheetEquip" type="button">Equipar arma</button><button id="re4Attack" type="button">Rolar ataque</button><button id="re4Damage" type="button">Rolar dano</button><small id="re4CombatInfo"></small><output id="re4DamageResult" aria-live="polite"></output>';
    activeLabel.after(panel);
    document.getElementById('re4SheetEquip').onclick=()=>{equip(Number(document.getElementById('re4WeaponPicker').value));renderCase();changed();};
    document.getElementById('re4Attack').onclick=()=>{
      const item=caseItems.find(x=>x.weapon&&x.equipped&&inCase(x));if(!item)return;
      const index=SKILLS.findIndex(x=>x.toLowerCase()===item.weapon.skill.toLowerCase());
      if(index<0){toast('Configure uma perícia válida para esta arma.');return;}
      rollSkill(index);document.getElementById('rollHeroName').textContent=`Ataque • ${item.name} (${item.weapon.skill})`;
    };
    document.getElementById('re4Damage').onclick=()=>{
      const item=caseItems.find(x=>x.weapon&&x.equipped&&inCase(x));if(!item)return;
      const formula=String(item.weapon.damage).toLowerCase().replace(/\s/g,'');
      const match=formula.match(/^(\d{1,2})d(\d{1,3})([+-]\d{1,3})?$/);
      const output=document.getElementById('re4DamageResult');
      if(!match||+match[1]<1||+match[1]>50||+match[2]<2){output.textContent='Dano não rolável: use uma fórmula como 2d6+3.';return;}
      const dice=Array.from({length:+match[1]},()=>1+Math.floor(Math.random()*+match[2]));
      const bonus=+(match[3]||0),total=dice.reduce((a,b)=>a+b,bonus);
      output.textContent=`${item.name} • Dano ${formula}: ${total} (${dice.join(' + ')}${bonus?` ${bonus>0?'+':'−'} ${Math.abs(bonus)}`:''})`;
    };
  }
  if(header){
    const note=document.createElement('div');note.className='re4-guide';
    note.innerHTML='<strong id="re4Active"></strong><span>Arraste para organizar • R ou Girar para rotacionar • Selecione uma arma encaixada para equipar</span>';
    header.after(note);
  }
  // Recupera os campos extras antes perdidos pelo carregador antigo, sem alterar a ficha.
  try{const saved=JSON.parse(localStorage.getItem('op-ficha-v13')||'null');if(Array.isArray(saved?.lists?.inventory)){caseItems.forEach((item,index)=>model.restore(item,saved.lists.inventory[index]));}}catch{}
  renderCase();
  // Toque: arraste o item para a grade ou selecione e toque numa célula livre.
  let touch=null;
  document.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch')return;
    const button=event.target.closest('#caseGrid [data-case-item-id]');if(!button)return;
    touch={id:Number(button.dataset.caseItemId),x:event.clientX,y:event.clientY,moved:false};
  });
  document.addEventListener('pointermove',event=>{
    if(!touch)return;
    if(Math.hypot(event.clientX-touch.x,event.clientY-touch.y)<8&&!touch.moved)return;
    touch.moved=true;event.preventDefault();const cell=casePointerCell(event);const item=caseItems.find(x=>x.id===touch.id);
    document.getElementById('caseGrid').classList.toggle('re4-drop-valid',!!(item&&cell.inside&&canPlaceCase(item,cell.x,cell.y,item.id)));
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(!touch)return;const drag=touch;touch=null;document.getElementById('caseGrid').classList.remove('re4-drop-valid');
    if(drag.moved){event.preventDefault();const cell=casePointerCell(event);if(cell.inside)moveCaseItem(drag.id,cell.x,cell.y);}
  });
  document.addEventListener('pointercancel',()=>{touch=null;document.getElementById('caseGrid').classList.remove('re4-drop-valid');});
})();
