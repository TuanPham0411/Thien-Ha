import Quill from 'quill';
import 'quill/dist/quill.core.css';
import { normalizeDocument, documentText, FONT_SIZES, FONT_FAMILIES } from './rich-document.js';
import { t } from './i18n.js';
const Size = Quill.import('attributors/style/size'); Size.whitelist = FONT_SIZES; Quill.register(Size,true);
const Font = Quill.import('formats/font'); Font.whitelist=Object.keys(FONT_FAMILIES); Quill.register(Font,true);
const BaseImage = Quill.import('formats/image');
class LocalImage extends BaseImage { static sanitize(value) { return typeof value === 'string' && (value.startsWith('blob:') || /^\/api\/mes\/attachments\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,128}$/.test(value)) ? value : '//:0'; } }
Quill.register(LocalImage,true);
const Delta = Quill.import('delta');
export function createRichEditor(textarea, { files, addImages, slotForFile, imageForSlot, notice }) {
  textarea.hidden = true; textarea.required = false;
  const shell = document.createElement('div'); shell.className = 'rich-editor-shell';
  const toolbar = document.createElement('div'); toolbar.className = 'rich-toolbar'; toolbar.setAttribute('role','toolbar'); toolbar.setAttribute('aria-label','Text formatting');
  const body = document.createElement('div'); body.dataset.userContent='';
  shell.append(toolbar,body); textarea.before(shell);
  const q = new Quill(body, {modules:{history:{userOnly:true}},formats:['bold','italic','underline','strike','font','size','header','list','align','indent','blockquote','color','background','image'],placeholder:t(textarea.id==='description-input'?'MO / Serial / Process code / OP number / Product / Station: … Describe the issue and attach a photo or video.':'Write feedback…')});
  if(textarea.getAttribute('aria-describedby'))q.root.setAttribute('aria-describedby',textarea.getAttribute('aria-describedby'));
  q.root.setAttribute('role','textbox'); q.root.setAttribute('aria-multiline','true'); q.root.setAttribute('aria-label',t('Feedback'));
  let range = {index:0,length:0}, serial = 0;
  const images = new Map(), ownUrls = new Set(), controls = [];
  q.on('selection-change', r=>{if(r)range=r; updateButtons();});
  q.on('text-change', ()=>{ sync(); updateButtons(); });
  function sync() { textarea.value = q.getText().trim() || (q.getContents().ops.some(o=>o.insert?.image)?'Image feedback':''); textarea.dispatchEvent(new Event('input',{bubbles:true})); }
  function focus() { q.focus(); q.setSelection(Math.min(range.index,q.getLength()-1),range.length,'silent'); }
  function button(label, text, action) {
    const b = document.createElement('button'); b.type='button'; b.textContent=text; b.title=label; b.setAttribute('aria-label',label);
    b.addEventListener('mousedown',e=>e.preventDefault()); b.onclick=()=>{focus();action();sync();updateButtons();}; toolbar.append(b); return b;
  }
  function select(label, values, apply) {
    const select=document.createElement('select'); select.setAttribute('aria-label',label); select.title=label;
    for(const [value,text] of values){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
    select.onchange=()=>{focus();apply(select.value);};toolbar.append(select);return select;
  }
  const font=select('Font',[['','Calibri (default)'],['arial','Arial'],['cambria','Cambria'],['georgia','Georgia'],['times','Times New Roman'],['tahoma','Tahoma'],['verdana','Verdana'],['trebuchet','Trebuchet MS'],['segoe','Segoe UI'],['courier','Courier New'],['consolas','Consolas'],['serif','Serif'],['monospace','Monospace']],v=>q.format('font',v||false));
  const size=select('Font size',[['','Default size'],...FONT_SIZES.map(v=>[v,v.replace('px','')])],v=>q.format('size',v||false));
  const style=select('Text style',[['','Paragraph'],['1','Heading 1'],['2','Heading 2'],['3','Heading 3']],v=>q.format('header',v?Number(v):false));
  for(const [key,label,text] of [['bold','Bold','B'],['italic','Italic','I'],['underline','Underline','U'],['strike','Strikethrough','S']]) {
    const b=button(label,text,()=>q.format(key,!q.getFormat()[key])); b.dataset.format=key;controls.push(b);
  }
  button('Bullet list','• List',()=>q.format('list',q.getFormat().list==='bullet'?false:'bullet'));
  button('Numbered list','1. List',()=>q.format('list',q.getFormat().list==='ordered'?false:'ordered'));
  button('Align left','⇤',()=>q.format('align',false)); button('Align center','↔',()=>q.format('align','center'));button('Align right','⇥',()=>q.format('align','right'));
  const color=document.createElement('input');color.type='color';color.value='#263a56';color.title='Text color';color.setAttribute('aria-label','Text color');color.oninput=()=>{focus();q.format('color',color.value);};toolbar.append(color);
  const highlight=document.createElement('input');highlight.type='color';highlight.value='#fff1a8';highlight.title='Highlight color';highlight.setAttribute('aria-label','Highlight color');highlight.oninput=()=>{focus();q.format('background',highlight.value);};toolbar.append(highlight);
  button('No highlight','◩',()=>q.format('background',false));
  button('Align justify','☰',()=>q.format('align','justify'));
  button('Indent','→',()=>q.format('indent','+1'));button('Outdent','←',()=>q.format('indent','-1'));
  button('Quote','❝',()=>q.format('blockquote',!q.getFormat().blockquote));
  button('Clear formatting','Tx',()=>q.removeFormat(range.index,range.length));
  button('Undo','↶',()=>q.history.undo());button('Redo','↷',()=>q.history.redo());
  const picker=document.createElement('input');picker.type='file';picker.accept='.jpg,.jpeg,.png,.webp';picker.multiple=true;picker.hidden=true;
  const imageButton=button('Insert image','＋ Image',()=>picker.click());shell.append(picker);
  async function insertFiles(chosen) {
    try {
      const generation=serial;
      const allowed=await addImages([...chosen]);
      if(generation!==serial)return;
      focus();let index=q.getSelection()?.index ?? q.getLength()-1;
      for(const file of allowed){const url=URL.createObjectURL(file);ownUrls.add(url);images.set(url,{file});q.insertEmbed(index,'image',url,'user');index+=1;}
      q.setSelection(index,0,'silent');range={index,length:0};sync();
    }catch(e){notice(e.message);}
  }
  picker.onchange=()=>{insertFiles(picker.files);picker.value='';};
  q.clipboard.addMatcher('IMG',()=>new Delta());
  q.root.addEventListener('paste',event=>{const found=[...(event.clipboardData?.files||[])];if(found.length){event.preventDefault();event.stopImmediatePropagation();insertFiles(found);}},true);
  q.root.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
  q.root.addEventListener('drop',event=>{if(event.dataTransfer?.files.length){event.preventDefault();event.stopImmediatePropagation();insertFiles(event.dataTransfer.files);}},true);
  function updateButtons(){const index=Math.max(0,Math.min(range.index,q.getLength()-1)),length=Math.max(0,Math.min(range.length,q.getLength()-1-index));const format=q.getFormat(index,length);for(const b of controls)b.setAttribute('aria-pressed',String(!!format[b.dataset.format]));font.value=format.font||'';size.value=format.size||'';style.value=String(format.header||'');}
  return {
    root:q.root,
    getDocument(){
      return normalizeDocument({version:1,ops:q.getContents().ops.map(op=>{
        if(typeof op.insert==='object'){
          const entry=images.get(op.insert.image);const slot=entry?.file?slotForFile(entry.file):entry?.slot;
          if(!Number.isInteger(slot)||slot<0)throw new Error('Remove the inline image whose attachment was removed.');
          return {insert:{image:slot}};
        }
        return op;
      })});
    },
    async setDocument(doc,plain=''){
      const generation=++serial; images.clear();for(const url of ownUrls)URL.revokeObjectURL(url);ownUrls.clear();
      if(!doc){q.setText(plain);q.history.clear();sync();return;}
      const safe=normalizeDocument(doc);const ops=[];
      for(const op of safe.ops){if(typeof op.insert==='object'){
        try{const url=await imageForSlot(op.insert.image);if(generation!==serial)return;images.set(url,{slot:op.insert.image});ops.push({insert:{image:url}});}catch{images.set('blob:missing-image',{slot:op.insert.image});ops.push({insert:{image:'blob:missing-image'}});}
      }else ops.push(op);}
      if(generation!==serial)return;q.setContents({ops});q.history.clear();sync();
    },
    reset(){serial++;q.setText('');q.history.clear();images.clear();for(const url of ownUrls)URL.revokeObjectURL(url);ownUrls.clear();textarea.value='';},
    removeSlot(slot){const ops=q.getContents().ops.filter(op=>{const entry=images.get(op.insert?.image);return !entry||((entry.file?slotForFile(entry.file):entry.slot)!==slot);});q.setContents({ops},'user');sync();},
    replaceSlot(slot,file){const url=URL.createObjectURL(file);ownUrls.add(url);images.set(url,{slot});const ops=q.getContents().ops.map(op=>{const entry=images.get(op.insert?.image);return entry&&(entry.file?slotForFile(entry.file):entry.slot)===slot?{...op,insert:{image:url}}:op;});q.setContents({ops},'user');sync();},
    removeFile(file){const ops=q.getContents().ops.filter(op=>!(op.insert?.image && images.get(op.insert.image)?.file===file));q.setContents({ops},'user');sync();},
    setLanguage(){q.root.dataset.placeholder=t('Write feedback…');q.root.setAttribute('aria-label',t('Feedback'));},
  };
}
