export function presenceLabel(online,lastSeen,now=Date.now()){
 if(online)return 'в сети';
 const time=Number(lastSeen);if(!Number.isFinite(time)||time<=0)return 'Время посещения недоступно';
 const age=Math.max(0,now-time);if(age<60_000)return 'был(а) только что';if(age<3_600_000)return `был(а) ${Math.floor(age/60_000)} мин. назад`;
 return 'был(а) '+new Date(time).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}
