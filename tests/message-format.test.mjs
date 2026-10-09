import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInline,parseMessage} from '../client/src/message-format.mjs';

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
