import { CheckCircle2, Clapperboard, ImageIcon, Palette, Wand2, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { ZONE_GRADIENTS, type SkillCard as SkillCardData, type SkillZone } from "@/pages/skills/skills-data";
import { SkillStatusBadge } from "./skill-status-badge";

const ZONE_ICONS: Record<SkillZone, LucideIcon> = {
    资产设计: Palette,
    剧本分镜: Clapperboard,
    提示词导演: Wand2,
    场景一致性: ImageIcon,
    成片质检: CheckCircle2,
};

export function formatUsageCount(count?: number) {
    if (!count) return "0";
    if (count < 1000) return `${count}`;
    const value = count / 1000;
    return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}k`;
}

export function SkillCard({ skill, onOpen }: { skill: SkillCardData; onOpen: () => void }) {
    const gradient = skill.gradient || ZONE_GRADIENTS[skill.zone];
    const ZoneIcon = ZONE_ICONS[skill.zone];

    return (
        <button
            type="button"
            onClick={onOpen}
            className="group relative flex h-52 w-full overflow-hidden rounded-2xl text-left shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-lg dark:ring-white/10"
            style={{ backgroundImage: gradient }}
        >
            <div className="absolute right-3 top-3 z-10">
                <SkillStatusBadge status={skill.status} />
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-between p-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/20 text-white backdrop-blur-sm">
                            <ZoneIcon className="size-4" />
                        </div>
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{skill.name}</div>
                            <div className="truncate text-xs text-white/70">{skill.author}</div>
                        </div>
                    </div>
                    <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/85">{skill.problem}</p>
                </div>
                <div className="flex items-center gap-1 text-xs font-medium text-white/85">
                    <Zap className="size-3.5" />
                    {formatUsageCount(skill.usageCount)}
                </div>
            </div>

            <div className="relative w-24 shrink-0 overflow-hidden sm:w-28">
                {skill.cover ? (
                    <img src={skill.cover} alt={skill.name} className="h-full w-full object-cover" />
                ) : (
                    <div className={cn("flex h-full w-full items-center justify-center bg-black/10 transition group-hover:bg-black/5")}>
                        <span className="text-4xl font-bold text-white/35">{skill.name.charAt(0)}</span>
                    </div>
                )}
            </div>
        </button>
    );
}
