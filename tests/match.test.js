import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchComponents } from '../src/match.js';
const items = (names) =>
  names.map((heading, i) => ({
    id: 'c' + i,
    type: 'text',
    heading,
    parentId: null,
    siblingIndex: i,
  }));
test('M4 insertion/reorder never shifts existing matches', () => {
  const a = items(['Alpha', 'Bravo', 'Charlie']),
    b = items(['Charlie', 'New', 'Alpha', 'Bravo']);
  const m = matchComponents(a, b);
  for (const x of m.filter((x) => x.status === 'matched'))
    assert.equal(
      a.find((i) => i.id === x.referenceId).heading,
      b.find((i) => i.id === x.candidateId).heading,
    );
  assert.equal(m.filter((x) => x.status === 'added').length, 1);
});
test('M4 repeated identical headings remain ambiguous', () => {
  assert.ok(
    matchComponents(items(['Same', 'Same']), items(['Same', 'Same'])).every(
      (x) => x.status === 'ambiguous',
    ),
  );
});
test('M4 changed heading with unique type pairs; removal is explicit', () => {
  assert.equal(matchComponents(items(['Before']), items(['After']))[0].status, 'matched');
  assert.equal(matchComponents(items(['Before']), [])[0].status, 'removed');
});
