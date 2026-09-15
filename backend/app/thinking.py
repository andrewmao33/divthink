import re

# Thinking summaries arrive as sections that each start with a bold heading
# line, e.g. "**Refining Trip Components**", followed by a paragraph of
# "I'm currently..." narration. Only the headings are shown to the user.
_HEADING = re.compile(r"^\*{1,2}([^*\n]+?)\*{1,2}[ \t]*$", re.MULTILINE)


def thought_headings(text: str) -> list[str]:
    """Return the bold section headings in a thinking summary, in order."""
    return [m.group(1).strip() for m in _HEADING.finditer(text)]
