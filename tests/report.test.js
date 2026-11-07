import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportHtml } from '../src/report.js';
import { outcome } from '../src/runner.js';
test('M6 report embeds data safely without external dependencies', () => {
  const r = {
    project: '</script><img src=x onerror=alert(1)>',
    findings: [],
    evidence: {},
    summary: {},
    pages: [],
  };
  const h = reportHtml(r);
  assert.ok(h.includes('\\u003c/script>'));
  assert.ok(!h.includes('<img src=x'));
  assert.ok(!/src="https?:/.test(h));
  assert.ok(h.includes("connect-src 'none'"));
});
test('M7 exit status distinguishes uncertainty from regressions', () => {
  assert.equal(outcome([], []).exitCode, 0);
  assert.equal(outcome([{ severity: 'high', confidence: 0.9 }], []).exitCode, 1);
  assert.equal(outcome([{ severity: 'high', confidence: 0.4 }], []).status, 'review');
  assert.equal(outcome([], [{ status: 'inconclusive' }]).exitCode, 3);
});
