/* Tamanhos inspirados na organização de maleta de RE4; carga de Ordem permanece separada. */
(function () {
  'use strict';
  const key = name => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const sizes = {
    soqueira:[2,1],faca:[2,1],machado:[3,2],machete:[3,1],martelo:[2,2],marreta:[3,2],
    'espada da ordem':[4,1],'serra eletrica':[4,2],'pistola antiga':[2,2],revolver:[3,2],
    'pistola semiautomatica':[2,2],escopeta:[4,2],'escopeta (cano serrado)':[3,2],
    'rifle de caca':[5,2],'rifle de precisao':[5,2],'rifle de assalto':[4,2],balestra:[4,2]
  };
  const source = window.RPG_CATALOG || {};
  const weapons = [...(source.meleeWeapons || []),...(source.rangedWeapons || [])];
  const byName = new Map(weapons.map(x => [key(x.name),x]));
  function metadata(item) {
    const catalog=byName.get(key(item.name));
    if(!catalog && item.type!=='weapon' && !item.weapon && !item.catalogDetails?.damage)return null;
    const info=item.weapon || item.catalogDetails || {};
    return {damage:info.damage || item.damage || catalog?.dmg || '',crit:info.crit || item.crit || catalog?.crit || '',range:info.range || item.range || catalog?.range || '',skill:info.skill || item.test || catalog?.skill || 'Pontaria',ammo:info.ammo || item.ammo || catalog?.ammo || '',capacity:info.capacity ?? item.capacity ?? catalog?.capacity,attacks:info.attacks ?? item.atk ?? catalog?.atk,image:info.image || item.img || catalog?.img || ''};
  }
  function upgrade(item) {
    const weapon=metadata(item);if(!weapon)return false;
    item.weapon=weapon;item.type='weapon';
    if(item.re4Version===1)return false;
    const dimensions=sizes[key(item.name)] || (weapon.skill==='Luta'?[3,1]:[3,2]);
    item.w=dimensions[0];item.h=dimensions[1];item.re4Version=1;item.equipped=!!item.equipped;
    return true;
  }
  function restore(item,row={}) {
    if(row.catalogDetails)item.catalogDetails={...row.catalogDetails};
    if(row.weapon)item.weapon={...row.weapon};
    if(row.type==='weapon')item.type='weapon';
    item.re4Version=row.re4Version;item.equipped=!!row.equipped;
    upgrade(item);
    return item;
  }
  function serialize(item) {
    return {type:item.type,weapon:item.weapon ? {...item.weapon}:undefined,catalogDetails:item.catalogDetails ? {...item.catalogDetails}:undefined,re4Version:item.re4Version,equipped:!!item.equipped};
  }
  window.RE4Weapons={upgrade,restore,serialize,metadata,sizes};
})();
