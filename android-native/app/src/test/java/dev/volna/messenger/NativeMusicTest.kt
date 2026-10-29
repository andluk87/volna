package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeMusicTest {
 @Test fun queueHasExplicitBoundariesAndRepeatWraps(){val ids=listOf(10L,20L,30L);assertEquals(20L,nativeMusicNext(ids,10,1,false,false));assertNull(nativeMusicNext(ids,30,1,false,false));assertEquals(10L,nativeMusicNext(ids,30,1,false,true));assertEquals(30L,nativeMusicNext(ids,10,-1,false,true));assertNull(nativeMusicNext(ids,99,1,false,true));assertNull(nativeMusicNext(emptyList(),10,1,true,true))}
 @Test fun shuffleNeverRepeatsCurrentTrackWhenAlternativesExist(){repeat(100){assertTrue(nativeMusicNext(listOf(1,2,3),2,1,true,false) in listOf(1L,3L))}}
 @Test fun queueExcludesVoiceNotesAndDeletedMessages(){val music=VolnaMessage(1,1,"Имя","","",false,"song.mp3",attachmentMime="audio/mpeg");assertTrue(nativeIsMusic(music));assertFalse(nativeIsMusic(music.copy(attachmentName="Голосовое-1.m4a")));assertFalse(nativeIsMusic(music.copy(deleted=true)));assertFalse(nativeIsMusic(music.copy(attachmentMime="video/mp4")))}
}
