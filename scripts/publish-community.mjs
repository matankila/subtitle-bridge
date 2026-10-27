const manifestUrl=process.argv[2];
if(!manifestUrl||new URL(manifestUrl).protocol!=='https:')throw new Error('Usage: node scripts/publish-community.mjs https://host/manifest.json');
const response=await fetch(manifestUrl,{signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error(`Manifest unavailable: ${response.status}`);
const manifest=await response.json();
if(!manifest.id||!manifest.version||!manifest.resources?.some(x=>x==='subtitles'||x.name==='subtitles'))throw new Error('Invalid subtitle add-on manifest');
const result=await fetch('https://api.strem.io/api/addonPublish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transportUrl:manifestUrl,transportName:'http'}),signal:AbortSignal.timeout(30000)});
const text=await result.text();console.log(JSON.stringify({httpStatus:result.status,manifestUrl,response:text}));
if(!result.ok)process.exitCode=1;
else{try{const body=JSON.parse(text);if(body.error)process.exitCode=1;}catch{process.exitCode=1;}}
