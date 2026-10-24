/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness loads the transpiled client module. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { Worker: Thread } = require('node:worker_threads');
const source = fs.readFileSync('src/components/debugquest/DebugQuestApp.tsx', 'utf8');
const compiled = ts.transpileModule(source + '\nexport { runCodeInWorker, validAttempt, localDay, calculateStreak, zoomAt, fitView };', { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const blobs = new Map();
let id = 0;
class BrowserWorker {
  constructor(url) {
    this.thread = new Thread(`const { parentPort } = require('node:worker_threads'); globalThis.self = globalThis; self.postMessage = value => parentPort.postMessage(value); parentPort.on('message', data => self.onmessage({ data }));\n${blobs.get(url)}`, { eval: true });
    this.thread.on('message', data => this.onmessage?.({ data }));
    this.thread.on('error', error => this.onerror?.(error));
  }
  postMessage(data) { this.thread.postMessage(data); }
  terminate() { this.thread.terminate(); }
}
const modelContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/debugquest/flow-model.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, modelContext);
const context = { exports: {}, require: name => name === './flow-model' ? modelContext.exports : name === './Dashboard' ? { Dashboard: () => null } : name.endsWith('.css') ? {} : require(name), Worker: BrowserWorker, Blob: class { constructor(parts) { this.source = parts.join(''); } }, URL: { createObjectURL(blob) { const key = String(++id); blobs.set(key, blob.source); return key; }, revokeObjectURL(key) { blobs.delete(key); } }, window: { setTimeout, clearTimeout }, console };
vm.runInNewContext(compiled, context);
const { runCodeInWorker, validAttempt, localDay, calculateStreak } = context.exports;
test('correct solution passes the boundary cases and releases resources', async () => {
  const results = await runCodeInWorker('return score >= 50 ? "ผ่าน" : "ลองอีกครั้ง";');
  assert.equal(results.length, 5);
  assert.ok(results.every(r => r.passed));
  assert.equal(blobs.size, 0);
});
test('incorrect threshold fails the score 50 case', async () => {
  const results = await runCodeInWorker('return score > 50 ? "ผ่าน" : "ลองอีกครั้ง";');
  assert.equal(results.find(r => r.input === 50).passed, false);
});
test('syntax error is surfaced and resources released', async () => {
  await assert.rejects(runCodeInWorker('if ( {'));
  assert.equal(blobs.size, 0);
});
test('infinite loop is terminated', async () => {
  await assert.rejects(runCodeInWorker('while (true) {}'), /โค้ดใช้เวลานานเกินไป/);
  assert.equal(blobs.size, 0);
});
test('corrupt saved history is rejected', () => {
  assert.equal(validAttempt(null), false);
  assert.equal(validAttempt({ id: 'bad', completedAt: 'invalid' }), false);
  assert.equal(validAttempt({ id: 'a', completedAt: new Date().toISOString(), score: 100, timeToResolveMin: 1, readLogFirst: true, copeToAi: false, usedDiagram: true, fixedSuccessfully: true, errorType: '' }), true);
});
test('daily streak uses calendar days and ignores failures', () => {
  assert.equal(localDay(new Date(2026, 9, 24, 0, 1)), '2026-10-24');
  assert.equal(calculateStreak([{ fixedSuccessfully: false, completedAt: new Date().toISOString() }]), 0);
  assert.equal(calculateStreak([{ fixedSuccessfully: true, completedAt: new Date().toISOString() }]), 1);
});

test('zoom keeps the world point under the cursor and clamps the scale', () => {
  const { zoomAt } = context.exports;
  const before = { x: -80, y: 30, zoom: 0.8 };
  const after = zoomAt(before, 1.6, 320, 200);
  assert.equal((320 - before.x) / before.zoom, (320 - after.x) / after.zoom);
  assert.equal((200 - before.y) / before.zoom, (200 - after.y) / after.zoom);
  assert.equal(zoomAt(before, 100, 0, 0).zoom, 2.5);
  assert.equal(zoomAt(before, 0, 0, 0).zoom, 0.25);
});
test('fit view places every node inside the viewport', () => {
  const nodes = [{ x: 100, y: 80 }, { x: 1200, y: 600 }];
  const camera = context.exports.fitView(nodes, 800, 560);
  for (const node of nodes) {
    assert.ok(node.x * camera.zoom + camera.x >= 0);
    assert.ok(node.y * camera.zoom + camera.y >= 0);
    assert.ok((node.x + 190) * camera.zoom + camera.x <= 800);
    assert.ok((node.y + 120) * camera.zoom + camera.y <= 560);
  }
});

function completeGraph(lesson) {
  return { nodes: modelContext.exports.starterNodes(lesson), edges: [...modelContext.exports.starterEdges, { from: 'check', to: 'pass', label: 'ใช่' }, { from: 'check', to: 'retry', label: 'ไม่ใช่' }] };
}
test('every lesson simulates both boundary branches and produces its own outputs', () => {
  const { lessons, simulateGraph, checkLessonPlan } = modelContext.exports;
  for (const lesson of lessons) {
    const { nodes, edges } = completeGraph(lesson);
    assert.equal(checkLessonPlan(nodes, edges, lesson).length, 0);
    for (const c of lesson.cases) {
      const steps = simulateGraph(nodes, edges, c.input);
      assert.equal(steps.at(-1).output, c.expected);
      assert.equal(steps.length, 4);
      assert.equal(edges[steps[2].edgeIndex].label, c.input >= lesson.threshold ? 'ใช่' : 'ไม่ใช่');
    }
  }
});
test('diagnostics identify incomplete branches and unreachable nodes by id', () => {
  const { lessons, starterNodes, starterEdges, validateGraph } = modelContext.exports;
  const issues = validateGraph(starterNodes(lessons[0]), starterEdges);
  assert.ok(issues.some(i => i.nodeId === 'check' && i.message.includes('ต้องเชื่อม')));
  assert.ok(issues.some(i => i.nodeId === 'pass' && i.message.includes('ไปไม่ถึง')));
});
test('cycle in a disconnected component is reported and cannot be simulated', () => {
  const { lessons, validateGraph, simulateGraph } = modelContext.exports;
  const { nodes, edges } = completeGraph(lessons[0]);
  nodes.push({ id: 'loop-a', kind: 'process', title: 'A', detail: '', x: 0, y: 0, operation: 'add', operand: 1 }, { id: 'loop-b', kind: 'process', title: 'B', detail: '', x: 0, y: 0, operation: 'add', operand: 1 });
  edges.push({ from: 'loop-a', to: 'loop-b' }, { from: 'loop-b', to: 'loop-a' });
  assert.ok(validateGraph(nodes, edges).some(i => i.message.includes('วนลูป')));
  assert.throws(() => simulateGraph(nodes, edges, 50));
});
test('swapped outputs are structurally valid but fail lesson validation', () => {
  const { lessons, validateGraph, checkLessonPlan } = modelContext.exports;
  const { nodes, edges } = completeGraph(lessons[0]);
  [edges[2].to, edges[3].to] = [edges[3].to, edges[2].to];
  assert.equal(validateGraph(nodes, edges).length, 0);
  assert.ok(checkLessonPlan(nodes, edges, lessons[0]).length > 0);
});
test('process nodes change the value before a decision and dangling edges are rejected', () => {
  const { lessons, simulateGraph, validateGraph } = modelContext.exports;
  const { nodes, edges } = completeGraph(lessons[0]);
  nodes.push({ id: 'add', kind: 'process', title: 'add', detail: '', x: 0, y: 0, operation: 'add', operand: 5 });
  edges[1] = { from: 'input', to: 'add' }; edges.push({ from: 'add', to: 'check' });
  assert.equal(simulateGraph(nodes, edges, 45).at(-1).output, 'ผ่าน');
  edges.push({ from: 'pass', to: 'missing' });
  assert.ok(validateGraph(nodes, edges).some(i => i.message.includes('ไม่มีอยู่')));
});
test('lesson code uses each lesson variable and test cases independently', async () => {
  const { lessons, lessonKey } = modelContext.exports;
  assert.equal(new Set(lessons.map(l => lessonKey(l.id))).size, lessons.length);
  for (const lesson of lessons) {
    const results = await runCodeInWorker(`return ${lesson.variable} >= ${lesson.threshold} ? ${JSON.stringify(lesson.yes)} : ${JSON.stringify(lesson.no)};`, lesson.cases, lesson.variable);
    assert.ok(results.every(r => r.passed));
  }
});
