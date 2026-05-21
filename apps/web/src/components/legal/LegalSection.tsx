// Shared section renderer for /terms and /privacy. The body grammar is
// plain text with blank-line paragraph separators and `- ` bullets.

export type LegalSection = {
  id: string;
  number: string;
  title: string;
  body: string;
};

type Block = { type: "paragraph"; text: string } | { type: "list"; items: string[] };

export function parseLegalBody(body: string): Block[] {
  const paragraphs = body.split(/\n\n+/);
  const blocks: Block[] = [];
  for (const para of paragraphs) {
    const lines = para.split("\n");
    const isList = lines.every((l) => l.trim().startsWith("- "));
    if (isList && lines.length > 0) {
      blocks.push({
        type: "list",
        items: lines.map((l) => l.trim().replace(/^- /, "")),
      });
    } else {
      const buffer: string[] = [];
      const flushBuffer = () => {
        if (buffer.length > 0) {
          blocks.push({ type: "paragraph", text: buffer.join(" ").trim() });
          buffer.length = 0;
        }
      };
      let listItems: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("- ")) {
          flushBuffer();
          listItems.push(trimmed.replace(/^- /, ""));
        } else {
          if (listItems.length > 0) {
            blocks.push({ type: "list", items: listItems });
            listItems = [];
          }
          if (trimmed.length > 0) buffer.push(trimmed);
        }
      }
      if (listItems.length > 0) blocks.push({ type: "list", items: listItems });
      flushBuffer();
    }
  }
  return blocks;
}

export function LegalSectionBlock({ section }: { section: LegalSection }) {
  const blocks = parseLegalBody(section.body);
  return (
    <section id={section.id} className="scroll-mt-24">
      <h2 className="text-xl font-semibold text-white sm:text-2xl">
        {section.number}. {section.title}
      </h2>
      <div className="mt-3 space-y-4 text-sm leading-relaxed text-text-secondary sm:text-base">
        {blocks.map((block, idx) =>
          block.type === "paragraph" ? (
            <p key={`${section.id}-p-${idx}`}>{block.text}</p>
          ) : (
            <ul
              key={`${section.id}-ul-${idx}`}
              className="list-disc space-y-1.5 pl-5 marker:text-gold/60"
            >
              {block.items.map((item, i) => (
                <li key={`${section.id}-li-${idx}-${i}`}>{item}</li>
              ))}
            </ul>
          ),
        )}
      </div>
    </section>
  );
}
