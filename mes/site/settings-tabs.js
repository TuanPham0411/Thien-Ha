import {t} from './i18n.js';
export function initSettingsTabs(getContext){
 const page=document.getElementById('settings-page'),nav=document.createElement('nav');nav.className='settings-tabs';nav.setAttribute('aria-label','Administration sections');page.querySelector('.page-heading').after(nav);
 const definitions=[['general','General','.settings-grid,.publishing-grid,.users-card'],['widgets','Default dashboard widgets','#widget-defaults-card'],['links','Links and network drives','.content-tabs-admin'],['storage','Storage and backup','.admin-upgrade,.drive-storage'],['wifi','Raspberry Pi Wi-Fi','#wifi-settings']];let selected='general';
 const groups=definitions.map(([id,title,selector])=>{const section=document.createElement('section');section.id='settings-tab-'+id;section.className='settings-tab';for(const node of [...page.querySelectorAll(selector)])section.append(node);page.append(section);const button=document.createElement('button');button.type='button';button.className='button';button.textContent=t(title);button.onclick=()=>{selected=id;render();};nav.append(button);return {id,section,button};});
 function render(){const context=getContext();if(!context.isOwner&&selected!=='widgets')selected='widgets';for(const group of groups){const allowed=context.isOwner||(group.id==='widgets'&&context.isAdmin);group.button.hidden=!allowed;group.button.setAttribute('aria-pressed',String(group.id===selected));group.section.hidden=!allowed||selected!==group.id;}}
 document.addEventListener('mes:identity',render);document.addEventListener('mes:navigate',render);render();
}
