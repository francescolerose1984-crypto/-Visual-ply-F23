const KEY='roadcloud-viewer-settings-v1';
export const DEFAULTS={maxPoints:2000000,pointSize:2,colorMode:'auto',background:'black',autoPivot:true,fov:55,zoomSpeed:1,orbitSpeed:1,panSpeed:1,invertX:false,invertY:false};
export function readSettings(){try{return {...DEFAULTS,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return {...DEFAULTS}}}
export function saveSettings(s){localStorage.setItem(KEY,JSON.stringify(s))}

const el=id=>document.getElementById(id);
if(el('back')){
  let state=readSettings();
  const controls=['maxPoints','pointSize','colorMode','background','autoPivot','fov','zoomSpeed','orbitSpeed','panSpeed','invertX','invertY'];
  function render(){for(const k of controls){const n=el(k);if(!n)continue;if(n.type==='checkbox')n.checked=!!state[k];else n.value=state[k]}el('pointSizeV').textContent=Number(state.pointSize).toFixed(1)+' px';el('fovV').textContent=state.fov+'°';el('zoomSpeedV').textContent=Number(state.zoomSpeed).toFixed(1)+'×';el('orbitSpeedV').textContent=Number(state.orbitSpeed).toFixed(1)+'×';el('panSpeedV').textContent=Number(state.panSpeed).toFixed(1)+'×'}
  function pull(){for(const k of controls){const n=el(k);if(!n)continue;let v=n.type==='checkbox'?n.checked:n.value;if(['maxPoints','pointSize','fov','zoomSpeed','orbitSpeed','panSpeed'].includes(k))v=Number(v);state[k]=v}saveSettings(state);render()}
  for(const k of controls)el(k)?.addEventListener('input',pull);
  el('reset').addEventListener('click',()=>{state={...DEFAULTS};saveSettings(state);render()});
  el('back').addEventListener('click',()=>{if(history.length>1)history.back();else location.href='./'});
  render();
}