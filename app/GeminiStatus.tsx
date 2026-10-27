'use client';
import {useEffect,useState} from 'react';
export default function GeminiStatus(){
 const [status,setStatus]=useState<{enabled:boolean;model:string}|null>(null);
 useEffect(()=>{let active=true;fetch('/api/refinement-status').then(r=>r.ok?r.json():null).then(value=>{if(active&&value&&typeof value==='object'&&'enabled' in value&&'model' in value&&typeof value.enabled==='boolean'&&typeof value.model==='string')setStatus({enabled:value.enabled,model:value.model});}).catch(()=>{});return()=>{active=false;};},[]);
 return status?<p className="field-help">Hebrew AI review: {status.enabled?`enabled (${status.model})`:'awaiting server API key configuration'}. Google translation remains available. API review preserves cue timing and pauses on Gemini quota errors.</p>:null;
}
