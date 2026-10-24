import {syncAnalysisGroups} from './analysis-groups.js';
import {api} from './backend.js';
import {t} from './i18n.js';
const widgets=[['metrics','Summary metrics','#metrics'],['notices','Notice board','.broadcast-panel'],['video','Workspace video','.video-panel'],['incidents','Incident timeline','#incident-timeline'],['status','Status overview','#status-chart'],['performance','Resolution performance','#resolution-insights'],['priority','Backlog by priority','#priority-chart'],['types','Tickets by issue type','#issue-type-chart'],['department-progress','Department ticket progress','#department-progress'],['departments','By department','#department-chart'],['recent','Recent feedback','#recent-issues'],['aging','Open tickets by age','#aging-analysis'],['priority-detail','Workload by priority','#priority-analysis'],['resolution-detail','Completed tickets by handling time','#resolution-analysis'],['department-detail','Department workload and completion','#department-detail-analysis']];
let hidden=new Set(),defaults={hidden:[]},customized=false,key='viewer',generation=0;
const valid=value=>Array.isArray(value?.hidden)?value.hidden.filter(id=>widgets.some(w=>w[0]===id)):[];
export function applyDashboardPreferences(){
 for(const [id,,selector]of widgets){const element=document.querySelector(selector);if(!element)continue;const target=['metrics','notices','video','aging','priority-detail','resolution-detail','department-detail'].includes(id)?element:element.closest('article');if(target)target.hidden=hidden.has(id);}
 syncAnalysisGroups();
 for(const grid of document.querySelectorAll('#dashboard-page .chart-grid,#dashboard-page .workspace-board,#dashboard-page .dashboard-overview,#detailed-analytics'))grid.classList.toggle('widgets-empty',![...grid.children].some(c=>!c.hidden));
 const extra=document.getElementById('dashboard-extra');if(extra)extra.hidden=![...extra.querySelectorAll('.chart-grid,#detailed-analytics')].some(grid=>!grid.classList.contains('widgets-empty'));
 if(hidden.has('video'))document.getElementById('workspace-video')?.pause();
}
export async function loadDashboardPreferences(user,preview=false){
 const epoch=++generation;key=user?.uid||'viewer';let value={hidden:[],customized:false};
 try{const cached=JSON.parse(localStorage.getItem('th-mes-widgets:'+key)||'null');if(cached)value={...cached,customized:cached.customized!==false};}catch{}
 hidden=new Set(valid(value));customized=value.customized;applyDashboardPreferences();
 try{
  let stored;
  if(user&&!preview){stored=await api('getDashboardPreferences');if(epoch!==generation)return;if(stored.customized===false)defaults={hidden:valid(stored)};}
  else{const global=preview?defaults:await api('getDashboardDefaults');if(epoch!==generation)return;defaults={hidden:valid(global)};stored=customized?value:{...defaults,customized:false};}
  if(epoch!==generation)return;customized=stored.customized!==false;hidden=new Set(valid(stored));localStorage.setItem('th-mes-widgets:'+key,JSON.stringify({...stored,customized}));applyDashboardPreferences();
 }catch{}
}
export function initDashboardPreferences(getContext){
 const button=document.createElement('button');button.className='button';button.type='button';button.id='customize-dashboard';button.textContent='Customize dashboard';document.querySelector('#dashboard-page .heading-actions').prepend(button);
 const dialog=document.createElement('dialog');dialog.id='dashboard-preferences';dialog.innerHTML='<h2>Customize dashboard</h2><p>Select the widgets to show. Your choices do not change ticket data.</p><form><div id="widget-options"></div><div class="account-actions"><button type="submit" class="button primary">Save layout</button><button type="button" id="widgets-reset" class="button">Use administrator defaults</button><button type="button" id="widgets-all" class="button">Show all</button><button type="button" id="widgets-cancel" class="button">Cancel</button></div><p id="widgets-status" role="status"></p></form>';document.body.append(dialog);
 const card=document.createElement('article');card.id='widget-defaults-card';card.className='card';card.hidden=true;card.innerHTML='<h2>Default dashboard widgets</h2><p>Checked widgets appear by default. Users can enable other widgets in Customize dashboard. Existing personal layouts are preserved.</p><form><div id="default-widget-options"></div><button class="button primary">Save defaults</button><p role="status"></p></form>';document.querySelector('#settings-page .page-heading').after(card);
 const fill=(list,excluded)=>{list.replaceChildren();for(const [id,title]of widgets){const label=document.createElement('label');label.className='checkbox';const input=document.createElement('input');input.type='checkbox';input.value=id;input.checked=!excluded.has(id);label.append(input,document.createTextNode(t(title)));list.append(label);}};
 const selected=list=>({hidden:[...list.querySelectorAll('input')].filter(c=>!c.checked).map(c=>c.value)});
 const status=dialog.querySelector('#widgets-status');
 button.onclick=()=>{fill(dialog.querySelector('#widget-options'),hidden);status.textContent='';dialog.showModal();};dialog.querySelector('#widgets-cancel').onclick=()=>dialog.close();dialog.querySelector('#widgets-all').onclick=()=>dialog.querySelectorAll('input').forEach(c=>c.checked=true);
 async function savePersonal(reset=false){const epoch=generation,savedKey=key,context=getContext();const controls=[...dialog.querySelectorAll('button')];controls.forEach(b=>b.disabled=true);
  try{let value=reset?{...defaults,customized:false}:{...selected(dialog.querySelector('#widget-options')),customized:true};if(context.user&&!context.preview)value=await api(reset?'resetDashboardPreferences':'saveDashboardPreferences',value);if(epoch!==generation)return;const nextHidden=valid(value),enabledExtra=!reset&&[...hidden].some(id=>!nextHidden.includes(id)&&!['metrics','notices','video','incidents','status','performance','recent'].includes(id));customized=value.customized!==false;hidden=new Set(nextHidden);if(enabledExtra){const extra=document.getElementById('dashboard-extra');if(extra)extra.open=true;}localStorage.setItem('th-mes-widgets:'+savedKey,JSON.stringify({...value,customized}));applyDashboardPreferences();dialog.close();}catch{status.textContent=t('Could not save layout. Please try again.');}finally{controls.forEach(b=>b.disabled=false);}
 }
 dialog.querySelector('form').onsubmit=event=>{event.preventDefault();savePersonal();};dialog.querySelector('#widgets-reset').onclick=()=>savePersonal(true);
 let identityEpoch=0,adminKey=null;
 document.addEventListener('mes:identity',async()=>{const context=getContext(),identity=context.isAdmin?(context.user?.uid||'preview'):null;card.hidden=!context.isAdmin;if(identity===adminKey)return;adminKey=identity;const epoch=++identityEpoch;if(card.hidden)return;try{const value=getContext().preview?defaults:await api('getDashboardDefaults');if(epoch!==identityEpoch)return;defaults={hidden:valid(value)};fill(card.querySelector('#default-widget-options'),new Set(defaults.hidden));}catch{card.querySelector('[role=status]').textContent=t('Could not load widget defaults.');}});
 card.querySelector('form').onsubmit=async event=>{event.preventDefault();const submit=card.querySelector('button');submit.disabled=true;try{const value=selected(card.querySelector('#default-widget-options'));if(!getContext().preview)await api('saveDashboardDefaults',value);defaults=value;if(!customized){hidden=new Set(value.hidden);applyDashboardPreferences();}card.querySelector('[role=status]').textContent=t('Widget defaults saved.');}catch{card.querySelector('[role=status]').textContent=t('Could not save layout. Please try again.');}finally{submit.disabled=false;}};
}
