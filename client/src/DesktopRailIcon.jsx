import React from 'react';
// Filled, compact silhouettes for the Windows navigation rail.
export default function DesktopRailIcon({kind='folder'}){
 if(kind==='edit')return <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 9h15m5 0h2M5 23h2m5 0h15"/><circle cx="22" cy="9" r="3"/><circle cx="10" cy="23" r="3"/></svg>;
 if(kind==='all')return <svg viewBox="0 0 32 32" aria-hidden="true" fill="currentColor"><path d="M14 4C7.4 4 2 8.2 2 13.4c0 2.7 1.5 5.2 4 7L3.8 26l7.2-3.5c1 .2 2 .3 3 .3 6.6 0 12-4.2 12-9.4S20.6 4 14 4Z"/><path d="M28.4 13c1 1.3 1.6 2.9 1.6 4.6 0 2.5-1.3 4.7-3.6 6.2l1.7 4.3-5.8-2.6c-.9.2-1.8.3-2.8.3-2.5 0-4.8-.7-6.6-1.8h1.2c7.9 0 14.3-4.9 14.3-11Z"/></svg>;
 if(kind==='archive')return <svg viewBox="0 0 32 32" aria-hidden="true" fill="currentColor"><rect x="4" y="5" width="24" height="5" rx="2"/><path d="M6 12h20v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V12Zm6 4v3h8v-3h-8Z" fillRule="evenodd"/></svg>;
 return <svg viewBox="0 0 32 32" aria-hidden="true" fill="currentColor"><path d="M4 9a3 3 0 0 1 3-3h6l3 3h9a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9Z"/></svg>;
}
