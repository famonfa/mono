/** Print-ready page: the doc in a clean light layout, whatever the app's theme. */
const PRINT_CSS = `
  @page { margin: 22mm 20mm; }
  body { font: 11.5pt/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1b1b1f; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 26pt; line-height: 1.2; margin: 0 0 18pt; letter-spacing: -0.01em; }
  h2 { font-size: 17pt; margin: 22pt 0 8pt; }
  h3 { font-size: 13.5pt; margin: 18pt 0 6pt; }
  p, ul, ol, blockquote, table, pre { margin: 0 0 9pt; }
  ul, ol { padding-left: 20pt; }
  blockquote { border-left: 3px solid #d0d0d6; padding-left: 12pt; color: #5c5c66; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.9em; background: #f1f1f4; padding: 1pt 4pt; border-radius: 3pt; }
  pre { background: #f6f6f8; padding: 10pt; border-radius: 6pt; overflow: hidden; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d8d8de; padding: 5pt 8pt; text-align: left; vertical-align: top; }
  th { background: #f4f4f6; }
  img { max-width: 100%; }
  a { color: #4b55c0; }
  h1, h2, h3 { break-after: avoid; } tr, img, pre { break-inside: avoid; }
`;

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The editor's HTML, flattened for paper and Google Docs: checkboxes become ☐/☑ (neither keeps form
 * inputs) and the paragraphs it wraps list items and table cells in are unwrapped.
 */
function cleanBody(body: string) {
  const doc = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html");
  for (const box of doc.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
    const li = box.closest("li");
    if (li) li.style.listStyle = "none";
    box.replaceWith(doc.createTextNode(box.checked || box.hasAttribute("checked") ? "☑ " : "☐ "));
  }
  for (const p of doc.querySelectorAll("li > p, td > p, th > p")) {
    if (p.parentElement!.children.length === 1 || p === p.parentElement!.firstElementChild) p.replaceWith(...p.childNodes);
  }
  return doc.body.innerHTML;
}

export function pageDocument(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/"><title>${escape(title)}</title><style>${PRINT_CSS}</style></head><body>${title ? `<h1>${escape(title)}</h1>` : ""}${cleanBody(body)}</body></html>`;
}

/** Opens the system print dialog on the page alone ("Save as PDF" lives there). */
export function printToPdf(title: string, body: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = pageDocument(title, body);
  frame.onload = () => {
    const win = frame.contentWindow!;
    // Images must be in before printing, or they come out blank.
    const pending = [...win.document.images].filter((img) => !img.complete).map((img) => new Promise((r) => (img.onload = img.onerror = r)));
    void Promise.all(pending).then(() => {
      win.focus();
      win.print();
      window.setTimeout(() => frame.remove(), 1000);
    });
  };
  document.body.appendChild(frame);
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
