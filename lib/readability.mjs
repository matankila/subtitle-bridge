// Word-preserving line breaks only. Never shorten dialogue or change timing.
export function wrapSubtitle(text,width=42){
 const clean=text.replace(/\s+/g,' ').trim();if(clean.length<=width)return clean;
 const words=clean.split(' ');if(words.length<2)return clean;
 let best=null,score=Infinity;
 for(let i=1;i<words.length;i++){
  const a=words.slice(0,i).join(' '),b=words.slice(i).join(' ');
  const overflow=Math.max(0,a.length-width)+Math.max(0,b.length-width);
  // Avoid isolating Hebrew function words from the phrase they introduce.
  const dangling=/^(את|של|על|עם|אל|אם|כי|או)$/.test(words[i-1])?18:0;
  const punctuation=/[,;:!?…]$/.test(a)?-8:0;
  const cost=overflow*100+Math.abs(a.length-b.length)+dangling+punctuation;
  if(cost<score){score=cost;best=a+'\n'+b;}
 }
 return best||clean;
}
export function readabilityStats(data){
 const texts=data.cues.map(c=>({text:c.parts.map(p=>data.units[p].translated||'').join(' '),duration:(c.end-c.start)/1000}));
 return {longCues:texts.filter(c=>c.text.length>84).length,fastCues:texts.filter(c=>c.duration>0&&c.text.length/c.duration>20).length};
}
