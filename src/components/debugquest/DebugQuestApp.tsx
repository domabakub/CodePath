"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import "./debugquest.css";
import { Dashboard } from "./Dashboard";

import { lessons, lessonKey, starterNodes, starterEdges, starterCode, validateGraph, simulateGraph, checkLessonPlan, type FlowNode, type Edge, type NodeKind, type Lesson, type SimulationStep } from "./flow-model";

type Phase = "plan" | "trace" | "code" | "result";
type AttemptRecord = { lessonId?: string; id: string; completedAt: string; score: number; timeToResolveMin: number; readLogFirst: boolean; copeToAi: boolean; usedDiagram: boolean; fixedSuccessfully: boolean; errorType: string };
type RunResult = { passed: boolean; input: number; actual?: unknown; error?: string };
function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function validAttempt(value: unknown): value is AttemptRecord {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return typeof a.id === "string" && typeof a.completedAt === "string" && Number.isFinite(Date.parse(a.completedAt))
    && typeof a.score === "number" && Number.isFinite(a.score) && a.score >= 0 && a.score <= 100
    && typeof a.timeToResolveMin === "number" && Number.isFinite(a.timeToResolveMin) && a.timeToResolveMin >= 0
    && [a.readLogFirst, a.copeToAi, a.usedDiagram, a.fixedSuccessfully].every(v => typeof v === "boolean") && typeof a.errorType === "string";
}
const STORAGE_KEY = "codepath.mock.v1";

const kindMeta: Record<NodeKind, { label: string; icon: string; className: string }> = {
  start: { label: "เริ่ม / จบ", icon: "▶", className: "start" },
  input: { label: "Input", icon: "↓", className: "input" },
  process: { label: "Process", icon: "⚙", className: "process" },
  decision: { label: "เงื่อนไข", icon: "◇", className: "decision" },
  output: { label: "Output", icon: "↑", className: "output" },
};
const navItems = [
  { id: "dashboard", title: "Dashboard", icon: "▦" },
  { id: "plan", title: "วางแผน Flow", icon: "⌘" },
  { id: "lessons", title: "เส้นทางเรียนรู้", icon: "▤" },
  { id: "progress", title: "ความก้าวหน้า", icon: "◔" },
] as const;

function runCodeInWorker(code: string, cases = lessons[0].cases, variable = "score"): Promise<RunResult[]> {
  if (typeof Worker === "undefined") return Promise.reject(new Error("เบราว์เซอร์นี้ยังไม่รองรับพื้นที่รันโค้ด"));
  const workerSource = `const sendResult = self.postMessage.bind(self);
  for (const key of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker", "importScripts", "indexedDB", "caches"]) {
    try { Object.defineProperty(self, key, { value: undefined, configurable: false, writable: false }); } catch {}
  }
  self.onmessage = ({ data }) => {
    try {
      const checkScore = new Function(data.variable, "fetch", "XMLHttpRequest", "WebSocket", "Worker", "importScripts", "navigator", "location", "self", "globalThis", '"use strict";\\n' + data.code);
      const results = data.cases.map(({ input, expected }) => {
        try { const actual = checkScore(input, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined); return { input, actual, passed: actual === expected }; }
        catch (error) { return { input, passed: false, error: error instanceof Error ? error.message : String(error) }; }
      });
      sendResult({ results });
    } catch (error) {
      sendResult({ compileError: error instanceof Error ? error.message : String(error) });
    }
  };`;
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  return new Promise((resolve, reject) => {
    const worker = new Worker(url);
    const timeout = window.setTimeout(() => { worker.terminate(); URL.revokeObjectURL(url); reject(new Error("โค้ดใช้เวลานานเกินไป ลองตรวจว่ามี loop ที่ไม่จบหรือเปล่า")); }, 1800);
    worker.onmessage = event => {
      window.clearTimeout(timeout); worker.terminate(); URL.revokeObjectURL(url);
      if (event.data.compileError) reject(new Error(event.data.compileError));
      else resolve(event.data.results as RunResult[]);
    };
    worker.onerror = event => { window.clearTimeout(timeout); worker.terminate(); URL.revokeObjectURL(url); reject(new Error(event.message || "รันโค้ดไม่สำเร็จ")); };
    worker.postMessage({ code, cases, variable });
  });
}

function calculateStreak(attempts: AttemptRecord[]) {
  const days = [...new Set(attempts.filter(attempt => attempt.fixedSuccessfully).map(attempt => localDay(new Date(attempt.completedAt))))].sort().reverse();
  if (!days.length) return 0;
  const today = localDay();
  const yesterday = localDay(new Date(new Date().setDate(new Date().getDate() - 1)));
  if (days[0] !== today && days[0] !== yesterday) return 0;
  let count = 1;
  for (let index = 1; index < days.length; index++) {
    const prior = new Date(`${days[index - 1]}T00:00:00Z`).getTime();
    const current = new Date(`${days[index]}T00:00:00Z`).getTime();
    if (prior - current !== 86400000) break;
    count++;
  }
  return count;
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M4 5.5v13A2.5 2.5 0 0 1 6.5 16H20M8 7h8M8 10h7"/></>,
    chart: <><path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/></>,
    code: <><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    play: <path d="m8 5 12 7-12 7z"/>,
    undo: <><path d="M3 7v6h6"/><path d="M5.5 13a7 7 0 1 0 2-5L3 12"/></>,
    redo: <><path d="M21 7v6h-6"/><path d="M18.5 13a7 7 0 1 1-2-5L21 12"/></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.grid}</svg>;
}

function Sidebar({ lessonTitle, active, onNavigate, completed, streak }: { lessonTitle: string; active: string; onNavigate: (id: string) => void; completed: number; streak: number }) {
  return <aside className="dq-sidebar">
    <a className="dq-brand" href="#top"><span className="dq-brand-mark"><Icon name="code" size={21}/></span><span>codepath<small>LEARN BY THINKING</small></span></a>
    <div className="dq-side-label">WORKSPACE</div>
    <nav className="dq-nav" aria-label="เมนูหลัก">
      {navItems.map(item => <button key={item.id} className={active === item.id ? "is-active" : ""} onClick={() => onNavigate(item.id)} aria-current={active === item.id ? "page" : undefined}>
        <span className="dq-nav-icon">{item.icon}</span>{item.title}{active === item.id && <span className="dq-nav-active-dot"/>}
      </button>)}
    </nav>
    <div className="dq-side-label dq-path-label">เส้นทางของฉัน</div>
    <button className="dq-course-card" onClick={() => onNavigate("lessons")}>
      <span className="dq-course-icon">JS</span><span><b>{lessonTitle}</b><small>{completed ? `ผ่านแล้ว ${completed} ครั้ง` : "เริ่มภารกิจแรก"}</small><i><em style={{ width: `${Math.min(100, (completed > 0 ? 100 : 0))}%` }}/></i></span><span className="dq-course-percent">{Math.min(100, (completed > 0 ? 100 : 0))}%</span>
    </button>
    <div className="dq-sidebar-spacer"/>
    <div className="dq-streak-card"><span className="dq-streak-flame">✦</span><div><b>{streak ? `ฝึกมา ${streak} วันติด` : "เริ่มฝึกวันนี้"}</b><small>{streak ? "รักษาจังหวะการฝึกต่อไป!" : "ทำภารกิจแรกเพื่อเริ่ม streak"}</small></div><span className="dq-streak-count">{streak}</span></div>
    <div className="dq-profile"><span className="dq-avatar">น</span><span><b>ผู้เรียน</b><small>พื้นที่ฝึกส่วนตัว</small></span></div>
  </aside>;
}

function StepRail({ title, phase, onNavigate }: { title: string; phase: Phase; onNavigate: (phase: Phase) => void }) {
  const steps: { id: Phase; number: string; title: string; desc: string }[] = [
    { id: "plan", number: "01", title: "วางแผน", desc: "จัดลำดับความคิด" },
    { id: "trace", number: "02", title: "อ่าน Trace", desc: "หาเบาะแสก่อนถาม" },
    { id: "code", number: "03", title: "ลงมือเขียน", desc: "รันกับโจทย์ทดสอบ" },
  ];
  const order = phase === "result" ? steps.length : steps.findIndex(step => step.id === phase);
  return <section className="dq-stepper" aria-label="ขั้นตอนการฝึก">
    {steps.map((step, index) => <Fragment key={step.id}>
      <button className={`dq-step${step.id === phase ? " is-current" : index < order ? " is-complete" : ""}`} onClick={() => { if (index <= order) onNavigate(step.id); }} disabled={index > order} aria-current={step.id === phase ? "step" : undefined}>
        <span>{index < order ? <Icon name="check" size={13}/> : step.number}</span><div><b>{step.title}</b><small>{step.desc}</small></div>
      </button>{index < steps.length - 1 && <span className={`dq-step-line${index < order ? " is-complete" : ""}`}/>}
    </Fragment>)}
    <span className="dq-step-note"><Icon name="target" size={15}/> {title}</span>
  </section>;
}

function NodeShape({ status, node, selected, onPointerDown, onClick }: { status?: string; node: FlowNode; selected: boolean; onPointerDown: (event: React.PointerEvent, id: string) => void; onClick: (id: string) => void }) {
  const meta = kindMeta[node.kind];
  return <button type="button" className={`dq-flow-node dq-node-${meta.className}${selected ? " is-selected" : ""} ${status ?? ""}`} style={{ left: node.x, top: node.y }} onPointerDown={event => onPointerDown(event, node.id)} onClick={() => onClick(node.id)} aria-label={`${meta.label}: ${node.title}`}>
    <span className="dq-node-kind"><i>{meta.icon}</i>{meta.label}</span><strong>{node.title}</strong><small>{node.detail}</small>
    <span className="dq-node-port dq-port-top"/><span className="dq-node-port dq-port-bottom"/>
  </button>;
}

type Camera = { x: number; y: number; zoom: number };
function zoomAt(camera: Camera, zoom: number, x: number, y: number): Camera {
  const next = Math.min(2.5, Math.max(0.25, zoom));
  return { zoom: next, x: x - (x - camera.x) / camera.zoom * next, y: y - (y - camera.y) / camera.zoom * next };
}
function fitView(nodes: FlowNode[], width: number, height: number): Camera {
  if (!nodes.length || width <= 0 || height <= 0) return { x: 24, y: 24, zoom: 1 };
  const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
  const right = Math.max(...nodes.map(n => n.x + 190)), bottom = Math.max(...nodes.map(n => n.y + 120));
  const zoom = Math.max(0.25, Math.min(1.5, (width - 64) / (right - left), (height - 64) / (bottom - top)));
  return { zoom, x: (width - (right - left) * zoom) / 2 - left * zoom, y: (height - (bottom - top) * zoom) / 2 - top * zoom };
}

function FlowCanvas({ playback, activeNodeId, activeEdgeIndex, visitedNodeIds, errorNodeIds, camera, onCamera, viewportRef, panMode, onFit, nodes, edges, selected, linkStart, onSelect, onMove, onDropNode }: { playback?: React.ReactNode; activeNodeId?: string; activeEdgeIndex?: number; visitedNodeIds: string[]; errorNodeIds: string[]; camera: Camera; onCamera: React.Dispatch<React.SetStateAction<Camera>>; viewportRef: React.RefObject<HTMLDivElement | null>; panMode: boolean; onFit: () => void; nodes: FlowNode[]; edges: Edge[]; selected: string | null; linkStart: string | null; onSelect: (id: string) => void; onMove: (id: string, x: number, y: number) => void; onDropNode: (kind: NodeKind, x: number, y: number) => void }) {
  const zoom = camera.zoom;
  const pan = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const spaceHeld = useRef(false);
  const dragged = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; camera: Camera; x: number; y: number } | null>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = viewport!.getBoundingClientRect();
      if (event.shiftKey) onCamera(c => ({ ...c, x: c.x - event.deltaY - event.deltaX }));
      else onCamera(c => zoomAt(c, c.zoom * Math.exp(-event.deltaY * 0.002), event.clientX - rect.left, event.clientY - rect.top));
    }
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [onCamera, viewportRef]);
  const [moving, setMoving] = useState<{ id: string; pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);
  const pathData = useMemo(() => edges.map((edge, index) => {
    const a = nodes.find(n => n.id === edge.from); const b = nodes.find(n => n.id === edge.to);
    if (!a || !b) return null;
    const aw = a.kind === "start" ? 142 : a.kind === "decision" ? 178 : 170;
    const ax = a.x + aw / 2, ay = a.y + (a.kind === "start" ? 64 : 104);
    const bw = b.kind === "start" ? 142 : b.kind === "decision" ? 178 : 170;
    const bx = b.x + bw / 2, by = b.y;
    const mid = (ay + by) / 2;
    return { ...edge, index, d: `M ${ax} ${ay} C ${ax} ${mid + 8}, ${bx} ${mid - 8}, ${bx} ${by}`, lx: (ax + bx) / 2 + (edge.label ? 9 : 0), ly: mid };
  }).filter(Boolean), [edges, nodes]);
  function startMove(event: React.PointerEvent, id: string) {
    const node = nodes.find(item => item.id === id); if (!node) return;
    if (panMode || spaceHeld.current || event.button !== 0) return;
    event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    dragged.current = false;
    setMoving({ id, pointerX: event.clientX, pointerY: event.clientY, startX: node.x, startY: node.y });
  }
  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    if (!panMode && !spaceHeld.current && event.button !== 1 && (event.target as Element).closest("button, .dq-edge-hit")) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), camera, x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    }
    pan.current = { x: event.clientX, y: event.clientY, originX: camera.x, originY: camera.y };
    dragged.current = false; setIsPanning(true);
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      const initial = pinch.current;
      const next = zoomAt(initial.camera, initial.camera.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, initial.distance), initial.x, initial.y);
      onCamera({ ...next, x: next.x + (a.x + b.x) / 2 - rect.left - initial.x, y: next.y + (a.y + b.y) / 2 - rect.top - initial.y });
      dragged.current = true; return;
    }
    if (pan.current) {
      const dx = event.clientX - pan.current.x, dy = event.clientY - pan.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragged.current = true;
      const origin = pan.current;
      onCamera(c => ({ ...c, x: origin.originX + dx, y: origin.originY + dy })); return;
    }
    if (!moving) return;
    const dx = (event.clientX - moving.pointerX) / zoom, dy = (event.clientY - moving.pointerY) / zoom;
    if (Math.abs(dx) + Math.abs(dy) < 3 && !dragged.current) return;
    dragged.current = true;
    onMove(moving.id, Math.max(0, moving.startX + dx), Math.max(0, moving.startY + dy));
  }
  function endPointer(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId); pinch.current = null; pan.current = null;
    setMoving(null); setIsPanning(false);
  }
  function drop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/x-codepath-kind") as NodeKind;
    if (!Object.hasOwn(kindMeta, kind)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onDropNode(kind, Math.max(0, (event.clientX - rect.left - camera.x) / zoom), Math.max(0, (event.clientY - rect.top - camera.y) / zoom));
  }
  return <div ref={viewportRef} style={{ backgroundPosition: `${camera.x}px ${camera.y}px`, backgroundSize: `${17 * zoom}px ${17 * zoom}px` }} className={`dq-canvas-viewport${panMode ? " is-pan-mode" : ""}${isPanning ? " is-panning" : ""}`} tabIndex={0} role="region" aria-label="กระดานแผนภาพ เลื่อนด้วยการลากพื้นที่ว่าง ซูมด้วยล้อเมาส์" onPointerDown={startPan} onPointerMove={move} onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={endPointer} onClickCapture={e => { if (dragged.current || panMode) { e.stopPropagation(); dragged.current = false; } }} onKeyDown={e => {
    if (e.target !== e.currentTarget) return;
    if (e.code === "Space") { e.preventDefault(); spaceHeld.current = true; }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); onCamera(c => ({ ...c, x: c.x + (e.key === "ArrowLeft" ? 50 : e.key === "ArrowRight" ? -50 : 0), y: c.y + (e.key === "ArrowUp" ? 50 : e.key === "ArrowDown" ? -50 : 0) })); }
    if (["+", "=", "-"].includes(e.key)) { e.preventDefault(); const factor = e.key === "-" ? 0.9 : 1.1; const { clientWidth, clientHeight } = e.currentTarget; onCamera(c => zoomAt(c, c.zoom * factor, clientWidth / 2, clientHeight / 2)); }
    if (e.key === "0") { e.preventDefault(); onFit(); }
  }} onKeyUp={e => { if (e.code === "Space") spaceHeld.current = false; }} onBlur={() => { spaceHeld.current = false; }} onDragOver={event => event.preventDefault()} onDrop={drop}>
    <div className="dq-canvas-grid" data-active-node={activeNodeId} style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})` }} aria-label="พื้นที่จัดวางแผนภาพ">
      <svg className="dq-connectors" aria-label="เส้นเชื่อมระหว่างกล่อง"><defs><marker id="dq-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#a6b4c2"/></marker></defs>
        {pathData.map(edge => edge && <g key={`${edge.from}-${edge.to}`} className={`dq-edge ${activeEdgeIndex === edge.index ? "is-running" : ""} ${edge.label === "ใช่" ? "is-yes" : edge.label === "ไม่ใช่" ? "is-no" : ""}`}><path className="dq-edge-hit" d={edge.d} fill="none" stroke="transparent" strokeWidth="18" role="button" tabIndex={0} aria-label={`แก้ไขเส้นเชื่อม ${nodes.find(n => n.id === edge.from)?.title} ไป ${nodes.find(n => n.id === edge.to)?.title}`} onClick={() => onSelect(edge.from)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(edge.from); } }}/><path className="dq-edge-line" d={edge.d} fill="none" stroke="#8393aa" strokeWidth="2.5" markerEnd="url(#dq-arrow)"/>{edge.label && <g><rect x={edge.lx - 39} y={edge.ly - 17} width="82" height="32" rx="11" fill="white" stroke="#e4e9ee"/><text x={edge.lx + 2} y={edge.ly + 4} textAnchor="middle" fill="#6b7a8a" fontSize="16.5" fontWeight="600">{edge.label === "ใช่" ? "✓ ใช่" : "✕ ไม่ใช่"}</text></g>}</g>)}
      </svg>
      {nodes.map(node => <NodeShape key={node.id} status={node.id === activeNodeId ? "is-running" : errorNodeIds.includes(node.id) ? "has-error" : visitedNodeIds.includes(node.id) ? "is-visited" : ""} node={node} selected={selected === node.id || linkStart === node.id} onPointerDown={startMove} onClick={id => { if (!dragged.current && !panMode) onSelect(id); }}/ >)}
    </div>
    {playback && <div className="dq-playback-dock" onPointerDown={e => e.stopPropagation()}>{playback}</div>}
  </div>;
}

function ConnectionEditor({ node, nodes, edges, onChange }: { node: FlowNode; nodes: FlowNode[]; edges: Edge[]; onChange: (edges: Edge[]) => void }) {
  const outgoing = edges.map((edge, index) => ({ ...edge, index })).filter(e => e.from === node.id);
  const targets = nodes.filter(n => n.id !== node.id);
  function update(index: number, patch: Partial<Edge>) {
    const changed = { ...edges[index], ...patch };
    let next = edges.map((e, i) => i === index ? changed : e);
    if (patch.label && node.kind === "decision") next = next.map((e, i) => i !== index && e.from === node.id && e.label === patch.label ? { ...e, label: patch.label === "ใช่" ? "ไม่ใช่" : "ใช่" } : e);
    onChange(next);
  }
  return <section className="dq-connections" aria-label="จัดการเส้นเชื่อม">
    <h3><Icon name="arrow" size={16}/> เชื่อมไปยังกล่อง</h3>
    <p>เลือกปลายทางเพื่อเพิ่มหรือเปลี่ยนเส้นได้ทันที</p>
    {outgoing.map((edge, order) => <div className="dq-connection-card" key={edge.index}>
      <div className="dq-connection-top"><span className={`dq-branch ${edge.label === "ไม่ใช่" ? "is-no" : edge.label === "ใช่" ? "is-yes" : ""}`}>{edge.label === "ใช่" ? "✓ ใช่" : edge.label === "ไม่ใช่" ? "✕ ไม่ใช่" : `→ เส้นทาง ${order + 1}`}</span><button title="ลบเฉพาะเส้นเชื่อม" aria-label={`ลบเส้นทาง ${order + 1}`} onClick={() => onChange(edges.filter((_, i) => i !== edge.index))}><Icon name="trash" size={15}/></button></div>
      {node.kind === "decision" && <label>เมื่อคำตอบเป็น<select aria-label={`เงื่อนไขเส้นทาง ${order + 1}`} value={edge.label ?? "ใช่"} onChange={e => update(edge.index, { label: e.target.value })}><option value="ใช่">✓ ใช่ (True)</option><option value="ไม่ใช่">✕ ไม่ใช่ (False)</option></select></label>}
      <label>ไปยังกล่อง<select aria-label={`ปลายทางเส้นทาง ${order + 1}`} value={edge.to} onChange={e => update(edge.index, { to: e.target.value })}>{targets.map(n => <option key={n.id} value={n.id} disabled={outgoing.some(other => other.index !== edge.index && other.to === n.id)}>{kindMeta[n.kind].icon} {n.title}</option>)}</select></label>
    </div>)}
    {(node.kind !== "decision" || outgoing.length < 2) && <label className="dq-add-connection">＋ เพิ่มเส้นเชื่อม<select aria-label="เพิ่มเส้นเชื่อมไปยัง" value="" onChange={e => { if (e.target.value) onChange([...edges, { from: node.id, to: e.target.value, ...(node.kind === "decision" ? { label: outgoing.some(edge => edge.label === "ใช่") ? "ไม่ใช่" : "ใช่" } : {}) }]); }}><option value="">เลือกกล่องปลายทาง…</option>{targets.filter(n => !outgoing.some(e => e.to === n.id)).map(n => <option key={n.id} value={n.id}>{kindMeta[n.kind].icon} {n.title}</option>)}</select></label>}
    {node.kind === "decision" && outgoing.length === 2 && <small>เปลี่ยนคำตอบด้านบนเพื่อสลับสองทางอัตโนมัติ</small>}
  </section>;
}

function NodeRules({ node, lesson, onChange }: { node: FlowNode; lesson: Lesson; onChange: (patch: Partial<FlowNode>) => void }) {
  return <div className="dq-node-rules"><h3>การทำงานเมื่อจำลอง</h3><p>ใช้ค่าด้านล่างในการจำลอง ชื่อกล่องเป็นป้ายกำกับ</p>
    {node.kind === "decision" && <><label>เปรียบเทียบค่าปัจจุบัน<select aria-label="เครื่องหมายเงื่อนไข" value={node.operator ?? ""} onChange={e => onChange({ operator: e.target.value as FlowNode["operator"] })}><option value="" disabled>เลือกเครื่องหมาย</option><option value=">=">≥ มากกว่าหรือเท่ากับ</option><option value=">">&gt; มากกว่า</option><option value="<=">≤ น้อยกว่าหรือเท่ากับ</option><option value="<">&lt; น้อยกว่า</option><option value="==">= เท่ากับ</option></select></label><label>ค่าที่นำมาเปรียบเทียบ<input aria-label="ค่าเกณฑ์เงื่อนไข" type="number" value={Number.isFinite(node.threshold) ? node.threshold : ""} onChange={e => onChange({ threshold: e.target.value === "" ? NaN : Number(e.target.value) })}/></label></>}
    {node.kind === "output" && <label>ข้อความผลลัพธ์<input aria-label="ข้อความผลลัพธ์" value={node.outputValue ?? ""} onChange={e => onChange({ outputValue: e.target.value, title: `แสดง “${e.target.value}”` })}/></label>}
    {node.kind === "process" && <><label>การคำนวณ<select aria-label="วิธีคำนวณ" value={node.operation ?? ""} onChange={e => onChange({ operation: e.target.value as FlowNode["operation"] })}><option value="" disabled>เลือกวิธีคำนวณ</option><option value="add">＋ บวกค่าคงที่</option><option value="multiply">× คูณค่าคงที่</option></select></label><label>ค่าคงที่<input aria-label="ค่าคงที่" type="number" value={Number.isFinite(node.operand) ? node.operand : ""} onChange={e => onChange({ operand: e.target.value === "" ? NaN : Number(e.target.value) })}/></label></>}
    {node.kind === "input" && <p>รับ{lesson.inputLabel}จากช่องทดลอง ค่าตั้งแต่ {lesson.min} ถึง {lesson.max}</p>}
    {node.kind === "start" && <p>เริ่มทำงานแล้วเดินตามเส้นเชื่อมออก</p>}
  </div>;
}

export function DebugQuestApp({ startOnDashboard = false }: { startOnDashboard?: boolean }) {
  const [initialActive, setInitialActive] = useState(startOnDashboard ? "dashboard" : "plan");
  const [lessonId, setLessonId] = useState("exam");
  useEffect(() => {
    const timer = window.setTimeout(() => { try { const id = localStorage.getItem("codepath.activeLesson"); if (lessons.some(l => l.id === id)) setLessonId(id!); } catch { /* Continue without storage. */ } }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function chooseLesson(id: string) {
    if (!lessons.some(l => l.id === id)) return;
    try { localStorage.setItem("codepath.activeLesson", id); } catch { /* Lesson switching still works. */ }
    setInitialActive("plan");
    setLessonId(id);
  }
  return <LessonWorkspace key={lessonId} initialActive={initialActive} lesson={lessons.find(l => l.id === lessonId)!} onChooseLesson={chooseLesson}/>;
}

function LessonWorkspace({ initialActive, lesson, onChooseLesson }: { initialActive: string; lesson: Lesson; onChooseLesson: (id: string) => void }) {
  const initialNodes = useMemo(() => starterNodes(lesson), [lesson]);
  const initialEdges = starterEdges;
  const storageKey = lessonKey(lesson.id);
  const [undoGraph, setUndoGraph] = useState<{ nodes: FlowNode[]; edges: Edge[] } | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, zoom: 1 });
  const [panMode, setPanMode] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoom = camera.zoom;
  function changeZoom(next: number) {
    const el = viewportRef.current;
    setCamera(c => zoomAt(c, next, (el?.clientWidth ?? 600) / 2, (el?.clientHeight ?? 520) / 2));
  }
  function fitCanvas() {
    const el = viewportRef.current;
    if (el) setCamera(fitView(nodes, el.clientWidth, el.clientHeight));
  }
  const [active, setActive] = useState(initialActive);
  const [phase, setPhase] = useState<Phase>("plan");
  const [nodes, setNodes] = useState(initialNodes);
  const [showIssues, setShowIssues] = useState(false);
  const [simulationInput, setSimulationInput] = useState(String(lesson.threshold));
  const [simulationError, setSimulationError] = useState("");
  const [simulation, setSimulation] = useState<{ steps: SimulationStep[]; index: number; playing: boolean; fingerprint: string } | null>(null);

  const [edges, setEdges] = useState(initialEdges);
  const fingerprint = JSON.stringify([nodes, edges, simulationInput]);
  const simulationValid = simulation?.fingerprint === fingerprint;
  const currentStep = simulationValid ? simulation.steps[simulation.index] : undefined;
  function focusNode(id: string, scroll = false) {
    const node = nodes.find(n => n.id === id), viewport = viewportRef.current;
    if (!node) return;
    setSelectedId(id);
    if (scroll) viewport?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (viewport) { setCamera(c => ({ ...c, x: viewport.clientWidth / 2 - (node.x + 85) * c.zoom, y: viewport.clientHeight / 2 - (node.y + 52) * c.zoom })); }
  }
  function startSimulation(playing: boolean) {
    setSimulationError("");
    if (!simulationInput.trim() || !Number.isFinite(Number(simulationInput)) || Number(simulationInput) < lesson.min || Number(simulationInput) > lesson.max) { setSimulation(null); setSimulationError(`ใส่${lesson.inputLabel}ตั้งแต่ ${lesson.min} ถึง ${lesson.max}`); return; }
    try {
      const steps = simulateGraph(nodes, edges, Number(simulationInput));
      setSimulation({ steps, index: 0, playing, fingerprint }); focusNode(steps[0].nodeId);
    } catch (error) { setSimulation(null); setShowIssues(true); setSimulationError(error instanceof Error ? error.message : "จำลองไม่ได้"); }
  }
  function advanceSimulation() {
    if (!simulationValid) { startSimulation(false); return; }
    const index = Math.min(simulation.index + 1, simulation.steps.length - 1);
    setSimulation({ ...simulation, index, playing: false }); focusNode(simulation.steps[index].nodeId);
  }
  useEffect(() => {
    if (!simulationValid || !simulation?.playing) return;
    const timer = window.setTimeout(() => {
      const index = Math.min(simulation.index + 1, simulation.steps.length - 1);
      setSimulation({ ...simulation, index, playing: index < simulation.steps.length - 1 });
      const node = nodes.find(n => n.id === simulation.steps[index].nodeId);
      const viewport = viewportRef.current;
      if (node && viewport) setCamera(c => ({ ...c, x: viewport.clientWidth / 2 - (node.x + 85) * c.zoom, y: viewport.clientHeight / 2 - (node.y + 52) * c.zoom }));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [simulationValid, simulation, nodes]);
  const [selectedId, setSelectedId] = useState<string | null>("check");
  const [notice, setNotice] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [linkStart, setLinkStart] = useState<string | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [xp, setXp] = useState(0);
  const [planChecked, setPlanChecked] = useState(false);
  const [diagramUsed, setDiagramUsed] = useState(false);
  const [traceOpened, setTraceOpened] = useState(false);
  const [traceAnswer, setTraceAnswer] = useState("");
  const [traceChecked, setTraceChecked] = useState(false);
  const [aiHint, setAiHint] = useState(false);
  const [code, setCode] = useState(() => starterCode(lesson));
  const [runResults, setRunResults] = useState<RunResult[] | null>(null);
  const [codeError, setCodeError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [feedback, setFeedback] = useState("");
  const attemptStart = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(storageKey) ?? (lesson.id === "exam" ? window.localStorage.getItem(STORAGE_KEY) : null);
        if (raw) {
          const saved = JSON.parse(raw) as Record<string, unknown>;
          if (Array.isArray(saved.nodes) && saved.nodes.length > 0 && saved.nodes.length <= 100 && saved.nodes.every(n => n && typeof n.id === "string" && Object.hasOwn(kindMeta, n.kind) && typeof n.title === "string" && typeof n.detail === "string" && Number.isFinite(n.x) && Number.isFinite(n.y)) && new Set(saved.nodes.map(n => n.id)).size === saved.nodes.length) setNodes((saved.nodes as FlowNode[]).map(n => ({ ...initialNodes.find(base => base.id === n.id && base.kind === n.kind), ...n })));
          if (Array.isArray(saved.edges) && saved.edges.length <= 500 && saved.edges.every(e => e && typeof e.from === "string" && typeof e.to === "string" && (e.label === undefined || typeof e.label === "string"))) setEdges(saved.edges as Edge[]);
          if (["plan", "trace", "code", "result"].includes(String(saved.phase))) setPhase(saved.phase as Phase);
          if (typeof saved.planChecked === "boolean") setPlanChecked(saved.planChecked);
          if (typeof saved.diagramUsed === "boolean") setDiagramUsed(saved.diagramUsed);
          if (typeof saved.traceOpened === "boolean") setTraceOpened(saved.traceOpened);
          if (typeof saved.traceAnswer === "string") setTraceAnswer(saved.traceAnswer);
          if (typeof saved.traceChecked === "boolean") setTraceChecked(saved.traceChecked);
          if (typeof saved.aiHint === "boolean") setAiHint(saved.aiHint);
          if (typeof saved.code === "string") setCode(saved.code);
          const savedAttempts = Array.isArray(saved.attempts) ? saved.attempts.filter(validAttempt).slice(0, 50) : [];
          setAttempts(savedAttempts);
          if (typeof saved.xp === "number" && Number.isFinite(saved.xp) && saved.xp >= 0) setXp(saved.xp);
        }
      } catch { setNotice("อ่านข้อมูลที่บันทึกไว้ไม่ได้ เริ่มบทเรียนใหม่ได้ตามปกติ"); }
      setPersistenceReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, lesson.id, initialNodes]);

  useEffect(() => {
    if (!persistenceReady) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ version: 2, lessonId: lesson.id, phase, nodes, edges, planChecked, diagramUsed, traceOpened, traceAnswer, traceChecked, aiHint, code, attempts, xp }));
    } catch { const timer = window.setTimeout(() => setNotice("บันทึกข้อมูลไม่ได้ กรุณาสำรองข้อมูลก่อนปิดหน้านี้"), 0); return () => window.clearTimeout(timer); }
  }, [storageKey, lesson.id, persistenceReady, phase, nodes, edges, planChecked, diagramUsed, traceOpened, traceAnswer, traceChecked, aiHint, code, attempts, xp]);

  useEffect(() => { if (phase === "code" && !attemptStart.current) attemptStart.current = Date.now(); }, [phase]);
  const selectedNode = nodes.find(node => node.id === selectedId) ?? null;
  const successfulAttempts = attempts.filter(attempt => attempt.fixedSuccessfully).length;
  const streak = useMemo(() => calculateStreak(attempts), [attempts]);
  const dailyGoal = Math.min(3, attempts.filter(a => a.fixedSuccessfully && localDay(new Date(a.completedAt)) === localDay()).length);
  const pseudocode = (() => {
    const input = nodes.find(n => n.kind === "input");
    const decision = nodes.find(n => n.kind === "decision");
    const processes = nodes.filter(n => n.kind === "process").sort((a, b) => a.y - b.y);
    const outputs = nodes.filter(n => n.kind === "output").sort((a, b) => a.y - b.y);
    const lines = ["เริ่มต้น", `รับค่า ${input?.title.replace(/^รับ/, "") || "ข้อมูล"}`];
    for (const process of processes) lines.push(`คำนวณ: ${process.title}`);
    lines.push(`ถ้า ${decision?.title.replace("?", "") || "เงื่อนไข"}`);
    for (const output of outputs) {
      const branch = edges.find(edge => edge.to === output.id && edge.from === decision?.id)?.label;
      lines.push(`  ${branch ? `${branch} → ` : "  "}แสดงผล ${output.title.replace(/^แสดง\s*/, "")}`);
    }
    lines.push("จบการทำงาน");
    return lines.join("\n");
  })();
  const planIssues = checkLessonPlan(nodes, edges, lesson);
  const planVerified = planChecked && planIssues.length === 0;
  const structureIssues = validateGraph(nodes, edges);

  function addNode(kind: NodeKind, position?: { x: number; y: number }) {
    if (nodes.length >= 100) { setNotice("เพิ่มได้สูงสุด 100 กล่องต่อบทเรียน"); return; }
    setUndoGraph({ nodes, edges });
    const viewport = viewportRef.current;
    const nextId = nodes.reduce((max, node) => node.kind === kind ? Math.max(max, Number(node.id.split("-").at(-1)) || 0) : max, 0) + 1;
    const newNode: FlowNode = { ...(kind === "decision" ? { operator: ">=", threshold: lesson.threshold } : kind === "output" ? { outputValue: "" } : kind === "process" ? { operation: "add", operand: 0 } : {}), id: `${kind}-${nextId}`, kind, title: kind === "input" ? "รับข้อมูลใหม่" : kind === "process" ? "คำนวณข้อมูล" : kind === "decision" ? "ตรวจเงื่อนไข?" : kind === "output" ? "แสดงผลลัพธ์" : "เริ่มต้น", detail: kindMeta[kind].label, x: position?.x ?? Math.max(0, ((viewport?.clientWidth ?? 600) / 2 - camera.x) / camera.zoom - 85), y: position?.y ?? Math.max(0, ((viewport?.clientHeight ?? 560) / 2 - camera.y) / camera.zoom - 52) };
    setNodes(current => [...current, newNode]); setSelectedId(newNode.id); setDiagramUsed(true); setPlanChecked(false); setNotice(`เพิ่ม ${kindMeta[kind].label} แล้ว ลากไปจัดวางบนกระดานได้เลย`);
  }
  function updateNode(id: string, field: "title" | "detail", value: string) { setNodes(current => current.map(node => node.id === id ? { ...node, [field]: value } : node)); setDiagramUsed(true); setPlanChecked(false); }
  function runPlan() {
    setDiagramUsed(true);
    setShowIssues(true);
    if (planIssues.length) { setPlanChecked(false); setNotice(`พบ ${planIssues.length} จุดที่ต้องแก้ไข กดรายการเพื่อไปยังกล่องนั้น`); if (planIssues[0].nodeId) focusNode(planIssues[0].nodeId); return; }
    
    setPlanChecked(true); setNotice("ตรวจแผนผ่านแล้ว! ตอนนี้ไปอ่าน Error Trace ก่อนขอคำใบ้ได้เลย ✨");
  }
  function resetPlan() { setSimulation(null); setShowIssues(false); setSimulationError(""); setNodes(initialNodes); setEdges(initialEdges); setSelectedId("check"); setPlanChecked(false); setDiagramUsed(false); setPhase("plan"); setNotice("คืนค่าแผนตัวอย่างแล้ว เลือกกล่องแล้วเพิ่มเส้นเชื่อมจากแผงด้านข้าง"); }
  function selectFlowNode(id: string) {
    if (!connecting) { setSelectedId(id); return; }
    if (!linkStart) { setLinkStart(id); setNotice("เลือกกล่องปลายทางที่ต้องการเชื่อมต่อได้เลย"); return; }
    if (linkStart === id) { setLinkStart(null); setNotice("ยกเลิกการเชื่อมต่อแล้ว"); return; }
    const exists = edges.some(edge => edge.from === linkStart && edge.to === id);
    if (exists) { setNotice("สองกล่องนี้เชื่อมต่อกันอยู่แล้ว"); setLinkStart(null); setConnecting(false); return; }
    const from = nodes.find(node => node.id === linkStart);
    const branches = edges.filter(edge => edge.from === linkStart).length;
    if (from?.kind === "decision" && branches >= 2) { setSelectedId(linkStart); setNotice("เปลี่ยนปลายทางได้จากแผงเชื่อมไปยังกล่องด้านข้าง"); setLinkStart(null); setConnecting(false); return; }
    const label = from?.kind === "decision" ? (edges.some(e => e.from === linkStart && e.label === "ใช่") ? "ไม่ใช่" : "ใช่") : undefined;
    setUndoGraph({ nodes, edges });
    setEdges(current => [...current, { from: linkStart, to: id, label }]);
    setSelectedId(id); setLinkStart(null); setConnecting(false); setDiagramUsed(true); setPlanChecked(false); setNotice("เชื่อมขั้นตอนเข้าด้วยกันแล้ว");
  }
  function openTrace() { setTraceOpened(true); setNotice("เปิด Error Trace แล้ว ลองอ่านบรรทัดที่ระบุไฟล์และตำแหน่งก่อน"); }
  function checkTrace() {
    if (!traceOpened) { setNotice("เปิดอ่าน Error Trace ก่อนนะ"); return; }
    const isCorrect = traceAnswer === "undefined-object";
    if (traceChecked) return;
    setTraceChecked(isCorrect);
    setNotice(isCorrect ? "ใช่เลย! trace ชี้ว่า record ไม่มีค่าก่อนอ่านข้อมูล นี่คือสาเหตุของ error ✨" : "ลองไล่จากบรรทัดบนสุด: ตัวแปรไหนถูกใช้ก่อนที่โปรแกรมจะมีค่าให้มัน?");
    
  }
  function askAi() { setAiHint(true); setNotice("คำใบ้: ดูค่าของ record ก่อนเข้าถึงข้อมูล"); }
  async function executeCode() {
    if (isRunning) return;
    setIsRunning(true); setCodeError(""); setRunResults(null); setFeedback("");
    try {
      const results = await runCodeInWorker(code, lesson.cases, lesson.variable);
      setRunResults(results);
      const passed = results.filter(result => result.passed).length;
      const fixedSuccessfully = passed === lesson.cases.length;
      setFeedback(fixedSuccessfully ? "ครบทุกกรณีของบทเรียนแล้ว! โค้ดทำงานตามผลลัพธ์ที่โจทย์กำหนด" : `ผ่าน ${passed} จาก ${lesson.cases.length} กรณี ลองดูกรณีที่ยังไม่ผ่านแล้วปรับโค้ดอีกครั้ง`);
      const record: AttemptRecord = { lessonId: lesson.id, id: crypto.randomUUID(), completedAt: new Date().toISOString(), score: Math.round(passed / lesson.cases.length * 100), timeToResolveMin: Math.max(0.1, Math.round(((Date.now() - attemptStart.current) / 60000) * 10) / 10), readLogFirst: traceOpened, copeToAi: aiHint, usedDiagram: diagramUsed || planChecked, fixedSuccessfully, errorType: `TypeError: Cannot read properties of undefined (reading '${lesson.variable}')` };
      setAttempts(current => [record, ...current].slice(0, 50));
      if (fixedSuccessfully) { setXp(current => current + 50); setPhase("result"); }
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : "เกิดข้อผิดพลาดขณะรันโค้ด");
    } finally { setIsRunning(false); }
  }
  function restartLesson() {
    attemptStart.current = 0; setSimulation(null); setShowIssues(false); setSimulationError("");
    setSimulation(null); setShowIssues(false); setSimulationError(""); setNodes(initialNodes); setEdges(initialEdges); setSelectedId("check"); setPlanChecked(false); setDiagramUsed(false);
    setTraceOpened(false); setTraceAnswer(""); setTraceChecked(false); setAiHint(false); setRunResults(null); setCodeError(""); setFeedback("");
    setCode(starterCode(lesson));
    setPhase("plan"); setActive("plan"); setNotice("เริ่มภารกิจใหม่แล้ว");
  }

  return <div className="dq-app" id="top">
    <Sidebar lessonTitle={lesson.title} active={active} onNavigate={setActive} completed={successfulAttempts} streak={streak}/>
    <main className="dq-main" id="main-content">
      <header className="dq-topbar">
        <button className="dq-mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label="เปิดเมนู"><Icon name="menu"/></button>
        <div className="dq-breadcrumb"><span>พื้นที่เรียนรู้</span><Icon name="chevron" size={14}/><b>{active === "plan" ? "วางแผน Flow" : active === "lessons" ? "เส้นทางเรียนรู้" : active === "dashboard" ? "Dashboard" : "ความก้าวหน้า"}</b></div>
        <div className="dq-top-actions"><label className="dq-lesson-switch">บทเรียน<select aria-label="เลือกบทเรียน" value={lesson.id} onChange={e => onChooseLesson(e.target.value)}>{lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label><span className="dq-level-pill"><span>✦</span> {xp} XP</span><span className="dq-avatar dq-avatar-small">น</span></div>
      </header>
      {mobileOpen && <div className="dq-mobile-nav">{navItems.map(item => <button key={item.id} onClick={() => { setActive(item.id); setMobileOpen(false); }}>{item.title}<Icon name="chevron" size={16}/></button>)}</div>}

      {active === "plan" && <>
        <section className="dq-welcome-row">
          <div><p className="dq-eyebrow"><span className="dq-eyebrow-dot"/> ภารกิจที่ {lessons.indexOf(lesson) + 1} <span className="dq-eyebrow-sep">/</span> {lesson.title}</p><h1>{phase === "plan" ? <>คิดเป็นขั้นตอน<br className="dq-mobile-break"/><span>ก่อนเขียนโค้ด</span></> : phase === "trace" ? <>อ่าน Error Trace<br className="dq-mobile-break"/><span>ก่อนขอคำใบ้</span></> : phase === "code" ? <>เปลี่ยนแผน<br className="dq-mobile-break"/><span>ให้เป็นโค้ด</span></> : <>ทำได้แล้ว<br className="dq-mobile-break"/><span>มาดูสิ่งที่เรียนรู้</span></>}</h1><p className="dq-welcome-copy">{phase === "plan" ? "เริ่มจากจัดลำดับความคิด แล้วเชื่อม Input, เงื่อนไข และผลลัพธ์ให้ครบ" : phase === "trace" ? "อ่านร่องรอยข้อผิดพลาด แล้วเลือกสาเหตุจากหลักฐานใน trace" : phase === "code" ? "ใช้แผนภาพเป็นแนวทาง เขียน JavaScript แล้วลองกับข้อมูลหลายกรณี" : "ความสำเร็จไม่ได้วัดแค่คำตอบ แต่รวมถึงวิธีคิดและการใช้เครื่องมือของคุณด้วย"}</p></div>
          <div className="dq-daily-goal"><span className="dq-goal-ring"><b>{dailyGoal}</b><small>/ 3</small></span><span><b>การฝึกวันนี้ของบทนี้</b><small>{dailyGoal === 3 ? "ครบเป้าหมายแล้ว!" : `ฝึกอีก ${3 - dailyGoal} ครั้งเพื่อครบเป้าหมาย`}</small><i><em style={{ width: `${dailyGoal / 3 * 100}%` }}/></i></span></div>
        </section>

        <StepRail title={lesson.title} phase={phase} onNavigate={setPhase}/>

        <section className="dq-task-banner">
          <div className="dq-task-icon"><Icon name="spark" size={22}/></div>
          <div className="dq-task-copy"><span>โจทย์วันนี้ <i>{phase === "plan" ? "วางแผน" : phase === "trace" ? "อ่านหลักฐาน" : phase === "code" ? "ลงมือทำ" : "สำเร็จ"}</i></span><h2>{phase === "trace" ? "ตามหาสาเหตุของ TypeError" : phase === "code" ? `เขียนฟังก์ชัน${lesson.title}` : phase === "result" ? "ภารกิจสำเร็จแล้ว" : lesson.title}</h2><p>{phase === "trace" ? "โปรแกรมอ่านข้อมูลจากตัวแปรที่ยังไม่มีค่า ลองใช้ trace หาว่าปัญหาเกิดจากอะไร" : phase === "code" ? "ใช้แผนที่วางไว้ เขียนฟังก์ชันให้ผ่านทั้งคะแนนต่ำกว่า เท่ากับ และมากกว่าเกณฑ์" : lesson.description}</p></div>
          {phase === "plan" && <button className="dq-task-hint" onClick={() => setNotice("ใบ้: เริ่มจากถามว่าข้อมูลอะไรที่โปรแกรมต้องรับเข้ามาก่อน 🎯")}><span>?</span> ดูคำใบ้</button>}
          <div className="dq-banner-deco" aria-hidden="true"><span>{`{ }`}</span><i/><i/><i/></div>
        </section>

        {phase === "plan" && <section className="dq-workspace" aria-label="เครื่องมือวางแผน">
          <div className="dq-workspace-heading"><div><span className="dq-eyebrow">STEP 01 · PLAN FIRST</span><h2>วางแผนการทำงาน <span>✳</span></h2></div><div className="dq-workspace-actions"><button className="dq-quiet-button" disabled={!undoGraph} onClick={() => { if (!undoGraph) return; setNodes(undoGraph.nodes); setEdges(undoGraph.edges); setSelectedId(undoGraph.nodes.find(n => n.id === selectedId)?.id ?? undoGraph.nodes.at(-1)?.id ?? null); setUndoGraph(null); setPlanChecked(false); setNotice("คืนค่าการแก้ไขล่าสุดแล้ว"); }}><Icon name="undo" size={16}/> ย้อนกลับ</button><button className="dq-quiet-button" onClick={resetPlan}><Icon name="undo" size={16}/> เริ่มใหม่</button><button className="dq-run-button" onClick={planVerified ? () => { setPhase("trace"); setNotice(""); } : runPlan}><Icon name={planVerified ? "arrow" : "check"} size={16}/>{planVerified ? "อ่าน Error Trace" : "ตรวจแผน"}</button></div></div>
          <section className="dq-simulator" aria-label="ทดลองทำงานของแผนภาพ">
            <div><h3>▶ ทดลองเดินแผนภาพ</h3><p>ใส่ข้อมูล แล้วดูว่าค่าถูกส่งไปทางไหนทีละกล่อง</p></div>
            <label>{lesson.inputLabel}<input aria-label={`ค่าทดลอง${lesson.inputLabel}`} type="number" min={lesson.min} max={lesson.max} value={simulationInput} onChange={e => { setSimulationInput(e.target.value); setSimulationError(""); }}/></label>
            <div className="dq-sim-actions"><button className="dq-run-button" onClick={() => { if (simulationValid && simulation.playing) setSimulation({ ...simulation, playing: false }); else if (simulationValid && simulation.index < simulation.steps.length - 1) setSimulation({ ...simulation, playing: true }); else startSimulation(true); }}>{simulationValid && simulation.playing ? "Ⅱ หยุดชั่วคราว" : "▶ เล่นอัตโนมัติ"}</button><button onClick={advanceSimulation} disabled={simulationValid && simulation.index >= simulation.steps.length - 1}>เดินทีละขั้น →</button><button onClick={() => { setSimulation(null); setSimulationError(""); }}>↺ ล้างการจำลอง</button></div>
            <div className="dq-sim-status" role="status" aria-live="polite">{simulationError ? <strong className="dq-sim-error">{simulationError}</strong> : currentStep ? <><b>ขั้น {simulation!.index + 1} / {simulation!.steps.length} · {nodes.find(n => n.id === currentStep.nodeId)?.title}</b><span>{currentStep.message} · ค่าปัจจุบัน {currentStep.value}</span>{currentStep.output !== undefined && <strong>ผลลัพธ์: {currentStep.output}</strong>}</> : <span>กล่องสีเหลือง = ขั้นปัจจุบัน · สีเขียว = ผ่านแล้ว · แก้แผนหรือค่าแล้วเริ่มจำลองใหม่</span>}</div>
          </section>
          {showIssues && <section className={`dq-plan-issues${planIssues.length ? " has-issues" : ""}`} aria-label="ผลตรวจแผน"><h3>{planIssues.length ? `พบ ${planIssues.length} จุดที่ควรแก้` : "✓ แผนถูกต้อง ผ่านกรณีทดสอบของบทเรียน"}</h3>{planIssues.map((issue, index) => <button key={index} disabled={!issue.nodeId} onClick={() => { if (issue.nodeId) focusNode(issue.nodeId, true); }}>⚠ {issue.message}{issue.nodeId && <span>ไปยังกล่อง →</span>}</button>)}{structureIssues.length > 0 && <p>แก้โครงสร้างให้ครบก่อน แล้วตรวจซ้ำเพื่อทดสอบผลลัพธ์ตามโจทย์</p>}</section>}
          <div className="dq-builder">
            <aside className="dq-toolbox">
              <div className="dq-toolbox-title"><span>กล่องเครื่องมือ</span><small>＋ คลิกเพิ่มกล่อง</small></div>
              <div className="dq-tool-list">{(["input", "process", "decision", "output"] as NodeKind[]).map(kind => <button className={`dq-tool dq-tool-${kindMeta[kind].className}`} key={kind} draggable onDragStart={event => { event.dataTransfer.setData("application/x-codepath-kind", kind); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => addNode(kind)}><span>{kindMeta[kind].icon}</span><b>{kindMeta[kind].label}</b><Icon name="plus" size={15}/></button>)}</div>
              <div className="dq-tool-tip"><span>✦</span><p>ลากกล่องบนกระดานเพื่อจัดตำแหน่งได้เลย</p></div>
              <div className="dq-mini-legend"><b>สัญลักษณ์</b><span><i className="legend-oval"/> เริ่ม / จบ</span><span><i className="legend-box"/> ข้อมูล / ขั้นตอน</span><span><i className="legend-diamond"/> เงื่อนไข</span></div>
            </aside>
            <div className="dq-canvas-column">
              <div className="dq-canvas-toolbar"><span><i/> แผนภาพของฉัน <small>บันทึกอัตโนมัติ</small></span><div><button aria-label="ซูมออก" onClick={() => changeZoom(zoom / 1.15)}>&minus;</button><button className="dq-zoom-percent" aria-label="กลับไปซูม 100 เปอร์เซ็นต์" onClick={() => changeZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="ซูมเข้า" onClick={() => changeZoom(zoom * 1.15)}>&#43;</button><button className={`dq-pan-toggle${panMode ? " is-active" : ""}`} aria-label="ลากกระดาน" title="โหมดมือ: ลากกระดานได้แม้เริ่มลากบนกล่อง" aria-pressed={panMode} onClick={() => { setPanMode(!panMode); setConnecting(false); setLinkStart(null); }}>✋</button><button aria-label="แสดงทุกกล่อง" title="แสดงทุกกล่อง" onClick={fitCanvas}>⊡</button><button className={`dq-link-mode${connecting ? " is-active" : ""}`} aria-label="เชื่อมกล่อง" title="เชื่อมกล่อง" onClick={() => { setConnecting(!connecting); setPanMode(false); setLinkStart(null); setNotice(!connecting ? "เลือกกล่องต้นทาง แล้วเลือกกล่องปลายทาง" : "ปิดโหมดเชื่อมกล่องแล้ว"); }}>↗</button><span className="dq-toolbar-divider"/><button aria-label="ขยายเต็มหน้าจอ" onClick={async event => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await event.currentTarget.closest(".dq-builder")?.requestFullscreen(); } catch { setNotice("เบราว์เซอร์นี้เปิดเต็มหน้าจอไม่ได้"); } }}>⛶</button></div></div>
              <FlowCanvas playback={simulationValid && currentStep ? <><div><b>ขั้น {simulation.index + 1}/{simulation.steps.length}</b><span>{currentStep.message}</span></div><button onClick={() => setSimulation({ ...simulation, playing: !simulation.playing })} disabled={simulation.index === simulation.steps.length - 1}>{simulation.playing ? "Ⅱ พัก" : "▶ เล่นต่อ"}</button><button onClick={advanceSimulation} disabled={simulation.index === simulation.steps.length - 1}>ขั้นถัดไป →</button></> : undefined} activeNodeId={currentStep?.nodeId} activeEdgeIndex={currentStep?.edgeIndex} visitedNodeIds={simulationValid ? simulation.steps.slice(0, simulation.index).map(step => step.nodeId) : []} errorNodeIds={showIssues ? planIssues.flatMap(issue => issue.nodeId ? [issue.nodeId] : []) : []} camera={camera} onCamera={setCamera} viewportRef={viewportRef} panMode={panMode} onFit={fitCanvas} nodes={nodes} edges={edges} selected={selectedId} linkStart={linkStart} onSelect={selectFlowNode} onMove={(id, x, y) => { setNodes(current => current.map(n => n.id === id ? { ...n, x, y } : n)); setDiagramUsed(true); setPlanChecked(false); }} onDropNode={(kind, x, y) => addNode(kind, { x, y })}/>
              <div className="dq-canvas-foot"><span><i/> เริ่มต้น</span><span><i/> ลากพื้นที่ว่างเพื่อเลื่อน · ล้อเมาส์ซูม · Shift + ล้อเมาส์เลื่อนแนวนอน</span><button onClick={() => setShowCode(!showCode)}><Icon name="code" size={15}/>{showCode ? "ซ่อนโครงร่าง" : "ดูโครงร่าง"}</button></div>
              {showCode && <pre className="dq-pseudocode"><span>{"// โครงร่างจากแผนของคุณ"}</span>{"\n"}{pseudocode}</pre>}
              {notice && <div className={`dq-notice ${notice.includes("ครบ") || notice.includes("เยี่ยม") ? "is-success" : ""}`} role="status"><span>{notice.includes("เยี่ยม") ? "✦" : "i"}</span>{notice}<button onClick={() => setNotice("")} aria-label="ปิด">×</button></div>}
            </div>
            <aside className="dq-inspector">
              <div className="dq-inspector-head"><span>รายละเอียดบล็อก</span><button aria-label="ปิดรายละเอียด" onClick={() => setSelectedId(null)}>×</button></div>
              {selectedNode ? <>
                <div className={`dq-inspector-kind kind-${kindMeta[selectedNode.kind].className}`}><span>{kindMeta[selectedNode.kind].icon}</span>{kindMeta[selectedNode.kind].label}</div>
                <div className="dq-node-actions"><button onClick={() => { setUndoGraph({ nodes, edges }); const copy = { ...selectedNode, id: crypto.randomUUID(), title: `${selectedNode.title} (สำเนา)`, x: Math.min(selectedNode.x + 30, 320), y: Math.min(selectedNode.y + 30, 300) }; setNodes(current => [...current, copy]); setSelectedId(copy.id); setPlanChecked(false); setDiagramUsed(true); }}><Icon name="plus" size={16}/> ทำสำเนากล่อง</button>
                {selectedNode.kind !== "start" && <button className="dq-delete-node" onClick={() => { setUndoGraph({ nodes, edges }); setNodes(current => current.filter(node => node.id !== selectedNode.id)); setEdges(current => current.filter(edge => edge.from !== selectedNode.id && edge.to !== selectedNode.id)); setSelectedId(null); setPlanChecked(false); setDiagramUsed(true); setNotice("ลบกล่องและเส้นที่เกี่ยวข้องแล้ว · กดย้อนกลับเพื่อคืนค่า"); }}><Icon name="trash" size={16}/> ลบกล่องนี้</button>}</div>
                <label className="dq-field"><span>ชื่อขั้นตอน</span><input value={selectedNode.title} onChange={event => updateNode(selectedNode.id, "title", event.target.value)} /></label>
                <label className="dq-field"><span>คำอธิบายสั้น ๆ</span><textarea value={selectedNode.detail} onChange={event => updateNode(selectedNode.id, "detail", event.target.value)} rows={3}/></label>
                <div className="dq-inspector-tip"><span>✦</span><p>{selectedNode.kind === "decision" ? "คำถามนี้ควรตอบได้ว่า ‘ใช่’ หรือ ‘ไม่ใช่’ เพื่อแยกเส้นทางให้ชัดเจน" : selectedNode.kind === "input" ? "ลองระบุชนิดข้อมูลที่รับ เช่น ตัวเลข ข้อความ หรือวันเกิด" : "เขียนให้สั้นและบอกชัดว่าขั้นตอนนี้ทำอะไร"}</p></div>
                <NodeRules node={selectedNode} lesson={lesson} onChange={patch => { setUndoGraph({ nodes, edges }); setNodes(current => current.map(n => n.id === selectedNode.id ? { ...n, ...patch, ...(n.kind === "decision" ? { title: `${lesson.inputLabel} ${patch.operator ?? n.operator ?? ">="} ${patch.threshold ?? n.threshold ?? "…"}?` } : {}) } : n)); setDiagramUsed(true); setPlanChecked(false); }}/>
                <ConnectionEditor node={selectedNode} nodes={nodes} edges={edges} onChange={next => { setUndoGraph({ nodes, edges }); setEdges(next); setDiagramUsed(true); setPlanChecked(false); setNotice("อัปเดตเส้นเชื่อมแล้ว · กดย้อนกลับได้หากเปลี่ยนใจ"); }}/>

              </> : <div className="dq-inspector-empty"><span>↖</span><b>เลือกกล่องบนกระดาน</b><p>คลิกที่กล่องเพื่อแก้ชื่อและรายละเอียดของขั้นตอน</p></div>}
            </aside>
          </div>
          {planVerified ? <div className="dq-bottom-prompt is-ready"><span className="dq-prompt-star">✓</span><p><b>แผนผ่านแล้ว</b><small>ขั้นถัดไป: อ่าน error trace ให้เจอสาเหตุก่อนใช้ AI</small></p><button onClick={() => { setPhase("trace"); setNotice(""); }}>ไปขั้นต่อไป <Icon name="arrow" size={16}/></button></div> : <div className="dq-bottom-prompt"><span className="dq-prompt-star">✳</span><p><b>ลองคิดต่ออีกนิด</b><small>เลือกกล่องเงื่อนไข แล้วเลือกปลายทาง ✓ ใช่ และ ✕ ไม่ใช่ ในแผงด้านข้าง</small></p><button onClick={() => { setConnecting(true); setLinkStart(null); setNotice("เลือกกล่องเงื่อนไขก่อน แล้วเลือก Output ที่ต้องการเชื่อม"); }}>เชื่อมทางเลือก <Icon name="arrow" size={16}/></button></div>}
        </section>}
        {phase === "trace" && <TraceStage lesson={lesson} opened={traceOpened} onOpen={openTrace} answer={traceAnswer} onAnswer={setTraceAnswer} onCheck={checkTrace} checked={traceChecked} aiHint={aiHint} onAskAi={askAi} notice={notice} onContinue={() => { setPhase("code"); setNotice(""); }}/ >}
        {phase === "code" && <CodeStage lesson={lesson} code={code} onCode={setCode} onRun={executeCode} running={isRunning} results={runResults} error={codeError} feedback={feedback} plan={pseudocode} />}
        {phase === "result" && <ResultStage attempt={attempts[0]} xp={xp} onRestart={restartLesson} onProgress={() => setActive("progress")}/>}
      </>}
      {active === "dashboard" && <Dashboard onPractice={id => { if (id === lesson.id) setActive("plan"); else onChooseLesson(id); }}/> }
      {active === "lessons" && <Lessons currentLesson={lesson.id} onStart={id => { if (id === lesson.id) setActive("plan"); else onChooseLesson(id); }} />}
      {active === "progress" && <Progress lesson={lesson} attempts={attempts} xp={xp} onContinue={restartLesson} onClear={() => { setAttempts([]); setXp(0); restartLesson(); }} />}
      <footer className="dq-footer"><span>CODEPATH <i>·</i> เรียนรู้ทีละขั้น</span><span>บันทึกในเบราว์เซอร์นี้ <i>●</i> ฝึกได้โดยไม่สมัครสมาชิก</span></footer>
    </main>
  </div>;
}

function TraceStage({ lesson, opened, onOpen, answer, onAnswer, onCheck, checked, aiHint, onAskAi, notice, onContinue }: { lesson: Lesson; opened: boolean; onOpen: () => void; answer: string; onAnswer: (value: string) => void; onCheck: () => void; checked: boolean; aiHint: boolean; onAskAi: () => void; notice: string; onContinue: () => void }) {
  const options = [
    { id: "undefined-object", text: `ตัวแปร record ไม่มีค่า แต่โค้ดพยายามอ่าน record.${lesson.variable}` },
    { id: "bad-comparison", text: "เครื่องหมาย >= ใช้เปรียบเทียบตัวเลขไม่ได้" },
    { id: "wrong-output", text: "ฟังก์ชันส่งข้อความผลลัพธ์กลับมาผิดรูปแบบ" },
  ];
  return <section className="dq-stage-card dq-trace-stage">
    <div className="dq-stage-intro"><span className="dq-stage-icon trace-icon"><Icon name="search" size={21}/></span><div><span className="dq-eyebrow">STEP 02 · READ TRACE BEFORE SEARCH</span><h2>อ่านหลักฐานก่อนถามตัวช่วย</h2><p>ดู error และตำแหน่งที่เกิดก่อน แล้วค่อยเลือกสาเหตุที่เป็นไปได้</p></div></div>
    <div className="dq-trace-rule"><span>01</span><p><b>ลองด้วยตัวเองก่อน</b><small>เปิด trace และอ่านบรรทัดที่แจ้งตำแหน่งปัญหา คำใบ้ประกอบบทเรียน จะใช้ได้หลังจากเปิดอ่านแล้ว</small></p><span className="dq-rule-check"><Icon name="check" size={14}/></span></div>
    {!opened ? <button className="dq-open-trace" onClick={onOpen}><Icon name="search" size={17}/> เปิด Error Trace <span>ใช้เวลาอ่านไม่ถึง 1 นาที</span><Icon name="arrow" size={16}/></button> : <>
      <div className="dq-trace-window"><div className="dq-trace-window-bar"><span><i/><i/><i/></span><b>console · lesson.js</b><small>runtime error</small></div><pre>{`TypeError: Cannot read properties of undefined (reading '${lesson.variable}')
    at checkValue (lesson.js:2:14)
    at main (lesson.js:7:1)

1 function checkValue(record) {
2   if (record.${lesson.variable} >= ${lesson.threshold}) {
3     return ${JSON.stringify(lesson.yes)};
4   }
5   return ${JSON.stringify(lesson.no)};
6 }
7 checkValue(undefined);`}</pre></div>
      <div className="dq-diagnosis"><div className="dq-diagnosis-head"><span className="dq-eyebrow">02 · ลองวิเคราะห์</span><b>จาก trace นี้ สาเหตุที่ใกล้เคียงที่สุดคือข้อใด?</b></div><div className="dq-choice-list">{options.map(option => <label key={option.id} className={`dq-choice${answer === option.id ? " is-selected" : ""}${checked && option.id === "undefined-object" ? " is-correct" : ""}`}><input type="radio" name="trace-answer" value={option.id} checked={answer === option.id} onChange={() => onAnswer(option.id)}/><span className="dq-choice-radio"/><span>{option.text}</span></label>)}</div>
        <div className="dq-diagnosis-actions"><button className="dq-run-button" disabled={!answer || checked} onClick={onCheck}><Icon name="check" size={15}/> ตรวจคำตอบ</button><button className="dq-ai-hint-button" disabled={!opened || checked || aiHint} onClick={onAskAi}><span>✦</span>{aiHint ? "ได้รับคำใบ้แล้ว" : "ขอคำใบ้"}</button></div>
        {!opened && <p className="dq-lock-copy">อ่าน trace ก่อน ปุ่มขอคำใบ้จึงจะเปิดใช้งาน</p>}
        {aiHint && <div className="dq-ai-hint"><b>คำใบ้ประกอบบทเรียน</b><span>ลองดูค่าของ <code>record</code> ก่อนเข้าถึง <code>.{lesson.variable}</code> จุดเรียกฟังก์ชันส่งค่าอะไรเข้ามา?</span></div>}
      </div>
    </>}
    {notice && <div className={`dq-notice dq-stage-notice${checked ? " is-success" : ""}`} role="status"><span>{checked ? "✦" : "i"}</span>{notice}</div>}
    {checked && <div className="dq-stage-next"><div><b>เจอสาเหตุแล้ว!</b><small>ต่อไปใช้แผนภาพของคุณเขียนฟังก์ชัน แล้วลองกับ test cases</small></div><button className="dq-run-button" onClick={onContinue}>ไปเขียนโค้ด <Icon name="arrow" size={15}/></button></div>}
  </section>;
}

function CodeStage({ lesson, code, onCode, onRun, running, results, error, feedback, plan }: { lesson: Lesson; code: string; onCode: (value: string) => void; onRun: () => void; running: boolean; results: RunResult[] | null; error: string; feedback: string; plan: string }) {
  return <section className="dq-stage-card dq-code-stage">
    <div className="dq-stage-intro"><span className="dq-stage-icon code-icon"><Icon name="code" size={21}/></span><div><span className="dq-eyebrow">STEP 03 · BUILD FROM YOUR PLAN</span><h2>เขียนโค้ดจากแผนที่วางไว้</h2><p>เติมเงื่อนไขในฟังก์ชัน แล้วกดรันเพื่อทดสอบตัวอย่างทุกกรณีของบทเรียน</p></div></div>
    <div className="dq-code-layout"><div className="dq-editor-panel"><div className="dq-editor-bar"><span><i/> main.js</span><small>JavaScript</small></div><div className="dq-editor-body"><div className="dq-line-numbers" aria-hidden="true">{Array.from({ length: Math.max(6, code.split("\n").length) }, (_, index) => <span key={index}>{index + 1}</span>)}</div><label className="dq-code-label" htmlFor="student-code">โค้ดคำตอบ</label><textarea id="student-code" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={code} onChange={event => onCode(event.target.value)} aria-describedby="code-run-help"/></div><div className="dq-editor-footer"><span id="code-run-help">ใช้ <code>return</code> เพื่อส่งผลลัพธ์กลับ</span><button className="dq-run-button" onClick={onRun} disabled={running}>{running ? <><span className="dq-spinner"/> กำลังรัน</> : <><Icon name="play" size={14}/> รันโค้ด</>}</button></div>
      {error && <div className="dq-code-error"><b>ยังรันไม่ได้</b><code>{error}</code><small>ตรวจ syntax และวงเล็บในโค้ด แล้วลองใหม่</small></div>}
      {feedback && <div className={`dq-code-feedback${results?.every(result => result.passed) ? " is-success" : ""}`} role="status"><b>{results?.every(result => result.passed) ? "✓ ผ่านทุกกรณี" : "ลองปรับอีกครั้ง"}</b><span>{feedback}</span></div>}
      {results && <div className="dq-test-results"><b>ผลการทดสอบ</b>{results.map(result => <div className={result.passed ? "passed" : "failed"} key={result.input}><span>{lesson.variable} = {result.input}</span><span>{result.error ? `Error: ${result.error}` : String(result.actual)}</span><i>{result.passed ? "ผ่าน" : "ไม่ผ่าน"}</i></div>)}</div>}
    </div><aside className="dq-code-guide"><div className="dq-guide-card"><span className="dq-guide-heading"><Icon name="book" size={15}/> แผนจากขั้นก่อน</span><pre>{plan}</pre><small>ใช้ Input, เงื่อนไข และ Output ในแผนเป็นตัวนำทาง</small></div><div className="dq-cases-card"><span className="dq-guide-heading"><Icon name="target" size={15}/> กรณีทดสอบ</span><p>โปรแกรมควรให้ผลลัพธ์ตามนี้</p>{lesson.cases.map(test => <div className="dq-test-case" key={test.input}><code>{lesson.variable} = {test.input}</code><span>{test.expected}</span></div>)}</div><div className="dq-safe-note"><span>ⓘ</span> โค้ดรันแยกใน Web Worker และหยุดอัตโนมัติหากใช้เวลานาน</div></aside></div>
  </section>;
}

function ResultStage({ attempt, xp, onRestart, onProgress }: { attempt?: AttemptRecord; xp: number; onRestart: () => void; onProgress: () => void }) {
  if (!attempt) return <section className="dq-stage-card"><h2>ยังไม่มีผลการฝึก</h2><p>ทำภารกิจให้ครบก่อน แล้วผลสรุปจะแสดงที่นี่</p><button className="dq-run-button" onClick={onRestart}>เริ่มภารกิจ</button></section>;
  return <section className="dq-stage-card dq-result-stage"><div className="dq-result-hero"><span className="dq-result-medal">✦</span><span className="dq-eyebrow">MISSION COMPLETE</span><h2>เก่งมาก! คุณแก้โจทย์สำเร็จ</h2><p>คุณวางแผน อ่านหลักฐาน และตรวจโค้ดด้วยตัวเองครบทุกขั้น</p><div className="dq-result-score"><b>{attempt.score}</b><span>คะแนน<br/>+50 XP · ยอดรวม {xp} XP</span></div></div>
    <div className="dq-result-metrics"><div><span>ใช้เวลา</span><b>{attempt.timeToResolveMin < 1 ? "น้อยกว่า 1" : attempt.timeToResolveMin} นาที</b></div><div><span>อ่าน Error Trace ก่อน</span><b>{attempt.readLogFirst ? "ใช่" : "ยังไม่ได้อ่าน"}</b></div><div><span>ใช้คำใบ้</span><b>{attempt.copeToAi ? "ใช้คำใบ้" : "คิดเองก่อน"}</b></div><div><span>ใช้แผนภาพ</span><b>{attempt.usedDiagram ? "ใช้วางแผน" : "ไม่ได้ใช้"}</b></div></div>
    <div className="dq-result-feedback"><span className="dq-prompt-star">✳</span><div><b>{attempt.readLogFirst ? "คุณอ่านหลักฐานก่อนตัดสินใจ" : "ครั้งหน้าลองอ่าน trace ก่อน"}</b><p>{attempt.copeToAi ? "คุณขอ AI หลังจากอ่าน trace แล้ว ซึ่งช่วยให้คำใบ้ตรงจุดขึ้น" : "คุณหาเหตุจาก trace ได้เองโดยไม่ต้องใช้ AI เยี่ยมเลย"} โค้ดผ่านกรณีทดสอบของบทเรียนครบถ้วน</p></div></div>
    <div className="dq-result-actions"><button className="dq-run-button" onClick={onRestart}>ฝึกโจทย์นี้อีกครั้ง <Icon name="undo" size={15}/></button><button className="dq-quiet-button" onClick={onProgress}>ดูความก้าวหน้าของฉัน <Icon name="arrow" size={15}/></button></div>
  </section>;
}

function Lessons({ currentLesson, onStart }: { currentLesson: string; onStart: (id: string) => void }) {
  const [summaries, setSummaries] = useState<Record<string, { completed: boolean; phase: string; xp: number }>>({});
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next: typeof summaries = {};
      for (const lesson of lessons) {
        try { const saved = JSON.parse(localStorage.getItem(lessonKey(lesson.id)) ?? (lesson.id === "exam" ? localStorage.getItem(STORAGE_KEY) : null) ?? "{}"); next[lesson.id] = { completed: Array.isArray(saved.attempts) && saved.attempts.some((a: unknown) => validAttempt(a) && a.fixedSuccessfully), phase: saved.phase ?? "plan", xp: Number.isFinite(saved.xp) ? saved.xp : 0 }; } catch { /* A damaged lesson does not hide other lessons. */ }
      }
      setSummaries(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const completed = Object.values(summaries).filter(s => s.completed).length;
  return <div className="dq-secondary-page"><div className="dq-secondary-heading"><div><p className="dq-eyebrow">LEARNING PATH</p><h1>เลือกภารกิจฝึก</h1><p>แต่ละภารกิจบันทึกแผน โค้ด ผลทดสอบ และความก้าวหน้าแยกกัน</p></div><span className="dq-level-pill">ผ่าน {completed} / {lessons.length} ภารกิจ</span></div>
    <div className="dq-lesson-cards">{lessons.map((lesson, index) => <section key={lesson.id} className={`dq-lesson-card${lesson.id === currentLesson ? " is-current" : ""}`}><span className="dq-eyebrow">ภารกิจ {index + 1} · {summaries[lesson.id]?.completed ? "✓ ผ่านแล้ว" : summaries[lesson.id]?.phase && summaries[lesson.id].phase !== "plan" ? "กำลังเรียน" : "วางแผน"}</span><h2>{lesson.title}</h2><p>{lesson.description}</p><small>{summaries[lesson.id]?.xp ?? 0} XP · {lesson.cases.length} กรณีทดสอบ</small><button className="dq-run-button" onClick={() => onStart(lesson.id)}>{lesson.id === currentLesson ? "กลับไปทำต่อ" : "เปิดบทเรียน"}<Icon name="arrow" size={16}/></button></section>)}</div>
  </div>;
}
function Progress({ lesson, attempts, xp, onContinue, onClear }: { lesson: Lesson; attempts: AttemptRecord[]; xp: number; onContinue: () => void; onClear: () => void }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const complete = attempts.filter(attempt => attempt.fixedSuccessfully).length;
  const totalRuns = attempts.length;
  const latest = attempts[0];
  const percent = (predicate: (attempt: AttemptRecord) => boolean) => totalRuns ? Math.round(attempts.filter(predicate).length / totalRuns * 100) : 0;
  const readRate = percent(attempt => attempt.readLogFirst);
  const diagramRate = percent(attempt => attempt.usedDiagram);
  const aiRate = percent(attempt => attempt.copeToAi);
  const averageTime = totalRuns ? Math.round(attempts.reduce((sum, item) => sum + item.timeToResolveMin, 0) / totalRuns * 10) / 10 : 0;
  const passRate = percent(attempt => attempt.fixedSuccessfully);
  const skills = [["วางแผนด้วย Flowchart", diagramRate], ["อ่าน Trace ก่อนขอความช่วยเหลือ", readRate], ["แก้โค้ดผ่าน test cases", passRate], ["ใช้ AI เป็นตัวช่วย", aiRate]] as [string, number][];
  return <div className="dq-secondary-page"><div className="dq-secondary-heading"><div><p className="dq-eyebrow">YOUR PROGRESS · {lesson.title} · เก็บในเบราว์เซอร์นี้</p><h1>เก่งขึ้นทุกวัน</h1><p>ดูวิธีที่คุณใช้แก้ปัญหา ไม่ใช่แค่ดูว่าคำตอบถูกหรือไม่</p></div><span className="dq-level-pill">✦ {xp} XP</span></div>
    <div className="dq-progress-stats"><div><span>ภารกิจสำเร็จ</span><b>{complete} <small>ครั้ง</small></b><i>{totalRuns ? `จาก ${totalRuns} ครั้งที่ลอง` : "เริ่มภารกิจแรกเพื่อเก็บสถิติ"}</i></div><div><span>เวลาเฉลี่ยต่อครั้งที่ลอง</span><b>{averageTime} <small>นาที</small></b><i>นับตั้งแต่เริ่มเขียนโค้ด</i></div><div><span>อ่าน Trace ก่อน</span><b>{readRate} <small>%</small></b><i>{totalRuns ? `${attempts.filter(item => item.readLogFirst).length} จาก ${totalRuns} ครั้งที่ลอง` : "ยังไม่มีข้อมูล"}</i></div></div>
    <div className="dq-progress-panels"><section><span className="dq-eyebrow">ทักษะจากประวัติการฝึก</span><h2>ความชำนาญของฉัน</h2>{skills.map(([name, pct]) => <div className="dq-skill" key={name}><span>{name}</span><b>{totalRuns ? `${pct}%` : "—"}</b><i><em style={{ width: `${pct}%` }}/></i></div>)}<small className="dq-progress-footnote">{totalRuns ? `ใช้ diagram ${diagramRate}% · ขอคำใบ้หลังอ่าน trace ${aiRate}%` : "ข้อมูลจะแสดงหลังจากกดรันโค้ด"}</small></section><section className="dq-coach-card"><span className="dq-coach-icon"><Icon name="spark" size={22}/></span><p>คำแนะนำจากโค้ช</p><h2>{!totalRuns ? "เริ่มจากวางแผนก่อน" : !latest?.fixedSuccessfully ? "มีจุดให้ลองปรับอีกนิด" : latest.readLogFirst ? "ทำได้ดีที่อ่านหลักฐานก่อน" : "ลองอ่าน Trace ก่อน"}</h2><small>{!totalRuns ? "เชื่อม Input → เงื่อนไข → Output แล้วตรวจแผนก่อนเริ่มเขียนโค้ด" : !latest?.fixedSuccessfully ? "ดูกรณีทดสอบที่ยังไม่ผ่าน ปรับโค้ดแล้วกดรันซ้ำได้เลย ทุกครั้งที่ลองจะถูกบันทึก" : latest.copeToAi ? "ครั้งถัดไปลองตั้งสมมติฐานด้วยตัวเองก่อน แล้วใช้คำใบ้ตรวจคำตอบ" : "คุณหาเหตุจากข้อมูลที่มีได้ด้วยตัวเอง ลองนำวิธีนี้ไปใช้กับโจทย์ใหม่"}</small><button onClick={onContinue}>{complete ? "ฝึกซ้ำอีกครั้ง" : "เริ่มภารกิจ"} <Icon name="arrow" size={15}/></button></section></div>
    {latest && <section className="dq-history-panel"><span className="dq-eyebrow">RECENT PRACTICE</span><h2>บันทึกล่าสุด</h2>{attempts.slice(0, 8).map(item => <div className="dq-history-row" key={item.id}><span className={`dq-history-status${item.fixedSuccessfully ? "" : " is-failed"}`}>{item.fixedSuccessfully ? <Icon name="check" size={14}/> : "!"}</span><span><b>{lesson.title} · {item.fixedSuccessfully ? "ผ่าน" : "ยังไม่ผ่าน"}</b><small>{new Date(item.completedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</small></span><span>{item.timeToResolveMin} นาที</span><b>{item.score} คะแนน</b></div>)}</section>}
    <button className="dq-quiet-button" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), attempts, xp }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `codepath-progress-${localDay()}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>สำรองประวัติการฝึก (JSON)</button><div className="dq-clear-progress">{confirmClear ? <><span>ล้างคะแนน ประวัติ แผน และโค้ดของบทเรียนนี้?</span><button onClick={onClear}>ยืนยันล้างข้อมูล</button><button onClick={() => setConfirmClear(false)}>ยกเลิก</button></> : <button onClick={() => setConfirmClear(true)}>ล้างข้อมูลการฝึกบทเรียนนี้</button>}</div>
  </div>;
}
