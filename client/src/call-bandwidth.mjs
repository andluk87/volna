// 24 kbit/s mono Opus + 40 ms packets reduce both payload and packet overhead.
export function economicalAudioDescription(description){
 if(!description?.sdp)return description;
 const separator=description.sdp.includes('\r\n')?'\r\n':'\n';
 const sections=description.sdp.split(/(?=^m=)/m).map(section=>{
  if(!section.startsWith('m=audio '))return section;
  let lines=section.trimEnd().split(/\r?\n/);
  const payloads=lines.flatMap(line=>{const match=/^a=rtpmap:(\d+) opus\/48000(?:\/2)?$/i.exec(line);return match?[match[1]]:[];});
  if(!payloads.length)return section;
  for(const payload of payloads){const index=lines.findIndex(line=>line.startsWith(`a=fmtp:${payload} `));const old=index<0?'':lines[index].slice(`a=fmtp:${payload} `.length);const params=new Map(old.split(';').map(p=>p.trim()).filter(Boolean).map(p=>{const [key,...value]=p.split('=');return [key,value.join('=')];}));for(const [key,value] of Object.entries({maxaveragebitrate:'24000',stereo:'0','sprop-stereo':'0',usedtx:'1',useinbandfec:'1'}))params.set(key,value);const line=`a=fmtp:${payload} `+[...params].map(([key,value])=>`${key}=${value}`).join(';');if(index<0)lines.push(line);else lines[index]=line;}
  lines=lines.filter(line=>!/^a=(?:max)?ptime:/.test(line));lines.push('a=ptime:40','a=maxptime:60');return lines.join(separator)+separator;
 });return {type:description.type,sdp:sections.join('')};
}
export async function limitCallSenders(pc){
 for(const sender of pc.getSenders()){
  if(!sender.track||!sender.getParameters||!sender.setParameters)continue;
  const parameters=sender.getParameters();if(!parameters.encodings?.length)continue;
  for(const encoding of parameters.encodings){encoding.maxBitrate=sender.track.kind==='audio'?24000:400000;if(sender.track.kind==='video')encoding.maxFramerate=15;}
  await sender.setParameters(parameters);
 }
}
