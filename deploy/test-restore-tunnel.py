import os,pathlib,subprocess,tempfile,unittest
EXPECTED='[Service]\nEnvironment=TUNNEL_TRANSPORT_PROTOCOL=http2\nEnvironment=TUNNEL_EDGE_IP_VERSION=4\n'
class RestoreChecks(unittest.TestCase):
 def check(self,fail=False,modified=False):
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder);commands=root/'bin';commands.mkdir();config=root/'transport.conf';config.write_text('manual changes\n' if modified else EXPECTED)
   for name,body in {'id':'echo 0','systemctl':'echo "$*" >> "$TEST_CALLS"','sleep':':','journalctl':"printf '%s\\n' 'Registered tunnel connection' 'Registered tunnel connection'",'curl':'exit '+('22' if fail else '0')}.items():
    path=commands/name;path.write_text('#!/bin/bash\n'+body+'\n');path.chmod(0o755)
   source=pathlib.Path(__file__).with_name('restore-tunnel.sh').read_text().replace('/etc/systemd/system/cloudflared.service.d/50-th-transport.conf',str(config)).replace('/run/th-tunnel-restore.',str(root/'temporary.'));script=root/'script';script.write_text(source);calls=root/'calls';env={**os.environ,'PATH':str(commands)+':'+os.environ['PATH'],'TEST_CALLS':str(calls)}
   result=subprocess.run(['bash',str(script)],env=env,capture_output=True,text=True)
   if fail or modified:self.assertNotEqual(result.returncode,0);self.assertEqual(config.read_text(),'manual changes\n' if modified else EXPECTED)
   else:
    self.assertEqual(result.returncode,0,result.stderr);self.assertFalse(config.exists());before=calls.read_text();again=subprocess.run(['bash',str(script)],env=env,capture_output=True,text=True);self.assertEqual(again.returncode,0);self.assertEqual(calls.read_text(),before)
   self.assertFalse(list(root.glob('temporary.*')))
 def test_restore_and_repeat(self):self.check()
 def test_failed_health_restores_prior_dropin(self):self.check(fail=True)
 def test_manual_changes_are_retained(self):self.check(modified=True)
if __name__=='__main__':unittest.main()
