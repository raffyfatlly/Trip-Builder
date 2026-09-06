// How an agent message breaks into paragraphs and lists.
//
// Plain JS with no JSX, so it can be imported by a test as well as by the
// component that draws it. The drawing lives in components/Rich.js; the
// decisions about what IS a list live here.
//
// raffy, 2026-09-06: "Require bullet points, dashes, or numbered lists when
// presenting multiple items, strictly avoiding walls of raw text."
//
// Half of that rule is in the prompt. This is the other half: the agent was
// already told to use lists, and a numbered one came back as four naked
// paragraphs starting with digits, because only -/*/bullet was ever matched.
// Telling a model to format and then dropping the format on the floor is the
// worst of both.

export function parse(text) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let list = null;
  let listType = null;

  const flush = () => {
    if (list && list.length) blocks.push({ type: listType, items: list });
    list = null;
    listType = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    // "1." and "1)" both, because models write both. A bare year or a price
    // cannot start a list item: the digits must be followed by . or ) and a
    // space, which "2026 was the year" and "RM1,200 a night" never are.
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const numbered = !bullet && line.match(/^\s*\d{1,2}[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const want = bullet ? 'ul' : 'ol';
      // A list that changes marker mid-way is two lists.
      if (listType && listType !== want) flush();
      list = list || [];
      listType = want;
      list.push((bullet || numbered)[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push({ type: 'p', text: line });
  }
  flush();
  return blocks;
}
