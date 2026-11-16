import type { Plan, Task, Requirement } from "../../shared/domain";

export default function Inspector({
  plan,
  req,
  task,
  onChange,
  onDelete,
}: {
  plan: Plan;
  req: Requirement;
  task?: Task;
  onChange: (t: Task) => void;
  onDelete: () => void;
}) {
  if (!task)
    return (
      <aside className="inspector">
        <h3>任务详情</h3>
        <p className="hint">选择画布节点查看详情。</p>
      </aside>
    );
  const dependents = plan.pm.tasks.filter((x) => x.dependsOn.includes(task.id));
  const field = (key: "title" | "goal") => (
    <label className="field">
      {key === "title" ? "任务标题" : "任务目标"}
      <textarea
        aria-label={key === "title" ? "任务标题" : "任务目标"}
        rows={key === "title" ? 2 : 3}
        value={task[key]}
        onChange={(e) => onChange({ ...task, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <aside className="inspector">
      <div className="section-title">
        <h3>任务详情</h3>
        <small>{task.id}</small>
      </div>
      <section className="task-section task-basics"><h4>基本信息</h4>
      {field("title")}
      {field("goal")}
      <label className="field">
        主要负责 Agent
        <select
          value={task.agentId}
          onChange={(e) =>
            onChange({
              ...task,
              agentId: e.target.value,
            })
          }
        >
          <option value="">请选择</option>
          {plan.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      </section><section className="task-section"><h4>输出与完成条件</h4>
      {(["outputs", "done"] as const).map((k) => (
        <label key={k} className="field">
          {k === "outputs" ? "预期输出（每行一项）" : "完成条件（每行一项）"}
          <textarea
            rows={3}
            value={task[k].join("\n")}
            onChange={(e) =>
              onChange({ ...task, [k]: e.target.value.split("\n") })
            }
          />
        </label>
      ))}
      </section><section className="task-section"><h4>依赖与输入</h4>
      <div className="field">
        <span>前置依赖</span>
        <div className="checks">
          {plan.pm.tasks
            .filter((x) => x.id !== task.id)
            .map((x) => (
              <label key={x.id}>
                <input
                  type="checkbox"
                  checked={task.dependsOn.includes(x.id)}
                  onChange={(e) =>
                    onChange({
                      ...task,
                      dependsOn: e.target.checked
                        ? [...task.dependsOn, x.id]
                        : task.dependsOn.filter((id) => id !== x.id),
                    })
                  }
                />
                {x.title}
              </label>
            ))}
        </div>
      </div>
      <div className="field">
        <span>输入来源</span>
        <div className="inputs">
          {task.inputs.map((input, i) => (
            <div key={i}>
              <select
                aria-label={"输入来源" + i}
                value={JSON.stringify(input)}
                onChange={(e) =>
                  onChange({
                    ...task,
                    inputs: task.inputs.map((x, j) =>
                      j === i ? JSON.parse(e.target.value) : x,
                    ),
                  })
                }
              >
                <option value={JSON.stringify(input)}>
                  {input.kind}: {input.ref}
                  {input.output ? "." + input.output : ""}
                </option>
                <option
                  value={JSON.stringify({ kind: "requirement", ref: "spec" })}
                >
                  原始需求
                </option>
                {req.images.map((x) => (
                  <option
                    key={x.id}
                    value={JSON.stringify({
                      kind: "image",
                      ref: x.id,
                    })}
                  >
                    图片：{x.name}
                  </option>
                ))}
                {plan.pm.tasks
                  .filter((x) => task.dependsOn.includes(x.id))
                  .flatMap((x) =>
                    x.outputs.map((o) => (
                      <option
                        key={x.id + o}
                        value={JSON.stringify({
                          kind: "task",
                          ref: x.id,
                          output: o,
                        })}
                      >
                        {x.id}.{o}
                      </option>
                    )),
                  )}
              </select>
              <button
                aria-label="移除输入"
                onClick={() =>
                  onChange({
                    ...task,
                    inputs: task.inputs.filter((_, j) => j !== i),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      <button
        className="small"
        onClick={() =>
          onChange({
            ...task,
            inputs: [...task.inputs, { kind: "requirement", ref: "spec" }],
          })
        }
      >
        ＋ 添加输入
      </button>
      </section><section className="task-section"><h4>验收要求</h4>
      <div className="field">
        <span>关联验收要求</span>
        <div className="checks">
          {plan.pm.criteria.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={task.criteria.includes(c.id)}
                onChange={(e) =>
                  onChange({
                    ...task,
                    criteria: e.target.checked
                      ? [...task.criteria, c.id]
                      : task.criteria.filter((id) => id !== c.id),
                  })
                }
              />
              {c.text}
            </label>
          ))}
        </div>
      </div></section>
      <button className="danger" onClick={onDelete}>
        删除任务
      </button>
      {dependents.length > 0 && (
        <p className="hint">删除后 {dependents.length} 项下游依赖会被移除。</p>
      )}
    </aside>
  );
}
