export function callSafetyMaterial(callId,a,b){
 const fingerprints=sdp=>[...new Set([...String(sdp||'').matchAll(/^a=fingerprint:sha-256\s+([A-Fa-f0-9:]+)\s*$/gm)].map(m=>m[1].replaceAll(':','').toLowerCase()))];
 const left=fingerprints(a),right=fingerprints(b);
 if(!/^[a-f0-9]{32}$/.test(callId)||left.length!==1||right.length!==1||![left[0],right[0]].every(x=>/^[a-f0-9]{64}$/.test(x)))return null;
 return `volna-call-safety-v1\n${callId}\n${[left[0],right[0]].sort().join('\n')}`;
}
export async function callSafetyCode(callId,a,b){const material=callSafetyMaterial(callId,a,b);if(!material)return '';const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material));return [...new Uint8Array(digest)].slice(0,8).map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase().match(/.{4}/g).join(' · ');}
