const chords = [
  {name:'Emaj9', notes:'E · B · D♯ · G♯ · F♯', desc:'A glassy open voicing with just enough color to feel unresolved.', moods:['Dreamy','Warm'], style:'Neo soul', difficulty:2, frets:[0,2,1,1,0,2], fingers:['','2','1','1','','3'], tones:[82.41,123.47,155.56,207.65,246.94,369.99]},
  {name:'Bm11', notes:'× · B · D · A · B · E', desc:'Wide, melancholy and effortless—ideal for a ringing clean part.', moods:['Dreamy','Dark'], style:'Ambient', difficulty:1, frets:[-1,2,0,2,0,0], fingers:['','1','','2','',''], tones:[123.47,146.83,220,246.94,329.63]},
  {name:'Fmaj7♯11', notes:'F · × · E · A · B · E', desc:'Luminous tension from the open B and E strings over a low F.', moods:['Tense','Dreamy'], style:'Jazz', difficulty:2, frets:[1,-1,2,2,0,0], fingers:['1','','2','3','',''], tones:[87.31,164.81,220,246.94,329.63]},
  {name:'Em9', notes:'E · B · D · G · B · F♯', desc:'A huge minor-nine that sounds expensive with almost no effort.', moods:['Dark','Open'], style:'Progressive', difficulty:1, frets:[0,2,0,0,0,2], fingers:['','1','','','','2'], tones:[82.41,123.47,146.83,196,246.94,369.99]},
  {name:'G6/9', notes:'G · A · D · A · B · E', desc:'Bright and spacious, with open strings that keep every note breathing.', moods:['Warm','Open'], style:'Math rock', difficulty:1, frets:[3,0,0,2,0,0], fingers:['2','','','1','',''], tones:[98,110,146.83,220,246.94,329.63]},
  {name:'C♯m7', notes:'× · C♯ · G♯ · B · E · G♯', desc:'Compact and smooth, with a soft top voice made for sliding transitions.', moods:['Dark','Warm'], style:'Neo soul', difficulty:3, frets:[-1,4,6,4,5,4], fingers:['','1','3','1','2','1'], tones:[138.59,207.65,246.94,329.63,415.3]},
  {name:'Dmaj9/A', notes:'A · D · F♯ · C♯ · E · A', desc:'A dense, polished major-nine with the fifth anchoring the bass.', moods:['Dreamy','Warm'], style:'Jazz', difficulty:4, frets:[5,5,4,6,5,5], fingers:['2','2','1','4','3','2'], tones:[110,146.83,185,277.18,329.63,440]},
  {name:'B11', notes:'× · B · E · A · C♯ · F♯', desc:'Suspended dominant energy that wants to fall home to E.', moods:['Tense','Open'], style:'Funk', difficulty:2, frets:[-1,2,2,2,2,2], fingers:['','1','1','1','1','1'], tones:[123.47,164.81,220,277.18,369.99]}
];

const moods = ['All','Dreamy','Dark','Warm','Tense','Open'];
let activeMood = 'All';
let saved = new Set(JSON.parse(localStorage.getItem('chord-vault-saved') || '[]'));
let savedOnly = false;
const grid = document.querySelector('#chordGrid');
const themeToggle = document.querySelector('#themeToggle');

function syncThemeToggle(){
  const light=document.documentElement.dataset.theme==='light';
  themeToggle.textContent=light?'☾ Dark':'☼ Light';
  themeToggle.setAttribute('aria-label',light?'Switch to dark mode':'Switch to light mode');
}
themeToggle.addEventListener('click',()=>{
  const next=document.documentElement.dataset.theme==='light'?'dark':'light';
  document.documentElement.dataset.theme=next;
  localStorage.setItem('chord-vault-theme',next);
  syncThemeToggle();
});
syncThemeToggle();

function diagram(chord) {
  const xs=[24,48,72,96,120,144];
  const playedFrets=chord.frets.filter(f=>f>0);
  const baseFret=Math.max(...playedFrets)>5?Math.min(...playedFrets):1;
  const isHigherPosition=baseFret>1;
  const strings=xs.map(x=>`<line x1="${x}" y1="34" x2="${x}" y2="159" class="string"/>`).join('');
  const frets=[34,59,84,109,134,159].map((y,i)=>`<line x1="24" y1="${y}" x2="144" y2="${y}" class="${i===0&&!isHigherPosition?'nut':'fret'}"/>`).join('');
  const marks=chord.frets.map((f,i)=>f<0?`<text x="${xs[i]}" y="22" class="marker">×</text>`:f===0?`<circle cx="${xs[i]}" cy="16" r="5" class="open-marker"/>`:`<g><circle cx="${xs[i]}" cy="${46.5+(f-baseFret)*25}" r="9" class="finger-dot"/><text x="${xs[i]}" y="${50+(f-baseFret)*25}" class="finger-label">${chord.fingers[i]}</text></g>`).join('');
  const fretNumbers=isHigherPosition
    ? [0,1,2,3,4].map(i=>`<text x="169" y="${50+i*25}" class="fret-number">${baseFret+i}</text>`).join('')
    : [1,2,3,4,5].map((n,i)=>`<text x="169" y="${50+i*25}" class="fret-number">${n}</text>`).join('');
  return `<svg class="chord-diagram" viewBox="0 0 184 190" role="img" aria-label="${chord.name} guitar chord diagram${isHigherPosition?`, starting at fret ${baseFret}`:''}">${frets}${strings}${fretNumbers}${marks}${['E','A','D','G','B','e'].map((s,i)=>`<text x="${xs[i]}" y="184" class="string-label">${s}</text>`).join('')}</svg>`;
}

function render() {
  const shown=chords.filter(c=>(activeMood==='All'||c.moods.includes(activeMood))&&(!savedOnly||saved.has(c.name)));
  grid.innerHTML=shown.map((c)=>{const n=chords.indexOf(c)+1; const isSaved=saved.has(c.name); return `<article class="chord-card">
    <span class="card-number">${String(n).padStart(2,'0')}</span><button class="heart ${isSaved?'is-saved':''}" data-save="${c.name}" aria-label="${isSaved?'Remove':'Add'} ${c.name} ${isSaved?'from':'to'} favorites">${isSaved?'♥':'♡'}</button>
    <div class="card-title"><div><h3>${c.name}</h3><p>${c.notes}</p></div><button class="play" data-play="${c.name}" aria-label="Play ${c.name}">▶</button></div>
    ${diagram(c)}<div class="card-footer"><div class="tags">${c.moods.map(m=>`<span>${m}</span>`).join('')}<span>${c.style}</span></div><span class="difficulty" aria-label="Difficulty ${c.difficulty} out of 4"><span class="difficulty-label">Difficulty</span>${[1,2,3,4].map(i=>`<i class="${i<=c.difficulty?'on':''}"></i>`).join('')}</span></div>
  </article>`}).join('');
  document.querySelector('#empty').hidden=shown.length>0;
  updateSaved();
}

function updateSaved(){document.querySelector('#savedCount').textContent=saved.size; const b=document.querySelector('#savedButton'); b.setAttribute('aria-label',`${saved.size} saved chords`); b.classList.toggle('active',savedOnly)}
document.querySelector('.filters').innerHTML=moods.map(m=>`<button type="button" class="${m==='All'?'active':''}" data-mood="${m}" aria-pressed="${m==='All'}">${m}</button>`).join('');
document.querySelector('.filters').addEventListener('click',e=>{const b=e.target.closest('[data-mood]'); if(!b)return; activeMood=b.dataset.mood; document.querySelectorAll('[data-mood]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',x===b)});render()});
grid.addEventListener('click',e=>{const s=e.target.closest('[data-save]'); if(s){saved.has(s.dataset.save)?saved.delete(s.dataset.save):saved.add(s.dataset.save);localStorage.setItem('chord-vault-saved',JSON.stringify([...saved]));render();return} const p=e.target.closest('[data-play]'); if(p) playChord(chords.find(c=>c.name===p.dataset.play),p)});
document.querySelector('#savedButton').addEventListener('click',()=>{savedOnly=!savedOnly;render()});
document.querySelector('#guideDiagram').innerHTML=diagram(chords[1]);

function playChord(chord,button){const AudioCtx=window.AudioContext||window.webkitAudioContext; if(!AudioCtx)return; const ctx=new AudioCtx(); button.classList.add('playing'); chord.tones.forEach((freq,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type='triangle';o.frequency.value=freq;g.gain.setValueAtTime(0,ctx.currentTime+i*.045);g.gain.linearRampToValueAtTime(.06,ctx.currentTime+i*.045+.03);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+1.7+i*.045);o.connect(g).connect(ctx.destination);o.start(ctx.currentTime+i*.045);o.stop(ctx.currentTime+1.8+i*.045)});setTimeout(()=>button.classList.remove('playing'),700)}
render();
