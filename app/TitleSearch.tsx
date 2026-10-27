'use client';
import {useEffect,useRef,useState} from 'react';
import {Search,LoaderCircle} from 'lucide-react';
type Match={id:string;name:string;year:string};
type Props={id:string;type:'movie'|'series';disabled?:boolean;onChange:(id:string)=>void;onSelect?:(id:string)=>void};
export default function TitleSearch({id,type,disabled=false,onChange,onSelect}:Props){
 const [text,setText]=useState(''),[results,setResults]=useState<Match[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(-1),[selected,setSelected]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{setText('');setSelected(false);setResults([]);setMessage('');setOpen(false);},[type]);
 useEffect(()=>{
  if(selected){setBusy(false);return;}
  const query=text.trim();setResults([]);setActive(-1);setMessage('');setBusy(false);
  if(disabled||selected||query.length<2||/tt\d{5,12}/.test(query))return;
  let current=true;const controller=new AbortController();
  const timer=setTimeout(async()=>{
   setBusy(true);
   try{
    const response=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,query}),signal:controller.signal});
    const data=await response.json() as {results?:Match[];message?:string};
    if(!response.ok)throw new Error(data.message||'Search unavailable. Try again or paste an IMDb link.');
    if(current){setResults(data.results||[]);setMessage(data.results?.length?'':'No matches. Try a shorter or original title, or paste its IMDb link.');}
   }catch(e){if(current)setMessage((e as Error).message);}finally{if(current)setBusy(false);}
  },400);
  return()=>{current=false;clearTimeout(timer);controller.abort();};
 },[text,type,disabled,selected]);
 function choose(match:Match){setText(match.name);setSelected(true);setOpen(false);setResults([]);setMessage(`${match.name}${match.year?' · '+match.year:''} · ${match.id}`);onChange(match.id);onSelect?.(match.id);}
 const expanded=open&&!selected&&results.length>0;
 return <div className="title-search" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
  <label htmlFor={id}>{type==='series'?'Series':'Movie'} title or IMDb link</label>
  <div className="search-input"><Search size={16}/><input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-results`} aria-activedescendant={expanded&&active>=0?`${id}-option-${active}`:undefined} aria-describedby={`${id}-help`} autoComplete="off" maxLength={250} value={text} disabled={disabled} placeholder={type==='series'?'Search a series, e.g. Breaking Bad':'Search a movie, e.g. The Matrix'} onFocus={()=>setOpen(true)} onChange={e=>{const value=e.target.value;setText(value);setSelected(false);setOpen(true);setResults([]);setActive(-1);onChange(value.match(/tt\d{5,12}/)?.[0]||'');}} onKeyDown={e=>{
   if(e.key==='Escape'){setOpen(false);setActive(-1);}
   if(results.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();setOpen(true);setActive(i=>e.key==='ArrowDown'?(i+1)%results.length:(i<=0?results.length-1:i-1));}
   if(e.key==='Enter'&&expanded&&active>=0){e.preventDefault();choose(results[active]);}
  }}/>{busy&&<LoaderCircle size={16} className="spin search-spinner"/>}</div>
  {expanded&&<div id={`${id}-results`} role="listbox" aria-label="Matching titles" className="search-results">{results.map((match,i)=><button type="button" role="option" id={`${id}-option-${i}`} aria-selected={active===i} key={match.id} className={active===i?'search-result active':'search-result'} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(match)}><span>{match.name}</span><small>{match.year||'Year unavailable'} · {match.id}</small></button>)}</div>}
  <p id={`${id}-help`} className="field-help search-help" role="status">{busy?'Searching titles…':message|| (selected?'Selected.': 'Type at least two letters, then choose a match. IMDb IDs and links also work.')}</p>
 </div>;
}
