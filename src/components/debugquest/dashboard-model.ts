import { lessons, lessonKey } from "./flow-model";
export type DashboardAttempt = { id: string; lessonId: string; completedAt: string; score: number; timeToResolveMin: number; fixedSuccessfully: boolean; readLogFirst: boolean; copeToAi: boolean; usedDiagram: boolean };
export type DashboardFilters = { lessonId: string; from: string; to: string; result: string };
export function calendarDay(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function parseAttempts(raw: string | null, lessonId: string): DashboardAttempt[] {
  if (!raw) return [];
  const saved = JSON.parse(raw);
  if (!Array.isArray(saved?.attempts)) return [];
  return saved.attempts.filter((a: unknown) => {
    if (!a || typeof a !== "object") return false;
    const row = a as Record<string, unknown>;
    return typeof row.id === "string" && typeof row.completedAt === "string" && Number.isFinite(Date.parse(row.completedAt)) && typeof row.score === "number" && Number.isFinite(row.score) && row.score >= 0 && row.score <= 100 && typeof row.timeToResolveMin === "number" && Number.isFinite(row.timeToResolveMin) && row.timeToResolveMin >= 0 && [row.fixedSuccessfully, row.readLogFirst, row.copeToAi, row.usedDiagram].every(v => typeof v === "boolean");
  }).map((a: DashboardAttempt) => ({ ...a, lessonId }));
}
export function readDashboard(storage: Pick<Storage, "getItem">) {
  const attempts: DashboardAttempt[] = [], errors: string[] = [];
  for (const lesson of lessons) {
    try { const raw = storage.getItem(lessonKey(lesson.id)) ?? (lesson.id === "exam" ? storage.getItem("codepath.mock.v1") : null); attempts.push(...parseAttempts(raw, lesson.id)); }
    catch { errors.push(lesson.title); }
  }
  return { attempts, errors };
}
export function filterAttempts(attempts: DashboardAttempt[], filters: DashboardFilters) {
  return attempts.filter(a => {
    const day = calendarDay(new Date(a.completedAt));
    return (filters.lessonId === "all" || a.lessonId === filters.lessonId) && (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to) && (filters.result === "all" || a.fixedSuccessfully === (filters.result === "passed"));
  }).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}
export function summarize(attempts: DashboardAttempt[]) {
  const count = attempts.length, passed = attempts.filter(a => a.fixedSuccessfully).length;
  const percent = (predicate: (a: DashboardAttempt) => boolean) => count ? Math.round(attempts.filter(predicate).length / count * 100) : 0;
  return { count, passed, completedLessons: new Set(attempts.filter(a => a.fixedSuccessfully).map(a => a.lessonId)).size, passRate: percent(a => a.fixedSuccessfully), averageScore: count ? Math.round(attempts.reduce((n, a) => n + a.score, 0) / count) : 0, averageTime: count ? Math.round(attempts.reduce((n, a) => n + a.timeToResolveMin, 0) / count * 10) / 10 : 0, readRate: percent(a => a.readLogFirst), diagramRate: percent(a => a.usedDiagram), hintRate: percent(a => a.copeToAi) };
}
export function activityDays(attempts: DashboardAttempt[]) {
  const days = new Map<string, { day: string; total: number; passed: number }>();
  for (const a of attempts) { const day = calendarDay(new Date(a.completedAt)); const row = days.get(day) ?? { day, total: 0, passed: 0 }; row.total++; if (a.fixedSuccessfully) row.passed++; days.set(day, row); }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
export function demoAttempts(now = new Date()): DashboardAttempt[] {
  return Array.from({ length: 18 }, (_, i) => {
    const date = new Date(now); date.setDate(date.getDate() - Math.floor(i / 2)); date.setHours(10 + i % 7, 15, 0, 0);
    const passed = i % 4 !== 0;
    return { id: `demo-${i}`, lessonId: lessons[i % lessons.length].id, completedAt: date.toISOString(), score: passed ? 100 : i % 2 ? 60 : 40, timeToResolveMin: 1 + i % 6, fixedSuccessfully: passed, readLogFirst: i % 4 !== 0, copeToAi: i % 3 === 0, usedDiagram: i % 5 !== 0 };
  });
}
export function attemptsCsv(attempts: DashboardAttempt[]) {
  const cell = (value: string | number) => { const text = String(value); return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`; };
  const rows = [["บทเรียน", "วันเวลา", "ผล", "คะแนน", "เวลา (นาที)", "อ่าน Trace", "ใช้แผนภาพ", "ใช้คำใบ้"], ...attempts.map(a => [lessons.find(l => l.id === a.lessonId)?.title ?? a.lessonId, new Date(a.completedAt).toLocaleString("th-TH"), a.fixedSuccessfully ? "ผ่าน" : "ยังไม่ผ่าน", a.score, a.timeToResolveMin, a.readLogFirst ? "ใช่" : "ไม่ใช่", a.usedDiagram ? "ใช่" : "ไม่ใช่", a.copeToAi ? "ใช่" : "ไม่ใช่"])];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
