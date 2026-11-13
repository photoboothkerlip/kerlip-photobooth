import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';

const directory = new URL('./data/', import.meta.url);
const dataPath = process.env.KERLIP_DATA_DIR || directory;
mkdirSync(dataPath, {recursive:true});
const db = new DatabaseSync(typeof dataPath === 'string' ? join(dataPath, 'guestbook.sqlite') : new URL('guestbook.sqlite', dataPath));
db.exec(`PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, album TEXT UNIQUE, name TEXT, date TEXT, prompt TEXT, pin TEXT, cover TEXT);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, event TEXT REFERENCES events(id), mime TEXT, bytes BLOB, booth INTEGER);
CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, event TEXT REFERENCES events(id), name TEXT, message TEXT, photo TEXT REFERENCES photos(id), hidden INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT, scope TEXT, expires INTEGER);`);

const get = (sql,...args) => db.prepare(sql).get(...args);
const all = (sql,...args) => db.prepare(sql).all(...args);
const run = (sql,...args) => db.prepare(sql).run(...args);
const token = () => randomBytes(18).toString('hex');
const hash = (value,salt=token()) => salt+':'+scryptSync(value,salt,32).toString('hex');
function matches(value, stored) {
  return timingSafeEqual(Buffer.from(hash(value,stored.split(':')[0])),Buffer.from(stored));
}
const crewPassword = process.env.KERLIP_PASSWORD;
if (crewPassword) run("INSERT OR REPLACE INTO settings VALUES ('crew',?)",hash(crewPassword));
if (!get("SELECT value FROM settings WHERE name='crew'")) {
  const generated = token().slice(0,16);
  run("INSERT INTO settings VALUES ('crew',?)",hash(generated));
  console.log('Crew password (save this): '+generated);
}
function addEvent(name,date,prompt,pin) {
  const id=token(), album=token();
  run('INSERT INTO events VALUES (?,?,?,?,?,?,NULL)',id,album,name,date,prompt,hash(pin));
  return {id,album};
}
if (!get("SELECT value FROM settings WHERE name='demo'")) {
  const demo=addEvent('Annual Dinner','2026-11-14','What made tonight memorable?','2468');
  let sample=null;
  try {
    const bytes=Buffer.from(readFileSync(new URL('./public/demo.jpg.b64',import.meta.url),'utf8'),'base64');
    sample=token();
    run('INSERT INTO photos VALUES (?,?,?,?,1)',sample,demo.id,'image/jpeg',bytes);
    run('UPDATE events SET cover=? WHERE id=?',sample,demo.id);
  } catch(error) { if(error.code!=='ENOENT') throw error; }
  run('INSERT INTO entries (event,name,message,photo) VALUES (?,?,?,?)',demo.id,'Nadia','What a night! So glad we got to celebrate together.',sample);
  run('INSERT INTO entries (event,name,message) VALUES (?,?,?)',demo.id,'Azim','A big thank you to the team behind the scenes.');
  run("INSERT INTO settings VALUES ('demo',?)",demo.id);
}
const files = new Map([['/app.js','text/javascript'],['/style.css','text/css']]);
const attempts = new Map();
const port=Number(process.env.PORT||8787);
const fail=(status,message)=>Object.assign(new Error(message),{status});
function requireThat(condition,status,message) { if(!condition) throw fail(status,message); }
function credentials(req, role, scope='') {
  const cookie = (req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(role+'='));
  return cookie && get('SELECT 1 FROM sessions WHERE token=? AND role=? AND scope=? AND expires>?',cookie.split('=')[1],role,scope,Date.now());
}
function login(res, role, scope='') {
  const key=token(), hours=12;
  run('DELETE FROM sessions WHERE expires<=?',Date.now());
  run('INSERT INTO sessions VALUES (?,?,?,?)',key,role,scope,Date.now()+hours*3600000);
  res.setHeader('Set-Cookie',role+'='+key+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+hours*3600);
}
function checkPassword(req, key, supplied, stored) {
  const address=req.socket.remoteAddress;
  const bucket=address+'|'+key;
  const now=Date.now();
  for(const [id,state] of attempts) if(state.until<=now) attempts.delete(id);
  const state=attempts.get(bucket)||{count:0,until:now+300000};
  requireThat(state.count<8,429,'Too many attempts. Try again in five minutes.');
  if(matches(supplied,stored)) { attempts.delete(bucket); return; }
  state.count++;
  attempts.set(bucket,state);
  throw fail(401,'Incorrect credentials.');
}
async function body(req) {
  requireThat(req.headers['content-type']==='application/json',415,'Expected JSON.');
  const chunks=[]; let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>16_000_000) throw fail(413,'Upload is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks)); }
  catch { throw fail(400,'Invalid request.'); }
}
function field(value, max, label) {
  requireThat(typeof value==='string' && value.trim() && value.trim().length<=max,400,label+' is required (up to '+max+' characters).');
  return value.trim();
}
function eventInfo(event) {
  return {name:event.name,date:event.date,prompt:event.prompt,cover:event.cover,id:event.id};
}
function entries(event,crew=false) {
  return all('SELECT id,name,message,photo,hidden FROM entries WHERE event=? '+(crew?'':'AND hidden=0')+' ORDER BY id DESC',event);
}
function decodePhoto(file) {
  const match=typeof file==='string' && /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(file);
  requireThat(match,400,'Use a valid photo.');
  const bytes=Buffer.from(match[1],'base64');
  requireThat(bytes.length<=900000 && bytes[0]===255 && bytes[1]===216 && bytes.at(-2)===255 && bytes.at(-1)===217,400,'Each converted JPEG must be under 900 KB.');
  return bytes;
}
export async function route(req,res,path) {
  const post=req.method==='POST';
  const crew=()=>requireThat(credentials(req,'crew'),401,'Sign in as crew.');
  const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(path==='/api/crew/login' && post) {
    const data=await body(req);
    checkPassword(req,'crew',field(data.password,200,'Password'),get("SELECT value FROM settings WHERE name='crew'").value);
    login(res,'crew');return send({ok:true});
  }
  if(path==='/api/crew/events') {
    crew();
    if(!post) return send(all('SELECT id,album,name,date,cover,prompt FROM events ORDER BY date DESC'));
    const data=await body(req);
    const name=field(data.name,100,'Event name'),date=field(data.date,10,'Event date'),prompt=field(data.prompt,180,'Message prompt'),pin=field(data.pin,10,'PIN');
    requireThat(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date,400,'Enter a valid date.');
    requireThat(/^\d{4,10}$/.test(pin),400,'Use a 4-10 digit PIN.');
    return send(addEvent(name,date,prompt,pin),201);
  }
  const parts=path.split('/');
  const [,api,role,id,action,photoId]=parts;
  requireThat(api==='api' && ['guest','crew','album'].includes(role),404,'Page not found.');
  if(role==='crew') crew();
  const event=get(role==='album'?'SELECT * FROM events WHERE album=?':'SELECT * FROM events WHERE id=?',id||'');
  requireThat(event,404,'Event not found.');
  if(role==='album' && action==='unlock' && post) {
    const data=await body(req);
    checkPassword(req,'album:'+id,field(data.pin,10,'PIN'),event.pin);
    login(res,'album',id);return send({ok:true});
  }
  if(role==='album') requireThat(credentials(req,'album',id),401,'Enter the album PIN.');
  if(action==='photo' && !post) {
    const photo=get('SELECT * FROM photos WHERE id=? AND event=?',photoId||'',event.id);
    requireThat(photo && (role==='crew' || photo.id===event.cover ||
      (role==='guest' && photo.booth && get('SELECT 1 FROM (SELECT id FROM photos WHERE event=? AND booth=1 ORDER BY rowid DESC LIMIT 12) WHERE id=?',event.id,photo.id)) ||
      (role==='album' && get('SELECT 1 FROM entries WHERE event=? AND photo=? AND hidden=0',event.id,photo.id))),404,'Photo unavailable.');
    res.writeHead(200,{'Content-Type':photo.mime});return res.end(photo.bytes);
  }
  if(role==='guest' && action==='sign' && post) {
    const data=await body(req), name=field(data.name,60,'Name'),message=field(data.message,300,'Message');
    const photo=data.photo||null;
    requireThat(!photo || (typeof photo==='string' && get('SELECT 1 FROM photos WHERE id=? AND event=? AND booth=1',photo,event.id)),400,'Select a booth photo from this event.');
    requireThat(!photo || !data.upload,400,'Choose one photo per entry.');
    const upload=data.upload==null?null:decodePhoto(data.upload);
    const attached=upload?token():photo;
    db.exec('BEGIN');
    try {
      if(upload) run('INSERT INTO photos VALUES (?,?,?,?,0)',attached,event.id,'image/jpeg',upload);
      run('INSERT INTO entries (event,name,message,photo) VALUES (?,?,?,?)',event.id,name,message,attached);
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK');throw error; }
    return send({ok:true},201);
  }
  if(role==='crew' && action==='photos' && post) {
    const data=await body(req);
    requireThat(Array.isArray(data.files) && data.files.length>0 && data.files.length<=12 && (!data.cover || data.files.length===1),400,'Choose up to 12 photos.');
    const images=data.files.map(file=>({id:token(),bytes:decodePhoto(file)}));
    db.exec('BEGIN');
    try {
      for(const image of images) run('INSERT INTO photos VALUES (?,?,?,?,?)',image.id,event.id,'image/jpeg',image.bytes,data.cover?0:1);
      if(data.cover) run('UPDATE events SET cover=? WHERE id=?',images[0].id,event.id);
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK');throw error; }
    return send({count:images.length});
  }
  if(role==='crew' && action==='visibility' && post) {
    const data=await body(req);
    requireThat(Number.isSafeInteger(data.entry) && typeof data.hidden==='boolean',400,'Invalid entry.');
    requireThat(run('UPDATE entries SET hidden=? WHERE event=? AND id=?',Number(data.hidden),event.id,data.entry).changes,404,'Entry not found.');
    return send({ok:true});
  }
  requireThat(!post && !action,404,'Page not found.');
  if(role==='guest') return send({...eventInfo(event),photos:all('SELECT id FROM photos WHERE event=? AND booth=1 ORDER BY rowid DESC LIMIT 12',event.id)});
  return send({...eventInfo(event),entries:entries(event.id,role==='crew'),...(role==='crew'?{album:event.album}:{})});
}
const server = http.createServer(async (req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'");
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    requireThat(['GET','POST'].includes(req.method),405,'Method not allowed.');
    if(req.method==='POST') {
      const origin=req.headers.origin;
      requireThat(!origin || origin==='http://'+req.headers.host,403,'Request origin not allowed.');
    }
    if(path.startsWith('/api/')) return await route(req,res,path);
    const file=files.has(path)?path.slice(1):'index.html';
    res.writeHead(200,{'Content-Type':(files.get(path)||'text/html')+'; charset=utf-8'});
    res.end(readFileSync(new URL('./public/'+file,import.meta.url)));
  } catch(error) {
    if(!error.status) console.error(error);
    if(!res.headersSent) res.writeHead(error.status||500,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:error.status?error.message:'Something went wrong.'}));
  }
});
if (process.env.KERLIP_NO_LISTEN !== '1') server.listen(port,process.env.KERLIP_BIND || '0.0.0.0',()=>{
  console.log('Laptop: http://localhost:'+port);
  for(const group of Object.values(networkInterfaces())) for(const item of group)
    if(item.family==='IPv4' && !item.internal) console.log('Same Wi-Fi: http://'+item.address+':'+port);
});
