import importlib.util,pathlib,unittest
from unittest.mock import patch,mock_open
spec=importlib.util.spec_from_file_location('status',pathlib.Path(__file__).with_name('rpi-status.py'));status=importlib.util.module_from_spec(spec);spec.loader.exec_module(status)
class StatusTests(unittest.TestCase):
 def test_service_and_api_failures_remain_distinct(self):
  output=status.frame({'th-app.service':'active','nginx.service':'failed'},'UNREACHABLE','eth0 192.0.2.5')
  self.assertIn('[OK] th-app',output);self.assertIn('[!!] nginx',output);self.assertIn('UNREACHABLE',output);self.assertIn('Ctrl+Alt+F1',output)
 def test_api_failure_does_not_crash_screen(self):
  with patch.object(status.urllib.request,'urlopen',side_effect=OSError('offline')):self.assertEqual(status.health(),'UNREACHABLE')
 def test_vt_switch_is_explicit(self):
  with patch('builtins.open',mock_open()) as stream,patch.object(status.fcntl,'ioctl') as command:
   status.activate(8);command.assert_called_once_with(stream().__enter__(),0x5606,8)
if __name__=='__main__':unittest.main()
