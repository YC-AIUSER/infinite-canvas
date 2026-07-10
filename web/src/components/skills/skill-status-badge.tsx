import type { SkillStatus } from "@/pages/skills/skills-data";

const STATUS_STYLES: Record<SkillStatus, string> = {
    可直接运行: "bg-emerald-500/90 text-white dark:bg-emerald-500/80",
    需要人工确认: "bg-amber-500/90 text-white dark:bg-amber-500/80",
    只做提示词: "bg-sky-500/90 text-white dark:bg-sky-500/80",
    只做检查: "bg-violet-500/90 text-white dark:bg-violet-500/80",
    待开发: "bg-stone-500/80 text-white dark:bg-stone-500/70",
};

export function SkillStatusBadge({ status, className }: { status: SkillStatus; className?: string }) {
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 shadow-sm backdrop-blur-sm ${STATUS_STYLES[status]} ${className ?? ""}`}>{status}</span>;
}
