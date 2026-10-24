/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS isolated model tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const flow = { exports: {} };
const compile = path => ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(compile('src/components/debugquest/flow-model.ts'), flow);
const context = { exports: {}, require: () => flow.exports };
vm.runInNewContext(compile('src/components/debugquest/dashboard-model.ts'), context);
const { parseAttempts, readDashboard, filterAttempts, summarize, activityDays, demoAttempts, attemptsCsv } = context.exports;
const all = { lessonId: 'all', from: '', to: '', result: 'all' };
const records = demoAttempts(new Date(2026, 9, 25, 12));
test('dashboard uses only valid records and assigns owning lesson', () => {
  const rows = parseAttempts(JSON.stringify({ attempts: [records[0], null, { ...records[1], score: -1 }] }), 'exam');
  assert.equal(rows.length, 1); assert.equal(rows[0].lessonId, 'exam');
});
test('new storage takes precedence over legacy records without double counting', () => {
  const key = flow.exports.lessonKey('exam');
  const values = { [key]: JSON.stringify({ attempts: [records[0]] }), 'codepath.mock.v1': JSON.stringify({ attempts: [records[1]] }) };
  const read = readDashboard({ getItem: k => values[k] ?? null });
  assert.equal(read.attempts.length, 1); assert.equal(read.attempts[0].id, records[0].id);
});
test('damaged lesson does not hide data from other lessons', () => {
  const values = { [flow.exports.lessonKey('exam')]: '{invalid', [flow.exports.lessonKey('age')]: JSON.stringify({ attempts: [records[1]] }) };
  const read = readDashboard({ getItem: k => values[k] ?? null });
  assert.equal(read.errors.length, 1); assert.equal(read.attempts.length, 1);
});
test('filters combine lesson, inclusive local calendar dates and pass status', () => {
  const selected = filterAttempts(records, { ...all, lessonId: 'age', from: '2026-10-24', to: '2026-10-25', result: 'passed' });
  assert.equal(selected.length, 1); assert.equal(selected[0].id, 'demo-1');
  assert.equal(filterAttempts(records, { ...all, from: '2030-01-01' }).length, 0);
});
test('completed lessons count once even after repeated successes', () => {
  const row = { ...records[0], fixedSuccessfully: true };
  const stats = summarize([row, { ...row, id: 'repeat' }]);
  assert.equal(stats.completedLessons, 1); assert.equal(stats.count, 2); assert.equal(stats.passRate, 100);
  assert.equal(summarize([]).averageTime, 0); assert.equal(summarize([]).passRate, 0);
});
test('daily buckets reconcile with filtered totals', () => {
  const stats = summarize(records), days = activityDays(records);
  assert.equal(days.reduce((n, d) => n + d.total, 0), stats.count);
  assert.equal(days.reduce((n, d) => n + d.passed, 0), stats.passed);
});
test('CSV has Thai headers, a BOM and one row per filtered attempt', () => {
  const csv = attemptsCsv(records.slice(0, 2));
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('บทเรียน')); assert.equal(csv.split('\r\n').length, 3);
});
