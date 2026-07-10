import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Empty, Input, Tag } from "antd";

import { SkillCard } from "@/components/skills/skill-card";
import { SkillDetailDrawer } from "@/components/skills/skill-detail-drawer";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import { SKILL_ZONES, skillCards, type SkillZone } from "./skills-data";

const ALL_TAB = "全部";
const HOT_TAB = "热门";
type SkillTab = typeof ALL_TAB | typeof HOT_TAB | SkillZone;

export default function SkillsPage() {
    const [keyword, setKeyword] = useState("");
    const [activeTab, setActiveTab] = useState<SkillTab>(ALL_TAB);
    const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
    const copyText = useCopyText();

    const skillsById = useMemo(() => new Map(skillCards.map((skill) => [skill.id, skill])), []);
    const selectedSkill = selectedSkillId ? (skillsById.get(selectedSkillId) ?? null) : null;

    const filteredSkills = useMemo(() => {
        let list = skillCards;
        if (activeTab === HOT_TAB) {
            list = [...list].sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));
        } else if (activeTab !== ALL_TAB) {
            list = list.filter((skill) => skill.zone === activeTab);
        }
        const query = keyword.trim().toLowerCase();
        if (query) {
            list = list.filter((skill) => skill.name.toLowerCase().includes(query) || skill.problem.toLowerCase().includes(query));
        }
        return list;
    }, [activeTab, keyword]);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
                <div className="pb-8">
                    <div className="mx-auto max-w-5xl text-center">
                        <h1 className="text-4xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">技能广场</h1>
                        <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">沉淀 AI 漫剧 / 短剧生产链路里的专项技能，共 {skillCards.length} 个技能。</p>
                    </div>

                    <div className="mx-auto mt-8 w-full max-w-2xl">
                        <Input size="large" className="w-full" prefix={<Search className="size-4 text-stone-400" />} value={keyword} placeholder="按技能名或问题描述搜索" onChange={(event) => setKeyword(event.target.value)} />
                    </div>

                    <div className="mx-auto mt-6 flex max-w-6xl flex-wrap gap-2">
                        {[ALL_TAB, HOT_TAB, ...SKILL_ZONES].map((tab) => (
                            <Tag.CheckableTag key={tab} checked={activeTab === tab} className={cn("prompt-filter-tag", activeTab === tab && "is-active")} onChange={() => setActiveTab(tab as SkillTab)}>
                                {tab}
                            </Tag.CheckableTag>
                        ))}
                    </div>
                </div>

                <div className="mx-auto grid max-w-7xl gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredSkills.map((skill) => (
                        <SkillCard key={skill.id} skill={skill} onOpen={() => setSelectedSkillId(skill.id)} />
                    ))}
                </div>
                {filteredSkills.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到匹配的技能" className="py-16" /> : null}
            </main>

            <SkillDetailDrawer skill={selectedSkill} skillsById={skillsById} onClose={() => setSelectedSkillId(null)} onCopy={(prompt) => copyText(prompt, "提示词已复制")} onSelectSkill={setSelectedSkillId} />
        </div>
    );
}
