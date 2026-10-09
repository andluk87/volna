package dev.volna.messenger;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name="VolnaAudio", permissions={@Permission(alias="bluetooth",strings={Manifest.permission.BLUETOOTH_CONNECT})})
public class VolnaAudioPlugin extends Plugin {
 private AudioManager audio;
 private int oldMode=AudioManager.MODE_NORMAL;
 private boolean changed=false;
 @Override public void load(){audio=(AudioManager)getContext().getSystemService(Context.AUDIO_SERVICE);}
 private void begin(){if(!changed){oldMode=audio.getMode();changed=true;}audio.setMode(AudioManager.MODE_IN_COMMUNICATION);}
 private void restore(){if(audio==null||!changed)return;if(Build.VERSION.SDK_INT>=31)audio.clearCommunicationDevice();else{audio.stopBluetoothSco();audio.setBluetoothScoOn(false);audio.setSpeakerphoneOn(false);}audio.setMode(oldMode);changed=false;}
 @PluginMethod public void devices(PluginCall call){
  try{JSArray out=new JSArray();String current="default";
   if(Build.VERSION.SDK_INT>=31){AudioDeviceInfo selected=audio.getCommunicationDevice();if(changed&&selected!=null)current=""+selected.getId();for(AudioDeviceInfo device:audio.getAvailableCommunicationDevices()){
    JSObject row=new JSObject();row.put("id",""+device.getId());String label=device.getProductName().toString();if(device.getType()==AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)label="Громкая связь";else if(device.getType()==AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)label="Разговорный динамик";row.put("label",label);out.put(row);
   }}else{for(String id:new String[]{"speaker","earpiece"}){if(id.equals("earpiece")&&!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY))continue;JSObject row=new JSObject();row.put("id",id);row.put("label",id.equals("speaker")?"Громкая связь":"Разговорный динамик");out.put(row);}if(changed)current=audio.isSpeakerphoneOn()?"speaker":"earpiece";}
   JSObject result=new JSObject();result.put("devices",out);result.put("current",current);call.resolve(result);
  }catch(Exception e){call.reject("Не удалось получить устройства звука",e);}
 }
 @PluginMethod public void start(PluginCall call){try{begin();call.resolve();}catch(Exception e){call.reject("Не удалось включить режим звонка",e);}}
 @PluginMethod public void select(PluginCall call){
  String id=call.getString("id","default");try{
   if(id.equals("default")){restore();call.resolve();return;}
   if(Build.VERSION.SDK_INT>=31){for(AudioDeviceInfo d:audio.getAvailableCommunicationDevices())if(id.equals(""+d.getId())){begin();if(!audio.setCommunicationDevice(d)){call.reject("Устройство недоступно");return;}call.resolve();return;}}
   else if(id.equals("speaker")||id.equals("earpiece")){begin();audio.stopBluetoothSco();audio.setBluetoothScoOn(false);audio.setSpeakerphoneOn(id.equals("speaker"));call.resolve();return;}
   call.reject("Устройство отключено");
  }catch(Exception e){call.reject("Не удалось переключить звук",e);}
 }
 @PluginMethod public void bluetooth(PluginCall call){if(Build.VERSION.SDK_INT>=31&&getPermissionState("bluetooth")!=PermissionState.GRANTED)requestPermissionForAlias("bluetooth",call,"bluetoothResult");else call.resolve();}
 @PermissionCallback private void bluetoothResult(PluginCall call){if(getPermissionState("bluetooth")==PermissionState.GRANTED)call.resolve();else call.reject("Нет разрешения Bluetooth");}
 @PluginMethod public void reset(PluginCall call){restore();call.resolve();}
 @PluginMethod public void keepAlive(PluginCall call){
  try{boolean active=call.getBoolean("active",false);Context context=getContext();
   if(active){android.content.Intent intent=new android.content.Intent(context,CallKeepAliveService.class);intent.setAction(CallKeepAliveService.ACTION_START);intent.putExtra("api",call.getString("api",""));intent.putExtra("token",call.getString("token",""));intent.putExtra("device",call.getString("device",""));intent.putExtra("peer",call.getString("peer","Volna"));if(Build.VERSION.SDK_INT>=26)context.startForegroundService(intent);else context.startService(intent);}
   else context.stopService(new android.content.Intent(context,CallKeepAliveService.class));call.resolve();
  }catch(Exception e){call.reject("Не удалось запустить фоновый режим звонка",e);}
 }
 @Override protected void handleOnDestroy(){restore();}
}
