import index from './animated-emoji-index.json';
import {version} from '../package.json';

export function animatedEmojiFile(emoji){return index[emoji.replace(/\ufe0f/g,'')]||null;}
const cache=new Map();
let player;
export function loadEmojiPlayer(){
 return player??=import('lottie-web/build/player/lottie_light').then(module=>module.default).catch(error=>{player=null;throw error;});
}
export function loadEmojiAnimation(file){
 if(cache.has(file))return cache.get(file);
 const promise=(async()=>{
  const response=await fetch(`${import.meta.env.BASE_URL}site/animated-emoji/${file}?v=${version}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Emoji animation unavailable');
  const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
 })().catch(error=>{cache.delete(file);throw error;});
 cache.set(file,promise);
 if(cache.size>24)cache.delete(cache.keys().next().value);
 return promise;
}
