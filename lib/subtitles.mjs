import {wrapSubtitle} from './readability.mjs';
import {AddonError} from './errors.mjs';
import {readLimited} from './http.mjs';
export {AddonError};
export const LANGUAGES = {
  he: ['Hebrew', 'heb'], ar: ['Arabic', 'ara'], es: ['Spanish', 'spa'],
  fr: ['French', 'fre'], de: ['German', 'ger'], it: ['Italian', 'ita'],
  pt: ['Portuguese', 'por'], ru: ['Russian', 'rus'], uk: ['Ukrainian', 'ukr'],
  pl: ['Polish', 'pol'], nl: ['Dutch', 'dut'], tr: ['Turkish', 'tur'],
  el: ['Greek', 'gre'], ro: ['Romanian', 'rum'], sv: ['Swedish', 'swe'],
  da: ['Danish', 'dan'], fi: ['Finnish', 'fin'], cs: ['Czech', 'cze'],
  hu: ['Hungarian', 'hun'], hi: ['Hindi', 'hin'], ja: ['Japanese', 'jpn'],
  ko: ['Korean', 'kor'], zh: ['Chinese', 'chi'], en: ['English', 'eng'],
};
const aliases = { iw: 'he', fra: 'fr', deu: 'de', nld: 'nl', ell: 'el', ron: 'ro', ces: 'cs', zho: 'zh' };
export function language(code) {
  const value = String(code || '').toLowerCase().split(/[-_]/)[0];
  return aliases[value] || Object.keys(LANGUAGES).find(k => k === value || LANGUAGES[k][1] === value) || null;
}
export function decodeEntities(value) {
  const named = { amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',lrm:'',rlm:'',hellip:'…',ndash:'–',mdash:'—' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (full, key) => {
    if (key[0] !== '#') return named[key.toLowerCase()] ?? full;
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}
export function plain(value) {
  return decodeEntities(String(value)).replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}
function stamp(value) {
  const parts = value.replace(',', '.').split(':');
  if (parts.length === 2) parts.unshift('00');
  const [h,m,s] = parts.map(Number);
  if (m >= 60 || s >= 60 || !Number.isFinite(h+m+s)) throw new AddonError('INVALID_SUBTITLE','Invalid subtitle timestamps.');
  return Math.round((h*3600+m*60+s)*1000);
}
export function time(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
}
export function parseSubtitles(input) {
  const lines = input.replace(/^\uFEFF/, '').replace(/\r\n?/g,'\n').split('\n');
  if (input.includes('\uFFFD')) throw new AddonError('ENCODING','The source subtitle has an unsupported text encoding.');
  const cues = [];
  for (let i=0; i<lines.length; i++) {
    if (/^(NOTE(?:\s|$)|STYLE$|REGION$)/.test(lines[i])) { while (i<lines.length && lines[i].trim()) i++; continue; }
    const match = lines[i].match(/^\s*((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/);
    if (!match) continue;
    const start=stamp(match[1]),end=stamp(match[2]);
    if (end <= start) throw new AddonError('INVALID_SUBTITLE','A subtitle cue has invalid timing.');
    const text=[];
    while (++i < lines.length && lines[i].trim()) text.push(lines[i]);
    const value = plain(text.join('\n'));
    if (value) cues.push({start,end,text:value});
  }
  if (!cues.length || cues.length > 5000) throw new AddonError('INVALID_SUBTITLE','Expected an SRT or WebVTT file with 1–5,000 cues.');
  return cues;
}
// Split on word boundaries where possible, never inside a Unicode character.
export function splitUtf8(text, limit=480) {
  const encoder=new TextEncoder(), result=[];
  let part='',size=0;
  for (const ch of text) {
    const n=encoder.encode(ch).length;
    if (size+n>limit) {
      const cut=part.lastIndexOf(' ');
      if (cut > part.length/2) { result.push(part.slice(0,cut)); part=part.slice(cut+1); }
      else { result.push(part); part=''; }
      size=encoder.encode(part).length;
    }
    part+=ch; size+=n;
  }
  if(part.trim()) result.push(part.trim());
  return result;
}
export function makeWork(cues) {
  const units=[], indexes=new Map();
  const mapped=cues.map(cue => ({start:cue.start,end:cue.end,parts:splitUtf8(cue.text.replace(/\s+/g,' ')).map(text => {
    if(!indexes.has(text)){indexes.set(text,units.length);units.push({text,translated:null,attempts:0});}
    return indexes.get(text);
  })}));
  return {cues:mapped,units};
}
export function renderSrt(data) {
  if(data.units.some(u=>!u.translated)) throw new AddonError('NOT_READY','Translation is still running.',503);
  return data.cues.map((c,i)=>`${i+1}\n${time(c.start)} --> ${time(c.end)}\n${wrapSubtitle(c.parts.map(p=>plain(data.units[p].translated).replace(/\n+/g,' ')).join(' '))}\n`).join('\n');
}
export function selectTracks(tracks,target,extra={}) {
  const valid=tracks.filter(s=>s && typeof s.url==='string' && s.url.length<3000 && typeof s.lang==='string');
  const tokens=String(extra.filename||'').toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
  const normalize=s=>String(s||'').toLowerCase().replace(/\.(?:mkv|mp4|avi|srt|vtt|ass)$/i,'').replace(/[^\p{L}\p{N}]+/gu,'');
  const score=s=>{const h=String(s.moviehash||s.movieHash||'').toLowerCase(),requested=String(extra.videoHash||'').toLowerCase();return (requested&&h?(h===requested?10000:-10000):0)+(extra.filename&&[s.title,s.movieReleaseName,s.subtitleFileName].some(x=>normalize(x)===normalize(extra.filename))?1000:0)+tokens.filter(t=>String(s.title||s.id).toLowerCase().includes(t)).length;};
  const ordered=valid.sort((a,b)=>score(b)-score(a));
  return {existing:ordered.filter(s=>language(s.lang_code||s.lang)===target),sources:ordered.filter(s=>language(s.lang_code||s.lang)==='en' && !s.ai_translated)};
}
export async function translateUnit(text,target,email,fetcher=fetch,ip='') {
  if(new TextEncoder().encode(text).length>500) throw new AddonError('TOO_LONG','Translation segment exceeds 500 UTF-8 bytes.',400);
  const url=new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q',text); url.searchParams.set('langpair',`en|${target}`);url.searchParams.set('mt','1');
  if(email)url.searchParams.set('de',email);
  if(ip)url.searchParams.set('ip',ip);
  let res;
  try {res=await fetcher(url,{signal:AbortSignal.timeout(20000),redirect:'manual'});}
  catch (e) {console.error('Translation fetch failed', {name:e?.name||'Error',message:String(e?.message).replace(/https?:\/\/[^\s]+/g,'[URL]').replace(/[^\s@]+@[^\s@]+/g,'[EMAIL]').slice(0,200),code:e?.cause?.code||null,timeout:/timeout|abort/i.test(String(e?.message))});throw new AddonError('TRANSLATOR_UNAVAILABLE','The translation service did not respond. Try again shortly.',503);}
  if(res.status===429)throw new AddonError('PROVIDER_QUOTA','MyMemory has reached its rate or daily limit. Try again tomorrow.',429);
  if(!res.ok)throw new AddonError('TRANSLATOR_UNAVAILABLE','The translation service is temporarily unavailable.',503);
  let body;try{body=JSON.parse(await readLimited(res,50000));}catch{throw new AddonError('TRANSLATOR_RESPONSE','Invalid response from the translation service.');}
  if(body.quotaFinished || Number(body.responseStatus)===429)throw new AddonError('PROVIDER_QUOTA','MyMemory has reached its daily limit. Try again tomorrow.',429);
  const result=body.responseData?.translatedText;
  if(Number(body.responseStatus)!==200 || typeof result!=='string' || !plain(result) || /MYMEMORY WARNING|QUERY LENGTH LIMIT|USED ALL AVAILABLE FREE|INVALID LANGUAGE PAIR/i.test(result))
    throw new AddonError('TRANSLATOR_RESPONSE','The translation service rejected this segment.');
  return plain(result);
}
