import { CANONICAL_VOICINGS } from './src/chords/canonical.ts';
import { createChordRepository } from './src/chords/repository-composition.ts';
import { recipeById, recipeIdFromChordName } from './src/chords/recipes.ts';
import { displayBarre } from './src/chords/diagram.ts';
import { legacyChordSlug } from './src/chords/slug.ts';
import { matchesAnyFilter, toggleFilterValue } from './src/chords/filtering.ts';
import { MOOD_TAGS, STYLE_TAGS, normalizedDescriptorTags, normalizedMoodTags, normalizedStyleTags } from './src/chords/tags.ts';
import { resolveFavoriteIds } from './src/chords/favorites.ts';

const {repository:chordRepository,capabilities:repositoryCapabilities}=await createChordRepository({localStorage,sessionStorage,env:import.meta.env});
const repositoryWorkspace=chordRepository.loadWorkspace();

const COMMON_OPEN_FINGERS=new Map([
  ['-1-3-2-0-1-0',['','3','2','','1','']],
  ['-1-0-2-2-2-0',['','','1','2','3','']],
  ['3-2-0-0-0-3',['2','1','','','','3']],
  ['0-2-2-1-0-0',['','2','3','1','','']],
  ['-1--1-0-2-3-2',['','','','1','3','2']],
  ['-1-0-2-2-1-0',['','','2','3','1','']],
  ['0-2-2-0-0-0',['','2','3','','','']],
  ['-1--1-0-2-3-1',['','','','2','3','1']],
  ['-1-0-2-2-0-0',['','','1','2','','']],
  ['-1--1-0-2-3-0',['','','','1','3','']],
  ['-1-0-2-2-3-0',['','','1','2','3','']],
  ['0-2-2-2-0-0',['','1','2','3','','']],
  ['-1--1-0-2-3-3',['','','','1','3','4']],
  ['-1-0-2-0-2-0',['','','1','','2','']],
  ['-1-2-1-2-0-2',['','2','1','3','','4']],
  ['-1-3-2-3-1-0',['','3','2','4','1','']],
  ['-1--1-0-2-1-2',['','','','2','1','3']],
  ['0-2-0-1-0-0',['','2','','1','','']],
  ['3-2-0-0-0-1',['3','2','','','','1']],
  ['-1-0-2-1-2-0',['','','2','1','3','']],
  ['-1-3-2-0-0-0',['','3','2','','','']],
  ['-1--1-0-2-2-2',['','','','1','2','3']],
  ['0-2-1-1-0-0',['','3','1','2','','']],
  ['3-2-0-0-0-2',['3','2','','','','1']],
  ['-1-0-2-0-1-0',['','','2','','1','']],
  ['-1--1-0-2-1-1',['','','','2','1','1']],
  ['0-2-0-0-0-0',['','2','','','','']],
]);

const MOVABLE_FINGER_PATTERNS=new Map([
  ['0-2-2-1-0-0',['1','3','4','2','1','1']],
  ['0-2-2-0-0-0',['1','3','4','1','1','1']],
  ['0-2-0-1-0-0',['1','3','1','2','1','1']],
  ['0-2-1-1-0-0',['1','4','2','3','1','1']],
  ['0-2-0-0-0-0',['1','3','1','1','1','1']],
  ['x-0-2-2-2-0',['','1','2','3','4','1']],
  ['x-0-2-2-1-0',['','1','3','4','2','1']],
  ['x-0-2-0-2-0',['','1','3','1','4','1']],
  ['x-0-2-1-2-0',['','1','4','2','3','1']],
  ['x-0-2-0-1-0',['','1','3','1','2','1']],
]);

function commonFingering(frets){
  const exact=COMMON_OPEN_FINGERS.get(frets.join('-'));
  if(exact)return exact;
  if(frets.some(fret=>fret===0))return null;
  const played=frets.filter(fret=>fret>0);
  if(!played.length)return null;
  const minimum=Math.min(...played);
  const normalized=frets.map(fret=>fret<0?'x':fret-minimum).join('-');
  return MOVABLE_FINGER_PATTERNS.get(normalized)??null;
}

function inferredFingers(frets,provided=[]){
  const common=commonFingering(frets);
  if(common)return [...common];
  const result=frets.map((fret,index)=>provided[index]||'');
  const barre=displayBarre(frets);
  if(barre){
    for(let index=barre.from;index<=barre.to;index+=1)if(frets[index]===barre.fret)result[index]='1';
  }
  let nextFinger=barre?2:1;
  frets.forEach((fret,index)=>{
    if(fret>0&&!result[index]){
      result[index]=String(Math.min(4,nextFinger));
      nextFinger+=1;
    }
  });
  return result;
}

const curatedChords = [
  {name:'Emaj9', notes:'E · B · D♯ · G♯ · F♯', desc:'A glassy open voicing with just enough color to feel unresolved.', moods:['Ethereal','Warm'], style:'Jazz', difficulty:2, frets:[0,2,1,1,0,2], fingers:['','2','1','1','','3'], tones:[82.41,123.47,155.56,207.65,246.94,369.99]},
  {name:'Bm11', notes:'× · B · D · A · B · E', desc:'Wide, melancholy and effortless—ideal for a ringing clean part.', moods:['Melancholic','Dark'], style:'Ambient', difficulty:1, frets:[-1,2,0,2,0,0], fingers:['','1','','2','',''], tones:[123.47,146.83,220,246.94,329.63]},
  {name:'Fmaj7♯11', notes:'F · × · E · A · B · E', desc:'Luminous tension from the open B and E strings over a low F.', moods:['Tense','Ethereal'], style:'Jazz', difficulty:2, frets:[1,-1,2,2,0,0], fingers:['1','','2','3','',''], tones:[87.31,164.81,220,246.94,329.63]},
  {name:'Em9', notes:'E · B · D · G · B · F♯', desc:'A huge minor-nine that sounds expensive with almost no effort.', moods:['Dark','Ambient'], style:'Math rock', difficulty:1, frets:[0,2,0,0,0,2], fingers:['','1','','','','2'], tones:[82.41,123.47,146.83,196,246.94,369.99]},
  {name:'G6/9', notes:'G · A · D · A · B · E', desc:'Bright and spacious, with open strings that keep every note breathing.', moods:['Warm','Bright'], style:'Math rock', difficulty:1, frets:[3,0,0,2,0,0], fingers:['2','','','1','',''], tones:[98,110,146.83,220,246.94,329.63]},
  {name:'C♯m7', notes:'× · C♯ · G♯ · B · E · G♯', desc:'Compact and smooth, with a soft top voice made for sliding transitions.', moods:['Dark','Warm'], style:'Jazz', difficulty:3, frets:[-1,4,6,4,5,4], fingers:['','1','3','1','2','1'], tones:[138.59,207.65,246.94,329.63,415.3]},
  {name:'Dmaj9/A', notes:'A · D · F♯ · C♯ · E · A', desc:'A dense, polished major-nine with the fifth anchoring the bass.', moods:['Ethereal','Warm'], style:'Jazz', difficulty:4, frets:[5,5,4,6,5,5], fingers:['2','2','1','4','3','2'], tones:[110,146.83,185,277.18,329.63,440]},
  {name:'B11', notes:'× · B · E · A · C♯ · F♯', desc:'Suspended dominant energy that wants to fall home to E.', moods:['Tense','Aggressive'], style:'Blues', difficulty:2, frets:[-1,2,2,2,2,2], fingers:['','1','1','1','1','1'], tones:[123.47,164.81,220,277.18,369.99]}
];

const canonicalBase=CANONICAL_VOICINGS.map(voicing=>({
  id:voicing.id,
  name:voicing.chordName,
  notes:voicing.fretPositions.map((fret,index)=>fret===null?'×':voicing.notes[voicing.fretPositions.slice(0,index+1).filter(value=>value!==null).length-1]).join(' · '),
  moods:[],styles:[],difficulty:voicing.difficulty,
  frets:voicing.fretPositions.map(fret=>fret??-1),
  fingers:inferredFingers(voicing.fretPositions.map(fret=>fret??-1),voicing.fingerPositions??[]),
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
const publishedVoicings=repositoryWorkspace.published.map(voicing=>{
  const legacyTags=voicing.descriptorTags??[];
  return {...voicing,moodTags:normalizedMoodTags([...(voicing.moodTags??[]),...legacyTags]),genreTags:normalizedStyleTags([...(voicing.genreTags??[]),...legacyTags]),descriptorTags:normalizedDescriptorTags(legacyTags)};
});
const publishedChords=publishedVoicings.map(voicing=>({
  id:voicing.id,slug:voicing.slug,name:voicing.chordName,
  notes:voicing.fretPositions.map((fret,index)=>fret===null?'×':voicing.notes[voicing.fretPositions.slice(0,index+1).filter(value=>value!==null).length-1]).join(' · '),
  moods:normalizedMoodTags(voicing.moodTags??[]),styles:normalizedStyleTags(voicing.genreTags??[]),difficulty:voicing.difficulty,
  frets:voicing.fretPositions.map(fret=>fret??-1),fingers:inferredFingers(voicing.fretPositions.map(fret=>fret??-1),voicing.fingerPositions??[]),
  tones:voicing.fretPositions.flatMap((fret,index)=>fret===null?[]:[440*2**((voicing.tuning.strings[index].midi+fret-69)/12)]),
  chordQuality:voicing.chordQuality,root:voicing.root,category:'Other Approved',displayPriority:100,movable:voicing.movable??false,descriptorTags:voicing.descriptorTags,
}));
const publishedSlugByKey=new Map(publishedChords.map(chord=>[`${chord.name}|${chord.frets.join('-')}`,chord.slug]));
const publishedKeys=new Set(publishedChords.map(chord=>`${chord.name}|${chord.frets.join('-')}`));
const chordRecords=[...canonicalChords,...publishedChords.filter(chord=>!canonicalKeys.has(`${chord.name}|${chord.frets.join('-')}`)),...curatedChords.filter(chord=>!canonicalKeys.has(`${chord.name}|${chord.frets.join('-')}`)&&!publishedKeys.has(`${chord.name}|${chord.frets.join('-')}`)).map(chord=>({...chord,category:'Other Approved',displayPriority:100}))]
  .sort((left,right)=>(left.category==='Essential Open'?10:left.category==='Essential Barre'?20:100)-(right.category==='Essential Open'?10:right.category==='Essential Barre'?20:100)
    ||(left.displayPriority??999)-(right.displayPriority??999)||left.difficulty-right.difficulty||left.name.localeCompare(right.name));
const libraryEdits=repositoryWorkspace.libraryEdits;
const allChords=chordRecords.map((chord,index)=>{
  const libraryKey=chord.id??`curated:${chord.name}:${chord.frets.join('-')}`;
  const edit=libraryEdits[libraryKey];
  const publicSlug=publishedSlugByKey.get(`${chord.name}|${chord.frets.join('-')}`)??chord.slug??legacyChordSlug(chord.name,libraryKey);
  const legacyTags=edit?.descriptorTags??chord.descriptorTags??defaultDescriptorTags(chord);
  return {...chord,id:libraryKey,slug:publicSlug,vaultIndex:index+1,rootKey:chordRoot(chord),qualityFamilyKey:qualityFamily(chord),recipeFamilyKey:recipeFamily(chord),difficulty:edit?.difficulty??chord.difficulty,descriptorTags:normalizedDescriptorTags(legacyTags),moods:normalizedMoodTags(edit?.moods??[...(chord.moods??[]),...legacyTags]),styles:normalizedStyleTags(edit?.styles??[...(chord.styles??[]),chord.style??'',...legacyTags])};
});
chordRepository.savePublicLibrary(allChords.map(chord=>({key:chord.id,name:chord.name,root:chord.rootKey,chordQuality:chord.chordQuality,difficulty:chord.difficulty,descriptorTags:chord.descriptorTags,moods:chord.moods,styles:chord.styles,frets:chord.frets,fingers:chord.fingers,source:'Main Vault'})));
const finalApprovedKeys=new Set(repositoryWorkspace.publishedKeys);
const chords=allChords.filter(chord=>finalApprovedKeys.has(chord.id));
if(repositoryCapabilities.loadError){const status=document.querySelector('#resultCount');if(status)status.textContent=repositoryCapabilities.loadError}

const activeMoods = new Set();
const activeStyles = new Set();
const activeRoots = new Set();
const activeQualities = new Set();
const activeRecipes = new Set();
const activeDifficulties = new Set();
const activeTypes = new Set();
const storedFavorites=chordRepository.listFavorites();
const resolvedFavorites=resolveFavoriteIds(storedFavorites,chords);
let saved = new Set(resolvedFavorites);
if(storedFavorites.some((favorite,index)=>favorite!==resolvedFavorites[index])||storedFavorites.length!==resolvedFavorites.length){
  storedFavorites.forEach(favorite=>chordRepository.removeFavorite(favorite));
  resolvedFavorites.forEach(favorite=>chordRepository.addFavorite(favorite));
}
let savedOnly = false;
let pageStart = 0;
const grid = document.querySelector('#chordGrid');
const moodFilters = document.querySelector('#moodFilters');
const styleFilters = document.querySelector('#styleFilters');
const noteFilters = document.querySelector('#noteFilters');
const qualityFilters = document.querySelector('#qualityFilters');
const recipeFilters = document.querySelector('#recipeFilters');
const difficultyFilters = document.querySelector('#difficultyFilters');
const typeFilters = document.querySelector('#typeFilters');
const resetFilters = document.querySelector('#resetFilters');
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
moodFilters.innerHTML=['All',...MOOD_TAGS].map(value=>`<button type="button" data-value="${value}" class="${value==='All'?'active':''}" aria-pressed="${value==='All'}">${value}</button>`).join('');
styleFilters.innerHTML=['All',...STYLE_TAGS].map(value=>`<button type="button" data-value="${value}" class="${value==='All'?'active':''}" aria-pressed="${value==='All'}">${value}</button>`).join('');
noteFilters.innerHTML=ROOT_ORDER.map(root=>`<button type="button" data-value="${root}" class="${root==='All'?'active':''}" aria-pressed="${root==='All'}">${root}</button>`).join('');
const QUALITY_OPTIONS=['All','Major','Minor'];
const RECIPE_OPTIONS=['All','Triad','7th','Sus','9th','11th'];
const DIFFICULTY_OPTIONS=['All',1,2,3,4,5];
const TYPE_OPTIONS=['All','Open','Barre','Essential','Movable'];
qualityFilters.innerHTML=QUALITY_OPTIONS.map(value=>`<button type="button" data-value="${value}" class="${value==='All'?'active':''}" aria-pressed="${value==='All'}">${value}</button>`).join('');
recipeFilters.innerHTML=RECIPE_OPTIONS.map(value=>`<button type="button" data-value="${value}" class="${value==='All'?'active':''}" aria-pressed="${value==='All'}">${value}</button>`).join('');
difficultyFilters.innerHTML=DIFFICULTY_OPTIONS.map(value=>value==='All'
  ? `<button type="button" data-value="All" class="active" aria-pressed="true">All</button>`
  : `<button class="difficulty-filter-button" type="button" data-value="${value}" aria-pressed="false" aria-label="Difficulty ${value} out of 5"><span>${value}</span><span class="filter-difficulty-bars">${[1,2,3,4,5].map(level=>`<i class="${level<=value?'on':''}"></i>`).join('')}</span></button>`).join('');
typeFilters.innerHTML=TYPE_OPTIONS.map(value=>`<button type="button" data-value="${value}" class="${value==='All'?'active':''}" aria-pressed="${value==='All'}">${value}</button>`).join('');

function chordRoot(chord){
  if(chord.root)return chord.root;
  return chord.name.match(/^[A-G](?:#|♯|b|♭)?/)?.[0].replace('♯','#').replace('♭','b')??'';
}

function chordQuality(chord){
  return recipeById(chord.chordQuality??'')?.id??recipeIdFromChordName(chord.name);
}

function qualityFamily(chord){
  return recipeById(chordQuality(chord))?.publicQualityFamily??'Neither';
}

function recipeFamily(chord){
  return recipeById(chordQuality(chord))?.family??'Other';
}

function defaultDescriptorTags(chord){
  return [...new Set([
    chord.isEssential&&chord.displayPriority===1?'Essential':'',
    chord.category==='Essential Open'?'Open':'',
    chord.category==='Essential Barre'?'Barre':'',
    chord.movable?'Movable':'',
  ].filter(Boolean))];
}

function matchesDifficulty(chord){return activeDifficulties.size===0||activeDifficulties.has(chord.difficulty)}

function matchesChordType(chord){
  if(activeTypes.size===0)return true;
  return (activeTypes.has('Open')&&chord.frets.includes(0))
    ||(activeTypes.has('Barre')&&(chord.category==='Essential Barre'||displayBarre(chord.frets)!==null))
    ||(activeTypes.has('Essential')&&Boolean(chord.isEssential&&chord.displayPriority===1))
    ||(activeTypes.has('Movable')&&Boolean(chord.movable));
}

function filteredChords(){
  return chords.filter(c=>matchesAnyFilter(c.moods,activeMoods)
    &&matchesAnyFilter(c.styles,activeStyles)
    &&(activeRoots.size===0||activeRoots.has(c.rootKey))
    &&(activeQualities.size===0||activeQualities.has(c.qualityFamilyKey))
    &&(activeRecipes.size===0||activeRecipes.has(c.recipeFamilyKey))
    &&matchesDifficulty(c)
    &&matchesChordType(c)
    &&(!savedOnly||saved.has(c.id)));
}

function diagram(chord) {
  const xs=[24,48,72,96,120,144];
  const playedFrets=chord.frets.filter(f=>f>0);
  const baseFret=Math.max(...playedFrets)>5?Math.min(...playedFrets):1;
  const isHigherPosition=baseFret>1;
  const strings=xs.map(x=>`<line x1="${x}" y1="34" x2="${x}" y2="159" class="string"/>`).join('');
  const frets=[34,59,84,109,134,159].map((y,i)=>`<line x1="24" y1="${y}" x2="144" y2="${y}" class="${i===0&&!isHigherPosition?'nut':'fret'}"/>`).join('');
  const barre=displayBarre(chord.frets);
  const barreY=barre?46.5+(barre.fret-baseFret)*25:0;
  const barreMark=barre?`<g><rect x="${xs[barre.from]-9}" y="${barreY-9}" width="${xs[barre.to]-xs[barre.from]+18}" height="18" rx="9" class="finger-dot barre-dot"/><text x="${(xs[barre.from]+xs[barre.to])/2}" y="${barreY+3.5}" class="finger-label">${chord.fingers[barre.from]||1}</text></g>`:'';
  const marks=chord.frets.map((f,i)=>f<0?`<text x="${xs[i]}" y="22" class="marker">×</text>`:f===0?`<circle cx="${xs[i]}" cy="16" r="5" class="open-marker"/>`:barre&&f===barre.fret&&i>=barre.from&&i<=barre.to?'':`<g><circle cx="${xs[i]}" cy="${46.5+(f-baseFret)*25}" r="9" class="finger-dot"/><text x="${xs[i]}" y="${50+(f-baseFret)*25}" class="finger-label">${chord.fingers[i]}</text></g>`).join('');
  const fretNumbers=isHigherPosition
    ? [0,1,2,3,4].map(i=>`<text x="169" y="${50+i*25}" class="fret-number">${baseFret+i}</text>`).join('')
    : [1,2,3,4,5].map((n,i)=>`<text x="169" y="${50+i*25}" class="fret-number">${n}</text>`).join('');
  return `<svg class="chord-diagram" viewBox="0 0 184 190" role="img" aria-label="${chord.name} guitar chord diagram${isHigherPosition?`, starting at fret ${baseFret}`:''}${barre?`, with a barre at fret ${barre.fret}`:''}">${frets}${strings}${fretNumbers}${barreMark}${marks}${['E','A','D','G','B','e'].map((s,i)=>`<text x="${xs[i]}" y="184" class="string-label">${s}</text>`).join('')}</svg>`;
}

function render() {
  const shown=filteredChords();
  const pageSize=12;
  if(pageStart>=shown.length)pageStart=0;
  const visibleChords=shown.slice(pageStart,pageStart+pageSize);
  grid.classList.toggle('is-incomplete',visibleChords.length<pageSize);
  grid.innerHTML=visibleChords.map((c)=>{const n=c.vaultIndex; const isSaved=saved.has(c.id); return `<article class="chord-card">
    <span class="card-number">${String(n).padStart(2,'0')}</span><button class="heart ${isSaved?'is-saved':''}" data-save="${c.id}" aria-label="${isSaved?'Remove':'Add'} ${c.name} ${isSaved?'from':'to'} favorites">${isSaved?'♥':'♡'}</button>
    <div class="card-title"><div><h3>${c.name}</h3><p>${c.notes}</p></div><button class="play" data-play="${c.id}" aria-label="Play ${c.name}">▶</button></div>
    <a class="chord-name-link" href="/chords/${encodeURIComponent(c.slug)}" aria-label="View ${c.name} chord details">${c.name}</a>
    ${diagram(c)}<div class="card-footer"><div class="tags">${[...c.descriptorTags,...c.moods,...c.styles].map(tag=>`<span class="${tag==='Essential'?'essential-badge':''}">${tag}</span>`).join('')}</div><span class="difficulty" aria-label="Difficulty ${c.difficulty} out of 5"><span class="difficulty-label">Difficulty</span>${[1,2,3,4,5].map(i=>`<i class="${i<=c.difficulty?'on':''}"></i>`).join('')}</span></div>
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
const filterGroupSync=[];
function bindMultiFilter(container,selected,parse=value=>value){
  function sync(){
    container.querySelectorAll('[data-value]').forEach(button=>{
      const value=button.dataset.value;
      const active=value==='All'?selected.size===0:selected.has(parse(value));
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
  }
  container.addEventListener('click',event=>{
    const button=event.target.closest('[data-value]');if(!button)return;
    const value=button.dataset.value;
    toggleFilterValue(selected,value==='All'?'All':parse(value));
    pageStart=0;sync();render();
  });
  filterGroupSync.push(sync);sync();
}
bindMultiFilter(moodFilters,activeMoods);
bindMultiFilter(styleFilters,activeStyles);
bindMultiFilter(noteFilters,activeRoots);
bindMultiFilter(qualityFilters,activeQualities);
bindMultiFilter(recipeFilters,activeRecipes);
bindMultiFilter(difficultyFilters,activeDifficulties,value=>Number(value));
bindMultiFilter(typeFilters,activeTypes);
resetFilters.addEventListener('click',()=>{
  [activeMoods,activeStyles,activeRoots,activeQualities,activeRecipes,activeDifficulties,activeTypes].forEach(selection=>selection.clear());
  savedOnly=false;pageStart=0;filterGroupSync.forEach(sync=>sync());render();
});
grid.addEventListener('click',e=>{const s=e.target.closest('[data-save]'); if(s){if(saved.has(s.dataset.save)){saved.delete(s.dataset.save);chordRepository.removeFavorite(s.dataset.save)}else{saved.add(s.dataset.save);chordRepository.addFavorite(s.dataset.save)}render();return} const p=e.target.closest('[data-play]'); if(p) playChord(chords.find(c=>c.id===p.dataset.play),p)});
document.querySelector('#savedButton').addEventListener('click',()=>{savedOnly=!savedOnly;pageStart=0;render()});
function goToPage(page){pageStart=(page-1)*12;render();grid.scrollIntoView({behavior:'smooth',block:'start'})}
previousPage.addEventListener('click',()=>goToPage(Math.max(1,pageStart/12)));
nextPage.addEventListener('click',()=>goToPage(pageStart/12+2));
pageNumbers.addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(button)goToPage(Number(button.dataset.page))});
document.querySelector('#guideDiagram').innerHTML=diagram(allChords[1]);

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
  activeOscillators.forEach(oscillator=>{try{oscillator.stop()}catch{/* The oscillator may already be stopped. */}});
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
