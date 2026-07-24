export type Module4IssueCode =
    | "missing-section"
    | "section-order"
    | "storyline-opening"
    | "timecode"
    | "shot-number"
    | "locked-camera"
    | "metaphor"
    | "shot-list"
    | "bgm-length";

export type Module4Issue = {
    code: Module4IssueCode;
    message: string;
};

export type Module4ValidationResult =
    | { ok: true; issues: [] }
    | { ok: false; issues: Module4Issue[] };

const SECTION_TITLES = ["参考图索引", "故事线", "Tone", "BGM衔接", "风格", "画面要求"] as const;
const STORYLINE_OPENING = "按故事板镜头顺序自然推进";

function sectionPattern(index: number, title: string) {
    return new RegExp(`^\\s*${index}\\.\\s*${title}\\s*$`, "m");
}

function sectionBody(text: string, index: number, title: string) {
    const current = sectionPattern(index, title).exec(text);
    if (!current) return "";
    const start = (current.index ?? 0) + current[0].length;
    const nextTitle = SECTION_TITLES[index];
    if (!nextTitle) return text.slice(start).trim();
    const next = sectionPattern(index + 1, nextTitle).exec(text.slice(start));
    return text.slice(start, next ? start + (next.index ?? 0) : undefined).trim();
}

function pushIssue(issues: Module4Issue[], code: Module4IssueCode, message: string) {
    if (!issues.some((issue) => issue.code === code && issue.message === message)) issues.push({ code, message });
}

// 禁词裁决（2026-07-24，方法论内部冲突按意图收窄，与第二块「skill 冲突按意图裁决并记录」同一先例）：
// 06 §2.5/§2.6 字面禁「固定」「像」，但同一 skill 的封闭词库有合法词条「固定位微动」「固定镜头长拍」，
// 布光库 usage 高频出现「肖像/人像」——裸字拦截会把库内逐字选取（铁律 3）判死。故：
// ① 锁镜类只拦机位语义的完整词组；② 比喻只拦比喻句式，其余五个比喻词无合成词歧义仍裸拦。
const LOCKED_CAMERA_PATTERN = /(固定机位|机位固定|静止机位|静态机位|静态镜头|锁机|定格|静止不动|一动不动)/;
const METAPHOR_PATTERN = /(仿佛|犹如|好似|宛如|如同|就像|好像|活像|像是|像.{0,12}?(?:一样|般))/;

export function validateModule4(text: string): Module4ValidationResult {
    const normalized = text.trim();
    const issues: Module4Issue[] = [];
    const sectionIndexes: number[] = [];

    SECTION_TITLES.forEach((title, offset) => {
        const index = offset + 1;
        const match = sectionPattern(index, title).exec(normalized);
        if (!match) pushIssue(issues, "missing-section", `缺少第${index}段“${title}”`);
        else sectionIndexes.push(match.index ?? 0);
    });
    if (sectionIndexes.length === SECTION_TITLES.length && sectionIndexes.some((value, index) => index > 0 && value <= sectionIndexes[index - 1])) {
        pushIssue(issues, "section-order", "六段顺序必须是参考图索引→故事线→Tone→BGM衔接→风格→画面要求");
    }

    const storyline = sectionBody(normalized, 2, "故事线");
    if (storyline && !storyline.startsWith(STORYLINE_OPENING)) {
        pushIssue(issues, "storyline-opening", `故事线必须以“${STORYLINE_OPENING}”开头`);
    }

    // 禁词只审模型创作的 2/3/4 段。第 1/5/6 段是模板所有权（finalizeModule4Text 收口重写），
    // 内插的锁定表布光中文、风格串属用户既定内容——跑全文会被「肖像」这类合法词永久卡死。
    const modelBody = [storyline, sectionBody(normalized, 3, "Tone"), sectionBody(normalized, 4, "BGM衔接")].join("\n");
    if (/\[\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*秒\s*\]/.test(modelBody)) pushIssue(issues, "timecode", "禁止使用[N-N秒]时间码");
    if (/\bShot\s*\d+\b/i.test(modelBody) || /\bT\d+\b/i.test(modelBody)) pushIssue(issues, "shot-number", "禁止暴露Shot/Tn编号");
    if (LOCKED_CAMERA_PATTERN.test(modelBody)) pushIssue(issues, "locked-camera", "禁止使用固定机位、锁机、静态机位或定格类表述");
    if (METAPHOR_PATTERN.test(modelBody)) pushIssue(issues, "metaphor", "禁止使用比喻句式：仿佛、犹如、好似、宛如、如同、就像、好像、像…一样");
    if (/^\s*[-–—]\s+/m.test(modelBody) || /^\s*第[一二三四五六七八九十百\d]+镜/m.test(modelBody)) pushIssue(issues, "shot-list", "禁止按逐镜列表分条输出");

    const bgm = sectionBody(normalized, 4, "BGM衔接");
    if (bgm.length > 200) pushIssue(issues, "bgm-length", "BGM衔接不得超过200字");

    return issues.length ? { ok: false, issues } : { ok: true, issues: [] };
}
