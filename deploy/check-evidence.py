"""Read-only production check: report evidence counts, never ticket content/accounts."""
import json
import sys

rows = json.load(sys.stdin)['rows']
for row in sorted(rows, key=lambda r: r.get('createdAt',0), reverse=True)[:10]:
    attachments = row.get('attachments') or []
    count = sum(str(f.get('type','')).startswith(('image/','video/')) for f in attachments)
    print(json.dumps({'ticket':row.get('ticketNumber'), 'createdAt':row.get('createdAt'), 'files':len(attachments), 'photoVideo':count, 'evidenceRequired':row.get('evidenceRequired',False)}))
for row in rows:
    assert not row.get('pendingEvidence'), 'An upload draft was exposed publicly'
    if row.get('evidenceRequired'):
        assert any(str(f.get('type','')).startswith(('image/','video/')) for f in row.get('attachments',[])), 'A required-evidence ticket was published without media'
