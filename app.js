import { CANONICAL_VOICINGS } from './src/chords/canonical.ts';

const curatedChords = [
  {name:'Emaj9', notes:'E · B · D♯ · G♯ · F♯', desc:'A glassy open voicing with just enough color to feel unresolved.', moods:['Dreamy','Warm'], style:'Neo soul', difficulty:2, frets:[0,2,1,1,0,2], fingers:['','2','1','1','','3'], tones:[82.41,123.47,155.56,207.65,246.94,369.99]},
  {name:'Bm11', notes:'× · B · D · A · B · E', desc:'Wide, melancholy and effortless—ideal for a ringing clean part.', moods:['Dreamy','Dark'], style:'Ambient', difficulty:1, frets:[-1,2,0,2,0,0], fingers:['','1','','2','',''], tones:[123.47,146.83,220,246.94,329.63]},
  {name:'Fmaj7♯11', notes:'F · × · E · A · B · E', desc:'Luminous tension from the open B and E strings over a low F.', moods:['Tense','Dreamy'], style:'Jazz', difficulty:2, frets:[1,-1,2,2,0,0], fingers:['1','','2','3','',''], tones:[87.31,164.81,220,246.94,329.63]},
  {name:'Em9', notes:'E · B · D · G · B · F♯', desc:'A huge minor-nine that sounds expensive with almost no effort.', moods:['Dark','Open'], style:'Progressive', difficulty:1, frets:[0,2,0,0,0,2], fingers:['','1','','','','2'], tones:[82.41,123.47,146.83,196,246.94,369.99]},
  {name:'G6/9', notes:'G · A · D · A · B · E', desc:'Bright and spacious, with open strings that keep every note breathing.', moods:['Warm','Open'], style:'Math rock', difficulty:1, frets:[3,0,0,2,0,0], fingers:['2','','','1','',''], tones:[98,110,146.83,220,246.94,329.63]},
  {name:'C♯m7', notes:'× · C♯ · G♯ · B · E · G♯', desc:'Compact and smooth, with a soft top voice made for sliding transitions.', moods:['Dark','Warm'], style:'Neo soul', difficulty:3, frets:[-1,4,6,4,5,4], fingers:['','1','3','1','2','1'], tones:[138.59,207.65,246.94,329.63,415.3]},
  {name:'Dmaj9/A', notes:'A · D · F♯ · C♯ · E · A', desc:'A dense, polished major-nine with the fifth anchoring the bass.', moods:['Dreamy','Warm'], style:'Jazz', difficulty:4, frets:[5,5,4,6,5,5], fingers:['2','2','1','4','3','2'], tones:[110,146.83,185,277.18,329.63,440]},
  {name:'B11', notes:'× · B · E · A · C♯ · F♯', desc:'Suspended dominant energy that wants to fall home to E.', moods:['Tense','Open'], style:'Funk', difficulty:2, frets:[-1,2,2,2,2,2], fingers:['','1','1','1','1','1'], tones:[123.47,164.81,220,277.18,369.99]}
];

const canonicalBase=CANONICAL_VOICINGS.map(voicing=>({
  name:voicing.chordName,
  notes:voicing.fretPositions.map((fret,index)=>fret===null?'×':voicing.notes[voicing.fretPositions.slice(0,index+1).filter(value=>value!==null).length-1]).join(' · '),
  moods:[],style:voicing.shapeFamily,difficulty:voicing.difficulty,
  frets:voicing.fretPositions.map(fret=>fret??-1),
  fingers:(voicing.fingerPositions??voicing.fretPositions.map(()=>null)).map(finger=>finger??''),
  tones:voicing.fretPositions.flatMap((fret,index)=>fret===null?[]:[440*2**((voicing.tuning.strings[index].midi+fret-69)/12)]),
  chordQuality:voicing.chordQuality,root:voicing.root,isEssential:true,isCanonical:true,
  category:voicing.category,displayPriority:voicing.displayPriority,movable:voicing.movable,shapeFamily:voicing.shapeFamily,
}));
const curatedByKey=new Map(curatedChords.map(chord=>[`${chord.name}|${chord.frets.join('-')}`,chord]));
const canonicalChords=canonicalBase.map(chord=>{
  const curated=curatedByKey.get(`${chord.name}|${chord.frets.join('-')}`);
  return curated?{...chord,...curated,chordQuality:chord.chordQuality,root:chord.root,isEssential:true,isCanonical:true,category:chord.category,displayPriority:chord.displayPriority,movable:chord.movable,shapeFamily:chord.shapeFamily}:chord;
});
const canonicalKeys=new Set(canonicalChords.map(chord=>`${chord.name}|${chord.frets.join('-')}`));
const chordRecords=[...canonicalChords,...curatedChords.filter(chord=>!canonicalKeys.has(`${chord.name}|${chord.frets.join('-')}`)).map(chord=>({...chord,category:'Other Approved',displayPriority:100}))]
  .sort((left,right)=>(left.category==='Essential Open'?10:left.category==='Essential Barre'?20:100)-(right.category==='Essential Open'?10:right.category==='Essential Barre'?20:100)
    ||(left.displayPriority??999)-(right.displayPriority??999)||left.difficulty-right.difficulty||left.name.localeCompare(right.name));
const chords=chordRecords.map((chord,index)=>({...chord,vaultIndex:index+1,rootKey:chordRoot(chord),qualityFamilyKey:qualityFamily(chord),recipeFamilyKey:recipeFamily(chord)}));

let activeMood = 'All';
let activeRoot = 'All';
let activeQuality = 'All';
let activeRecipe = 'All';
let saved = new Set(JSON.parse(localStorage.getItem('chord-vault-saved') || '[]'));
let savedOnly = false;
let pageStart = 0;
const grid = document.querySelector('#chordGrid');
const noteFilters = document.querySelector('#noteFilters');
const qualityFilters = document.querySelector('#qualityFilters');
const recipeFilters = document.querySelector('#recipeFilters');
const pagination = document.querySelector('#pagination');
const pageNumbers = document.querySelector('#pageNumbers');
const previousPage = document.querySelector('#previousPage');
const nextPage = document.querySelector('#nextPage');
const themeToggle = document.querySelector('#themeToggle');
const menuToggle = document.querySelector('#menuToggle');
const navPanel = document.querySelector('#navPanel');

function setMenu(open){
  navPanel.classList.toggle('open',open);
  menuToggle.setAttribute('aria-expanded',String(open));
  menuToggle.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');
}
menuToggle.addEventListener('click',()=>setMenu(menuToggle.getAttribute('aria-expanded')!=='true'));
navPanel.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>setMenu(false)));
document.addEventListener('keydown',event=>{if(event.key==='Escape')setMenu(false)});

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

const ROOT_ORDER=['All','A','A#','B','C','C#','D','D#','E','F','F#','G','G#'];
noteFilters.innerHTML=ROOT_ORDER.map(root=>`<button type="button" data-root="${root}" class="${root==='All'?'active':''}" aria-pressed="${root==='All'}">${root}</button>`).join('');
const QUALITY_OPTIONS=['All','Major','Minor'];
const RECIPE_OPTIONS=['All','Triad','7th','Sus','9th','11th'];
qualityFilters.innerHTML=QUALITY_OPTIONS.map(value=>`<button type="button" data-quality="${value}" class="${value==='All'?'active':''}" aria-pressed="${value==='All'}">${value}</button>`).join('');
recipeFilters.innerHTML=RECIPE_OPTIONS.map(value=>`<button type="button" data-recipe="${value}" class="${value==='All'?'active':''}" aria-pressed="${value==='All'}">${value}</button>`).join('');

function chordRoot(chord){
  if(chord.root)return chord.root;
  return chord.name.match(/^[A-G](?:#|♯|b|♭)?/)?.[0].replace('♯','#').replace('♭','b')??'';
}

function chordQuality(chord){
  if(chord.chordQuality)return chord.chordQuality;
  const name=chord.name.toLowerCase();
  if(name.includes('m11'))return 'min11';
  if(name.includes('maj9'))return 'maj9';
  if(name.includes('m9'))return 'min9';
  if(name.includes('maj7'))return 'maj7';
  if(name.includes('m7'))return 'min7';
  if(name.includes('sus2'))return 'sus2';
  if(name.includes('sus4')||name.includes('sus'))return 'sus4';
  if(name.includes('7'))return 'dom7';
  if(/^([a-g](?:#|b)?m)(?!aj)/i.test(name))return 'minor';
  return 'major';
}

function qualityFamily(chord){
  const quality=chordQuality(chord);
  if(['minor','min7','min9','min11'].includes(quality))return 'Minor';
  if(['major','dom7','maj7','maj9'].includes(quality))return 'Major';
  return 'Neither';
}

function recipeFamily(chord){
  const quality=chordQuality(chord);
  if(['major','minor'].includes(quality))return 'Triad';
  if(['dom7','maj7','min7'].includes(quality))return '7th';
  if(['sus2','sus4'].includes(quality))return 'Sus';
  if(['maj9','min9'].includes(quality))return '9th';
  if(quality==='min11')return '11th';
  return 'Other';
}

function filteredChords(){
  return chords.filter(c=>(activeMood==='All'||c.moods.includes(activeMood))
    &&(activeRoot==='All'||c.rootKey===activeRoot)
    &&(activeQuality==='All'||c.qualityFamilyKey===activeQuality)
    &&(activeRecipe==='All'||c.recipeFamilyKey===activeRecipe)
    &&(!savedOnly||saved.has(c.name)));
}

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
  const shown=filteredChords();
  const pageSize=12;
  if(pageStart>=shown.length)pageStart=0;
  const visibleChords=shown.slice(pageStart,pageStart+pageSize);
  grid.innerHTML=visibleChords.map((c)=>{const n=c.vaultIndex; const isSaved=saved.has(c.name); return `<article class="chord-card">
    <span class="card-number">${String(n).padStart(2,'0')}</span><button class="heart ${isSaved?'is-saved':''}" data-save="${c.name}" aria-label="${isSaved?'Remove':'Add'} ${c.name} ${isSaved?'from':'to'} favorites">${isSaved?'♥':'♡'}</button>
    <div class="card-title"><div><h3>${c.name}</h3><p>${c.notes}</p></div><button class="play" data-play="${c.name}" aria-label="Play ${c.name}">▶</button></div>
    ${diagram(c)}<div class="card-footer"><div class="tags">${c.isEssential&&c.displayPriority===1?'<span class="essential-badge">Essential</span>':''}${c.category==='Essential Open'?'<span>Open</span>':''}${c.category==='Essential Barre'?'<span>Barre</span>':''}${c.movable?'<span>Movable</span>':''}${c.moods.map(m=>`<span>${m}</span>`).join('')}${c.category==='Essential Open'?'':`<span>${c.shapeFamily??c.style}</span>`}</div><span class="difficulty" aria-label="Difficulty ${c.difficulty} out of 4"><span class="difficulty-label">Difficulty</span>${[1,2,3,4].map(i=>`<i class="${i<=c.difficulty?'on':''}"></i>`).join('')}</span></div>
  </article>`}).join('');
  document.querySelector('#empty').hidden=shown.length>0;
  const pageCount=Math.max(1,Math.ceil(shown.length/pageSize));
  const currentPage=Math.floor(pageStart/pageSize)+1;
  pagination.hidden=shown.length===0;
  previousPage.disabled=currentPage===1;
  nextPage.disabled=currentPage===pageCount;
  pageNumbers.innerHTML=Array.from({length:pageCount},(_,index)=>index+1).map(page=>`<button type="button" data-page="${page}" class="${page===currentPage?'active':''}" aria-label="Page ${page}" aria-current="${page===currentPage?'page':'false'}">${page}</button>`).join('');
  syncPlayCooldown();
  updateSaved();
}

function updateSaved(){document.querySelector('#savedCount').textContent=saved.size; const b=document.querySelector('#savedButton'); b.setAttribute('aria-label',`${saved.size} saved chords`); b.classList.toggle('active',savedOnly)}
document.querySelector('.filters').addEventListener('click',e=>{const b=e.target.closest('[data-mood]'); if(!b)return; activeMood=b.dataset.mood;pageStart=0; document.querySelectorAll('[data-mood]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',x===b)});render()});
noteFilters.addEventListener('click',event=>{const button=event.target.closest('[data-root]');if(!button)return;activeRoot=button.dataset.root;pageStart=0;noteFilters.querySelectorAll('[data-root]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',item===button)});render()});
qualityFilters.addEventListener('click',event=>{const button=event.target.closest('[data-quality]');if(!button)return;activeQuality=button.dataset.quality;pageStart=0;qualityFilters.querySelectorAll('[data-quality]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',item===button)});render()});
recipeFilters.addEventListener('click',event=>{const button=event.target.closest('[data-recipe]');if(!button)return;activeRecipe=button.dataset.recipe;pageStart=0;recipeFilters.querySelectorAll('[data-recipe]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',item===button)});render()});
grid.addEventListener('click',e=>{const s=e.target.closest('[data-save]'); if(s){saved.has(s.dataset.save)?saved.delete(s.dataset.save):saved.add(s.dataset.save);localStorage.setItem('chord-vault-saved',JSON.stringify([...saved]));render();return} const p=e.target.closest('[data-play]'); if(p) playChord(chords.find(c=>c.name===p.dataset.play),p)});
document.querySelector('#savedButton').addEventListener('click',()=>{savedOnly=!savedOnly;pageStart=0;render()});
function goToPage(page){pageStart=(page-1)*12;render();grid.scrollIntoView({behavior:'smooth',block:'start'})}
previousPage.addEventListener('click',()=>goToPage(Math.max(1,pageStart/12)));
nextPage.addEventListener('click',()=>goToPage(pageStart/12+2));
pageNumbers.addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(button)goToPage(Number(button.dataset.page))});
document.querySelector('#guideDiagram').innerHTML=diagram(chords[1]);

let audioContext;
let activeOscillators=[];
let activePlayButton;
let playCooldownUntil=0;
let playCooldownTimer;

function syncPlayCooldown(){
  const coolingDown=Date.now()<playCooldownUntil;
  document.querySelectorAll('.play').forEach(button=>{
    button.disabled=coolingDown;
    const name=button.dataset.play;
    button.setAttribute('aria-label',coolingDown?`Please wait before playing ${name} again`:`Play ${name}`);
  });
}

function beginPlayCooldown(){
  playCooldownUntil=Date.now()+500;
  clearTimeout(playCooldownTimer);
  syncPlayCooldown();
  playCooldownTimer=setTimeout(()=>{playCooldownUntil=0;syncPlayCooldown()},500);
}

function playChord(chord,button){
  if(Date.now()<playCooldownUntil)return;
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx)return;
  beginPlayCooldown();
  audioContext??=new AudioCtx();
  if(audioContext.state==='suspended')audioContext.resume();
  activeOscillators.forEach(oscillator=>{try{oscillator.stop()}catch{}});
  activeOscillators=[];
  activePlayButton?.classList.remove('playing');
  activePlayButton=button;
  button.classList.add('playing');
  chord.tones.forEach((freq,i)=>{
    const oscillator=audioContext.createOscillator();
    const gain=audioContext.createGain();
    oscillator.type='triangle';
    oscillator.frequency.value=freq;
    gain.gain.setValueAtTime(.001,audioContext.currentTime+i*.045);
    gain.gain.linearRampToValueAtTime(.06,audioContext.currentTime+i*.045+.03);
    gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+1.7+i*.045);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(audioContext.currentTime+i*.045);
    oscillator.stop(audioContext.currentTime+1.8+i*.045);
    activeOscillators.push(oscillator);
  });
  setTimeout(()=>{button.classList.remove('playing');if(activePlayButton===button)activePlayButton=undefined},700);
}
render();
