// A drive path is displayed/copied, never fetched by the server or assigned to href.
export function accessLink(value){
 if(typeof value!=='string'||!value.trim()||value.length>2000||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Enter a valid web address or drive path.');
 const url=value.trim();
 if(/^\\\\[^\\/]+\\[^\\/]+(?:[\\/].*)?$/.test(url)||/^[A-Za-z]:[\\/]/.test(url)||/^file:\/\//i.test(url)){
  if(/^file:\/\//i.test(url)){let parsed;try{parsed=new URL(url);}catch{throw new Error('Enter a valid drive path.');}if(parsed.username||parsed.password)throw new Error('Do not include credentials in a link.');}
  return {url,kind:'drive'};
 }
 if(url.startsWith('/')&&!url.startsWith('//')&&!url.includes('\\'))return {url,kind:'web'};
 let parsed;try{parsed=new URL(url);}catch{throw new Error('Use http:// or https:// for internal web addresses.');}
 if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('Only HTTP(S) web addresses and copyable drive paths are supported.');
 return {url:parsed.href,kind:'web'};
}
