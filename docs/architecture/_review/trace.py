#!/usr/bin/env python3
"""SPEC traceability generator for docs/architecture/09-ABDECKUNG.md.

Expands range notation (DOC-01 … DOC-06) before matching, which a naive grep does
not: without it every ID inside a range reads as uncovered and the matrix reports
phantom gaps.
"""
import re, glob, collections, sys

PREFIX = ('ACC|AGT|APR|AUT|BAU|CAL|CLN|CRM|DOC|DSH|EMP|FIN|LEG|NOT|OPS|PRO|PUB'
          '|RAD|REC|REP|REQ|SEC|SOC|TEN|TIM')
ID   = re.compile(rf'\b(?:{PREFIX})-(?:A?\d+)\b')
# "DOC-01 … DOC-06", "DOC-01 … 06", "DOC-01–DOC-06", "DOC-01 ... DOC-06"
RANGE = re.compile(rf'\b({PREFIX})-(\d{{1,2}})\s*(?:…|\.\.\.|–|—|-{{1,2}})\s*(?:(?:{PREFIX})-)?(\d{{1,2}})\b')

def spec_ids(path='docs/SPEC.md'):
    txt = open(path, encoding='utf-8').read()
    return sorted({m.group(0) for m in ID.finditer(txt)},
                  key=lambda i: (i.split('-')[0], i.split('-')[1].zfill(3)))

def expand(txt):
    """Every ID the text mentions, ranges expanded."""
    found = {m.group(0) for m in ID.finditer(txt)}
    for m in RANGE.finditer(txt):
        p, a, b = m.group(1), int(m.group(2)), int(m.group(3))
        if a <= b and b - a < 40:
            found |= {f'{p}-{n:02d}' for n in range(a, b + 1)}
    return found

def main():
    ids = spec_ids()
    docs = sorted(glob.glob('docs/architecture/*.md')) + \
           sorted(glob.glob('docs/architecture/02-datenmodell/*.md'))
    docs = [d for d in docs if 'HANDOVER' not in d and '09-ABDECKUNG' not in d
            and 'README' not in d and '_review' not in d]

    cover = collections.defaultdict(set)
    for d in docs:
        for i in expand(open(d, encoding='utf-8').read()):
            cover[i].add(d)

    # PR assignment: 08-PR-PLAN.md, "### PR n" headings, ranges expanded per section
    plan = open('docs/architecture/08-PR-PLAN.md', encoding='utf-8').read()
    parts = re.split(r'^#{2,4}\s*PR\s+(\d+)', plan, flags=re.M)
    prs = collections.defaultdict(set)
    for n, body in zip(parts[1::2], parts[2::2]):
        for i in expand(body):
            prs[i].add(int(n))
    return ids, docs, cover, prs

if __name__ == '__main__':
    ids, docs, cover, prs = main()
    missing = [i for i in ids if not cover[i]]
    nopr    = [i for i in ids if not prs[i]]
    print(f'SPEC IDs: {len(ids)}')
    print(f'covered by at least one document: {len(ids) - len(missing)}')
    print(f'assigned to at least one PR:      {len(ids) - len(nopr)}')
    if missing: print('NOT COVERED:', missing)
    if nopr:    print('NO PR:', nopr)
