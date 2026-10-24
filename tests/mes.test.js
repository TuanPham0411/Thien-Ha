import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateFiles,
  validateEvidence,
  validateIssue,
  validateOccurrences,
  filterIssues,
  stats,
  safeUsername,
  makeDemo,
  csvCell,
} from "../mes/site/model.js";
import {
  verifyProof,
  canonicalProof,
  activeSession,
  challengeMatches,
} from "../mes/proof.js";
import { createHmac, createHash } from "node:crypto";
test("Windows proof is bound to challenge, nonce, username and device", () => {
  const secret = Buffer.alloc(32, 7).toString("base64");
  const proof = {
    challengeId: "abc123",
    nonce: "a".repeat(64),
    username: "phtuan",
    deviceId: "device123",
  };
  proof.signature = createHmac("sha256", Buffer.from(secret, "base64"))
    .update(canonicalProof(proof))
    .digest("hex");
  assert.equal(verifyProof(proof, secret), true);
  for (const key of ["challengeId", "nonce", "username", "deviceId"])
    assert.equal(verifyProof({ ...proof, [key]: "changed" }, secret), false);
  assert.equal(verifyProof({ ...proof, signature: "bad" }, secret), false);
  assert.equal(
    verifyProof(proof, Buffer.alloc(32, 8).toString("base64")),
    false,
  );
});
test("managed sessions reject inactive, future, expired and mismatched Windows proofs", () => {
  const now = 1000000000000,
    u = { active: true, username: "phtuan" },
    token = { windowsUsername: "phtuan", windowsVerifiedAt: now - 100 };
  assert.equal(activeSession(token, u, true, now), true);
  assert.equal(activeSession({}, u, true, now), false);
  assert.equal(
    activeSession({ ...token, windowsUsername: "other" }, u, true, now),
    false,
  );
  assert.equal(
    activeSession({ ...token, windowsVerifiedAt: now + 1 }, u, true, now),
    false,
  );
  assert.equal(
    activeSession(
      { ...token, windowsVerifiedAt: now - 43200001 },
      u,
      true,
      now,
    ),
    false,
  );
  assert.equal(
    activeSession(token, { ...u, active: false }, false, now),
    false,
  );
  assert.equal(activeSession({}, u, false, now), true);
});
test("feedback requires catalogs, bounded text and a meaningful description", () => {
  const d = {
    teamLeaderId: "a",
    departmentId: "b",
    process: "Station 1",
    subject: "Report issue",
    description: "Production report cannot be opened.",
  };
  assert.equal(validateIssue(d), "");
  for (const v of [
    { ...d, departmentId: "" },
    { ...d, process: " " },
    { ...d, description: " " },
    { ...d, description: "x".repeat(5001) },
  ])
    assert.notEqual(validateIssue(v), "");
});
test("attachments enforce count, type and size", () => {
  const file = { name: "screen.png", type: "image/png", size: 1024 };
  assert.equal(validateFiles([file]), "");
  assert.equal(
    validateFiles([
      { name: "report.csv", type: "application/vnd.ms-excel", size: 100 },
    ]),
    "",
  );
  assert.equal(
    validateFiles([{ name: "report.txt", type: "", size: 100 }]),
    "",
  );
  assert.notEqual(validateFiles([{ ...file, size: 0 }]), "");
  assert.notEqual(validateFiles(Array(6).fill(file)), "");
  assert.notEqual(validateFiles([{ ...file, size: 11 * 1024 * 1024 }]), "");
  assert.notEqual(
    validateFiles([
      { ...file, type: "application/x-msdownload", name: "program.exe" },
    ]),
    "",
  );
});
test("dashboard statistics and combined filters reflect only matching data", () => {
  const { issues } = makeDemo();
  assert.deepEqual(stats(issues), {
    total: 6,
    open: 4,
    progress: 1,
    resolved: 2,
    critical: 1,
  });
  assert.equal(
    filterIssues(issues, { status: "New", priority: "Critical" }).length,
    1,
  );
  assert.equal(filterIssues(issues, { search: "scanner" }).length, 1);
  assert.equal(filterIssues(issues, { department: "unknown" }).length, 0);
  assert.equal(issues.filter((i) => i.resolvedAt).length, 2);
});
test("CSV export escapes formulas, delimiters and control-prefixed payloads", () => {
  for (const input of [
    "=1+1",
    "+cmd",
    "-1+2",
    "@SUM(A1)",
    "\t=1",
    "  =1",
    "\r=1",
  ])
    assert.ok(csvCell(input).startsWith("\"'"));
  assert.equal(csvCell('a"b,c'), '"a""b,c"');
});
test("managed usernames reject traversal and unsafe Windows names", () => {
  assert.equal(safeUsername("phtuan"), true);
  assert.equal(safeUsername("john.doe-01"), true);
  for (const x of [
    "../admin",
    "C:\\Users\\admin",
    "a..b",
    "john doe",
    "a/b",
    "",
    "x".repeat(65),
  ])
    assert.equal(safeUsername(x), false);
});

test("Windows challenges expire, bind the nonce, and cannot be reused", () => {
  const proof = { username: "phtuan", nonce: "a".repeat(64) };
  const c = {
    username: "phtuan",
    nonceHash: createHash("sha256").update(proof.nonce).digest("hex"),
    expiresAt: 2000,
    used: false,
  };
  assert.equal(challengeMatches(c, proof, 1000), true);
  assert.equal(challengeMatches({ ...c, used: true }, proof, 1000), false);
  assert.equal(challengeMatches(c, proof, 2000), false);
  assert.equal(
    challengeMatches(c, { ...proof, username: "other" }, 1000),
    false,
  );
  assert.equal(
    challengeMatches(c, { ...proof, nonce: "b".repeat(64) }, 1000),
    false,
  );
});

test("incident times allow multiple moments/ranges and reject invalid limits", () => {
  const point = {kind:'point',start:'2026-10-16T01:00:00Z'};
  const range = {kind:'range',start:'2026-10-16T02:00:00Z',end:'2026-10-16T03:00:00Z'};
  assert.equal(validateOccurrences([point,range,point]),'');
  assert.equal(validateOccurrences([]),'');
  for (const bad of [[{...point,start:'bad'}],[{...range,end:point.start}],[{...range,end:null}],Array(21).fill(point),[{...point,start:'1990-01-01T00:00:00Z'}]]) assert.notEqual(validateOccurrences(bad),'');
  assert.equal(validateIssue({departmentId:'a',process:'Station',description:'Lỗi'}),'');
});

test('video evidence has bounded file types and separate limits from images',()=>{
 assert.equal(validateFiles([{name:'recording.webm',type:'video/webm',size:200*1024*1024}]),'');
 assert.match(validateFiles([{name:'recording.mp4',type:'video/mp4',size:201*1024*1024}]),/200 MB/);
 assert.match(validateFiles([{name:'photo.jpg',type:'image/jpeg',size:11*1024*1024}]),/10 MB/);
 assert.match(validateFiles([{name:'script.mp4',type:'text/html',size:100}]),/unsupported/);
});

test('new tickets require image or video evidence; supplementary documents remain supported',()=>{
 const document={name:'notes.pdf',type:'application/pdf',size:100};
 assert.match(validateEvidence([]),/photo or video/);
 assert.match(validateEvidence([document]),/photo or video/);
 assert.equal(validateFiles([document]),'');
 for(const type of ['image/png','video/mp4'])assert.equal(validateEvidence([{name:'evidence',type,size:100}]),'');
 assert.match(validateEvidence([{name:'empty.png',type:'image/png',size:0}]),/empty/);
});
