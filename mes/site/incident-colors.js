const api=async(...args)=>(await import('./backend.js')).api(...args);
import {departmentColor} from './incident-load.js';
export const validColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
let personal={},context=()=>({}),epoch=0;
export const departmentInk=id=>personal.departments?.[id||'__none']||departmentColor(id);
const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const luminance=c=>rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
export const visibleColor=c=>validColor(c)&&luminance(c)>=.145&&luminance(c)<=.29;
export const colorDistance=(a,b)=>Math.hypot(...rgb(a).map((v,i)=>v-rgb(b)[i]));
export function countInk(ids=[]){const colors=ids.map(departmentInk);if(validColor(personal.line))return personal.line;return ['#a17c00','#887eb0','#a87058','#428c91','#b16a88','#738744'].sort((a,b)=>Math.min(...colors.map(c=>colorDistance(c,b)),500)-Math.min(...colors.map(c=>colorDistance(c,a)),500))[0];}
export function currentColors(){return structuredClone(personal);}
export async function saveColors(value){const c=context(),generation=epoch;if(!c.user)throw Error('Sign in to save personal colors.');if(!c.preview)value=await api('saveIncidentColors',value);if(generation!==epoch)return;personal=value;try{localStorage.setItem('th-mes-incident-colors:'+c.user.uid,JSON.stringify(value));}catch{}document.dispatchEvent(new Event('mes:incident-colors'));}
export function initIncidentColors(getContext){context=getContext;async function load(){const generation=++epoch,c=context();personal={};try{if(c.user)personal=JSON.parse(localStorage.getItem('th-mes-incident-colors:'+c.user.uid)||'{}');}catch{}document.dispatchEvent(new Event('mes:incident-colors'));if(!c.user||c.preview)return;try{const value=await api('getIncidentColors');if(generation!==epoch)return;personal=value;document.dispatchEvent(new Event('mes:incident-colors'));}catch{}}
 document.addEventListener('mes:identity',load);document.addEventListener('mes:refresh',load);
}
