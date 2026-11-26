import{RATE,DURATION,frequency,envelope,synth,resample,analyze,analyzeShifted,random,spectrum,PRESETS,pickPreset}from'./dsp.js?v=10';
import{SoundListener}from'./listener.js?v=2';
const $=id=>document.getElementById(id),canvas=$('scope'),ctx=canvas.getContext('2d');
// [name, title, brief, simulated noise, pass match %, pitch tolerance in octaves, any starting pitch]
const levels=[['First contact','A chirp in the quiet','Follow the dashed curve with a low-to-high hum or whistle. The microphone stays on: chirp whenever you are ready, as often as you like. Start at any pitch that is comfortable.',0,30,.4,true],['Through the static','Find it in the noise','The same chirp, with simulated noise mixed into your recording. Keep your sweep smooth.',1,38,.32,true],['Deep space','Keep your signal clear','More noise, same mission. A sustained rising pitch matters more than volume.',2,44,.25,true],['Shape matters','Every part tells a story','The χ² consistency check is now active, and your chirp must match the dashed curve’s pitch. Keep the sound smooth across the whole sweep.',3,48,.2],['Glitch hunter','Make a signal that belongs','The sine-Gaussian veto is active too. Finish cleanly: avoid clicks, pops, and a sharp squeak.',4,50,.18]];
let unlocked=0;try{unlocked=Math.min(4,Math.max(0,Number(localStorage.getItem('whoop-progress'))||0))}catch{}
// One fixed pitch-shift factor per register, so heavier binaries really do sound lower.
// The spectrogram axis is fixed too (real 7.5–120 Hz, times the factor), so they also sit lower.
const AXIS_LOW=7.5,AXIS_SPAN=16;
// Pass thresholds for the χ² and SG scores, deliberately generous: voices drift in pitch and loudness far more than a real inspiral.
const CHI_MAX=4,SG_MAX=10;
let binary=pickPreset(),scale=12,level=0,base=Math.round(12*binary.fStart),stream,ac,processor,source,mute,capture=false,busy=false,view=null,progress=0,playing=false,pendingCapture=null,attemptId=0,muteUntil=0;
function setStatus(s){$('status').textContent=s}
function showBinary(){$('masses').innerHTML=`<span class="masses-label">THIS CHIRP</span><strong>${binary.m1}&nbsp;M<span class="sun">☉</span> + ${binary.m2}&nbsp;M<span class="sun">☉</span></strong><span class="masses-note">black holes</span>`}
const workspace=document.querySelector('.workspace');
function setFullscreen(on){workspace.classList.toggle('fs',on);document.body.classList.toggle('fs-open',on);$('fullscreen').textContent=on?'Exit full screen ✕':'Full screen ↗';$('fullscreen').setAttribute('aria-pressed',String(on));requestAnimationFrame(draw)}
$('fullscreen').onclick=async()=>{const on=!workspace.classList.contains('fs');try{if(on&&workspace.requestFullscreen)await workspace.requestFullscreen();else if(!on&&document.fullscreenElement)await document.exitFullscreen()}catch{}setFullscreen(on)};
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&workspace.classList.contains('fs'))setFullscreen(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&workspace.classList.contains('fs')&&!document.fullscreenElement)setFullscreen(false)});
function renderLevels(){ $('levels').replaceChildren(...levels.map((l,i)=>{const b=document.createElement('button');b.className='level '+(i===level?'active current':i<unlocked?'done':'future');b.disabled=i>unlocked||busy;b.setAttribute('aria-label',`Level ${i+1}: ${l[0]}`);b.setAttribute('aria-current',i===level?'step':'false');b.innerHTML=`<span class="num">${i<unlocked&&i!==level?'✓':i+1}</span><div><strong>${l[0]}</strong><small>${['Learn the chirp','Noise +','Noise ++','Add chisquared','Add SG veto'][i]}</small></div>`;b.onclick=()=>selectLevel(i);return b}))}
function selectLevel(i){level=i;stopTraceFlash();view=null;progress=0;const l=levels[i];$('levelTag').textContent=`LEVEL 0${i+1} / ${l[0].toUpperCase()}`;$('levelTitle').textContent=l[1];$('brief').textContent=l[2];$('noiseLabel').textContent='NOISE · '+['LOW','MEDIUM','HIGH','HIGH','VERY HIGH'][i];$('chiBadge').textContent=i>=3?'ACTIVE':'LEVEL 4';$('sgBadge').textContent=i>=4?'ACTIVE':'LEVEL 5';$('match').innerHTML='—<small> / 100</small>';$('chi').textContent='—';$('sg').textContent='—';$('result').hidden=true;renderLevels();draw()}
function draw(){const theme=getComputedStyle(document.documentElement),color=name=>theme.getPropertyValue('--'+name).trim();const dpr=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight||220;canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.fillStyle=color('bg');ctx.fillRect(0,0,w,h);const bandsOn=!!(view?.shares&&level>=3),R=bandsOn?Math.min(130,Math.max(80,w*.15)):20,x=t=>20+t/DURATION*(w-20-R),lo=scale*AXIS_LOW,y=f=>h-15-Math.log(Math.max(lo,f)/lo)/Math.log(AXIS_SPAN)*(h-30);ctx.strokeStyle=color('line');ctx.lineWidth=1;for(let i=0;i<7;i++){ctx.beginPath();ctx.moveTo(20+i*(w-40)/6,0);ctx.lineTo(20+i*(w-40)/6,h);ctx.stroke()}for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(0,15+i*(h-30)/4);ctx.lineTo(w,15+i*(h-30)/4);ctx.stroke()}
if(view){const span=Math.max(DURATION,view.span||0),xv=t=>x(t*DURATION/span);for(const fr of view.frames){const max=Math.max(...fr.p,1e-8);for(let k=Math.floor(lo*1024/RATE);k<Math.min(fr.p.length,Math.ceil(lo*AXIS_SPAN*1024/RATE));k++){const a=Math.max(0,(Math.log10(fr.p[k]/max+1e-7)+3)/3);if(a>.05){ctx.fillStyle=color('signal');ctx.globalAlpha=a*.65;ctx.fillRect(xv(fr.t),y((k+1)*RATE/1024),Math.max(2,(w-40)/140),Math.max(2,y(k*RATE/1024)-y((k+1)*RATE/1024)))}}}ctx.globalAlpha=1}
ctx.globalAlpha=traceAlpha;ctx.strokeStyle=color('accent');ctx.lineWidth=2;ctx.setLineDash([5,5]);ctx.beginPath();for(let i=0;i<=120;i++){const t=DURATION*i/120;i?ctx.lineTo(x(t),y(frequency(t,view?.base||base,binary.ratio))):ctx.moveTo(x(t),y(frequency(t,view?.base||base,binary.ratio)))}ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;ctx.font=`${workspace.classList.contains('fs')?15:12}px ${color('font-body')}`;if(bandsOn)drawBands(w,h,R,y);ctx.fillStyle=color('muted');ctx.fillText(`${Math.round(lo*AXIS_SPAN)} Hz`,8,14);ctx.fillText(`${Math.round(lo)} Hz`,8,h-4);if(playing){ctx.strokeStyle=color('white');ctx.beginPath();ctx.moveTo(x(progress),0);ctx.lineTo(x(progress),h);ctx.stroke()}}
// χ² bands beside the spectrogram: each of the six frequency bands is drawn at its true position and width on the frequency axis (at least 10px tall, nudged upward if needed, so thin bands stay visible), with a bar
// showing your share of power in it against the expected equal share (dashed line). Too much is pink; too little is orange, with the shortfall outlined.
// After an attempt, the dashed target fades in and out so your sound in the spectrogram underneath can be seen.
// With reduced motion, the target is shown faintly instead.
let traceAlpha=1,traceTimer=null;
function startTraceFlash(){stopTraceFlash();if(matchMedia('(prefers-reduced-motion: reduce)').matches){traceAlpha=.35;return}const t0=performance.now();traceTimer=setInterval(()=>{traceAlpha=.5+.5*Math.cos((performance.now()-t0)/2400*2*Math.PI);draw()},50)}
function stopTraceFlash(){clearInterval(traceTimer);traceTimer=null;traceAlpha=1}
function drawBands(w,h,R,y){const theme=getComputedStyle(document.documentElement),color=n=>theme.getPropertyValue('--'+n).trim();
 const x0=w-R+10,x1=w-8,mid=x0+(x1-x0)/2,e=1/view.shares.length;ctx.save();
 ctx.fillStyle=color('muted');ctx.textAlign='center';ctx.fillText('χ² BANDS',mid,12);
 let prevTop=Infinity;view.shares.forEach((o,i)=>{const bot=Math.min(y(view.bands[i]),prevTop),top=Math.min(y(view.bands[i+1]),bot-10);prevTop=top;const r=o/e,len=Math.min(1,r/2)*(x1-x0);
  ctx.fillStyle=r>1.35?color('danger'):r<.65?color('warning'):color('success');ctx.globalAlpha=.85;ctx.fillRect(x0,top+1,Math.max(len,r<.65?3:0),Math.max(2,bot-top-2));if(r<.65){ctx.globalAlpha=1;ctx.strokeStyle=color('warning');ctx.lineWidth=1.5;ctx.setLineDash([3,2]);ctx.strokeRect(x0+len,top+1.5,mid-x0-len,Math.max(1,bot-top-3));ctx.setLineDash([]);ctx.lineWidth=1}
  ctx.globalAlpha=1;ctx.strokeStyle=color('line');ctx.strokeRect(x0+.5,top+.5,x1-x0-1,Math.max(1,bot-top-1))});
 ctx.strokeStyle=color('text');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(mid,y(view.bands[0]));ctx.lineTo(mid,y(view.bands[view.bands.length-1]));ctx.stroke();ctx.restore()}
function lock(on){busy=on;$('record').disabled=on&&!stream;$('hear').disabled=on;$('register').disabled=on;$('reset').disabled=on;renderLevels()}
async function context(){ac??=new (window.AudioContext||window.webkitAudioContext)();await ac.resume();return ac}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Peak-frequency spectrogram column from the most recent ~0.15 s of microphone input.
function liveFrame(chunks,t){const n=chunks.reduce((k,c)=>k+c.length,0),samples=new Float32Array(n);let offset=0;for(const c of chunks){samples.set(c,offset);offset+=c.length}const p=spectrum(resample(samples,ac.sampleRate));let pk=0;const lo=scale*AXIS_LOW;for(let j=Math.floor(lo*1024/RATE);j<Math.min(p.length,lo*AXIS_SPAN*1024/RATE);j++)if(p[j]>p[pk])pk=j;return{t,p,peak:pk*RATE/1024}}
// Always-on listening: the SoundListener segments each chirp by loudness against the room's noise floor, and each segment is scored as soon as it ends.
function listen(){
 const listener=new SoundListener(ac.sampleRate),recent=[];
 $('scopeState').textContent='LISTENING';$('record').textContent='■   Stop';$('timer').textContent='MAKE SOME NOISE';
 setStatus('Listening. Make some noise whenever you are ready: start low and sweep up. Press Stop to turn the microphone off.');
 pendingCapture={reject(){},push(input){
  if(playing||performance.now()<muteUntil)return;
  recent.push(new Float32Array(input));if(recent.length>Math.ceil(.15*ac.sampleRate/input.length))recent.shift();
  const e=listener.push(input);
  if(e.started){stopTraceFlash();view={frames:[],span:0};$('result').hidden=true;$('countdown').hidden=true;$('countdown').classList.remove('word','found');$('scopeState').textContent='HEARING YOU…'}
  if(e.active&&view?.frames){progress=listener.elapsed;view.span=progress;view.frames.push(liveFrame(recent,progress));$('timer').textContent=`${progress.toFixed(1)} s`;draw()}
  if(e.ended){$('scopeState').textContent='LISTENING';
   if(e.ended.duration<.4){console.debug('ignored short sound',e.ended.duration);view=null;draw();setStatus('That was very short. Try a longer rising sweep, about 1.5 seconds.');return}
   const l=levels[level];finish((l[6]?analyzeShifted:analyze)(resample(e.ended.audio,ac.sampleRate),resample(e.ended.background,ac.sampleRate),base,l[3],847,binary.ratio,l[5]))}
 }};
}
async function enable(){
 if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access requires HTTPS or localhost and a supported browser.');
 const audio=await context();stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
 source=audio.createMediaStreamSource(stream);processor=audio.createScriptProcessor(2048,1,1);mute=audio.createGain();mute.gain.value=0;
 processor.onaudioprocess=e=>pendingCapture?.push(e.inputBuffer.getChannelData(0));source.connect(processor);processor.connect(mute);mute.connect(audio.destination);
 $('micOff').hidden=false;$('micOff').textContent='Turn off mic';stream.getAudioTracks()[0].onended=()=>{stopMic();setStatus('Microphone disconnected. Reconnect it and try again.')};
}
function releaseMic(){
 const error=new Error('Recording cancelled.');error.name='AbortError';pendingCapture?.reject(error);pendingCapture=null;capture=false;
 const current=stream;stream=null;current?.getTracks().forEach(t=>{t.onended=null;t.stop()});processor?.disconnect();source?.disconnect();mute?.disconnect();processor=null;source=null;$('micOff').hidden=true;$('countdown').hidden=true;$('countdown').classList.remove('word','found');$('scopeState').textContent='READY TO RECORD';$('record').textContent='▶   Start';
}
function finish(result,demo=false){view=result;startTraceFlash();draw();$('match').innerHTML=`${result.match}<small> / 100</small>`;$('chi').textContent=result.chi.toFixed(2);$('sg').textContent=result.sg>999?'999+':result.sg.toFixed(2);const l=levels[level],passes=result.match>=l[4]&&result.rise>=1.25&&(level<3||result.chi<CHI_MAX)&&(level<4||result.sg<SG_MAX);$('result').hidden=false;$('resultTitle').textContent=(demo?'DEMO · ':'')+(passes?'Whoop! There it is!':'Keep searching.');let feedback=[];if(result.rise<1.25)feedback.push('Your pitch needs to rise: start low and finish higher.');else if(result.match<l[4])feedback.push(`Aim for ${l[4]}% match: start low and accelerate your pitch near the end.`);if(level>=3&&result.chi>=CHI_MAX)feedback.push(`Keep a steady, smooth envelope throughout the chirp (χ² target < ${CHI_MAX}).`);if(level>=4&&result.sg>=SG_MAX)feedback.push(`Excess high-frequency power: finish softly, without a pop or squeak (SG target < ${SG_MAX}).`);if(result.rms<.001&&!demo)feedback=['The microphone heard very little. Check the input device and move closer.'];$('resultText').textContent=feedback.join(' ')||(demo?'This generated chirp shows the target shape. Try it with your voice to unlock the next level.':'Your rising signal passed this level’s checks. '+(level===4?'You found your signal: all five missions complete. Try again in another register.':'Ready for the next challenge?'));$('next').hidden=!passes||demo||level===4;if(passes&&!demo){const c=$('countdown');c.classList.add('word','found');c.innerHTML='WHOOP!<small>THERE IT IS</small>';c.hidden=false;setTimeout(()=>{if(c.classList.contains('found')){c.hidden=true;c.classList.remove('word','found')}},2500)}if(passes&&!demo){unlocked=Math.max(unlocked,Math.min(4,level+1));try{localStorage.setItem('whoop-progress',unlocked)}catch{}renderLevels()}setStatus(demo?'Generated audio analysed locally. Demo runs do not unlock levels.':passes?'Signal found. Still listening: make some noise again any time, or press Stop.':'Still listening. Make some noise again any time, or press Stop.');$('timer').textContent=demo?'GENERATED DEMO':`${result.duration.toFixed(1)} SECOND CHIRP`}
$('record').onclick=async()=>{
 if(stream){stopMic();return}
 lock(true);const id=++attemptId;
 try{
  await enable();if(id!==attemptId)return;binary=pickPreset(binary);base=Math.round(scale*binary.fStart);showBinary();view=null;progress=0;$('result').hidden=true;draw();
  $('countdown').hidden=false;$('countdown').classList.add('word');$('countdown').textContent='LISTEN';await playChirp();if(id!==attemptId)return;$('countdown').hidden=true;$('countdown').classList.remove('word');
  listen();
 }catch(e){releaseMic();setStatus(e.name==='NotAllowedError'?'Microphone permission was denied. Allow it in browser settings, then press Start.':e.name==='NotFoundError'?'No microphone found. Connect a microphone, then press Start.':e.message)}finally{lock(false);if(stream)$('record').textContent='■   Stop'}
};
async function playChirp(){playing=true;try{const audio=await context(),data=synth(base,'chirp',binary.ratio),buffer=audio.createBuffer(1,data.length,RATE);buffer.copyToChannel(data,0);const player=audio.createBufferSource(),gain=audio.createGain();gain.gain.value=.5;player.buffer=buffer;player.connect(gain);gain.connect(audio.destination);setStatus('Listen for the accelerating rise. Your turn comes next.');const t0=audio.currentTime+.02;player.start(t0);progress=0;let frame;const tick=()=>{progress=Math.max(0,Math.min(DURATION,audio.currentTime-t0));draw();frame=requestAnimationFrame(tick)};frame=requestAnimationFrame(tick);await new Promise(r=>player.onended=r);cancelAnimationFrame(frame)}finally{playing=false;muteUntil=performance.now()+400;progress=0;draw()}}
$('hear').onclick=async()=>{lock(true);try{await playChirp();setStatus(stream?'Still listening. Copy the sound whenever you are ready.':'Press Start, then copy the sound whenever you are ready.')}catch(e){setStatus('Playback unavailable: '+e.message)}finally{lock(false)}};
$('next').onclick=()=>selectLevel(Math.min(4,level+1));$('register').onchange=()=>{scale=Number($('register').value);base=Math.round(scale*binary.fStart);selectLevel(level)};$('reset').onclick=()=>{unlocked=0;try{localStorage.removeItem('whoop-progress')}catch{}selectLevel(0);setStatus('Progress reset. Start a new mission.')};
function stopMic(){attemptId++;releaseMic();$('scopeState').textContent='READY TO RECORD';setStatus('Microphone off. Press Start when ready.')}$('stop').onclick=stopMic;$('micOff').onclick=stopMic;window.addEventListener('pagehide',()=>{stopMic();ac?.close()});window.addEventListener('resize',draw);selectLevel(0);
showBinary();
