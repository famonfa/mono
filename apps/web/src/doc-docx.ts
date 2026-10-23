import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ParagraphChild } from "docx";

/** The slice of a BlockNote block the export reads. */
type Styles = { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean };
type Inline = { type: "text"; text: string; styles?: Styles } | { type: "link"; href: string; content: Inline[] };
type Cell = Inline[] | { type: "tableCell"; content: Inline[] };
type Block = {
  type: string;
  props?: Record<string, unknown>;
  content?: Inline[] | { type: "tableContent"; rows: { cells: Cell[] }[] };
  children?: Block[];
};

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const MAX_IMAGE_WIDTH = 600;

function runs(content: Inline[] = [], extra: Styles = {}): ParagraphChild[] {
  return content.flatMap((item): ParagraphChild[] => {
    if (item.type === "link") return [new ExternalHyperlink({ link: item.href, children: runs(item.content, extra).map((r) => (r instanceof TextRun ? r : r)) as TextRun[] })];
    const s = { ...extra, ...item.styles };
    return [
      new TextRun({
        text: item.text,
        bold: s.bold,
        italics: s.italic,
        underline: s.underline ? {} : undefined,
        strike: s.strike,
        ...(s.code ? { font: "Courier New", shading: { type: ShadingType.CLEAR, fill: "F1F1F4", color: "auto" } } : {}),
      }),
    ];
  });
}

async function image(url: string): Promise<ImageRun | null> {
  try {
    const res = await fetch(new URL(url, location.origin));
    if (!res.ok) return null;
    const blob = await res.blob();
    const type = blob.type.includes("png") ? "png" : blob.type.includes("gif") ? "gif" : blob.type.includes("bmp") ? "bmp" : blob.type.includes("jpeg") || blob.type.includes("jpg") ? "jpg" : null;
    if (!type) return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_IMAGE_WIDTH / bitmap.width);
    return new ImageRun({ type, data: await blob.arrayBuffer(), transformation: { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) } });
  } catch {
    return null;
  }
}

/** Blocks → Word paragraphs and tables; nested children become indented list levels. */
async function convert(blocks: Block[], level = 0): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [];
  for (const block of blocks) {
    const props = block.props ?? {};
    const inline = Array.isArray(block.content) ? block.content : [];
    switch (block.type) {
      case "heading":
        out.push(new Paragraph({ heading: HEADINGS[Math.min(5, Number(props.level ?? 1) - 1)], children: runs(inline) }));
        break;
      case "bulletListItem":
        out.push(new Paragraph({ bullet: { level }, children: runs(inline) }));
        break;
      case "numberedListItem":
        out.push(new Paragraph({ numbering: { reference: "numbered", level }, children: runs(inline) }));
        break;
      case "checkListItem":
        out.push(new Paragraph({ indent: { left: 360 * (level + 1) }, children: [new TextRun(props.checked ? "☑ " : "☐ "), ...runs(inline, props.checked ? { strike: true } : {})] }));
        break;
      case "quote":
        out.push(new Paragraph({ indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "C8C8D0", space: 8 } }, children: runs(inline, { italic: true }) }));
        break;
      case "codeBlock":
        for (const line of inline.map((i) => (i.type === "text" ? i.text : "")).join("").split("\n")) {
          out.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: "F6F6F8", color: "auto" }, children: [new TextRun({ text: line || " ", font: "Courier New", size: 20 })] }));
        }
        break;
      case "table": {
        const table = block.content && !Array.isArray(block.content) ? block.content : null;
        if (!table) break;
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: table.rows.map(
              (row, r) =>
                new TableRow({
                  children: row.cells.map((cell) => {
                    const content = Array.isArray(cell) ? cell : cell.content;
                    return new TableCell({ children: [new Paragraph({ children: runs(content, r === 0 ? { bold: true } : {}) })], ...(r === 0 ? { shading: { type: ShadingType.CLEAR, fill: "F4F4F6", color: "auto" } } : {}) });
                  }),
                }),
            ),
          }),
        );
        break;
      }
      case "image": {
        const run = props.url ? await image(String(props.url)) : null;
        if (run) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run] }));
        if (props.caption) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(props.caption), italics: true, size: 18 })] }));
        break;
      }
      default:
        out.push(new Paragraph({ children: runs(inline) }));
    }
    if (block.children?.length) out.push(...(await convert(block.children, level + 1)));
  }
  return out;
}

/** The doc as a .docx (Word, Pages, or Google Docs when uploaded to Drive). */
export async function toDocx(title: string, blocks: unknown[]): Promise<Blob> {
  const body = await convert(blocks as Block[]);
  const doc = new Document({
    creator: "Mono",
    title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: "numbered",
          levels: [0, 1, 2, 3, 4].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } } })),
        },
      ],
    },
    sections: [{ children: [...(title ? [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] })] : []), ...body] }],
  });
  return Packer.toBlob(doc);
}
