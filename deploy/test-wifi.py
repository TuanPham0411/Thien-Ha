import importlib.util,pathlib,unittest,time,tempfile
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('wifi',pathlib.Path(__file__).with_name('wifi-agent.py'));wifi=importlib.util.module_from_spec(spec);spec.loader.exec_module(wifi)
class WifiTests(unittest.TestCase):
 def tearDown(self):wifi.pending=None
 def test_host_detection_and_validation(self):
  with patch.object(wifi,'is_pi',return_value=False),patch.object(wifi,'run') as run:
   self.assertFalse(wifi.status()['available']);run.assert_not_called()
  for data in [{'ssid':'x','password':'short'},{'ssid':'x\n[connection]','password':'good-password'},{'ssid':'x','password':'good-password','security':'invalid'},{'ssid':'ắ'*32,'password':'good-password'}]:
   with self.assertRaises(ValueError):wifi.validate(data)
  self.assertEqual(wifi.validate({'ssid':'Nhà máy','password':'good-password'})[0],'Nhà máy')
 def test_confirm_requires_pending_id_active_connection_and_deadline(self):
  wifi.pending={'id':'new-id','deadline':time.time()+100,'checkpoint':'checkpoint'}
  with patch.object(wifi,'run',return_value='old-id'),patch.object(wifi,'interface',return_value='wlan0'),patch.object(wifi,'nm') as nm:
   with self.assertRaises(ValueError):wifi.confirm({'id':'wrong-id'})
   with self.assertRaises(ValueError):wifi.confirm({'id':'new-id'})
   nm.assert_not_called()
  wifi.pending['deadline']=time.time()-1
  with self.assertRaises(ValueError):wifi.confirm({'id':'new-id'})
 def test_confirm_persists_only_active_profile_then_commits_checkpoint(self):
  wifi.pending={'id':'new-id','deadline':time.time()+100,'checkpoint':'checkpoint'}
  with patch.object(wifi,'run',return_value='new-id') as run,patch.object(wifi,'status',return_value={'connected':True}),patch.object(wifi,'interface',return_value='wlan0'),patch.object(wifi,'nm') as nm:
   self.assertEqual(wifi.confirm({'id':'new-id'}),{'ok':True});nm.assert_called_once_with('CheckpointDestroy','o','checkpoint');self.assertIsNone(wifi.pending)
   self.assertIn('connection.autoconnect',run.call_args.args[0])
 def test_connect_checkpoint_precedes_loading_and_secret_never_appears_in_argv(self):
  calls=[]
  def run(args,timeout=15):
   calls.append(args)
   if 'GENERAL.DBUS-PATH' in args:return '/org/freedesktop/NetworkManager/Devices/2'
   return ''
  with tempfile.TemporaryDirectory() as root:
   original=wifi.Path
   def path(value):return original(root) if value=='/etc/NetworkManager/system-connections' else original(value)
   with patch.object(wifi,'Path',side_effect=path),patch.object(wifi,'status',return_value={'available':True}),patch.object(wifi,'interface',return_value='wlan0'),patch.object(wifi,'nm',return_value=['/org/freedesktop/NetworkManager/Checkpoint/1']) as nm,patch.object(wifi,'run',side_effect=run),patch.object(wifi.threading,'Thread'):
    result=wifi.connect({'ssid':'MES WiFi','password':' secret\\word '});self.assertIn('id',result);nm.assert_called_once_with('CheckpointCreate','aouu','1','/org/freedesktop/NetworkManager/Devices/2','120','2')
    profile=next(original(root).iterdir());self.assertEqual(profile.stat().st_mode&0o777,0o600);self.assertIn('autoconnect=false',profile.read_text());self.assertIn('psk=\\ssecret\\\\word\\s',profile.read_text());self.assertNotIn('secret',str(calls))
if __name__=='__main__':unittest.main()
