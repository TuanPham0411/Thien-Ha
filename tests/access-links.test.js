import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accessLink} from '../mes/site/access-links.js';
test('internal links open as HTTP(S), drive and UNC paths are copy-only',()=>{
 for(const url of ['http://192.168.1.5:8080/mes','https://intranet.local/','/page/internal'])assert.equal(accessLink(url).kind,'web');
 for(const url of ['\\\\server\\share\\MES','Z:\\MES','file:///C:/MES'])assert.deepEqual(accessLink(url),{url,kind:'drive'});
 for(const url of ['javascript:alert(1)','data:text/html,x','//evil.test','http://user:secret@server/','https://server/\nsecret'])assert.throws(()=>accessLink(url));
});
