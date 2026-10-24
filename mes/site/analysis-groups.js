import {t} from './i18n.js';
let identity='viewer',choices={};
const key=()=>`th-mes-analysis-views:${identity}`;
export function initAnalysisGroups(getContext){
 document.addEventListener('mes:identity',()=>{const context=getContext(),next=context.preview?'preview':context.user?.uid||'viewer';if(next===identity)return;identity=next;try{choices=JSON.parse(localStorage.getItem(key())||'{}');}catch{choices={};}syncAnalysisGroups();});
 try{choices=JSON.parse(localStorage.getItem(key())||'{}');}catch{choices={};}
}
export function analysisGroup(id,title,panels){
 const card=document.createElement('article');card.className='card analysis-group';card.id=id;const heading=document.createElement('h2');heading.textContent=t(title);card.append(heading);
 const tabs=document.createElement('div');tabs.className='analysis-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t(title));card.append(tabs);
 for(const [label,panel]of panels){panel.classList.add('analysis-panel');panel.setAttribute('role','tabpanel');const button=document.createElement('button');button.type='button';button.id=id+'-'+panel.id+'-tab';button.textContent=t(label);button.dataset.panel=panel.id;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',button.id);button.onclick=()=>{choices[id]=panel.id;try{localStorage.setItem(key(),JSON.stringify(choices));}catch{}syncAnalysisGroups();};button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const available=[...tabs.children].filter(b=>!b.hidden),index=available.indexOf(button),next=event.key==='Home'?0:event.key==='End'?available.length-1:(index+(event.key==='ArrowLeft'?-1:1)+available.length)%available.length;available[next].click();available[next].focus();};tabs.append(button);card.append(panel);}
 return card;
}
export function syncAnalysisGroups(){
 for(const group of document.querySelectorAll('.analysis-group')){const panels=[...group.querySelectorAll(':scope > .analysis-panel')],available=panels.filter(p=>!p.hidden),selected=available.find(p=>p.id===choices[group.id])||available[0];group.hidden=!selected;
  for(const panel of panels){const active=panel===selected;panel.dataset.tabVisible=String(active);const button=document.getElementById(group.id+'-'+panel.id+'-tab');button.hidden=panel.hidden;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
 }
 for(const row of document.querySelectorAll('.dashboard-analysis-row'))row.hidden=![...row.children].some(c=>!c.hidden);
}
