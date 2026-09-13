(() => {
  'use strict';

  const LS={table:'master_table_code'};
  const socket=io({autoConnect:true});
  const livePlayers=new Map();
  let auth=null,managingPlayerId=null,logLines=[];
  const $=(s)=>document.querySelector(s);
  const esc=(s)=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const PLAYER_SHEET_CONDITIONS=['Abalado','Agarrado','Atordoado','Caído','Cego','Debilitado','Enjoado','Enlouquecendo','Exausto','Fraco','Imóvel','Inconsciente','Machucado','Morrendo','Ofuscado','Paralisado','Pasmo','Perturbado','Sangrando','Surdo','Surpreendido','Vulnerável'];
  function normalizeTableCode(value){const normalized=String(value||'PADRAO').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);return normalized||'PADRAO';}
  const params=new URLSearchParams(location.search);
  let masterTableCode=normalizeTableCode(params.get('mesa')||localStorage.getItem(LS.table)||'PADRAO');
  localStorage.setItem(LS.table,masterTableCode);
  function log(message){const time=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});logLines.unshift({time,message});logLines=logLines.slice(0,30);const box=$('#liveGMLog');if(box)box.innerHTML=logLines.map(x=>`<div><b>${esc(x.time)}</b> ${esc(x.message)}</div>`).join('');}
  function setStatus(kind,text){const dot=$('#liveGMDot'),label=$('#liveGMStatus');if(dot)dot.className=`live-dot ${kind}`;if(label)label.textContent=text;}
  function playerKey(p){return Number(p?.dbId||p?.id||0);}
  function inviteUrl(){return `${location.origin}/jogador?mesa=${encodeURIComponent(masterTableCode)}`;}
  function updateMasterTableUI(){if($('#masterLiveTableCode'))$('#masterLiveTableCode').textContent=masterTableCode;}
  function chooseMasterTable(){
    const requested=prompt('Digite o codigo da mesa:',masterTableCode);if(requested===null)return;const next=normalizeTableCode(requested);if(next===masterTableCode)return;
    masterTableCode=next;localStorage.setItem(LS.table,masterTableCode);try{const u=new URL(location.href);u.searchParams.set('mesa',masterTableCode);history.replaceState(null,'',u);}catch{}
    livePlayers.clear();updateMasterTableUI();renderLivePlayers();refreshLiveSelects();connectMasterTable();
  }
  window.chooseMasterTable=chooseMasterTable;
  function injectGMUI(){
    if($('#liveGMPanel'))return;const mesa=document.querySelector('.tab[data-tab="mesa"] .grid');if(!mesa)return;
    const panel=document.createElement('section');panel.id='liveGMPanel';panel.className='gm-connected-workspace';
    panel.innerHTML=`<header class="gm-connected-topbar"><div class="gm-connected-brand"><h2>Jogadores conectados</h2><div class="gm-connected-status-line"><span id="liveGMDot" class="live-dot offline"></span><span id="liveGMStatus">Conectando ao servidor...</span></div></div><div class="gm-connected-actions"><button class="live-master-table-button" type="button" onclick="chooseMasterTable()">MESA: <span id="masterLiveTableCode">${esc(masterTableCode)}</span></button><button id="liveGMCopyLink" type="button">COPIAR LINK DA FICHA</button><button id="liveGMOpenPlayer" type="button">ABRIR NOVA FICHA</button><button id="liveGMForceSync" type="button">SINCRONIZAR</button></div></header><section class="gm-connected-players-section"><div class="gm-connected-heading"><span>Jogadores conectados automaticamente</span><span id="liveGMPlayersCount" class="gm-connected-count">0 ONLINE</span></div><div class="gm-connected-players" id="liveGMPlayers"><div class="gm-connected-empty"><strong>Aguardando jogadores</strong>Assim que uma ficha usar a mesa <b>${esc(masterTableCode)}</b>, ela aparecerá aqui automaticamente.</div></div></section>`;
    mesa.appendChild(panel);$('#liveGMCopyLink')?.addEventListener('click',copyInviteLink);$('#liveGMOpenPlayer')?.addEventListener('click',()=>window.open(inviteUrl(),'_blank','noopener'));$('#liveGMForceSync')?.addEventListener('click',forceRoomSync);injectManageModal();injectClueSendBox();updateMasterTableUI();refreshConnectionUI();
  }
  function injectManageModal(){
    if($('#liveManagePlayerModal'))return;const modal=document.createElement('div');modal.className='modal';modal.id='liveManagePlayerModal';modal.addEventListener('click',e=>{if(e.target===modal)closeLiveManage();});modal.innerHTML=`<section class="modal-panel"><div class="modal-head"><div><div class="kicker">Sincronização em tempo real</div><h2 id="liveManageTitle">Jogador</h2></div><button class="modal-close" type="button" id="liveManageClose">×</button></div><div class="live-manage-grid"><div><label>PV atual</label><input id="liveEditPV" type="number" min="0"></div><div><label>Sanidade atual</label><input id="liveEditSAN" type="number" min="0"></div><div><label>PE atual</label><input id="liveEditPE" type="number" min="0"></div><div><label>Radiação</label><input id="liveEditRAD" type="number" min="0" max="7"></div><div class="full"><label>Condições</label><div class="live-condition-grid" id="liveManageConditions"></div></div><div class="full"><label>Mensagem para o jogador</label><input id="liveNoticeText" placeholder="Ex.: Você escuta passos vindo do corredor..."></div></div><div class="modal-actions"><button type="button" id="liveSendNotice">Enviar mensagem</button><button type="button" id="liveManageCancel">Cancelar</button><button class="primary" type="button" id="liveManageApply">Aplicar na ficha</button></div></section>`;document.body.appendChild(modal);$('#liveManageClose').addEventListener('click',closeLiveManage);$('#liveManageCancel').addEventListener('click',closeLiveManage);$('#liveManageApply').addEventListener('click',applyLivePlayerPatch);$('#liveSendNotice').addEventListener('click',sendLiveNotice);
  }
  function refreshConnectionUI(){updateMasterTableUI();renderLivePlayers();refreshLiveSelects();}
  function connectMasterTable(){
    if(!socket.connected)return;setStatus('wait',`Conectando à mesa ${masterTableCode}...`);auth={campaign:{code:masterTableCode,name:`Mesa ${masterTableCode}`}};
    socket.emit('master_ready',{mesa:masterTableCode},res=>{if(res?.ok===false){setStatus('offline',res.error||'Falha ao conectar à mesa');return;}livePlayers.clear();(res?.players||[]).forEach(p=>{const key=playerKey(p);if(key)livePlayers.set(key,p);});setStatus('online',`Conectado • Mesa ${masterTableCode}`);refreshConnectionUI();});
  }
  async function copyInviteLink(){const url=inviteUrl();try{await navigator.clipboard.writeText(url);toast('Link da ficha copiado');}catch{prompt('Copie o link da ficha:',url);}}
  function forceRoomSync(){if(!socket.connected)return;setStatus('wait','Solicitando fichas...');socket.emit('master_request_sync',{mesa:masterTableCode},res=>{if(res?.ok===false){setStatus('online',`Conectado • Mesa ${masterTableCode}`);return;}(res?.players||[]).forEach(p=>{const key=playerKey(p);if(key)livePlayers.set(key,p);});renderLivePlayers();refreshLiveSelects();setTimeout(()=>setStatus('online',`Conectado • Mesa ${masterTableCode}`),200);});}

  function summaryFor(p) {
    const s = p.summary || {};
    const f = p.sheet?.fields || {};
    return {
      playerName: s.playerName || p.playerName || f.player || '',
      characterName: s.characterName || p.characterName || f.name || 'Agente',
      nex: n(s.nex ?? f.nex),
      className: s.className || f.class || '',
      defense: n(s.defense),
      pv: n(s.pv ?? f.pvCur), pvMax: n(s.pvMax),
      san: n(s.san ?? f.sanCur), sanMax: n(s.sanMax),
      pe: n(s.pe ?? f.peCur), peMax: n(s.peMax),
      radiation: n(s.radiation ?? f.radiation),
      portrait: f.portraitData || '',
      conditions: Array.isArray(s.conditions) ? s.conditions : [],
      inventoryCount: n(s.inventoryCount), ritualCount: n(s.ritualCount), powerCount: n(s.powerCount)
    };
  }

  window.addLivePlayersToCombat=()=>{
    for(const p of livePlayers.values()){
      if(!p.online)continue;
      const key=`live:${masterTableCode}:${playerKey(p)}`;
      if(state.initiative.some(item=>item.liveKey===key))continue;
      const s=summaryFor(p);
      state.initiative.push({id:uid(),liveKey:key,name:s.characterName,init:0,def:s.defense,pv:s.pv,pvMax:s.pvMax,status:s.conditions.join(', ')});
    }
    renderInitiative();autosave();
  };
  function receiveInitiative(p,roll=p?.initiative){
    if(!roll||!p||normalizeTableCode(p.mesa)!==masterTableCode||!Number.isFinite(roll.total))return;
    const key=`live:${masterTableCode}:${playerKey(p)}`;
    state.receivedInitiativeRolls=state.receivedInitiativeRolls||{};
    if(state.receivedInitiativeRolls[key]===roll.id)return;
    state.receivedInitiativeRolls[key]=roll.id;
    const s=summaryFor(p),active=state.initiative[state.combat.turn]?.id;
    let item=state.initiative.find(x=>x.liveKey===key);
    if(!item){item={id:uid(),liveKey:key,name:s.characterName,def:s.defense,pv:s.pv,pvMax:s.pvMax,status:s.conditions.join(', ')};state.initiative.push(item);}
    item.init=roll.total;item.name=s.characterName;
    state.initiative.sort((a,b)=>(Number(b.init)||0)-(Number(a.init)||0));
    if(active&&(state.combat.round>1||state.combat.turn>0))state.combat.turn=Math.max(0,state.initiative.findIndex(x=>x.id===active));else state.combat.turn=0;
    renderInitiative();autosave();
  }
  socket.on('gm:initiative',data=>receiveInitiative(data.player,data.roll));
  function renderLivePlayers() {
    for(const p of livePlayers.values())receiveInitiative(p);
    const box = $('#liveGMPlayers');
    const countBox = $('#liveGMPlayersCount');
    if (!box) return;

    const players = [...livePlayers.values()].filter(p => p.online);
    if (countBox) countBox.textContent = `${players.length} ONLINE`;

    if (!players.length) {
      box.innerHTML = `<div class="gm-connected-empty"><strong>Aguardando jogadores</strong>Assim que uma ficha usar a mesa <b>${esc(masterTableCode)}</b>, ela aparecerá aqui automaticamente.</div>`;
      return;
    }

    box.innerHTML = players.map(p => {
      const s = summaryFor(p);
      const pvPct = s.pvMax > 0 ? Math.max(0, Math.min(100, s.pv / s.pvMax * 100)) : 0;
      const sanPct = s.sanMax > 0 ? Math.max(0, Math.min(100, s.san / s.sanMax * 100)) : 0;
      const pePct = s.peMax > 0 ? Math.max(0, Math.min(100, s.pe / s.peMax * 100)) : 0;
      const portrait = s.portrait ? esc(s.portrait) : '';
      const initial = esc((s.characterName || 'A').trim().charAt(0).toUpperCase() || 'A');

      const tags = [];
      if (s.pv <= 0) tags.push('<span class="gm-player-tag danger">Morrendo</span>');
      else if (s.pvMax > 0 && s.pv <= s.pvMax / 2) tags.push('<span class="gm-player-tag danger-soft">Machucado</span>');

      if (s.san <= 0) tags.push('<span class="gm-player-tag sanity">Enlouquecendo</span>');
      else if (s.sanMax > 0 && s.san < s.sanMax / 2) tags.push('<span class="gm-player-tag sanity-soft">Perturbado</span>');

      (s.conditions || []).forEach(c => {
        tags.push(`<span class="gm-player-tag">${esc(c)}</span>`);
      });

      return `<article class="gm-connected-player-card">
        <span class="gm-player-online-dot" title="Online"></span>

        <div class="gm-player-header">
          ${portrait
            ? `<img class="gm-player-portrait" src="${portrait}" alt="Retrato de ${esc(s.characterName)}">`
            : `<div class="gm-player-portrait gm-player-portrait-empty">${initial}</div>`}
          <div class="gm-player-identity">
            <h3>${esc(s.characterName)}</h3>
            <div>${esc(s.playerName || 'Jogador')} • NEX ${s.nex}%${s.className ? ` • ${esc(s.className)}` : ''}</div>
            <small>DEFESA ${s.defense || '—'} • RAD ${s.radiation}/7</small>
          </div>
        </div>

        <div class="gm-player-resource">
          <div class="gm-player-resource-label life"><span>VIDA</span><b>${s.pv} / ${s.pvMax || 0}</b></div>
          <div class="gm-player-bar"><i class="life" style="width:${pvPct}%"></i><span>${s.pv} / ${s.pvMax || 0}</span></div>
        </div>

        <div class="gm-player-resource">
          <div class="gm-player-resource-label sanity"><span>SANIDADE</span><b>${s.san} / ${s.sanMax || 0}</b></div>
          <div class="gm-player-bar"><i class="sanity" style="width:${sanPct}%"></i><span>${s.san} / ${s.sanMax || 0}</span></div>
        </div>

        <div class="gm-player-resource">
          <div class="gm-player-resource-label effort"><span>PE</span><b>${s.pe} / ${s.peMax || 0}</b></div>
          <div class="gm-player-bar small"><i class="effort" style="width:${pePct}%"></i><span>${s.pe} / ${s.peMax || 0}</span></div>
        </div>

        <div class="gm-player-tags">${tags.join('')}</div>
        <button class="gm-player-manage" type="button" onclick="window.liveManagePlayer(${Number(p.id)})">Gerenciar ficha</button>
      </article>`;
    }).join('');
  }

  window.liveManagePlayer = (id) => {
    const p = livePlayers.get(Number(id));
    if (!p) return;
    managingPlayerId = Number(id);
    const s = summaryFor(p);
    $('#liveManageTitle').textContent = `${s.characterName} • ${s.playerName || 'Jogador'}`;
    $('#liveEditPV').value = s.pv;
    $('#liveEditSAN').value = s.san;
    $('#liveEditPE').value = s.pe;
    $('#liveEditRAD').value = s.radiation;
    $('#liveNoticeText').value = '';
    const allConditions = PLAYER_SHEET_CONDITIONS;
    $('#liveManageConditions').innerHTML = allConditions.map(name => `<label class="live-condition-item"><input type="checkbox" value="${esc(name)}" ${s.conditions.includes(name)?'checked':''}><span>${esc(name)}</span></label>`).join('');
    openModal('liveManagePlayerModal');
  };

  function closeLiveManage() { closeModal('liveManagePlayerModal'); managingPlayerId = null; }

  function applyLivePlayerPatch() {
    if (!auth || !managingPlayerId) return;
    const conditions = [...document.querySelectorAll('#liveManageConditions input:checked')].map(x => x.value);
    const patch = { fields: {
      pvCur: Math.max(0, n($('#liveEditPV').value)),
      sanCur: Math.max(0, n($('#liveEditSAN').value)),
      peCur: Math.max(0, n($('#liveEditPE').value)),
      radiation: Math.max(0, Math.min(7, n($('#liveEditRAD').value)))
    }, conditions };
    socket.emit('gm:patch_player', { playerId: managingPlayerId, patch }, res => {
      if (!res?.ok) return alert(res?.error || 'Falha ao alterar a ficha.');
      toast('Alteração enviada ao jogador');
      log(`Alteração enviada para ${summaryFor(livePlayers.get(managingPlayerId)).characterName}.`);
      closeLiveManage();
    });
  }

  function sendLiveNotice() {
    const message = ($('#liveNoticeText').value || '').trim();
    if (!message || !managingPlayerId) return;
    sendEvent(managingPlayerId, 'notice', { message }, () => {
      toast('Mensagem enviada');
      $('#liveNoticeText').value = '';
    });
  }

  function sendEvent(playerId, type, data, after) {
    if (!socket.connected) return alert('Servidor desconectado.');
    socket.emit('gm:send_event', { playerId:Number(playerId), type, data }, res => {
      if (!res?.ok) return alert(res?.error || 'Falha ao enviar.');
      after?.();
    });
  }

  function playerOptions(selected = '') {
    const players = [...livePlayers.values()];
    return `<option value="">Selecione um jogador</option>` + players.map(p => {
      const s = summaryFor(p);
      return `<option value="${Number(p.id)}" ${String(selected)===String(p.id)?'selected':''}>${esc(s.characterName)} — ${esc(s.playerName || 'Jogador')}${p.online?' • online':' • offline'}</option>`;
    }).join('');
  }

  function refreshLiveSelects() {
    document.querySelectorAll('select[data-live-player-select]').forEach(sel => {
      const old = sel.value;
      sel.innerHTML = playerOptions(old);
      if ([...sel.options].some(o => o.value === old)) sel.value = old;
    });
    appendLiveAudienceOptions();
  }

  function appendLiveAudienceOptions() {
    const options = [...livePlayers.values()].map(p => summaryFor(p));
    for (const id of ['clueAudience','packageTarget']) {
      const sel = document.getElementById(id);
      if (!sel) continue;
      const existing = new Set([...sel.options].map(o => o.value.toLowerCase()));
      options.forEach(s => {
        const value = (s.playerName || s.characterName || '').trim();
        if (!value || existing.has(value.toLowerCase())) return;
        const o = document.createElement('option');
        o.value = value;
        o.textContent = `${s.playerName ? s.playerName+' — ' : ''}${s.characterName} • online`;
        sel.appendChild(o);
        existing.add(value.toLowerCase());
      });
    }
  }

  function wrapAudience() {
    if (typeof refreshAudience !== 'function' || refreshAudience.__liveWrapped) return;
    const original = refreshAudience;
    refreshAudience = function(...args) {
      const result = original.apply(this,args);
      appendLiveAudienceOptions();
      return result;
    };
    refreshAudience.__liveWrapped = true;
  }

  function ensureEquipmentSend() {
    const panel = document.querySelector('#equipmentModal .equipment-modal-panel');
    if (!panel || panel.querySelector('#liveEquipmentSend')) { refreshLiveSelects(); return; }
    const box = document.createElement('div');
    box.id = 'liveEquipmentSend';
    box.className = 'live-send-box';
    box.innerHTML = `<label>Enviar este equipamento para uma ficha conectada</label><div class="live-send-row"><select data-live-player-select id="liveEquipmentPlayer"></select><button type="button" id="liveEquipmentButton">Enviar ao jogador</button></div>`;
    const actions = panel.querySelector('.equipment-modal-actions');
    actions?.insertAdjacentElement('beforebegin', box);
    $('#liveEquipmentButton').addEventListener('click', sendCurrentEquipment);
    refreshLiveSelects();
  }

  window.EchosEquipment = {
    refreshRecipients: refreshLiveSelects,
    send(playerId, item) {
      return new Promise((resolve, reject) => {
        if (!socket.connected) return reject(new Error('Servidor desconectado. Aguarde a reconexão.'));
        if (!livePlayers.has(Number(playerId))) return reject(new Error('Este jogador saiu da mesa. Selecione um jogador conectado.'));
        if (!String(item?.name || '').trim()) return reject(new Error('Informe o nome do equipamento.'));
        const timer = setTimeout(() => reject(new Error('Não foi possível confirmar o envio. Confira o inventário antes de enviar novamente.')), 12000);
        socket.emit('gm:send_event', {playerId:Number(playerId),type:'equipment',data:item}, result => {
          clearTimeout(timer);
          if (!result?.ok) return reject(new Error(result?.error || 'Não foi possível enviar o equipamento.'));
          log(`${item.name} enviado ao inventário do jogador.`);
          resolve(result);
        });
      });
    }
  };

  function sendCurrentEquipment() {
    const playerId = $('#liveEquipmentPlayer')?.value;
    if (!playerId) return alert('Selecione o jogador.');
    const item = {
      ...JSON.parse($('#equipmentModal')?.dataset.catalogMetadata || '{}'),
      type: $('#equipmentType')?.value || 'item',
      name: ($('#equipmentName')?.value || '').trim(),
      category: ($('#equipmentCategory')?.value || '').trim(),
      load: n($('#equipmentLoad')?.value), spaces: n($('#equipmentSpaces')?.value,1),
      damage: ($('#equipmentDamage')?.value || '').trim(), crit: ($('#equipmentCrit')?.value || '').trim(), range: ($('#equipmentRange')?.value || '').trim(),
      desc: ($('#equipmentDesc')?.value || '').trim()
    };
    if (!item.name) return alert('Dê um nome ao equipamento antes de enviar.');
    sendEvent(playerId,'equipment',item,()=>{toast(`${item.name} enviado`);log(`${item.name} enviado para ${summaryFor(livePlayers.get(Number(playerId))).characterName}.`);});
  }

  function wrapEquipmentModal() {
    if (typeof openEquipmentModal !== 'function' || openEquipmentModal.__liveWrapped) return;
    const original = openEquipmentModal;
    openEquipmentModal = function(...args) {
      const result = original.apply(this,args);
      setTimeout(ensureEquipmentSend,0);
      return result;
    };
    openEquipmentModal.__liveWrapped = true;
  }

  function injectClueSendBox() {
    window.sendClueToMiro=async(id,miroButton,miroStatus)=>{
      if(!socket.connected){miroStatus.textContent='Conecte-se à mesa antes de enviar.';return;}
      const nodes=(state.gmClues?.nodes||[]).filter(n=>n.id===id && Array.isArray(n.audience)&&n.audience.includes('all'));
      if(!nodes.length){miroStatus.textContent='Para enviar ao quadro compartilhado, edite esta pista e marque o público como Todos.';return;}
      miroButton.disabled=true;miroStatus.textContent='Enviando ao Miro...';
      try{
        const illustrated=[];
        for(const node of nodes){
          if(!node.image)throw new Error(`Adicione uma imagem à pista: ${node.title}`);
          const picture=new Image();picture.src=node.image;await picture.decode();
          const canvas=document.createElement('canvas');canvas.width=Math.max(400,picture.naturalWidth);canvas.height=picture.naturalHeight+70;
          const context=canvas.getContext('2d');context.fillStyle='#17221b';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(picture,(canvas.width-picture.naturalWidth)/2,0);
          context.fillStyle='#f3eedb';context.font='bold 28px sans-serif';context.textAlign='center';context.textBaseline='middle';context.fillText(String(node.title),canvas.width/2,picture.naturalHeight+35,canvas.width-30);
          illustrated.push({...node,image:canvas.toDataURL('image/jpeg',.85)});
        }
        socket.emit('gm:publish_clues',{nodes:illustrated},res=>{miroButton.disabled=false;miroStatus.textContent=res?.ok?(res.sent?'Pista enviada ao Miro.':'Esta pista já está atualizada no Miro.'):res?.error||'Falha ao enviar ao Miro.';});
      }catch(error){miroButton.disabled=false;miroStatus.textContent=error.message||'Não foi possível preparar a imagem.';}
    };

  }

  function sendCluesLive() {
    const playerId = Number($('#liveCluePlayer')?.value || 0);
    const p = livePlayers.get(playerId);
    if (!p) return alert('Selecione o jogador.');
    const s = summaryFor(p);
    const identities = [s.playerName,s.characterName].filter(Boolean).map(x=>x.toLowerCase());
    const nodes = (state.gmClues?.nodes || []).filter(node => {
      const aud = Array.isArray(node.audience) ? node.audience.map(x=>String(x).toLowerCase()) : ['all'];
      return aud.includes('all') || identities.some(id => aud.includes(id));
    });
    const ids = new Set(nodes.map(x=>x.id));
    const links = (state.gmClues?.links || []).filter(l => ids.has(l.a) && ids.has(l.b));
    const pkg = {
      type:'op-clues-package', sender:'Mestre', audience:['all'],
      board:{
        nodes:nodes.map(n=>({id:n.id,title:n.title,desc:n.desc,kind:n.kind,audience:['all'],sourcePlayer:n.sourcePlayer||'',sharedByGM:true,sharedBy:'Mestre',x:n.x,y:n.y,w:n.w})),
        links:links.map(l=>({a:l.a,b:l.b}))
      }
    };
    sendEvent(playerId,'clue',pkg,()=>{toast(`${nodes.length} pista(s) enviadas`);log(`${nodes.length} pista(s) enviadas para ${s.characterName}.`);});
  }

  function appendCompGrant() {
    const detail = $('#compDetail');
    if (!detail || detail.querySelector('#liveCompGrant') || compSelected === null) return;
    const data = compType === 'ritual' ? BOOK_DATA.rituals : BOOK_DATA.powers;
    const item = data[compSelected];
    if (!item) return;
    const box = document.createElement('div');
    box.id = 'liveCompGrant';
    box.className = 'live-send-box';
    box.innerHTML = `<label>Adicionar ${compType==='ritual'?'ritual':'poder'} a um jogador</label><div class="live-send-row"><select data-live-player-select id="liveCompPlayer"></select><button type="button" id="liveCompButton">Enviar ${compType==='ritual'?'ritual':'poder'}</button></div>`;
    detail.appendChild(box);
    $('#liveCompButton').addEventListener('click',()=>{
      const playerId = $('#liveCompPlayer')?.value;
      if (!playerId) return alert('Selecione o jogador.');
      sendEvent(playerId,compType==='ritual'?'ritual':'power',{name:item.name},()=>{toast(`${item.name} enviado`);log(`${item.name} enviado para ${summaryFor(livePlayers.get(Number(playerId))).characterName}.`);});
    });
    refreshLiveSelects();
  }

  function wrapCompendium() {
    if (typeof renderCompDetail !== 'function' || renderCompDetail.__liveWrapped) return;
    const original = renderCompDetail;
    renderCompDetail = function(...args) {
      const result = original.apply(this,args);
      setTimeout(appendCompGrant,0);
      return result;
    };
    renderCompDetail.__liveWrapped = true;
  }

  socket.on('connect',()=>{setStatus('online','Servidor conectado');setTimeout(connectMasterTable,30);});
  socket.on('disconnect',()=>setStatus('wait','Servidor desconectado • reconectando...'));
  socket.on('players_snapshot',players=>{livePlayers.clear();(Array.isArray(players)?players:[]).filter(p=>normalizeTableCode(p?.mesa)===masterTableCode).forEach(p=>{const key=playerKey(p);if(key)livePlayers.set(key,p);});setStatus('online',`Conectado • Mesa ${masterTableCode}`);renderLivePlayers();refreshLiveSelects();if(typeof refreshAudience==='function')refreshAudience();});
  socket.on('update_mestre',p=>{if(!p||normalizeTableCode(p.mesa)!==masterTableCode)return;const key=playerKey(p);if(!key)return;livePlayers.set(key,{...(livePlayers.get(key)||{}),...p,online:true});renderLivePlayers();refreshLiveSelects();const s=summaryFor(p);log(`Ficha atualizada: ${s.characterName}.`);});
  socket.on('player_disconnected',data=>{if(!data||normalizeTableCode(data.mesa)!==masterTableCode)return;const code=String(data.codigo||'');for(const [key,p] of livePlayers.entries()){if(String(p.codigo||'')===code){livePlayers.delete(key);break;}}renderLivePlayers();refreshLiveSelects();});
  socket.on('gm:players',players=>{if(!Array.isArray(players))return;players.forEach(p=>{const key=playerKey(p);if(key&&p.online)livePlayers.set(key,p);});renderLivePlayers();refreshLiveSelects();});
  socket.on('gm:player_sheet',p=>{const key=playerKey(p);if(!key)return;livePlayers.set(key,{...(livePlayers.get(key)||{}),...p,online:true});renderLivePlayers();refreshLiveSelects();});

  window.addEventListener('load',()=>{injectGMUI();wrapAudience();wrapEquipmentModal();wrapCompendium();refreshLiveSelects();updateMasterTableUI();if(socket.connected)setTimeout(connectMasterTable,50);});
})();
(function(){
  const tab=document.querySelector('.tab[data-tab="pistas"]');if(!tab)return;
  const style=document.createElement('style');style.textContent='.tab[data-tab="pistas"] #gmClueViewport,.tab[data-tab="pistas"] .clue-tools button:not(:first-child),.tab[data-tab="pistas"] .span4,.tab[data-tab="pistas"] .span8{display:none!important}.gm-clue-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;margin-top:18px}.gm-clue-tile{padding:12px;border:1px solid #64715d;background:#17221b;border-radius:7px;text-align:left}.gm-clue-tile img{width:100%;height:150px;object-fit:contain;background:#0b110d;margin-bottom:8px}.gm-clue-tile strong{display:block;font-size:16px}.gm-clue-tile p{white-space:pre-wrap;color:#c4cdbb}.gm-clue-open{display:block;width:100%;border:0;padding:0;background:transparent;text-align:left;text-transform:none}.gm-clue-open:focus-visible{outline:2px solid #e3d856;outline-offset:4px}.gm-clue-actions[hidden]{display:none}.gm-clue-actions{margin-top:12px}.gm-clue-actions button{margin:3px}.gm-clue-preview{max-width:100%;max-height:220px;object-fit:contain}.gm-clue-preview[hidden]{display:none}';document.head.appendChild(style);
  tab.querySelector('.section-head .hint').textContent='Adicione uma pista com imagem, nome e informações. Clique em uma pista para ver as opções e enviar ao Miro.';
  const gallery=document.createElement('div');gallery.className='gm-clue-list';tab.querySelector('.card').appendChild(gallery);
  const fields=document.querySelector('#clueModal .fields');
  const upload=document.createElement('div');upload.className='field full';upload.innerHTML='<label for="gmClueImageFile">Imagem da pista</label><input id="gmClueImageFile" type="file" accept="image/png,image/jpeg,image/webp"><img class="gm-clue-preview" id="gmClueImagePreview" alt="Prévia da pista" hidden><button type="button" id="gmClueImageRemove">Remover imagem</button><small id="gmClueImageStatus" role="status"></small>';fields.prepend(upload);
  let imageData='',reading=false;
  const preview=document.getElementById('gmClueImagePreview'),input=document.getElementById('gmClueImageFile'),status=document.getElementById('gmClueImageStatus');
  const refresh=()=>{preview.hidden=!imageData;if(imageData)preview.src=imageData;else preview.removeAttribute('src');};
  input.onchange=async()=>{const file=input.files[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024){status.textContent='Escolha uma imagem PNG, JPG ou WebP de até 10 MB.';input.value='';return;}reading=true;status.textContent='Carregando imagem...';try{const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas'),scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();imageData=canvas.toDataURL('image/jpeg',.8);if(imageData.length>450000)imageData=canvas.toDataURL('image/jpeg',.5);if(imageData.length>600000)throw Error();refresh();status.textContent='Imagem pronta.';}catch{status.textContent='Não foi possível carregar esta imagem.';}finally{reading=false;}};
  document.getElementById('gmClueImageRemove').onclick=()=>{imageData='';input.value='';refresh();};
  const oldOpen=openClueModal,oldSave=saveGMClue,oldRender=renderGMClues;
  openClueModal=function(id=null){oldOpen(id);imageData=state.gmClues.nodes.find(n=>n.id===id)?.image||'';input.value='';status.textContent='';refresh();};
  saveGMClue=function(){if(reading){status.textContent='Aguarde o carregamento da imagem.';return;}if(!byId('clueTitle').value.trim())return oldSave();const id=gmClueEditing;oldSave();const item=id?state.gmClues.nodes.find(n=>n.id===id):state.gmClues.nodes.at(-1);if(item)item.image=imageData;autosave();renderGMClues();};
  renderGMClues=function(){
    oldRender();gallery.replaceChildren();
    for(const node of state.gmClues.nodes){
      const card=document.createElement('article');card.className='gm-clue-tile';
      const trigger=document.createElement('button');trigger.type='button';trigger.className='gm-clue-open';trigger.setAttribute('aria-expanded','false');
      if(node.image){const img=document.createElement('img');img.src=node.image;img.alt='';trigger.appendChild(img);}
      const name=document.createElement('strong');name.textContent=node.title;trigger.appendChild(name);
      const actions=document.createElement('div');actions.className='gm-clue-actions';actions.hidden=true;
      trigger.onclick=()=>{const opening=actions.hidden;for(const tile of gallery.children){tile.querySelector('.gm-clue-actions').hidden=true;tile.querySelector('.gm-clue-open').setAttribute('aria-expanded','false');}actions.hidden=!opening;trigger.setAttribute('aria-expanded',String(opening));};
      const desc=document.createElement('p');desc.textContent=node.desc;
      const send=document.createElement('button');send.type='button';send.className='primary';send.textContent='Enviar para o Miro';
      const status=document.createElement('p');status.className='hint';status.setAttribute('role','status');
      send.onclick=()=>{if(window.sendClueToMiro)window.sendClueToMiro(node.id,send,status);else status.textContent='Aguarde a conexão com a mesa.';};
      const edit=document.createElement('button');edit.type='button';edit.textContent='Editar';edit.onclick=()=>openClueModal(node.id);
      const remove=document.createElement('button');remove.type='button';remove.textContent='Excluir';remove.onclick=()=>removeGMClue(node.id);
      actions.append(desc,send,status,edit,remove);card.append(trigger,actions);gallery.appendChild(card);
    }
  };
  renderGMClues();
})();

// Keep the clues screen focused on creation and the saved clues.
(function(){
  const style=document.createElement('style');
  style.textContent=`
    .tab[data-tab="equipamentos"] > .tab-organizer,
    .tab[data-tab="equipamentos"] > .gm-tab-overview {display:none!important}
    .tab[data-tab="pistas"] > .tab-organizer,
    .tab[data-tab="pistas"] > .gm-tab-overview,
    .tab[data-tab="pistas"] .gm-card-summary,
    .tab[data-tab="pistas"] .section-head > div:first-child,
    .tab[data-tab="pistas"] .notice {display:none!important}
    .tab[data-tab="pistas"] .gm-card-body {display:block!important}
    .tab[data-tab="pistas"] .section-head {justify-content:flex-end}
    .tab[data-tab="pistas"] .gm-clue-list {margin-top:14px}
  `;
  document.head.appendChild(style);
})();

(()=>{const script=document.createElement('script');script.src='/shared/gm-bestiary.js';document.head.appendChild(script);})();

