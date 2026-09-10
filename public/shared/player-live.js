(() => {
  'use strict';

  const LS = { table:'player_table_code', playerCode:'player_sync_code' };
  const socket = io({ autoConnect:true });
  let applyingRemote = false;
  let syncTimer = null;
  let pageReady = document.readyState !== 'loading';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));

  function normalizeTableCode(value) {
    const normalized = String(value || 'PADRAO').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
    return normalized || 'PADRAO';
  }

  const params = new URLSearchParams(window.location.search);
  let tableCode = normalizeTableCode(params.get('mesa') || params.get('sala') || localStorage.getItem(LS.table) || 'PADRAO');
  localStorage.setItem(LS.table, tableCode);
  let playerCode = localStorage.getItem(LS.playerCode);
  if (!playerCode) {
    playerCode = Math.random().toString(36).substring(2,6).toUpperCase();
    localStorage.setItem(LS.playerCode, playerCode);
  }

  function field(k){ return document.querySelector(`[data-k="${k}"]`)?.value ?? ''; }
  function currentResource(k){ return Number(document.querySelector(`[data-k="${k}"]`)?.value || 0); }
  function resourceMax(resource){
    const card=document.querySelector(`.res[data-resource="${resource}"]`);
    const input=card?.querySelector('[data-resource-max]');
    if(input) return Number(input.value||0);
    return Number(card?.dataset.max||0);
  }
  function activeConditions(){
    if(typeof CONDITIONS==='undefined') return [];
    return CONDITIONS.filter((name,i)=>document.querySelector(`[data-k="cond_${i}"]`)?.checked);
  }
  function buildSummary(){
    const collected = typeof collect==='function' ? collect() : {};
    return {
      playerName:field('player'), characterName:field('name'), nex:Number(field('nex')||0), className:field('class'), origin:field('origin'), trail:field('trail'), level:Number(field('level')||0),
      defense:Number($('#actionDefense')?.textContent||0), pv:currentResource('pvCur'), pvMax:resourceMax('PV'), san:currentResource('sanCur'), sanMax:resourceMax('SAN'), pe:currentResource('peCur'), peMax:resourceMax('PE'), radiation:currentResource('radiation'),
      portrait:collected?.fields?.portraitData||'', conditions:activeConditions(), inventoryCount:typeof caseItems!=='undefined'?caseItems.length:0, ritualCount:document.querySelectorAll('#rituals .ritual-card').length, powerCount:document.querySelectorAll('#powers .power-card').length, updatedAt:new Date().toISOString()
    };
  }
  function setStatus(kind,text){
    const dot=$('#livePlayerDot'), status=$('#livePlayerStatus');
    if(dot) dot.className=`live-dot ${kind}`;
    if(status) status.textContent=text;
  }
  function updateTableUI(){
    if($('#displayLiveTableCode')) $('#displayLiveTableCode').textContent=tableCode;
    if($('#displayLivePlayerCode')) $('#displayLivePlayerCode').textContent=playerCode;
  }
  function choosePlayerTable(){
    const requested=prompt('Digite o codigo da mesa:',tableCode);
    if(requested===null) return;
    const next=normalizeTableCode(requested);
    if(next===tableCode) return;
    tableCode=next;
    localStorage.setItem(LS.table,tableCode);
    try{const u=new URL(location.href);u.searchParams.set('mesa',tableCode);u.searchParams.delete('sala');history.replaceState(null,'',u);}catch{}
    updateTableUI();
    scheduleSync(0);
  }
  window.choosePlayerTable=choosePlayerTable;
  function injectUI(){
    if($('#livePlayerPanel')) return;
    const panel=document.createElement('section');
    panel.id='livePlayerPanel';panel.className='live-panel live-reference-connection';
    panel.innerHTML=`<div class="live-reference-left"><span id="livePlayerDot" class="live-dot offline"></span><div><strong id="livePlayerStatus">Conectando ao servidor...</strong><small>CÓDIGO DA FICHA: <b id="displayLivePlayerCode">${esc(playerCode)}</b></small></div></div><button class="live-table-selector" type="button" onclick="choosePlayerTable()">MESA: <span id="displayLiveTableCode">${esc(tableCode)}</span></button>`;
    document.querySelector('.top')?.insertAdjacentElement('afterend',panel);
    updateTableUI();
  }
  function scheduleSync(delay=650){
    if(applyingRemote||!socket.connected||!pageReady) return;
    clearTimeout(syncTimer);syncTimer=setTimeout(syncNow,delay);
  }
  function syncNow(){
    if(applyingRemote||!socket.connected||!pageReady||typeof collect!=='function') return;
    const sheet=collect();const summary=buildSummary();
    socket.emit('status_change',{codigo:playerCode,id:playerCode,mesa:tableCode,nome:summary.characterName||'Agente',playerName:summary.playerName||'',foto:summary.portrait||sheet?.fields?.portraitData||'',nex:summary.nex,defesa:summary.defense,vida_atual:summary.pv,vida_max:summary.pvMax,sani_atual:summary.san,sani_max:summary.sanMax,pe_atual:summary.pe,pe_max:summary.peMax,radiacao:summary.radiation,status:summary.conditions,fullData:sheet,summary},res=>{
      if(res?.ok===false) setStatus('wait',res.error||'Falha na sincronização'); else setStatus('online',`Conectado • Mesa ${tableCode}`);
    });
  }

  function applyFieldPatch(fields = {}) {
    let needsCalc = false;
    for (const [key, value] of Object.entries(fields)) {
      const input = document.querySelector(`[data-k="${key}"]`);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = value;
      if (['nex','class','origin','trail','agi','for','vig','int','pre','level'].includes(key)) needsCalc = true;
    }
    if (needsCalc && typeof calc === 'function') calc();

    for (const resource of ['PV','SAN','PE']) {
      const key = resource.toLowerCase() + 'Cur';
      if (!(key in fields)) continue;
      const card = document.querySelector(`.res[data-resource="${resource}"]`);
      if (card && typeof updateResourceCard === 'function') updateResourceCard(card);
    }
    if ('radiation' in fields) {
      const card = document.querySelector('.radiation-resource');
      if (card && typeof updateRadiationCard === 'function') updateRadiationCard(card);
    }
  }

  function applyConditionPatch(names) {
    if (!Array.isArray(names) || typeof CONDITIONS === 'undefined') return;
    CONDITIONS.forEach((name, i) => {
      const box = document.querySelector(`[data-k="cond_${i}"]`);
      if (box) box.checked = names.includes(name);
    });
    if (typeof updateConditionCount === 'function') updateConditionCount();
  }

  function receiveEquipment(item = {}) {
    if (!item.name) return;
    if (item.type === 'weapon' && typeof addRow === 'function') {
      const already = [...document.querySelectorAll('#weapons .listrow')].some(r => (r.querySelector('[data-row$="_name"]')?.value || '').toLowerCase() === String(item.name).toLowerCase());
      if (!already) addRow('weapons','weapon',{ name:item.name, test:item.test || 'Pontaria', damage:item.damage || '', crit:item.crit || '', range:item.range || '' });
    }
    if (typeof caseItems !== 'undefined' && typeof caseSequence !== 'undefined') {
      const w = Math.max(1, Math.min(6, Number(item.spaces || 1)));
      caseItems.push({
        id: caseSequence++,
        name: String(item.name),
        cat: item.type === 'weapon' ? 'ferramenta' : 'suprimento',
        w,
        h: 1,
        load: Math.max(0, Number(item.load || 0)),
        desc: String(item.desc || [item.damage && `Dano ${item.damage}`, item.crit && `Crítico ${item.crit}`, item.range].filter(Boolean).join(' • ')),
        x: -1,
        y: -1
      });
      if (typeof renderCase === 'function') renderCase();
    }
    if (typeof save === 'function') save();
    toast(`${item.name} recebido do mestre`, 1900);
  }

  function receiveRitual(data = {}) {
    const name = data.name || data.ritual;
    if (!name || typeof RITUAL_CATALOG === 'undefined') return;
    const existing = [...document.querySelectorAll('#rituals .ritual-card')].some(c => (c.dataset.ritualName || '') === name);
    if (existing) return toast(`${name} já está na ficha`, 1500);
    const item = RITUAL_CATALOG.find(r => r.name === name);
    if (!item) return toast(`Ritual não encontrado no catálogo: ${name}`, 1800);
    addRow('rituals','ritual',{...item,catalog:'1'});
    save();
    toast(`Ritual recebido: ${name}`, 1900);
  }

  function receivePower(data = {}) {
    const name = data.name || data.power;
    if (!name || typeof POWER_CATALOG === 'undefined') return;
    const existing = [...document.querySelectorAll('#powers .power-card')].some(c => (c.dataset.powerName || '') === name);
    if (existing) return toast(`${name} já está na ficha`, 1500);
    const item = POWER_CATALOG.find(p => p.name === name);
    if (!item) return toast(`Poder não encontrado no catálogo: ${name}`, 1800);
    addRow('powers','text',{name:item.name,desc:item.summary || '',catalog:'1',kind:item.type || 'Poder / habilidade'});
    save();
    toast(`Poder recebido: ${name}`, 1900);
  }

  function receiveClue(pkg) {
    const area = $('#clueImportText');
    if (!area || typeof importCluePackageFromText !== 'function') return;
    area.value = JSON.stringify(pkg);
    importCluePackageFromText(false);
    toast('Nova pista recebida do mestre', 1900);
  }

  socket.on('connect',()=>{setStatus('online',`Conectado • Mesa ${tableCode}`);if(pageReady)scheduleSync(0);});
  socket.on('disconnect',()=>setStatus('wait','Servidor desconectado • reconectando...'));
  socket.on('sync_requested',(dados={})=>{if(normalizeTableCode(dados.mesa)!==tableCode)return;if(dados.codigo&&String(dados.codigo)!==String(playerCode))return;scheduleSync(0);});
  socket.on('player:sync_request',()=>scheduleSync(0));
  socket.on('player_data_updated',(dados={})=>{
    if(String(dados.codigo||'')!==String(playerCode)||normalizeTableCode(dados.mesa)!==tableCode||!dados.fullData)return;
    applyingRemote=true;try{hydrate(dados.fullData);if(typeof save==='function')save();toast('Ficha atualizada pelo mestre',1500);}finally{applyingRemote=false;}scheduleSync(80);
  });
  socket.on('player:gm_patch',(patch={})=>{applyingRemote=true;try{applyFieldPatch(patch.fields||{});applyConditionPatch(patch.conditions);if(typeof save==='function')save();toast('Mestre atualizou sua ficha',1500);}finally{applyingRemote=false;}scheduleSync(50);});
  socket.on('player:gm_event',(event={})=>{applyingRemote=true;try{if(event.type==='equipment')receiveEquipment(event.data);else if(event.type==='ritual')receiveRitual(event.data);else if(event.type==='power')receivePower(event.data);else if(event.type==='clue')receiveClue(event.data);else if(event.type==='notice')toast(event.data?.message||'Mensagem do mestre',2400);}finally{applyingRemote=false;}scheduleSync(80);});

  function wrapLocalSave() {
    if (typeof window.save === 'function' && !window.save.__liveWrapped) {
      const original = window.save;
      const wrapped = function(...args) {
        const result = original.apply(this, args);
        if (!applyingRemote) scheduleSync();
        return result;
      };
      wrapped.__liveWrapped = true;
      window.save = wrapped;
    }
  }

  window.addEventListener('load',()=>{pageReady=true;injectUI();wrapLocalSave();updateTableUI();if(socket.connected)scheduleSync(80);});
})();
