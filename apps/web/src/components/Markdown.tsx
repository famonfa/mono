import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { fileUrl } from "../api";

export function Markdown({ taskId, children }: { taskId: string; children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url, key) => (key === "src" ? fileUrl(taskId, url.replace(/^\.\.\//, "")) : defaultUrlTransform(url))}
        components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
