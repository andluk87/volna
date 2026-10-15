export function clampCallPosition(point, viewport, size, margin=12) {
 const xMax=Math.max(0,viewport.width-size.width-margin),yMax=Math.max(0,viewport.height-size.height-margin);
 return {x:Math.max(Math.min(margin,xMax),Math.min(xMax,point.x)),y:Math.max(Math.min(margin,yMax),Math.min(yMax,point.y))};
}
