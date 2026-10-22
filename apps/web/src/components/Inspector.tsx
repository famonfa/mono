import type { ReactNode } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { fileUrl } from "../api";
import { NODE_TYPE_LABEL } from "../nodes";
import { CHANGE_STATUS, TEST_STATUS, type ChangeStatus, type NodeData, type TestStatus, type Task, type WsEdge, type WsNode } from "../types";
import { Menu } from "../ui";

const SWATCHES = ["", "#fef3c7", "#dcfce7", "#dbeafe", "#fce7f3", "#ede9fe", "#fee2e2", "#e2e8f0"];
const NONE = "__none";

type Props = {
  task: Task;
  node?: WsNode;
  edge?: WsEdge;
  onNodeChange: (id: string, patch: Partial<NodeData>, top?: Partial<WsNode>) => void;
  onEdgeChange: (id: string, patch: Partial<WsEdge>) => void;
  onDelete: () => void;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="prop">
      <span className="prop-label">{label}</span>
      {children}
    </div>
  );
}

const dot = (color: string) => <i className="dot" style={{ background: color }} />;

export function Inspector({ task, node, edge, onNodeChange, onEdgeChange, onDelete }: Props) {
  if (node) {
    const d = node.data;
    const set = (patch: Partial<NodeData>) => onNodeChange(node.id, patch);
    const isLane = node.type === "lane";
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <Menu
            value={node.type}
            options={Object.entries(NODE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            onChange={(type) => onNodeChange(node.id, {}, { type })}
            className="chip-trigger"
          >
            {NODE_TYPE_LABEL[node.type ?? "card"]}
          </Menu>
          <span className="spacer" />
          <button className="icon-btn danger" onClick={onDelete} title="Borrar (Backspace)">
            <Trash2 size={14} />
          </button>
        </div>

        <textarea className="inspector-title" rows={2} value={d.label ?? ""} placeholder="Título" onChange={(e) => set({ label: e.target.value })} autoFocus />
        <textarea className="inspector-detail" rows={4} value={d.detail ?? ""} placeholder="Agregar detalle…" onChange={(e) => set({ detail: e.target.value || undefined })} />

        <div className="prop-group">
          {!isLane && (
            <>
              <Row label="Cambio">
                <Menu
                  value={d.status ?? NONE}
                  options={[{ value: NONE, label: "Sin estado", icon: dot("var(--text-4)") }, ...Object.entries(CHANGE_STATUS).map(([v, s]) => ({ value: v, label: s.label, icon: dot(s.color) }))]}
                  onChange={(v) => set({ status: v === NONE ? undefined : (v as ChangeStatus) })}
                  className="prop-value"
                >
                  {d.status ? (
                    <>
                      {dot(CHANGE_STATUS[d.status].color)} {CHANGE_STATUS[d.status].label}
                    </>
                  ) : (
                    <span className="muted">Sin estado</span>
                  )}
                </Menu>
              </Row>
              <Row label="Testeo">
                <Menu
                  value={d.test ?? NONE}
                  options={[{ value: NONE, label: "No aplica" }, ...Object.entries(TEST_STATUS).map(([v, t]) => ({ value: v, label: t.label, icon: <span style={{ color: t.color }}>{t.icon}</span> }))]}
                  onChange={(v) => set({ test: v === NONE ? undefined : (v as TestStatus) })}
                  className="prop-value"
                >
                  {d.test ? (
                    <>
                      <span style={{ color: TEST_STATUS[d.test].color }}>{TEST_STATUS[d.test].icon}</span> {TEST_STATUS[d.test].label}
                    </>
                  ) : (
                    <span className="muted">No aplica</span>
                  )}
                </Menu>
              </Row>
              <Row label="Repo">
                <input
                  className="prop-input"
                  list="repos"
                  value={d.repo ?? ""}
                  placeholder="—"
                  onChange={(e) => set({ repo: e.target.value || undefined })}
                />
                <datalist id="repos">
                  {[...new Set(["instamenu", "instamenu-api", "KDS", ...(task.repos ?? []).map((r) => r.name)])].map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </Row>
              {task.assets.length > 0 && (
                <Row label="Imagen">
                  <Menu
                    value={d.image ?? NONE}
                    options={[{ value: NONE, label: "Sin imagen" }, ...task.assets.map((a) => ({ value: `assets/${a}`, label: a }))]}
                    onChange={(v) => set({ image: v === NONE ? undefined : v })}
                    className="prop-value"
                  >
                    {d.image ? d.image.replace("assets/", "") : <span className="muted">Sin imagen</span>}
                  </Menu>
                </Row>
              )}
            </>
          )}
          <Row label="Link">
            <input className="prop-input" value={d.link ?? ""} placeholder="https://…" onChange={(e) => set({ link: e.target.value || undefined })} />
            {d.link && (
              <a className="icon-btn tiny" href={d.link} target="_blank" rel="noreferrer">
                <ExternalLink size={12} />
              </a>
            )}
          </Row>
          <Row label="Color">
            <div className="swatches">
              {SWATCHES.map((c) => (
                <button
                  key={c || "none"}
                  className={`swatch ${(d.color ?? "") === c ? "active" : ""} ${c ? "" : "none"}`}
                  style={c ? { background: c } : undefined}
                  onClick={() => set({ color: c || undefined })}
                />
              ))}
            </div>
          </Row>
        </div>

        {d.image && <img className="inspector-thumb" src={fileUrl(task.id, d.image)} alt="" />}

        {node.type === "card" && (
          <div className="inspector-files">
            <span className="prop-label">Archivos</span>
            <textarea
              rows={3}
              className="mono"
              placeholder="un archivo por línea"
              value={(d.files ?? []).join("\n")}
              onChange={(e) => set({ files: e.target.value ? e.target.value.split("\n") : undefined })}
            />
          </div>
        )}

        {d.edited && <p className="hint">Editado a mano — la IA no va a pisar este nodo.</p>}
      </aside>
    );
  }

  if (edge) {
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <span className="chip-trigger static">Conexión</span>
          <span className="spacer" />
          <button className="icon-btn danger" onClick={onDelete} title="Borrar">
            <Trash2 size={14} />
          </button>
        </div>
        <textarea
          className="inspector-title"
          rows={1}
          placeholder="Etiqueta de la conexión"
          value={String(edge.label ?? "")}
          onChange={(e) => onEdgeChange(edge.id, { label: e.target.value || undefined })}
          autoFocus
        />
        <label className="check">
          <input type="checkbox" checked={Boolean(edge.data?.dashed)} onChange={(e) => onEdgeChange(edge.id, { data: { ...edge.data, dashed: e.target.checked } })} />
          Punteada — opcional / alternativa
        </label>
        <label className="check">
          <input type="checkbox" checked={Boolean(edge.animated)} onChange={(e) => onEdgeChange(edge.id, { animated: e.target.checked })} />
          Animada — camino principal
        </label>
      </aside>
    );
  }

  return null;
}
