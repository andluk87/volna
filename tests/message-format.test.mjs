import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInline,parseMessage,formatSelection,highlightCode} from '../client/src/message-format.mjs';

test('message formatter recognizes fenced code, quotes and paragraphs without losing text',()=>{
 const source='Обычный текст\n\n```js\nconst x = 1;\n```\n> цитата';
 assert.deepEqual(parseMessage(source),[
  {type:'paragraph',text:'Обычный текст'},
  {type:'code',text:'const x = 1;',language:'js'},
  {type:'quote',text:'цитата'}
 ]);
});

test('unclosed code fence stays visible as literal text',()=>{
 assert.deepEqual(parseMessage('```\nстрока'),[{type:'code',text:'```\nстрока',language:''}]);
});

test('inline formatting recognizes emphasis, strike, code and only HTTPS links',()=>{
 assert.deepEqual(parseInline('**жирный** *курсив* ~~удалено~~ `x` [сайт](https://example.org) [опасно](javascript:alert(1))'),[
  {type:'strong',text:'жирный'},{type:'text',text:' '},{type:'em',text:'курсив'},{type:'text',text:' '},
  {type:'del',text:'удалено'},{type:'text',text:' '},{type:'inline-code',text:'x'},{type:'text',text:' '},
  {type:'link',text:'сайт',href:'https://example.org'},{type:'text',text:' [опасно](javascript:alert(1))'}
 ]);
});

test('italic aliases, menu underline and spoiler remain distinct',()=>{
 assert.deepEqual(parseInline('__курсив__ <u>низ</u> ||секрет||').filter(p=>p.type!=='text'),[{type:'em',text:'курсив'},{type:'underline',text:'низ'},{type:'spoiler',text:'секрет'}]);
});

test('format selection preserves UTF-16 emoji offsets inside and after selection',()=>{
 const entities=[{id:'a'.repeat(32),start:2,length:2},{id:'b'.repeat(32),start:7,length:2}];
 const edit=formatSelection('A 😀 B 😀',entities,2,4,'bold');
 assert.equal(edit.text,'A **😀** B 😀');assert.deepEqual(edit.entities.map(e=>e.start),[4,11]);assert.deepEqual(edit.selection,[4,6]);
 const quote=formatSelection('😀\nx',entities.slice(0,1).map(e=>({...e,start:0})),0,4,'quote');assert.equal(quote.text,'> 😀\n> x');assert.equal(quote.entities[0].start,2);
});
test('links reject active schemes, credentials and encode parentheses',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,test','https://user:password@example.org'])assert.throws(()=>formatSelection('сайт',[],0,4,'link',url));
 assert.equal(formatSelection('сайт',[],0,4,'link','https://example.org/(test)').text,'[сайт](https://example.org/%28test%29)');
});
test('code fences receive separate lines in middle of message',()=>{
 assert.equal(formatSelection('abcxdef',[],3,4,'code','js').text,'abc\n```js\nx\n```\ndef');
 assert.throws(()=>formatSelection('x',[],0,1,'code','js\n```'));
});
test('syntax highlighting preserves source and never interprets markup',()=>{
 const code='const x = "<script>**text**</script>"; // comment\nreturn 1;';const parts=highlightCode(code,'js');assert.equal(parts.map(p=>p.text).join(''),code);for(const kind of ['keyword','string','comment','number'])assert.ok(parts.some(p=>p.type===kind));
 assert.deepEqual(highlightCode(code,'unknown'),[{text:code,type:'text'}]);
});

test('menu formatting works across lines without losing custom emoji positions',()=>{
 const value='first\n😀';const edit=formatSelection(value,[{id:'a'.repeat(32),start:6,length:2}],0,value.length,'spoiler');assert.equal(edit.text,'||first||\n||😀||');assert.equal(edit.entities[0].start,12);assert.deepEqual(parseInline(edit.text).filter(p=>p.type==='spoiler').map(p=>p.text),['first','😀']);
});
