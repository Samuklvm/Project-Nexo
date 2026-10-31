const $=s=>document.querySelector(s),scr=[...document.querySelectorAll('.scr')];
let running=false;
const EN={"Cuide do seu PC": "Care for your PC", "sob as estrelas.": "under the stars.", "Análise que aprende a sua rotina, limpeza segura e monitoramento — tudo feito localmente.": "Analysis that learns your routine, safe cleanup and monitoring — all done locally.", "Li e aceito os": "I have read and accept the", "Avisos e a Privacidade": "Notices and Privacy", ". O compartilhamento com o criador é opcional e começa desativado.": ". Sharing with the creator is optional and starts off.", "Opções": "Options", "Instalar": "Install", "Opções de instalação": "Install options", "Pasta de destino": "Destination folder", "Alterar": "Change", "Atalho na área de trabalho": "Desktop shortcut", "Abrir o Nexo ao terminar": "Open Nexo when finished", "Compartilhar dados opcionais com o criador": "Share optional data with the creator", "Desativado por padrão": "Off by default", "O que o Nexo guarda neste PC?": "What does Nexo store on this PC?", "Voltar": "Back", "Preparando arquivos…": "Preparing files…", "Copiando o Nexo…": "Copying Nexo…", "Configurando sensores…": "Setting up sensors…", "Criando atalhos…": "Creating shortcuts…", "Finalizando…": "Finishing…", "Fechar": "Close", "Tentar de novo": "Try again", "Tudo pronto.": "All set.", "O Nexo Device Care foi instalado com sucesso.": "Nexo Device Care was installed successfully.", "Abrir o Nexo": "Open Nexo", "Avisos e privacidade": "Notices and privacy", "Avisos": "Notices", "Os indicadores e as recomendações são heurísticos: não garantem ganho de desempenho nem substituem avaliação técnica.": "Indicators and recommendations are heuristic: they do not guarantee a performance gain or replace a technical assessment.", "A limpeza mostra uma prévia e só mexe em arquivos antigos. Esvaziar a Lixeira, se você escolher, não pode ser desfeito.": "Cleanup shows a preview and only touches old files. Emptying the Recycle Bin, if you choose it, cannot be undone.", "Otimizar unidades e verificar arquivos do Windows usam ferramentas nativas e podem pedir permissão de administrador.": "Drive optimization and Windows file checks use native tools and may ask for administrator permission.", "O que o Nexo guarda neste PC (nada sai dele)": "What Nexo stores on this PC (none of it leaves it)", "Painel: nome do computador, versões do Windows e do app, tempo ligado, uso de CPU, RAM e discos, temperaturas e uso da GPU quando houver sensor.": "Dashboard: computer name, Windows and app versions, uptime, CPU, RAM and disk use, temperatures and GPU use when a sensor exists.", "Diagnóstico: nome e uso dos programas que mais consomem. Durante lentidões, só o nome do programa é guardado (sem caminho nem linha de comando).": "Diagnostics: name and use of the heaviest programs. During slowdowns, only the program name is stored (no path or command line).", "Aprendizado local: amostras por minuto (até 7 dias), médias por hora da semana, lentidões detectadas e até 60 programas recorrentes.": "Local learning: per-minute samples (up to 7 days), averages by hour of the week, detected slowdowns and up to 60 recurring programs.", "Limpeza e otimização: caminho, tamanho e quantidade de arquivos antigos; plano de energia e programas de inicialização, lidos só para exibir.": "Cleanup and optimization: path, size and count of old files; power plan and startup programs, read for display only.", "Preferências: avaliações das sugestões (até 100), últimas 20 atividades e o papel de parede escolhido.": "Preferences: suggestion ratings (up to 100), last 20 activities and the chosen wallpaper.", "Tudo pode ser exportado ou apagado em Ajustes.": "Everything can be exported or erased in Settings.", "Rede e compartilhamento": "Network and sharing", "Ao abrir, o app consulta as releases públicas do GitHub, que pode receber dados normais da conexão (como o IP). O download só começa por ação sua.": "On launch, the app checks public GitHub releases; GitHub may receive normal connection data (such as the IP). Downloads only start when you ask.", "O compartilhamento opcional com o criador começa desativado. Nesta versão a escolha só é guardada aqui: o Nexo não envia telemetria.": "Optional sharing with the creator starts off. In this version the choice is only stored here: Nexo does not send telemetry.", "Desinstalação": "Uninstalling", "Desinstalar pelo Windows, ou por Ajustes, remove o programa, os dados, as preferências, os atalhos e as entradas do Registro. Atualizações preservam os seus dados.": "Uninstalling through Windows, or through Settings, removes the program, data, preferences, shortcuts and Registry entries. Updates keep your data.", "Política completa no GitHub": "Full policy on GitHub", "Entendi": "Got it"};
let lang=(navigator.language||'pt').toLowerCase().startsWith('pt')?'pt':'en';
const t=s=>lang==='en'&&EN[s]?EN[s]:s;
const srcText=new WeakMap();
function applyLang(){
 const walker=document.createTreeWalker(document.querySelector('.win'),NodeFilter.SHOW_TEXT);let n;
 while(n=walker.nextNode()){
  if(!srcText.has(n)){const k=n.nodeValue.trim();if(!EN[k])continue;srcText.set(n,n.nodeValue)}
  const raw=srcText.get(n),k=raw.trim();n.nodeValue=lang==='en'?raw.replace(k,EN[k]):raw}
 document.documentElement.lang=lang==='en'?'en':'pt-BR';
 $('#lang').textContent=lang==='en'?'PT':'EN';$('#lang').setAttribute('aria-label',lang==='en'?'Idioma: português':'Language: English');
 if(running)set(lastPct);else if(errCode!==null)showError()}
$('#lang').onclick=()=>{lang=lang==='en'?'pt':'en';applyLang()};
const M=[[0,'Preparando arquivos…'],[25,'Copiando o Nexo…'],[55,'Configurando sensores…'],[80,'Criando atalhos…'],[95,'Finalizando…']];
let dir=null;
const go=n=>scr.forEach((s,i)=>s.classList.toggle('on',i===n));
let lastPct=0,errCode=null;const showError=()=>{$('#st').textContent=lang==='en'?'Something went wrong during installation (code '+errCode+').':'Algo deu errado na instalação (código '+errCode+').'};const set=p=>{lastPct=p;$('#fill').style.width=p+'%';$('#pct').textContent=p+'%';$('#st').textContent=t(M.filter(m=>p>=m[0]).pop()[1])};
async function start(){
 if(running)return;if(!$('#agree').checked){go(0);return}running=true;$('#err').hidden=true;set(0);go(2);
 const r=await nexo.install({dir,desktop:$('#o-desk').checked,runAfter:$('#o-run').checked,telemetry:$('#o-tel').checked});
 running=false;
 if(!r.ok){errCode=r.code;showError();$('#err').hidden=false;return}
 set(100);setTimeout(()=>{go(3);if($('#o-run').checked)setTimeout(()=>nexo.openApp(),1500)},600)}
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{const n=+b.dataset.go;n===2?start():go(n)});
$('#retry').onclick=start;$('#open').onclick=()=>nexo.openApp();
$('#close2').onclick=$('#close3').onclick=$('#x').onclick=()=>nexo.close();
$('#min').onclick=()=>nexo.minimize();
$('#pick').onclick=async()=>{const d=await nexo.pickDir();if(d){dir=d;$('#dir').textContent=d}};
const agree=$('#agree'),gated=[...document.querySelectorAll('.pri[data-go="2"]')];
const syncAgree=()=>gated.forEach(b=>{b.disabled=!agree.checked});syncAgree();agree.onchange=syncAgree;
const openNotices=()=>{$('#notices').hidden=false;$('#close-notices').focus()};
$('#open-notices').onclick=openNotices;$('#pl').onclick=openNotices;
$('#close-notices').onclick=()=>{$('#notices').hidden=true};
$('#notices-policy').onclick=()=>nexo.openLink('privacy');
addEventListener('keydown',e=>{if(e.key==='Escape')$('#notices').hidden=true});
nexo.onProgress(set);nexo.info().then(i=>$('#dir').textContent=i.defaultDir);
go(0);applyLang();
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
