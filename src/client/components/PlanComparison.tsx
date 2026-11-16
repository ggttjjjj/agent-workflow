import type { Plan, Requirement } from "../../shared/domain";
import { comparePlans } from "../../shared/compare";

const kinds = { added: "新增", removed: "删除", changed: "修改" };
const show = (value: unknown) =>
  value === undefined
    ? "（无）"
    : typeof value === "string"
      ? value || "（空文本）"
      : JSON.stringify(value, null, 2);
export default function PlanComparison({
  before,
  after,
  oldRequirement,
  newRequirement,
}: {
  before: Plan;
  after: Plan;
  oldRequirement?: Requirement;
  newRequirement?: Requirement;
}) {
  const groups = comparePlans(before, after, oldRequirement, newRequirement);
  const changes = groups.flatMap((g) => g.changes);
  return (
    <section aria-label="候选结构化差异" className="plan-comparison">
      <p>
        对比基线为当前已保存方案，不含未保存草稿。新增{" "}
        {changes.filter((c) => c.kind === "added").length} · 删除{" "}
        {changes.filter((c) => c.kind === "removed").length} · 修改{" "}
        {changes.filter((c) => c.kind === "changed").length}
      </p>
      <div className="compare-grid requirement-comparison">
        <section>
          <h3>当前需求原文 v{before.requirementVersion}</h3>
          <pre>{oldRequirement?.text || "（无文本）"}</pre>
          <p>
            参考图片：
            {oldRequirement?.images.map((i) => i.name).join("、") || "无"}
          </p>
        </section>
        <section>
          <h3>候选需求原文 v{after.requirementVersion}</h3>
          <pre>{newRequirement?.text || "（无文本）"}</pre>
          <p>
            参考图片：
            {newRequirement?.images.map((i) => i.name).join("、") || "无"}
          </p>
        </section>
      </div>
      {groups.map((g) => (
        <section className="change-group" key={g.title}>
          <h3>
            {g.title} · {g.changes.length} 项变更
          </h3>
          {!g.changes.length ? (
            <p className="hint">无变化</p>
          ) : (
            g.changes.map((c, i) => (
              <article className={`change-item change-${c.kind}`} key={i}>
                <h4>
                  <span className="tag">{kinds[c.kind]}</span> {c.label}
                </h4>
                <div className="compare-grid">
                  <section>
                    <strong>原内容</strong>
                    <pre>{show(c.before)}</pre>
                  </section>
                  <section>
                    <strong>候选内容</strong>
                    <pre>{show(c.after)}</pre>
                  </section>
                </div>
              </article>
            ))
          )}
        </section>
      ))}
    </section>
  );
}
