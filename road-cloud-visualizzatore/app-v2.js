import {readSettings} from './settings.js';

const $ = id => document.getElementById(id);
const cv = $('gl');
const gl = cv.getContext('webgl', {antialias:false, alpha:false, powerPreference:'high-performance'});
const nf = new Intl.NumberFormat('it-IT');
let S = readSettings();
let layers = [], idSeq = 1;
let yaw = -0.62, pitch = 0.36, dist = 10, target = [0,0,0], pivot = 'globale';
let ptr = new Map(), pinch = null, lastTap = 0, lastTapXY = [0,0];

const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const ext = n => (n.split('.').pop() || '').toLowerCase();
const finite = Number.isFinite;
const sleepFrame = () => new Promise(r => requestAnimationFrame(() => r()));

function status(t){ $('status').textContent = t; }
function progress(a,b){ $('progressTitle').textContent=a; $('progressText').textContent=b; $('progress').classList.add('show'); }
function progressText(t){ $('progressText').textContent=t; }
function progressOff(){ $('progress').classList.remove('show'); }

function shader(type, src){
  const sh = gl.createShader(type); gl.shaderSource(sh,src); gl.compileShader(sh);
  if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(sh));
  return sh;
}

let P, L;
if(gl){
  const vs = `attribute vec3 p;attribute vec3 c;attribute float it;uniform mat4 pr,v;uniform vec3 od;uniform float ps,mode,z0,z1,imin,imax,oz;varying vec3 C;vec3 hc(float t){t=clamp(t,0.,1.);return vec3(clamp(1.6*t,0.,1.),clamp(1.5-abs(t-.5)*2.,0.,1.),clamp(1.5*(1.-t),0.,1.));}void main(){vec3 q=p+od;gl_Position=pr*v*vec4(q,1.);gl_PointSize=ps;if(mode<.5)C=c;else if(mode<1.5)C=hc((p.z+oz-z0)/max(.000001,z1-z0));else if(mode<2.5){float a=(it-imin)/max(.000001,imax-imin);C=vec3(.15+.85*sqrt(clamp(a,0.,1.)));}else C=vec3(.93);}`;
  const fs = `precision mediump float;varying vec3 C;void main(){gl_FragColor=vec4(C,1.);}`;
  P=gl.createProgram(); gl.attachShader(P,shader(gl.VERTEX_SHADER,vs)); gl.attachShader(P,shader(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(P);
  L={p:gl.getAttribLocation(P,'p'),c:gl.getAttribLocation(P,'c'),it:gl.getAttribLocation(P,'it'),pr:gl.getUniformLocation(P,'pr'),v:gl.getUniformLocation(P,'v'),od:gl.getUniformLocation(P,'od'),ps:gl.getUniformLocation(P,'ps'),mode:gl.getUniformLocation(P,'mode'),z0:gl.getUniformLocation(P,'z0'),z1:gl.getUniformLocation(P,'z1'),imin:gl.getUniformLocation(P,'imin'),imax:gl.getUniformLocation(P,'imax'),oz:gl.getUniformLocation(P,'oz')};
}

// Z-up camera orbit: yaw turns around vertical Z, pitch tilts without any roll.
function cameraBasis(){
  const cy=Math.cos(yaw), sy=Math.sin(yaw), cp=Math.cos(pitch), sp=Math.sin(pitch);
  return {right:[-sy,cy,0],up:[-sp*cy,-sp*sy,cp],back:[cp*cy,cp*sy,sp]};
}
function viewMatrix(){
  const {right:r,up:u,back:b}=cameraBasis();
  return [r[0],u[0],b[0],0,r[1],u[1],b[1],0,r[2],u[2],b[2],0,0,0,-dist,1];
}
const PER=(f,a,n,z)=>{const q=1/Math.tan(f/2),d=1/(n-z);return[q/a,0,0,0,0,q,0,0,0,0,(z+n)*d,-1,0,0,2*z*n*d,0]};

function bounds(){
  const b=[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity]; let ok=false;
  for(const l of layers) if(l.visible){ ok=true; for(let j=0;j<3;j++){ b[j*2]=Math.min(b[j*2],l.b[j*2]); b[j*2+1]=Math.max(b[j*2+1],l.b[j*2+1]); } }
  return ok?b:null;
}
function radius(){ const b=bounds(); return b?Math.max(1e-6,.5*Math.hypot(b[1]-b[0],b[3]-b[2],b[5]-b[4])):1; }
function fit(b=bounds()){
  if(!b) return;
  target=[(b[0]+b[1])/2,(b[2]+b[3])/2,(b[4]+b[5])/2];
  const r=Math.max(1e-5,.5*Math.hypot(b[1]-b[0],b[3]-b[2],b[5]-b[4])), f=+S.fov*Math.PI/180;
  dist=Math.max(r/Math.sin(f/2)*1.18,r*1.5); pivot='globale'; hud(); draw();
}
function bg(){ return S.background==='light'?[.76,.79,.82,1]:S.background==='dark'?[.01,.03,.055,1]:[0,0,0,1]; }
function resize(){ const r=cv.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.round(r.width*d)),h=Math.max(1,Math.round(r.height*d)); if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;gl.viewport(0,0,w,h);} }
function draw(){
  if(!gl) return; resize(); const B=bounds(),c=bg(); gl.clearColor(...c); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); if(!B)return;
  const r=radius(),pr=PER(+S.fov*Math.PI/180,cv.width/cv.height,Math.max(1e-5,Math.min(dist*.01,r*.01)),Math.max(dist*100,r*50,1000)),v=viewMatrix();
  gl.enable(gl.DEPTH_TEST); gl.useProgram(P); gl.uniformMatrix4fv(L.pr,false,new Float32Array(pr)); gl.uniformMatrix4fv(L.v,false,new Float32Array(v)); gl.uniform1f(L.ps,+S.pointSize*(devicePixelRatio||1)); gl.uniform1f(L.z0,B[4]); gl.uniform1f(L.z1,B[5]);
  for(const l of layers) if(l.visible){
    let m=S.colorMode; if(m==='auto')m=l.rgb?'rgb':l.hasI?'intensity':'height'; if(m==='rgb'&&!l.rgb)m=l.hasI?'intensity':'height'; if(m==='intensity'&&!l.hasI)m=l.rgb?'rgb':'height';
    gl.uniform1f(L.mode,{rgb:0,height:1,intensity:2,mono:3}[m]??0); gl.uniform3f(L.od,l.o[0]-target[0],l.o[1]-target[1],l.o[2]-target[2]); gl.uniform1f(L.oz,l.o[2]); gl.uniform1f(L.imin,l.imin); gl.uniform1f(L.imax,l.imax);
    for(const q of [['p',l.bp,3,gl.FLOAT,false],['c',l.bc,3,gl.UNSIGNED_BYTE,true],['it',l.bi,1,gl.FLOAT,false]]){ gl.bindBuffer(gl.ARRAY_BUFFER,q[1]); gl.enableVertexAttribArray(L[q[0]]); gl.vertexAttribPointer(L[q[0]],q[2],q[3],q[4],0,0); }
    gl.drawArrays(gl.POINTS,0,l.n);
  }
}

function color(v){ v=+v; if(!finite(v))return 230; if(v<=1&&v>=0)v*=255; if(v>255)v/=257; return Math.round(clamp(v,0,255)); }

function makeLayer(name,fmt,total,a,c,i,rgb=false,hasI=false,meta=''){
  const n=Math.floor(a.length/3); if(!n) throw Error('Nessun punto valido.');
  const b=[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity];
  for(let k=0;k<n;k++){const x=a[k*3],y=a[k*3+1],z=a[k*3+2]; b[0]=Math.min(b[0],x);b[1]=Math.max(b[1],x);b[2]=Math.min(b[2],y);b[3]=Math.max(b[3],y);b[4]=Math.min(b[4],z);b[5]=Math.max(b[5],z);}
  const o=[(b[0]+b[1])/2,(b[2]+b[3])/2,(b[4]+b[5])/2];
  let p;
  if(a instanceof Float32Array && a.byteOffset===0 && a.length===a.buffer.byteLength/4){ p=a; for(let k=0;k<n;k++){p[k*3]-=o[0];p[k*3+1]-=o[1];p[k*3+2]-=o[2];} }
  else { p=new Float32Array(n*3); for(let k=0;k<n;k++){p[k*3]=a[k*3]-o[0];p[k*3+1]=a[k*3+1]-o[1];p[k*3+2]=a[k*3+2]-o[2];} }
  if(!c||c.length<n*3){c=new Uint8Array(n*3);c.fill(230);rgb=false;} if(!i||i.length<n)i=new Float32Array(n);
  let imin=Infinity,imax=-Infinity; for(const v of i){imin=Math.min(imin,v);imax=Math.max(imax,v);} if(!finite(imin)){imin=0;imax=1;} if(!(imax>imin))imax=imin+1;
  const l={id:idSeq++,name,fmt,total,n,b,o,p,c,i,rgb,hasI,imin,imax,visible:true,meta};
  l.bp=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,l.bp); gl.bufferData(gl.ARRAY_BUFFER,p,gl.STATIC_DRAW);
  l.bc=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,l.bc); gl.bufferData(gl.ARRAY_BUFFER,c,gl.STATIC_DRAW);
  l.bi=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,l.bi); gl.bufferData(gl.ARRAY_BUFFER,i,gl.STATIC_DRAW);
  return l;
}

function sampleRows(rows,max){
  const st=Math.max(1,Math.ceil(rows.length/max)),a=[],c=[],it=[]; let rgb=false,hasI=false;
  for(let k=0;k<rows.length;k+=st){const v=rows[k]; if(v.length<3)continue; const x=+v[0],y=+v[1],z=+v[2]; if(![x,y,z].every(finite))continue; a.push(x,y,z); let r=230,g=230,b=230,q=0; if(v.length>=7){q=+v[3]||0;r=color(v[4]);g=color(v[5]);b=color(v[6]);rgb=true;hasI=true;}else if(v.length>=6){r=color(v[3]);g=color(v[4]);b=color(v[5]);rgb=true;}else if(v.length>=4){q=+v[3]||0;hasI=true;} c.push(r,g,b);it.push(q);}
  return {a:new Float32Array(a),c:new Uint8Array(c),i:new Float32Array(it),rgb,hasI};
}
function parseText(txt,name,fmt,max){
  const lines=txt.split(/\r?\n/),rows=[]; for(const s0 of lines){const s=s0.trim();if(!s||s[0]==='#'||/^ply$/i.test(s))continue;const v=s.split(/[\s,;]+/).filter(Boolean);if(v.length>=3&&v.slice(0,3).every(x=>finite(+x)))rows.push(v);} const d=sampleRows(rows,max); return makeLayer(name,fmt,rows.length,d.a,d.c,d.i,d.rgb,d.hasI);
}
async function textFile(f,max){ return parseText(await f.text(),f.name,ext(f.name).toUpperCase(),max); }

const PLY_TYPES={
  char:[1,'getInt8'],int8:[1,'getInt8'],uchar:[1,'getUint8'],uint8:[1,'getUint8'],
  short:[2,'getInt16'],int16:[2,'getInt16'],ushort:[2,'getUint16'],uint16:[2,'getUint16'],
  int:[4,'getInt32'],int32:[4,'getInt32'],uint:[4,'getUint32'],uint32:[4,'getUint32'],
  float:[4,'getFloat32'],float32:[4,'getFloat32'],double:[8,'getFloat64'],float64:[8,'getFloat64']
};
function findPLYHeader(u8){
  const probeLen=Math.min(u8.byteLength,1024*1024), probe=new TextDecoder('ascii').decode(u8.subarray(0,probeLen));
  const m=/end_header(?:\r\n|\n|\r)/i.exec(probe); if(!m) throw Error('Header PLY non trovato o incompleto.');
  return {text:probe.slice(0,m.index+m[0].length), offset:m.index+m[0].length};
}
function parsePLYHeader(text){
  const lines=text.replace(/\r/g,'').split('\n'); let format='',count=0,inVertex=false,props=[],roadcloud=false,variable=false;
  for(const line of lines){const p=line.trim().split(/\s+/); if(!p[0])continue; if(p[0]==='format')format=p[1]||''; else if(p[0]==='comment'&&/RoadCloud/i.test(line))roadcloud=true; else if(p[0]==='element'){inVertex=p[1]==='vertex';if(inVertex)count=Number(p[2])||0;} else if(p[0]==='property'&&inVertex){if(p[1]==='list'){variable=true;props.push({list:true,countType:p[2],type:p[3],name:p[4]});}else props.push({type:p[1],name:p[2]});}}
  if(!count) throw Error('PLY senza punti vertex.'); if(!format) throw Error('Formato PLY mancante.'); return {format,count,props,roadcloud,variable};
}
function propLayout(props){
  let stride=0; const map={};
  for(const p of props){if(p.list)throw Error('PLY con proprietà vertex a lista non supportato.');const t=PLY_TYPES[p.type?.toLowerCase()];if(!t)throw Error('Tipo PLY non supportato: '+p.type);map[p.name?.toLowerCase()]={off:stride,size:t[0],get:t[1]};stride+=t[0];}
  return {stride,map};
}
function readProp(dv,base,p,le){ if(!p)return undefined; return dv[p.get](base+p.off,le); }
async function parsePLYBinary(u8,name,hdr,dataOffset,max){
  const {stride,map}=propLayout(hdr.props); if(!stride)throw Error('Record PLY vuoto.');
  const available=Math.floor((u8.byteLength-dataOffset)/stride), total=Math.min(hdr.count,available); if(total<=0)throw Error('PLY senza dati dopo l’header.');
  const step=Math.max(1,Math.ceil(total/max)), outN=Math.ceil(total/step), a=new Float32Array(outN*3), c=new Uint8Array(outN*3), it=new Float32Array(outN);
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength), le=hdr.format!=='binary_big_endian';
  const px=map.x,py=map.y,pz=map.z,pr=map.red||map.r,pg=map.green||map.g,pb=map.blue||map.b,pi=map.intensity||map.reflectance||map.confidence;
  if(!px||!py||!pz)throw Error('PLY: coordinate x/y/z non trovate.');
  const rgb=!!(pr&&pg&&pb), hasI=!!pi; let o=0, tick=0;
  for(let src=0;src<total;src+=step){
    const base=dataOffset+src*stride, x=readProp(dv,base,px,le), y=readProp(dv,base,py,le), z=readProp(dv,base,pz,le); if(![x,y,z].every(finite))continue;
    a[o*3]=x;a[o*3+1]=y;a[o*3+2]=z; c[o*3]=rgb?color(readProp(dv,base,pr,le)):230;c[o*3+1]=rgb?color(readProp(dv,base,pg,le)):230;c[o*3+2]=rgb?color(readProp(dv,base,pb,le)):230;it[o]=hasI?(+readProp(dv,base,pi,le)||0):0;o++;
    if(++tick%100000===0){progressText(`Lettura ${nf.format(src+1)} / ${nf.format(total)} punti…`);await sleepFrame();}
  }
  const aa=o===outN?a:a.slice(0,o*3),cc=o===outN?c:c.slice(0,o*3),ii=o===outN?it:it.slice(0,o);
  const meta=(hdr.roadcloud?'RoadCloud · ':'')+(available<hdr.count?`file parziale ${nf.format(available)}/${nf.format(hdr.count)}`:'');
  return makeLayer(name,`PLY ${hdr.format}${hdr.roadcloud?' · RoadCloud':''}`,hdr.count,aa,cc,ii,rgb,hasI,meta);
}
async function parsePLYAscii(u8,name,hdr,dataOffset,max){
  const text=new TextDecoder().decode(u8.subarray(dataOffset)), lines=text.split(/\r?\n/), names=hdr.props.filter(p=>!p.list).map(p=>p.name?.toLowerCase()), ix=names.indexOf('x'),iy=names.indexOf('y'),iz=names.indexOf('z'),ir=Math.max(names.indexOf('red'),names.indexOf('r')),ig=Math.max(names.indexOf('green'),names.indexOf('g')),ib=Math.max(names.indexOf('blue'),names.indexOf('b')),ii0=Math.max(names.indexOf('intensity'),names.indexOf('reflectance'),names.indexOf('confidence'));
  if(ix<0||iy<0||iz<0)throw Error('PLY ASCII: coordinate x/y/z non trovate.'); const total=Math.min(hdr.count,lines.length),step=Math.max(1,Math.ceil(total/max)),a=[],c=[],it=[],rgb=ir>=0&&ig>=0&&ib>=0,hasI=ii0>=0;
  for(let k=0;k<total;k+=step){const v=lines[k].trim().split(/\s+/);const x=+v[ix],y=+v[iy],z=+v[iz];if(![x,y,z].every(finite))continue;a.push(x,y,z);c.push(rgb?color(v[ir]):230,rgb?color(v[ig]):230,rgb?color(v[ib]):230);it.push(hasI?(+v[ii0]||0):0);}
  return makeLayer(name,'PLY ASCII',hdr.count,new Float32Array(a),new Uint8Array(c),new Float32Array(it),rgb,hasI,hdr.roadcloud?'RoadCloud':'');
}
async function plyBytes(u8,name,max){
  const hh=findPLYHeader(u8), hdr=parsePLYHeader(hh.text); if(hdr.variable)throw Error('PLY vertex con liste non supportato.');
  if(hdr.format==='ascii')return parsePLYAscii(u8,name,hdr,hh.offset,max);
  if(hdr.format!=='binary_little_endian'&&hdr.format!=='binary_big_endian')throw Error('Formato PLY non supportato: '+hdr.format);
  return parsePLYBinary(u8,name,hdr,hh.offset,max);
}
async function ply(f,max){ return plyBytes(new Uint8Array(await f.arrayBuffer()),f.name,max); }

async function lasBytes(u8,name,max){
  const d=new DataView(u8.buffer,u8.byteOffset,u8.byteLength); if(u8.byteLength<227||new TextDecoder('ascii').decode(u8.subarray(0,4))!=='LASF')throw Error('LAS non valido.');
  const off=d.getUint32(96,true); let fmt=d.getUint8(104), rec=d.getUint16(105,true), count=d.getUint32(107,true); if(fmt&128)throw Error('File LAZ compresso: usa il decoder LAZ.'); fmt&=63;
  if(d.getUint8(24)>=1&&d.getUint8(25)>=4&&u8.byteLength>255&&typeof d.getBigUint64==='function'){const n=Number(d.getBigUint64(247,true));if(n)count=n;}
  const sx=d.getFloat64(131,true),sy=d.getFloat64(139,true),sz=d.getFloat64(147,true),ox=d.getFloat64(155,true),oy=d.getFloat64(163,true),oz=d.getFloat64(171,true),available=Math.floor((u8.byteLength-off)/rec),total=Math.min(count,available),step=Math.max(1,Math.ceil(total/max)),outN=Math.ceil(total/step),a=new Float32Array(outN*3),c=new Uint8Array(outN*3),it=new Float32Array(outN),hasRGB=[2,3,5,7,8,10].includes(fmt),rgbOff={2:20,3:28,5:28,7:30,8:30,10:30}[fmt];
  let o=0; for(let k=0;k<total;k+=step){const q=off+k*rec;if(q+20>u8.byteLength)break;a[o*3]=d.getInt32(q,true)*sx+ox;a[o*3+1]=d.getInt32(q+4,true)*sy+oy;a[o*3+2]=d.getInt32(q+8,true)*sz+oz;it[o]=d.getUint16(q+12,true);if(hasRGB&&q+rgbOff+6<=u8.byteLength){c[o*3]=color(d.getUint16(q+rgbOff,true));c[o*3+1]=color(d.getUint16(q+rgbOff+2,true));c[o*3+2]=color(d.getUint16(q+rgbOff+4,true));}else{c[o*3]=c[o*3+1]=c[o*3+2]=230;}o++;if(o%100000===0){progressText(`Lettura ${nf.format(k+1)} / ${nf.format(total)} punti…`);await sleepFrame();}}
  return makeLayer(name,'LAS '+fmt,count,o===outN?a:a.slice(0,o*3),o===outN?c:c.slice(0,o*3),o===outN?it:it.slice(0,o),hasRGB,true);
}
async function las(f,max){ if(ext(f.name)==='laz')return cloudLoader(f,'laz',max); return lasBytes(new Uint8Array(await f.arrayBuffer()),f.name,max); }

async function cloudLoader(f,type,max){
  const [{load},{LASLoader},{PCDLoader}]=await Promise.all([import('https://cdn.jsdelivr.net/npm/@loaders.gl/core@4.5.4/+esm'),import('https://cdn.jsdelivr.net/npm/@loaders.gl/las@4.5.4/+esm'),import('https://cdn.jsdelivr.net/npm/@loaders.gl/pcd@4.5.4/+esm')]);
  const obj=await load(await f.arrayBuffer(),type==='pcd'?PCDLoader:LASLoader),attr=obj.attributes||obj.data?.attributes||{},pos=attr.POSITION?.value||attr.position?.value,col=attr.COLOR_0?.value||attr.COLOR?.value,ints=attr.INTENSITY?.value||attr.intensity?.value;
  if(!pos)throw Error(type.toUpperCase()+': coordinate non trovate.'); const total=Math.floor(pos.length/3),st=Math.max(1,Math.ceil(total/max)),n=Math.ceil(total/st),a=new Float32Array(n*3),c=new Uint8Array(n*3),it=new Float32Array(n),rgb=!!col,hasI=!!ints; let o=0;
  for(let k=0;k<total;k+=st){a[o*3]=+pos[k*3];a[o*3+1]=+pos[k*3+1];a[o*3+2]=+pos[k*3+2];if(col){c[o*3]=color(col[k*3]);c[o*3+1]=color(col[k*3+1]);c[o*3+2]=color(col[k*3+2]);}else c[o*3]=c[o*3+1]=c[o*3+2]=230;it[o]=ints?+ints[k]:0;o++;}
  return makeLayer(f.name,type.toUpperCase(),total,a,c,it,rgb,hasI);
}
async function e57(f,max){
  const mod=await import('https://cdn.jsdelivr.net/npm/web-e57@1.2.0/+esm'),fn=mod.convertE57||mod.default?.convertE57||mod.default; if(typeof fn!=='function')throw Error('Decoder E57 non disponibile.'); const out=await fn(new Uint8Array(await f.arrayBuffer()),'XYZ'),txt=typeof out==='string'?out:new TextDecoder().decode(out instanceof Uint8Array?out:new Uint8Array(out)); return parseText(txt,f.name,'E57',max);
}

function zipEntries(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength); let eocd=-1; const min=Math.max(0,u8.byteLength-65557);
  for(let p=u8.byteLength-22;p>=min;p--){if(dv.getUint32(p,true)===0x06054b50){eocd=p;break;}}
  if(eocd<0)throw Error('Archivio ZIP non valido.'); const count=dv.getUint16(eocd+10,true),cdOff=dv.getUint32(eocd+16,true),dec=new TextDecoder('utf-8'),out=[]; let p=cdOff;
  for(let i=0;i<count;i++){if(p+46>u8.byteLength||dv.getUint32(p,true)!==0x02014b50)break;const flags=dv.getUint16(p+8,true),method=dv.getUint16(p+10,true),comp=dv.getUint32(p+20,true),size=dv.getUint32(p+24,true),nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),local=dv.getUint32(p+42,true),name=dec.decode(u8.subarray(p+46,p+46+nl));out.push({name,flags,method,comp,size,local});p+=46+nl+el+cl;}
  return out;
}
async function extractZipEntry(zip,e,inflateSync){
  const dv=new DataView(zip.buffer,zip.byteOffset,zip.byteLength),p=e.local;if(p+30>zip.byteLength||dv.getUint32(p,true)!==0x04034b50)throw Error('ZIP: header locale non valido per '+e.name);const nl=dv.getUint16(p+26,true),el=dv.getUint16(p+28,true),start=p+30+nl+el,end=start+e.comp;if(end>zip.byteLength)throw Error('ZIP: dati incompleti per '+e.name);const raw=zip.subarray(start,end);if(e.method===0)return new Uint8Array(raw);if(e.method===8)return inflateSync(raw);throw Error('ZIP: compressione '+e.method+' non supportata.');
}
async function roadCloudZip(f,max){
  progress('Apertura scansione RoadCloud', 'Lettura archivio ZIP…'); const zip=new Uint8Array(await f.arrayBuffer()), entries=zipEntries(zip),plyAll=entries.filter(e=>/\.ply$/i.test(e.name)&&!e.name.endsWith('/'));
  if(!plyAll.length)throw Error('Nell’archivio non sono presenti file PLY.'); const raw=plyAll.filter(e=>/(^|\/)RAW\//i.test(e.name)); const selected=(raw.length?raw:plyAll).sort((a,b)=>a.name.localeCompare(b.name));
  const {inflateSync}=await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm'); const per=Math.max(25000,Math.floor(max/Math.max(1,selected.length))), made=[];
  for(let i=0;i<selected.length;i++){const e=selected[i];progress('Apertura scansione RoadCloud',`Segmento ${i+1} / ${selected.length} · ${e.name.split('/').pop()}`);await sleepFrame();const bytes=await extractZipEntry(zip,e,inflateSync);const l=await plyBytes(bytes,`${f.name} · ${e.name.split('/').pop()}`,per);l.meta=`Archivio ${f.name} · ${e.name}`;made.push(l);await sleepFrame();}
  return made;
}

async function parseFile(f){
  const x=ext(f.name),m=+S.maxPoints||2000000;
  if(x==='zip')return roadCloudZip(f,m);
  if(x==='ply')return [await ply(f,m)];
  if(x==='las')return [await las(f,m)];
  if(x==='laz')return [await cloudLoader(f,'laz',m)];
  if(x==='pcd')return [await cloudLoader(f,'pcd',m)];
  if(x==='e57')return [await e57(f,m)];
  if(['ptx','pts','xyz','csv','txt','asc'].includes(x))return [await textFile(f,m)];
  throw Error('Formato .'+x+' non supportato. Per una scansione completa RoadCloud seleziona il file .zip.');
}

function remove(l){ for(const b of [l.bp,l.bc,l.bi])gl.deleteBuffer(b); layers=layers.filter(x=>x!==l); }
function clear(){ for(const l of [...layers])remove(l); ui(); draw(); }
async function loadFiles(fs,replace){
  const arr=[...fs]; if(!arr.length)return; if(replace)clear(); let n=0,err=[];
  for(let k=0;k<arr.length;k++){const f=arr[k];progress(`Scansione ${k+1} / ${arr.length}`,f.name);status('Lettura '+f.name+'…');await sleepFrame();try{const made=await parseFile(f);for(const l of made){layers.push(l);n++;}ui();draw();}catch(e){console.error(e);err.push(f.name+': '+(e?.message||e));}}
  progressOff(); if(n&&(replace||layers.length===n))fit(); const msg=n?`${n} livelli caricati${err.length?' · ERRORE: '+err[0]:''}`:(err[0]||'Nessun file caricato');status(msg);ui(); if(!n&&err.length)alert('Road Cloud Visualizzatore\n\n'+err[0]);
}

function hud(){ $('layerCount').textContent=layers.length; $('pointCount').textContent=nf.format(layers.filter(l=>l.visible).reduce((s,l)=>s+l.n,0)); $('pivotMode').textContent=pivot; $('empty').classList.toggle('hidden',!!layers.length); $('topSub').textContent=layers.length?`${layers.length} livelli · ${$('pointCount').textContent} punti`:'Viewer laser scanner · locale sul dispositivo'; $('drawerSummary').textContent=layers.length?`${layers.length} livelli caricati`:'Nessuna scansione caricata'; }
function ui(){
  const box=$('layerList'); box.replaceChildren(); for(const l of layers){const row=document.createElement('div');row.className='layer-row';const vis=document.createElement('button');vis.className='vis-toggle'+(l.visible?'':' off');vis.textContent=l.visible?'●':'○';vis.onclick=()=>{l.visible=!l.visible;ui();draw()};const main=document.createElement('div');main.className='layer-main';main.innerHTML=`<div class="layer-name"></div><div class="layer-meta"></div>`;main.children[0].textContent=l.name;main.children[1].textContent=`${l.fmt} · ${nf.format(l.n)} / ${nf.format(l.total)} punti${l.rgb?' · RGB':''}${l.meta?' · '+l.meta:''}`;const ac=document.createElement('div');ac.className='layer-actions';const ce=document.createElement('button');ce.className='mini-btn';ce.textContent='Centra';ce.onclick=()=>{l.visible=true;fit(l.b);closeDrawer()};const de=document.createElement('button');de.className='mini-btn danger';de.textContent='×';de.onclick=()=>{remove(l);ui();draw();if(layers.length)fit()};ac.append(ce,de);row.append(vis,main,ac);box.append(row);} hud();
}

function project(w,r){
  const q=[w[0]-target[0],w[1]-target[1],w[2]-target[2]];
  const {right,up,back}=cameraBasis();
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const x=dot(right,q),y=dot(up,q),zc=dot(back,q)-dist;
  if(zc>=0)return null;
  const f=1/Math.tan(+S.fov*Math.PI/360),nx=f/(r.width/r.height)*x/-zc,ny=f*y/-zc;
  if(Math.abs(nx)>1.4||Math.abs(ny)>1.4)return null;
  return{x:(nx*.5+.5)*r.width,y:(1-(ny*.5+.5))*r.height};
}
function pick(cx,cy,rad=60){const r=cv.getBoundingClientRect(),x=cx-r.left,y=cy-r.top;let best=null,bd=rad*rad;const ls=layers.filter(l=>l.visible),per=Math.max(900,Math.floor(24000/Math.max(1,ls.length)));for(const l of ls){const st=Math.max(1,Math.ceil(l.n/per));for(let k=0;k<l.n;k+=st){const w=[l.p[k*3]+l.o[0],l.p[k*3+1]+l.o[1],l.p[k*3+2]+l.o[2]],q=project(w,r);if(!q)continue;const d=(q.x-x)**2+(q.y-y)**2;if(d<bd){bd=d;best=w;}}}return best;}
function pivotAt(x,y,z=1){const w=pick(x,y);if(!w)return false;target=w;pivot='locale';dist=clamp(dist*z,Math.max(1e-6,radius()*1e-6),Math.max(1000,radius()*1e5));$('pivotDot').classList.add('show');setTimeout(()=>$('pivotDot').classList.remove('show'),700);hud();draw();return true;}
function pan(dx,dy){
  const r=cv.getBoundingClientRect();
  const q=2*dist*Math.tan(+S.fov*Math.PI/360)/Math.max(1,r.height)*(+S.panSpeed);
  const {right,up}=cameraBasis();
  for(let j=0;j<3;j++)target[j]+=-right[j]*dx*q+up[j]*dy*q;
  pivot='manuale';hud();
}
cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);ptr.set(e.pointerId,{x:e.clientX,y:e.clientY,px:e.clientX,py:e.clientY,sx:e.clientX,sy:e.clientY,m:false,multi:false,pan:e.shiftKey||e.button===2});if(ptr.size>=2){for(const p of ptr.values())p.multi=true;const a=[...ptr.values()],mx=(a[0].x+a[1].x)/2,my=(a[0].y+a[1].y)/2;pinch={d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),dist};if(S.autoPivot)pivotAt(mx,my);}});
cv.addEventListener('pointermove',e=>{const p=ptr.get(e.pointerId);if(!p)return;p.px=p.x;p.py=p.y;p.x=e.clientX;p.y=e.clientY;if(Math.hypot(p.x-p.sx,p.y-p.sy)>5)p.m=true;if(ptr.size>=2){const a=[...ptr.values()],d=Math.max(5,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y));if(pinch)dist=clamp(pinch.dist*Math.pow(pinch.d/d,+S.zoomSpeed),radius()*1e-6,Math.max(1000,radius()*1e5));pan(((a[0].x-a[0].px)+(a[1].x-a[1].px))/2,((a[0].y-a[0].py)+(a[1].y-a[1].py))/2);}else if(p.pan||e.shiftKey)pan(p.x-p.px,p.y-p.py);else{yaw-=(p.x-p.px)*.006*(+S.orbitSpeed)*(S.invertX?-1:1);pitch=clamp(pitch+(p.y-p.py)*.006*(+S.orbitSpeed)*(S.invertY?-1:1),-1.54,1.54);}draw();});
function end(e){const p=ptr.get(e.pointerId);if(!p)return;ptr.delete(e.pointerId);if(ptr.size<2)pinch=null;if(!p.multi&&!p.m&&e.type==='pointerup'){const n=performance.now(),dbl=n-lastTap<330&&Math.hypot(e.clientX-lastTapXY[0],e.clientY-lastTapXY[1])<35;if(dbl){pivotAt(e.clientX,e.clientY,.5);lastTap=0;}else{pivotAt(e.clientX,e.clientY);lastTap=n;lastTapXY=[e.clientX,e.clientY];}}}
cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('wheel',e=>{e.preventDefault();if(S.autoPivot)pivotAt(e.clientX,e.clientY);dist=clamp(dist*Math.exp(e.deltaY*.0016*(+S.zoomSpeed)),radius()*1e-6,Math.max(1000,radius()*1e5));draw();},{passive:false});

function openDrawer(){$('drawer').classList.add('open');$('drawerBackdrop').classList.add('open');}
function closeDrawer(){$('drawer').classList.remove('open');$('drawerBackdrop').classList.remove('open');}
$('settingsBtn').onclick=()=>location.href='./settings.html'; $('layersBtn').onclick=openDrawer; $('closeDrawer').onclick=closeDrawer; $('drawerBackdrop').onclick=closeDrawer; $('fitBtn').onclick=()=>fit();
$('addBtn').onclick=()=>{$('addInput').value='';$('addInput').click();}; $('newBtn').onclick=()=>{$('newInput').value='';$('newInput').click();};
$('addInput').onchange=e=>loadFiles(e.target.files,false); $('newInput').onchange=e=>loadFiles(e.target.files,true);
['dragenter','dragover'].forEach(t=>$('viewerShell').addEventListener(t,e=>e.preventDefault())); $('viewerShell').addEventListener('drop',e=>{e.preventDefault();loadFiles(e.dataTransfer.files,false);});
window.addEventListener('pageshow',()=>{S=readSettings();draw();}); window.addEventListener('resize',draw); new ResizeObserver(draw).observe(cv);

if(!gl) status('WebGL non disponibile.');
else { ui(); draw(); if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{}); }
