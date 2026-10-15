import {useEffect,useState} from 'react';
import {desktopNotificationSettings} from './desktop-notifications.mjs';
export default function useDesktopNotificationSettings(){const [settings,setSettings]=useState(desktopNotificationSettings);useEffect(()=>{const update=()=>setSettings(desktopNotificationSettings());window.addEventListener('volna-desktop-notifications-changed',update);window.addEventListener('storage',update);return()=>{window.removeEventListener('volna-desktop-notifications-changed',update);window.removeEventListener('storage',update);};},[]);return settings;}
