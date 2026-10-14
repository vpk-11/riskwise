import { escapeHtml, getCategoryIcon } from "./riskUtils";

/** Popup body for a disruption point. Every feed-derived value is HTML-escaped. */
export function popupHTML(props: Record<string, string>) {
  const color = /^#[0-9a-f]{6}$/i.test(props.color ?? "") ? props.color : "#888";
  const description = props.description ?? "";
  return `
    <div style="
      background: #0d1a2a;
      border: 1px solid ${color}55;
      border-radius: 6px;
      padding: 14px 16px;
      max-width: 280px;
      min-width: 220px;
      font-family: 'Share Tech Mono', monospace;
      color: #c8dce8;
    ">
      <div style="color:${color};font-size:10px;letter-spacing:2px;margin-bottom:6px;text-transform:uppercase;">
        ${getCategoryIcon(props.category)} ${escapeHtml(props.category ?? "")}
      </div>
      <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#e8f4f8;line-height:1.3;">
        ${escapeHtml(props.title ?? "")}
      </div>
      <div style="font-size:11px;color:#7a9ab0;line-height:1.6;margin-bottom:10px;">
        ${escapeHtml(description.slice(0, 130))}${description.length > 130 ? "…" : ""}
      </div>
      <span style="
        display:inline-block;
        background:${color}22;
        border:1px solid ${color}55;
        border-radius:3px;
        padding:2px 8px;
        font-size:10px;
        color:${color};
        letter-spacing:1.5px;
        text-transform:uppercase;
      ">● SEVERITY: ${escapeHtml(props.severity ?? "")}</span>
    </div>`;
}
