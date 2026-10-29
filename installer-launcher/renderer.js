const $=s=>document.querySelector(s),scr=[...document.querySelectorAll('.scr')];
const M=[[0,'Preparando arquivos…'],[25,'Copiando o Nexo…'],[55,'Configurando sensores…'],[80,'Criando atalhos…'],[95,'Finalizando…']];
let dir=null,running=false;
const go=n=>scr.forEach((s,i)=>s.classList.toggle('on',i===n));
const set=p=>{$('#fill').style.width=p+'%';$('#pct').textContent=p+'%';$('#st').textContent=M.filter(m=>p>=m[0]).pop()[1]};
async function start(){
 if(running)return;running=true;$('#err').hidden=true;set(0);go(2);
 const r=await nexo.install({dir,desktop:$('#o-desk').checked,runAfter:$('#o-run').checked,telemetry:$('#o-tel').checked});
 running=false;
 if(!r.ok){$('#st').textContent='Algo deu errado na instalação (código '+r.code+').';$('#err').hidden=false;return}
 set(100);setTimeout(()=>{go(3);if($('#o-run').checked)setTimeout(()=>nexo.openApp(),1500)},600)}
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{const n=+b.dataset.go;n===2?start():go(n)});
$('#retry').onclick=start;$('#open').onclick=()=>nexo.openApp();
$('#close2').onclick=$('#close3').onclick=$('#x').onclick=()=>nexo.close();
$('#min').onclick=()=>nexo.minimize();
$('#pick').onclick=async()=>{const d=await nexo.pickDir();if(d){dir=d;$('#dir').textContent=d}};
$('#pl').onclick=e=>{const o=$('#priv').classList.toggle('on');e.target.setAttribute('aria-expanded',o)};
nexo.onProgress(set);nexo.info().then(i=>$('#dir').textContent=i.defaultDir);
go(0);
const win=$('#win'),bg=$('#bg');
win.addEventListener('pointermove',e=>{const r=win.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;bg.style.transform=`translate(${-x*14}px,${-y*10}px)`});
win.addEventListener('pointerleave',()=>bg.style.transform='');
if(!matchMedia('(prefers-reduced-motion:reduce)').matches){
 const c=$('#fx'),x=c.getContext('2d');let W,H,S=[],P=[],last=0,next=900;
 const rs=()=>{const r=c.getBoundingClientRect(),d=devicePixelRatio||1;W=c.width=r.width*d;H=c.height=r.height*d};rs();addEventListener('resize',rs);
 for(let i=0;i<34;i++)P.push({x:Math.random(),y:Math.random(),r:Math.random()*1.6+.4,s:Math.random()*6e-5+2e-5,p:Math.random()*6.28});
 (function f(t){const dt=t-last;last=t;x.clearRect(0,0,W,H);
  P.forEach(o=>{o.y-=o.s*dt;if(o.y<-.02)o.y=1.02;x.fillStyle=`rgba(150,210,255,${.25+.25*Math.sin(t/900+o.p)})`;x.beginPath();x.arc(o.x*W,o.y*H,o.r*W/900,0,6.28);x.fill()});
  if(t>next){S.push({x:W*(.5+Math.random()*.55),l:0});next=t+1800+Math.random()*3200}
  S=S.filter(s=>s.l<1);
  S.forEach(s=>{s.l+=dt/1100;const k=s.l,hx=s.x-k*W*.5,hy=-20+k*H*.85,L=W*.17,tx=hx+.55*L,ty=hy-.83*L,a=Math.sin(k*Math.PI);
   const g=x.createLinearGradient(hx,hy,tx,ty);g.addColorStop(0,`rgba(210,240,255,${a})`);g.addColorStop(1,'rgba(90,150,255,0)');
   x.strokeStyle=g;x.lineWidth=W/450;x.lineCap='round';x.beginPath();x.moveTo(hx,hy);x.lineTo(tx,ty);x.stroke();
   x.fillStyle=`rgba(230,248,255,${a})`;x.shadowColor='#5ad7ff';x.shadowBlur=W/70;x.beginPath();x.arc(hx,hy,W/450*1.2,0,6.28);x.fill();x.shadowBlur=0});
  requestAnimationFrame(f)})(0)}
