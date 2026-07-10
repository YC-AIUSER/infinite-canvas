import { AlertTriangle, Copy, ShieldAlert, Sparkles, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Drawer, Space, Tag, Tooltip, Typography } from "antd";

import { ZONE_GRADIENTS, type SkillCard as SkillCardData } from "@/pages/skills/skills-data";
import { SkillStatusBadge } from "./skill-status-badge";
import { formatUsageCount } from "./skill-card";

export function SkillDetailDrawer({ skill, skillsById, onClose, onCopy, onSelectSkill }: { skill: SkillCardData | null; skillsById: Map<string, SkillCardData>; onClose: () => void; onCopy: (prompt: string) => void; onSelectSkill: (id: string) => void }) {
    const navigate = useNavigate();
    return (
        <Drawer title={skill ? `[${skill.stage}] ${skill.name}` : undefined} open={Boolean(skill)} size="large" onClose={onClose}>
            {skill ? (
                <div className="space-y-6">
                    <div className="relative overflow-hidden rounded-xl p-5" style={{ backgroundImage: skill.gradient || ZONE_GRADIENTS[skill.zone] }}>
                        <div className="flex flex-wrap items-center gap-2">
                            <SkillStatusBadge status={skill.status} />
                            <Tag className="m-0 border-none bg-white/20 text-white">{skill.zone}</Tag>
                        </div>
                        <div className="mt-3 text-sm text-white/85">作者：{skill.author}</div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-white/75">
                            <Sparkles className="size-3.5" />
                            使用次数 {formatUsageCount(skill.usageCount)}
                        </div>
                    </div>

                    <SkillDetailSection title="解决的问题">
                        <p className="text-sm leading-6 text-stone-700 dark:text-stone-300">{skill.problem}</p>
                    </SkillDetailSection>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <SkillDetailSection title="输入">
                            <SkillDetailList items={skill.inputs} />
                        </SkillDetailSection>
                        <SkillDetailSection title="输出">
                            <SkillDetailList items={skill.outputs} />
                        </SkillDetailSection>
                    </div>

                    <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-red-700 dark:text-red-400">
                            <ShieldAlert className="size-4" />
                            必需参考资产
                        </div>
                        <div className="mt-2">
                            <SkillDetailList items={skill.refAssets} emptyText="无（该技能不依赖参考图）" textClassName="text-red-800 dark:text-red-300" />
                        </div>
                    </div>

                    {skill.steps && skill.steps.length > 0 ? (
                        <SkillDetailSection title="执行步骤">
                            <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                {skill.steps.map((step, index) => (
                                    <li key={index}>{step}</li>
                                ))}
                            </ol>
                        </SkillDetailSection>
                    ) : null}

                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="size-4" />
                            禁止事项
                        </div>
                        <div className="mt-2">
                            <SkillDetailList items={skill.forbidden} emptyText="无" textClassName="text-amber-800 dark:text-amber-300" />
                        </div>
                    </div>

                    {skill.quality && skill.quality.length > 0 ? (
                        <SkillDetailSection title="质量标准">
                            <SkillDetailList items={skill.quality} />
                        </SkillDetailSection>
                    ) : null}

                    <div className="grid gap-4 sm:grid-cols-2">
                        <SkillDetailSection title="上游技能">
                            <SkillTagList ids={skill.upstream} skillsById={skillsById} onSelectSkill={onSelectSkill} />
                        </SkillDetailSection>
                        <SkillDetailSection title="下游技能">
                            <SkillTagList ids={skill.downstream} skillsById={skillsById} onSelectSkill={onSelectSkill} />
                        </SkillDetailSection>
                    </div>

                    <Space wrap className="pt-2">
                        <Button type="primary" icon={<Copy className="size-4" />} disabled={!skill.prompt} onClick={() => skill.prompt && onCopy(skill.prompt)}>
                            复制提示词
                        </Button>
                        {skill.flow ? (
                            <Tooltip title="插入到最近使用的画布(没有则新建)">
                                <Button icon={<Workflow className="size-4" />} onClick={() => navigate(`/canvas?skill=${skill.id}`)}>
                                    在画布中使用
                                </Button>
                            </Tooltip>
                        ) : (
                            <Tooltip title="该技能仅支持复制提示词">
                                <Button disabled>在画布中使用</Button>
                            </Tooltip>
                        )}
                    </Space>
                </div>
            ) : null}
        </Drawer>
    );
}

function SkillDetailSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div>
            <Typography.Title level={5} className="!mb-2 !text-stone-900 dark:!text-stone-100">
                {title}
            </Typography.Title>
            {children}
        </div>
    );
}

function SkillDetailList({ items, emptyText = "无", textClassName = "text-stone-700 dark:text-stone-300" }: { items: string[]; emptyText?: string; textClassName?: string }) {
    if (!items || items.length === 0) {
        return <p className={`text-sm leading-6 ${textClassName}`}>{emptyText}</p>;
    }
    return (
        <ul className={`list-disc space-y-1 pl-5 text-sm leading-6 ${textClassName}`}>
            {items.map((item, index) => (
                <li key={index}>{item}</li>
            ))}
        </ul>
    );
}

function SkillTagList({ ids, skillsById, onSelectSkill }: { ids: string[]; skillsById: Map<string, SkillCardData>; onSelectSkill: (id: string) => void }) {
    if (!ids || ids.length === 0) {
        return <p className="text-sm text-stone-500 dark:text-stone-400">无</p>;
    }
    return (
        <div className="flex flex-wrap gap-1.5">
            {ids.map((id) => {
                const target = skillsById.get(id);
                if (!target) {
                    return (
                        <Tag key={id} className="m-0">
                            {id}
                        </Tag>
                    );
                }
                return (
                    <Tag key={id} className="m-0 cursor-pointer" color="blue" onClick={() => onSelectSkill(id)}>
                        {target.name}
                    </Tag>
                );
            })}
        </div>
    );
}
