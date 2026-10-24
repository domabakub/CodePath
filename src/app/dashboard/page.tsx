import type { Metadata } from "next";
import { DebugQuestApp } from "@/components/debugquest/DebugQuestApp";
export const metadata: Metadata = { title: "Dashboard — Codepath", description: "ภาพรวมความก้าวหน้าและพฤติกรรมการฝึกเขียนโปรแกรม" };
export default function DashboardPage() { return <DebugQuestApp startOnDashboard/>; }
