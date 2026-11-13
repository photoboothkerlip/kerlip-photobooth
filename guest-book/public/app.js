const app=document.querySelector('#app');
const notice=document.querySelector('#notice');
const element=(tag,text='',className='')=>{
  const node=document.createElement(tag);node.textContent=text;node.className=className;return node;
};
function append(parent,...children){parent.append(...children);return parent;}
function link(text,url){const a=element('a',text,'button');a.href=url;return a;}
function button(text,handler,className=''){
  const b=element('button',text,className);b.type='button';b.onclick=handler;return b;
}
function image(url,alt,className=''){const img=element('img','',className);img.src=url;img.alt=alt;return img;}
async function api(path,data){
  const options=data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)};
  const res=await fetch('/api'+path,options);
  const result=await res.json();
  if(!res.ok) throw Object.assign(new Error(result.error),{status:res.status});
  return result;
}
function showError(error){notice.textContent=error.message;notice.className='error';}
function form(fields,label,onSubmit){
  const root=element('form'),inputs={};
  for(const [key,title,type,max,placeholder] of fields){
    const caption=element('label',title);
    const input=element(type==='textarea'?'textarea':'input');
    input.id=key;input.name=key;input.required=true;
    if(type!=='textarea') input.type=type;
    if(max) input.maxLength=max;
    if(placeholder) input.placeholder=placeholder;
    if(key==='pin') input.inputMode='numeric';
    if(key==='password') input.autocomplete='current-password';
    if(key==='name') input.autocomplete='off';
    caption.htmlFor=key;
    inputs[key]=input;root.append(caption,input);
  }
  const submit=element('button',label,'primary full');
  submit.style.marginTop='16px';
  const status=element('p','','status');status.setAttribute('role','status');
  root.append(submit,status);
  root.onsubmit=async event=>{
    event.preventDefault();status.textContent='';status.className='status';submit.disabled=true;
    try{await onSubmit(Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])),root,status);}
    catch(error){status.textContent=error.message;status.className='status error';}
    finally{submit.disabled=false;}
  };
  return root;
}
const dateLabel=date=>new Intl.DateTimeFormat('en-MY',{dateStyle:'long',timeZone:'UTC'}).format(new Date(date));
const photoUrl=(role,id,photo)=>'/api/'+role+'/'+id+'/photo/'+photo;
async function guest(id){
  const event=await api('/guest/'+id);
  const layout=element('div','','layout guest-layout'),hero=element('section','','hero');
  if(event.cover) hero.style.backgroundImage='linear-gradient(0deg,#21150bea,transparent 80%),url('+photoUrl('guest',id,event.cover)+')';
  hero.append(append(element('div'),element('p',dateLabel(event.date)),element('h1',event.name),element('p','Leave a little memory from tonight.')));
  const panel=append(element('section','','panel'),element('h2','Sign the guest book'),element('p','Choose a booth photo, upload your own, or leave a message on its own.','muted'));
  let selected=null, current='';
  let upload=null, preparing=false;
  const picker=element('input'), preview=element('div'), uploadStatus=element('p','','status');
  picker.type='file';picker.accept='image/jpeg,image/png,image/webp';picker.hidden=true;
  uploadStatus.setAttribute('role','status');
  const uploadButton=button('Upload photo',()=>picker.click(),'guest-upload');
  function clearUpload(){
    upload=null;preview.replaceChildren();uploadStatus.textContent='';
  }
  const choices=element('div','','choices');
  choices.setAttribute('role','group');choices.setAttribute('aria-label','Choose a booth photo');
  function renderPhotos(photos,force=false){
    const signature=photos.map(p=>p.id).join(',');
    if(!force && current===signature)return;
    current=signature;
    if(selected && !photos.some(p=>p.id===selected))selected=null;
    choices.replaceChildren();
    for(const [index,photo] of [{id:''},...photos].entries()){
      const item=button(index?'Photo '+index:'Message only',()=>{
        if(preparing)return;
        clearUpload();
        selected=photo.id;
        for(const option of choices.children) option.setAttribute('aria-pressed',String(option===item));
      });
      item.setAttribute('aria-pressed',String(selected===photo.id));
      if(photo.id)item.prepend(image(photoUrl('guest',id,photo.id),''));
      choices.append(item);
    }
  }
  renderPhotos(event.photos,true);
  picker.onchange=async()=>{
    const file=picker.files[0];
    if(!file)return;
    picker.value='';preparing=true;uploadButton.disabled=true;
    uploadStatus.textContent='Preparing photo.';
    try{
      upload=await convert(file);
      selected=null;renderPhotos(event.photos,true);
      preview.replaceChildren(image(upload,'Your selected photo','art'),button('Remove uploaded photo',clearUpload));
      uploadStatus.textContent='Photo ready to attach.';
    }catch{
      uploadStatus.textContent='Could not open this photo. Try a JPG, PNG or WebP.';
    }finally{preparing=false;uploadButton.disabled=false;}
  };
  const signing=form([['name','Your name','text',60],['message','Your message','textarea',300,event.prompt]],'Sign guest book',async(data,root,status)=>{
    if(preparing)throw new Error('Wait for your photo to finish loading.');
    if(selected===null && !upload)throw new Error('Choose a booth photo, upload a photo, or select Message only.');
    uploadButton.disabled=true;
    try{await api('/guest/'+id+'/sign',{...data,photo:selected,upload});}
    finally{uploadButton.disabled=false;}
    root.reset();clearUpload();selected=null;renderPhotos(event.photos,true);
    status.textContent='Thank you, '+data.name.trim()+'! Your entry is saved.';
  });
  panel.append(uploadButton,picker,uploadStatus,preview,choices,signing);app.replaceChildren(append(layout,hero,panel));
  setInterval(async()=>{
    try{event.photos=(await api('/guest/'+id)).photos;renderPhotos(event.photos);}
    catch{ /* Keep the current choices if Wi-Fi briefly drops. */ }
  },5000);
}
function fieldLink(label,path){
  const wrapper=element('div'),caption=element('label',label),input=element('input','','link-field');
  input.value=new URL(path,location.origin).href;input.readOnly=true;
  input.id=label.toLowerCase().replaceAll(' ','-');caption.htmlFor=input.id;
  input.onclick=()=>input.select();
  return append(wrapper,caption,input);
}
async function crewHome(){
  let events;
  try{events=await api('/crew/events');}
  catch(error){
    if(error.status!==401)throw error;
    const gate=append(element('section','','panel gate'),element('h1','Crew sign-in'));
    gate.append(form([['password','Crew password','password',200]],'Sign in',async data=>{await api('/crew/login',data);await crewHome();}));
    app.replaceChildren(gate);return;
  }
  const list=append(element('section','','panel'),element('h2','Your events'));
  for(const event of events) list.append(append(element('div','','row'),append(element('div'),element('strong',event.name),element('p',dateLabel(event.date),'muted')),link('Manage','/crew/'+event.id)));
  const create=append(element('section','','panel'),element('h2','Create an event'));
  create.append(form([['name','Event name','text',100],['date','Event date','date'],['prompt','Guest message prompt','text',180,'What made tonight memorable?'],['pin','Organiser PIN (4-10 digits)','password',10]],'Create event',async data=>{
    const event=await api('/crew/events',data);location.assign('/crew/'+event.id);
  }));
  app.replaceChildren(element('h1','Crew dashboard'),append(element('div','','layout'),list,create));
}
async function convert(file){
  const bitmap=await createImageBitmap(file);
  try {
    const canvas=document.createElement('canvas'),scale=Math.min(1,1500/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d',{alpha:false});context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    for(const quality of [.88,.72,.52,.32]){
      const jpeg=canvas.toDataURL('image/jpeg',quality);
      if(jpeg.length<1190000)return jpeg;
    }
    throw new Error('Photo could not be resized below the upload limit.');
  } finally {bitmap.close();}
}
function uploader(id,cover,refresh){
  const input=element('input'),wrap=element('div'),status=element('p','','status');
  input.type='file';input.accept='image/jpeg,image/png,image/webp';input.multiple=!cover;
  const label=element('label',cover?'Event cover photo':'Booth photos (up to 12 per upload)');
  input.id=cover?'cover-upload':'booth-upload';label.htmlFor=input.id;
  status.setAttribute('role','status');
  input.onchange=async()=>{
    const files=Array.from(input.files);
    if(!files.length)return;
    input.disabled=true;status.textContent='Uploading.';status.className='status';
    try{
      if(files.length>12)throw new Error('Choose up to 12 photos at a time.');
      const payload=[];
      for(const file of files)payload.push(await convert(file));
      await api('/crew/'+id+'/photos',{cover,files:payload});
      status.textContent=files.length===1?'Photo uploaded.':files.length+' photos uploaded.';
      await refresh();
    }catch(error){status.textContent=error.message;status.className='status error';}
    finally{input.value='';input.disabled=false;}
  };
  return append(wrap,label,input,status);
}
async function crewEvent(id){
  let event;
  try{event=await api('/crew/'+id);}catch(error){if(error.status===401){await crewHome();return;}throw error;}
  const head=append(element('div','','bar'),element('h1',event.name),link('All events','/crew'));
  const left=append(element('section','','panel'),element('h2','Event setup'));
  const cover=element('div');
  const right=append(element('section','','panel'),element('h2','Guest entries'));
  const rows=element('div');
  const refresh=async()=>{
    event=await api('/crew/'+id);
    cover.replaceChildren();
    if(event.cover)cover.append(image(photoUrl('crew',id,event.cover),'Event cover','art'));
    rows.replaceChildren();
    if(!event.entries.length)rows.append(element('p','Entries will appear here.','muted'));
    for(const entry of event.entries){
      const toggle=button(entry.hidden?'Restore':'Hide',async()=>{
        toggle.disabled=true;
        try{await api('/crew/'+id+'/visibility',{entry:entry.id,hidden:!entry.hidden});await refresh();}
        catch(error){showError(error);toggle.disabled=false;}
      });
      const details=append(element('div'),element('strong',entry.name+(entry.hidden?' � Hidden':'')),element('p',entry.message,'muted'));
      if(entry.photo) details.append(image(photoUrl('crew',id,entry.photo),'Attached photo','art'));
      rows.append(append(element('div','','row'),details,toggle));
    }
  };
  left.append(cover,fieldLink('Guest tablet link','/guest/'+id),fieldLink('Organiser album link','/album/'+event.album),uploader(id,true,refresh),uploader(id,false,refresh));
  right.append(button('Refresh entries',()=>refresh().catch(showError)),rows);
  app.replaceChildren(head,append(element('div','','layout'),left,right));
  await refresh();
}
async function album(id){
  const root='/album/'+id;
  let event;
  try{event=await api(root);}
  catch(error){
    if(error.status!==401)throw error;
    const gate=append(element('section','','panel gate'),element('h1','Private guest book'));
    gate.append(form([['pin','Album PIN','password',10]],'Open album',async data=>{await api(root+'/unlock',data);await album(id);}));
    app.replaceChildren(gate);return;
  }
  const download=button('Download PDF',async()=>{
    download.disabled=true;notice.textContent='Preparing PDF.';notice.className='';
    try{await downloadPdf(await api(root),id);notice.textContent='';}
    catch(error){showError(error);}
    finally{download.disabled=false;}
  },'primary');
  const head=append(element('div','','bar'),append(element('div'),element('h1',event.name),element('p','Private organiser album � '+dateLabel(event.date),'muted')),download);
  const gallery=element('section','','cards');
  function renderCards(entries){
  gallery.replaceChildren();
  for(const entry of entries){
    const card=element('article','','card');
    if(entry.photo)card.append(image(photoUrl('album',id,entry.photo),'Booth photo from '+entry.name));
    card.append(append(element('div'),element('p',entry.message),element('cite','- '+entry.name)));
    gallery.append(card);
  }
  if(!entries.length)gallery.append(element('p','There are no visible entries yet.'));
  }
  renderCards(event.entries);
  app.replaceChildren(head);
  if(event.cover)app.append(image(photoUrl('album',id,event.cover),'Event cover','art'));
  app.append(gallery);
  let signature=JSON.stringify(event.entries);
  setInterval(async()=>{
    try{
      const latest=await api(root),next=JSON.stringify(latest.entries);
      if(next!==signature){signature=next;renderCards(latest.entries);}
    }catch(error){
      if(error.status===401)location.reload();
    }
  },4000);
}
async function loadImage(url){
  const img=image(url,'');
  await img.decode();
  return img;
}
function writeLines(context,text,x,y,width,step){
  const lines=[];
  let line='';
  for(const word of text.trim().split(/\s+/)){
    const next=line?line+' '+word:word;
    if(context.measureText(next).width<=width){line=next;continue;}
    if(line)lines.push(line);
    line='';
    for(const character of word){
      if(context.measureText(line+character).width>width){lines.push(line);line='';}
      line+=character;
    }
  }
  lines.push(line);
  for(const value of lines){context.fillText(value,x,y);y+=step;}
  return y;
}
function coverImage(context,img,x,y,w,h){
  const ratio=Math.max(w/img.width,h/img.height),sw=w/ratio,sh=h/ratio;
  context.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,x,y,w,h);
}
async function downloadPdf(event,id){
  const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1414;
  const ctx=canvas.getContext('2d'),pages=[];
  const cover=event.cover?await loadImage(photoUrl('album',id,event.cover)):null;
  const entries=event.entries.length?event.entries:[null];
  for(let start=0;start<entries.length;start+=2){
    ctx.fillStyle='#fffaf3';ctx.fillRect(0,0,1000,1414);
    ctx.fillStyle='#38261c';ctx.font='24px Georgia';ctx.fillText('KERLIP DIGITAL GUEST BOOK',56,65);
    ctx.font='45px Georgia';const titleEnd=writeLines(ctx,event.name,56,124,888,51);
    ctx.font='22px system-ui';ctx.fillText(dateLabel(event.date),56,titleEnd-10);
    if(cover)coverImage(ctx,cover,56,titleEnd+13,888,185);
    let y=titleEnd+(cover?230:40);
    for(const entry of entries.slice(start,start+2)){
      ctx.strokeStyle='#c9ab7c';ctx.strokeRect(56,y,888,340);
      if(entry){
        if(entry.photo)coverImage(ctx,await loadImage(photoUrl('album',id,entry.photo)),76,y+20,310,300);
        const x=entry.photo?410:80,width=entry.photo?505:830;
        ctx.fillStyle='#38261c';ctx.font='20px Georgia';
        const end=writeLines(ctx,entry.message,x,y+44,width,23);
        ctx.font='italic 19px Georgia';writeLines(ctx,'- '+entry.name,x,end+8,width,22);
      }else{ctx.fillStyle='#38261c';ctx.fillText('There are no visible entries yet.',80,y+60);}
      y+=364;
    }
    const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.89));
    if(!jpeg)throw new Error('Could not generate PDF page.');
    pages.push(new Uint8Array(await jpeg.arrayBuffer()));
  }
  const pdf=makePdf(pages);
  const url=URL.createObjectURL(pdf),anchor=element('a');
  anchor.href=url;anchor.download=(event.name.replace(/[^\p{L}\p{N}]+/gu,'-')||'Kerlip')+'-Guest-Book.pdf';
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function makePdf(pages){
  const encoder=new TextEncoder(),chunks=[],offsets=[0];
  let size=0;
  function add(value){const bytes=typeof value==='string'?encoder.encode(value):value;chunks.push(bytes);size+=bytes.length;}
  function object(id,...values){offsets[id]=size;add(id+' 0 obj\n');values.forEach(add);add('\nendobj\n');}
  add('%PDF-1.4\n');
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,'<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,index)=>(3+index*3)+' 0 R').join(' ')+'] >>');
  pages.forEach((jpeg,index)=>{
    const id=3+index*3,paint='q 595 0 0 842 0 0 cm /Photo Do Q\n';
    object(id,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Photo '+(id+1)+' 0 R >> >> /Contents '+(id+2)+' 0 R >>');
    object(id+1,'<< /Type /XObject /Subtype /Image /Width 1000 /Height 1414 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n',jpeg,'\nendstream');
    object(id+2,'<< /Length '+paint.length+' >>\nstream\n'+paint+'endstream');
  });
  const xref=size;
  add('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');
  for(const offset of offsets.slice(1))add(String(offset).padStart(10,'0')+' 00000 n \n');
  add('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
  return new Blob(chunks,{type:'application/pdf'});
}
async function main(){
  const [,role,id]=location.pathname.split('/');
  if(role==='guest' && id)await guest(id);
  else if(role==='album' && id)await album(id);
  else if(role==='crew' && id)await crewEvent(id);
  else if(role==='crew')await crewHome();
  else{
    const gate=append(element('section','','panel gate'),element('h1','Digital Guest Book'),element('p','Create events, collect guest messages and share a private album.','muted'),link('Crew dashboard','/crew'));
    app.replaceChildren(gate);
  }
}
main().catch(showError).finally(()=>app.setAttribute('aria-busy','false'));
