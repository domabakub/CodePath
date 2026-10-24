export type NodeKind = "start" | "input" | "process" | "decision" | "output";
export type FlowNode = { id: string; kind: NodeKind; title: string; detail: string; x: number; y: number; operator?: ">=" | ">" | "<=" | "<" | "=="; threshold?: number; outputValue?: string; operation?: "add" | "multiply"; operand?: number };
export type Edge = { from: string; to: string; label?: string };
export type Lesson = { id: string; title: string; inputLabel: string; variable: string; min: number; max: number; threshold: number; yes: string; no: string; description: string; cases: { input: number; expected: string }[] };
export const lessons: Lesson[] = [
  { id: "exam", title: "โปรแกรมตรวจผลสอบ", inputLabel: "คะแนน", variable: "score", min: 0, max: 100, threshold: 50, yes: "ผ่าน", no: "ลองอีกครั้ง", description: "รับคะแนน 0–100 ถ้าคะแนนตั้งแต่ 50 ให้แสดง ‘ผ่าน’ นอกนั้นแสดง ‘ลองอีกครั้ง’", cases: [{ input: 0, expected: "ลองอีกครั้ง" }, { input: 49, expected: "ลองอีกครั้ง" }, { input: 50, expected: "ผ่าน" }, { input: 82, expected: "ผ่าน" }, { input: 100, expected: "ผ่าน" }] },
  { id: "age", title: "ตรวจสิทธิ์เข้าชมกิจกรรม", inputLabel: "อายุ", variable: "age", min: 0, max: 120, threshold: 18, yes: "เข้าร่วมได้", no: "ยังไม่ถึงเกณฑ์", description: "รับอายุ 0–120 ปี ถ้าอายุตั้งแต่ 18 ให้แสดง ‘เข้าร่วมได้’ นอกนั้นแสดง ‘ยังไม่ถึงเกณฑ์’", cases: [{ input: 0, expected: "ยังไม่ถึงเกณฑ์" }, { input: 17, expected: "ยังไม่ถึงเกณฑ์" }, { input: 18, expected: "เข้าร่วมได้" }, { input: 25, expected: "เข้าร่วมได้" }, { input: 120, expected: "เข้าร่วมได้" }] },
  { id: "temperature", title: "แจ้งเตือนอุณหภูมิ", inputLabel: "อุณหภูมิ", variable: "temperature", min: -50, max: 100, threshold: 35, yes: "อากาศร้อน", no: "อากาศปกติ", description: "รับอุณหภูมิ −50 ถึง 100 °C ถ้าตั้งแต่ 35 ให้แสดง ‘อากาศร้อน’ นอกนั้นแสดง ‘อากาศปกติ’", cases: [{ input: -10, expected: "อากาศปกติ" }, { input: 34, expected: "อากาศปกติ" }, { input: 35, expected: "อากาศร้อน" }, { input: 40, expected: "อากาศร้อน" }, { input: 100, expected: "อากาศร้อน" }] },
];
export const lessonKey = (id: string) => `codepath.lesson.v2.${id}`;
export function starterNodes(lesson: Lesson): FlowNode[] {
  return [
    { id: "start", kind: "start", title: "เริ่มต้น", detail: "เริ่มทำแบบฝึก", x: 50, y: 30 },
    { id: "input", kind: "input", title: `รับ${lesson.inputLabel}`, detail: `${lesson.min} ถึง ${lesson.max}`, x: 50, y: 140 },
    { id: "check", kind: "decision", title: `${lesson.inputLabel} ≥ ${lesson.threshold}?`, detail: "ตรวจเงื่อนไข", x: 50, y: 300, operator: ">=", threshold: lesson.threshold },
    { id: "pass", kind: "output", title: `แสดง “${lesson.yes}”`, detail: "เมื่อคำตอบเป็นใช่", x: 340, y: 190, outputValue: lesson.yes },
    { id: "retry", kind: "output", title: `แสดง “${lesson.no}”`, detail: "เมื่อคำตอบเป็นไม่ใช่", x: 340, y: 400, outputValue: lesson.no },
  ];
}
export const starterEdges: Edge[] = [{ from: "start", to: "input" }, { from: "input", to: "check" }];
export function starterCode(lesson: Lesson) { return `// ${lesson.variable} คือ${lesson.inputLabel}ที่รับเข้ามา\nif (/* เติมเงื่อนไข */) {\n  return ${JSON.stringify(lesson.yes)};\n}\nreturn ${JSON.stringify(lesson.no)};`; }
export type PlanIssue = { nodeId?: string; message: string };
export function validateGraph(nodes: FlowNode[], edges: Edge[]): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const ids = new Set(nodes.map(n => n.id));
  const starts = nodes.filter(n => n.kind === "start");
  if (starts.length !== 1) issues.push({ nodeId: starts[1]?.id, message: "แผนต้องมีกล่องเริ่มต้นเพียงหนึ่งกล่อง" });
  const inputs = nodes.filter(n => n.kind === "input");
  if (inputs.length !== 1) issues.push({ nodeId: inputs[1]?.id ?? starts[0]?.id, message: "บทเรียนนี้ต้องมีกล่องรับข้อมูล (Input) หนึ่งกล่อง" });
  if (!nodes.some(n => n.kind === "output")) issues.push({ nodeId: starts[0]?.id, message: "เพิ่มกล่องแสดงผล (Output)" });
  const seenEdges = new Set<string>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) issues.push({ nodeId: ids.has(e.from) ? e.from : undefined, message: "เส้นเชื่อมอ้างถึงกล่องที่ไม่มีอยู่" });
    const key = JSON.stringify([e.from, e.to]);
    if (seenEdges.has(key)) issues.push({ nodeId: e.from, message: "มีเส้นเชื่อมซ้ำไปยังกล่องเดียวกัน" });
    seenEdges.add(key);
  }
  for (const n of nodes) {
    const out = edges.filter(e => e.from === n.id);
    const add = (message: string) => issues.push({ nodeId: n.id, message: `${n.title}: ${message}` });
    if (n.kind === "decision") {
      if (out.length !== 2 || !out.some(e => e.label === "ใช่") || !out.some(e => e.label === "ไม่ใช่")) add("ต้องเชื่อมทาง ✓ ใช่ และ ✕ ไม่ใช่ ให้ครบอย่างละหนึ่งเส้น");
      if (![">=", ">", "<=", "<", "=="].includes(n.operator ?? "") || !Number.isFinite(n.threshold)) add("กำหนดเครื่องหมายและค่าที่ใช้เปรียบเทียบก่อน");
    } else if (n.kind === "output") {
      if (out.length) add("กล่องผลลัพธ์เป็นจุดจบ ต้องไม่มีเส้นออก");
      if (typeof n.outputValue !== "string" || !n.outputValue.trim()) add("ระบุข้อความที่จะแสดงผล");
    } else if (out.length !== 1) add("ต้องมีทางออกหนึ่งเส้น");
    if (n.kind === "process" && (!["add", "multiply"].includes(n.operation ?? "") || !Number.isFinite(n.operand))) add("กำหนดการคำนวณและค่าที่ใช้ก่อน");
  }
  // Scan every component so a disconnected cycle is still reported.
  const color = new Map<string, number>();
  function visit(id: string) {
    color.set(id, 1);
    for (const e of edges.filter(e => e.from === id && ids.has(e.to))) {
      if (color.get(e.to) === 1) issues.push({ nodeId: id, message: `${nodes.find(n => n.id === id)?.title}: พบเส้นทางวนลูป กลับไปยังกล่องที่ยังทำงานไม่จบ` });
      else if (!color.get(e.to)) visit(e.to);
    }
    color.set(id, 2);
  }
  nodes.forEach(n => { if (!color.get(n.id)) visit(n.id); });
  const reachable = new Set<string>();
  function reach(id: string) { if (reachable.has(id)) return; reachable.add(id); edges.filter(e => e.from === id && ids.has(e.to)).forEach(e => reach(e.to)); }
  if (starts[0]) reach(starts[0].id);
  nodes.filter(n => !reachable.has(n.id)).forEach(n => issues.push({ nodeId: n.id, message: `${n.title}: ไปไม่ถึงจากจุดเริ่มต้น` }));
  return issues;
}
export type SimulationStep = { nodeId: string; value: number; edgeIndex?: number; message: string; output?: string };
export function simulateGraph(nodes: FlowNode[], edges: Edge[], input: number): SimulationStep[] {
  const issues = validateGraph(nodes, edges);
  if (issues.length) throw new Error(issues[0].message);
  if (!Number.isFinite(input)) throw new Error("กรุณาใส่ตัวเลขที่ถูกต้อง");
  let node = nodes.find(n => n.kind === "start")!;
  let value = input;
  const steps: SimulationStep[] = [];
  const visited = new Set<string>();
  while (node) {
    if (visited.has(node.id) || steps.length >= 100) throw new Error("หยุดจำลองเพราะพบการวนลูป");
    visited.add(node.id);
    if (node.kind === "process") value = node.operation === "multiply" ? value * node.operand! : value + node.operand!;
    if (!Number.isFinite(value)) throw new Error("ผลคำนวณเกินขอบเขตตัวเลข");
    if (node.kind === "output") { steps.push({ nodeId: node.id, value, message: `แสดงผล: ${node.outputValue}`, output: node.outputValue }); break; }
    let branch: string | undefined;
    if (node.kind === "decision") {
      const t = node.threshold!;
      const yes = node.operator === ">=" ? value >= t : node.operator === ">" ? value > t : node.operator === "<=" ? value <= t : node.operator === "<" ? value < t : value === t;
      branch = yes ? "ใช่" : "ไม่ใช่";
    }
    const edgeIndex = edges.findIndex(e => e.from === node.id && (branch === undefined || e.label === branch));
    steps.push({ nodeId: node.id, value, edgeIndex, message: branch ? `${value} ${node.operator} ${node.threshold} → ${branch}` : node.kind === "input" ? `รับค่า ${input}` : node.kind === "process" ? `คำนวณแล้วได้ ${value}` : "เริ่มทำงาน" });
    node = nodes.find(n => n.id === edges[edgeIndex]?.to)!;
  }
  return steps;
}
export function checkLessonPlan(nodes: FlowNode[], edges: Edge[], lesson: Lesson): PlanIssue[] {
  const issues = validateGraph(nodes, edges);
  if (issues.length) return issues;
  for (const sample of lesson.cases) {
    try {
      const steps = simulateGraph(nodes, edges, sample.input);
      if (steps.at(-1)?.output !== sample.expected) issues.push({ nodeId: steps.at(-1)?.nodeId, message: `เมื่อ${lesson.inputLabel} = ${sample.input} ต้องแสดง “${sample.expected}” แต่แผนให้ “${steps.at(-1)?.output}”` });
    } catch (e) { issues.push({ message: e instanceof Error ? e.message : "จำลองไม่สำเร็จ" }); }
  }
  return issues;
}
