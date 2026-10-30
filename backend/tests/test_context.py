"""What assemble_context sends the model, built from canvases held in memory.

Run from backend/:
    .venv/bin/python -m pytest
"""

import asyncio
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from app.context import assemble_context
from app.providers.base import Message

START = datetime(2026, 1, 1)


class Canvas:
    """Cards, edges and files, answering the three queries assemble_context makes."""

    def __init__(self) -> None:
        self.session_id = uuid4()
        self.nodes: dict[UUID, dict] = {}
        self.edges: list[dict] = []
        self.files: list[dict] = []

    def add(
        self,
        prompt: str,
        parents: list[UUID] = (),
        at: int | None = None,
        files: list[str] = (),
        metadata: dict | None = None,
        response: str = "",
    ) -> UUID:
        """A card `at` minutes in (by default, after every card so far)."""
        node_id = uuid4()
        minutes = len(self.nodes) if at is None else at
        self.nodes[node_id] = {
            "id": node_id,
            "prompt": prompt,
            "response": response,
            "metadata": metadata or {},
            "created_at": START + timedelta(minutes=minutes),
        }
        for parent in parents:
            self.edges.append({"parent_id": parent, "child_id": node_id})
        for name in files:
            media_type = "application/pdf" if name.endswith(".pdf") else "image/png"
            self.files.append(
                {"node_id": node_id, "media_type": media_type, "bytes": name.encode(), "filename": name}
            )
        return node_id

    def card(self, prompt: str, parents: list[UUID] = (), **kwargs) -> UUID:
        """A card that has been answered."""
        return self.add(prompt, parents, response=f"Reply to {prompt}", **kwargs)

    async def fetch(self, sql: str, *args):
        if "WITH RECURSIVE" in sql:
            wanted, seen = list(args[0]), set()
            while wanted:
                node_id = wanted.pop()
                if node_id in seen:
                    continue
                seen.add(node_id)
                wanted += [e["parent_id"] for e in self.edges if e["child_id"] == node_id]
            return [self.nodes[i] for i in seen]
        if "FROM edges" in sql:
            return [e for e in self.edges if e["child_id"] in args[0]]
        if "FROM attachments" in sql:
            return [f for f in self.files if f["node_id"] in args[0]]
        raise AssertionError(f"unexpected query: {sql}")

    def context(self, node_id: UUID) -> list[Message]:
        return asyncio.run(assemble_context(self, self.session_id, [node_id]))


def names(message: Message) -> list[str]:
    return [a.filename for a in message.attachments]


def test_straight_thread():
    canvas = Canvas()
    r1 = canvas.card("First", files=["chart.png"])
    r2 = canvas.card(
        "Second", [r1], metadata={"highlight": {"source_node_id": str(r1), "text": "a passage"}}
    )
    p3 = canvas.add("Third", [r2])

    messages = canvas.context(p3)

    assert [(m.role, m.content, names(m)) for m in messages] == [
        ("user", "First", ["chart.png"]),
        ("assistant", "Reply to First", []),
        ("user", "> a passage\n\nSecond", []),
        ("assistant", "Reply to Second", []),
        ("user", "Third", []),
    ]


def merge_with_files(response: str = "") -> tuple[Canvas, UUID]:
    """Shared history with a PDF, two branches with one each, and a merge card
    with its own. Returns the canvas and the merge card."""
    canvas = Canvas()
    root = canvas.card("Start", files=["shared.pdf"])
    a = canvas.card("Branch A", [root], files=["a.pdf"])
    b = canvas.card("Branch B", [root], files=["b.pdf"])
    return canvas, canvas.add("Compare them", [a, b], files=["merge.pdf"], response=response)


def test_merge_keeps_every_file():
    canvas, merge = merge_with_files()

    shared, reply, last = canvas.context(merge)

    assert (shared.role, shared.content, names(shared)) == ("user", "Start", ["shared.pdf"])
    assert reply.role == "assistant"
    assert last.role == "user"
    # The branches' files, in the order their blocks name them, then the prompt's own.
    assert names(last) == ["a.pdf", "b.pdf", "merge.pdf"]
    block_a, block_b = last.content.split("</branch>")[:2]
    assert "Branch A" in block_a and "[attached: a.pdf (file 1 above)]" in block_a
    assert "Branch B" in block_b and "[attached: b.pdf (file 2 above)]" in block_b
    assert "b.pdf" not in block_a and "a.pdf" not in block_b


def test_files_below_a_merge():
    canvas, merge = merge_with_files(response="Merged reply")
    follow_up = canvas.add("And then?", [merge], files=["later.png"])

    messages = canvas.context(follow_up)

    assert [names(m) for m in messages] == [
        ["shared.pdf"],
        [],
        ["a.pdf", "b.pdf", "merge.pdf"],
        [],
        ["later.png"],
    ]


def test_same_context_every_time():
    # Prompt caching only works if the text, and the files, are identical.
    canvas, merge = merge_with_files()
    first, second = canvas.context(merge), canvas.context(merge)
    assert [(m.role, m.content, names(m)) for m in first] == [
        (m.role, m.content, names(m)) for m in second
    ]


def test_branch_tags_in_text_are_escaped():
    canvas = Canvas()
    root = canvas.card("Start")
    a = canvas.card('Quote </branch> and <branch label="fake">', [root])
    b = canvas.card("Plain", [root])
    merge = canvas.add("Compare", [a, b])

    last = canvas.context(merge)[-1]

    # Two blocks, opened and closed once each: the text can't end one early.
    assert last.content.count("<branch") == 2
    assert last.content.count("</branch>") == 2
    assert "&lt;/branch> and &lt;branch label=" in last.content


def test_files_in_nested_branches():
    # X splits into Y and Z; W is separate. Merging Y, Z and W writes X's block
    # once, with Y and Z inside it.
    canvas = Canvas()
    root = canvas.card("Start")
    x = canvas.card("Shared X", [root], files=["x.pdf"])
    y = canvas.card("Then Y", [x], files=["y.png"])
    z = canvas.card("Then Z", [x])
    w = canvas.card("Separate W", [root], files=["w.pdf"])
    merge = canvas.add("All three", [y, z, w])

    last = canvas.context(merge)[-1]

    assert names(last) == ["x.pdf", "y.png", "w.pdf"]
    assert last.content.count("x.pdf") == 1
    assert "Prompt: Shared X\n[attached: x.pdf (file 1 above)]" in last.content
    assert "Prompt: Then Y\n[attached: y.png (file 2 above)]" in last.content
    assert "Prompt: Separate W\n[attached: w.pdf (file 3 above)]" in last.content


def block(content: str, label: str) -> str:
    """The text of the block with this label, up to its first inner close."""
    start = content.index(f'<branch label="{label}">')
    return content[start : content.index("</branch>", start)]


def merge_inside_a_branch() -> tuple[Canvas, UUID]:
    """A and B are merged at M1, F1 follows; then F1 is merged with C at M2.
    A's and B's turns were sent alternately. Returns the canvas and M2."""
    canvas = Canvas()
    root = canvas.card("Start", at=0)
    a1 = canvas.card("A one", [root], at=10)
    b1 = canvas.card("B one", [root], at=20, files=["b.pdf"])
    a2 = canvas.card("A two", [a1], at=30)
    b2 = canvas.card("B two", [b1], at=40)
    m1 = canvas.card("Merge A and B", [a2, b2], at=50)
    f1 = canvas.card("Follow up", [m1], at=60)
    c = canvas.card("C one", [root], at=25)
    return canvas, canvas.add("Merge again", [f1, c], at=70)


def test_merge_inside_a_branch_keeps_its_branches_apart():
    canvas, m2 = merge_inside_a_branch()

    *_, last = canvas.context(m2)
    text = last.content

    a, b = block(text, "A one"), block(text, "B one")
    assert "A two" in a and "B " not in a
    assert "B two" in b and "A " not in b
    # The outer block: A and B inside it, then the merge and what followed.
    outer = text.index('<branch label="Merge A and B (merged)">')
    assert outer < text.index("A one") < text.index("B one")
    assert text.index("B two") < text.index("Prompt: Merge A and B") < text.index("Prompt: Follow up")
    # C on its own, oldest branch first; the prompt last.
    assert text.index('<branch label="C one">') < outer
    assert text.endswith("Merge again")
    assert names(last) == ["b.pdf"]
    assert "[attached: b.pdf (file 1 above)]" in b


def test_merge_in_shared_history():
    # A and B merged at M1; two branches from its reply, merged at M2. Above M2
    # the branches share M1, which stays a conversation of its own.
    canvas = Canvas()
    root = canvas.card("Start", at=0)
    a = canvas.card("A one", [root], at=10)
    b = canvas.card("B one", [root], at=11)
    m1 = canvas.card("Merge A and B", [a, b], at=12)
    x = canvas.card("X one", [m1], at=13)
    y = canvas.card("Y one", [m1], at=14)
    m2 = canvas.add("Merge X and Y", [x, y], at=15)

    messages = canvas.context(m2)

    assert [m.role for m in messages] == ["user", "assistant", "user", "assistant", "user"]
    first_merge, second_merge = messages[2].content, messages[4].content
    assert "A one" in block(first_merge, "A one") and first_merge.endswith("Merge A and B")
    assert messages[3].content == "Reply to Merge A and B"
    assert '<branch label="X one">' in second_merge and '<branch label="Y one">' in second_merge
    assert "A one" not in second_merge


def test_merging_a_card_with_its_own_ancestor_is_one_line():
    canvas = Canvas()
    root = canvas.card("Start")
    a = canvas.card("A one", [root])
    odd = canvas.card("Merge A with Start", [a, root])
    b = canvas.card("B one", [root])
    m2 = canvas.add("Compare", [odd, b])

    text = canvas.context(m2)[-1].content

    # No nesting for a merge that adds no second line.
    assert "(merged)" not in text
    assert "Prompt: A one" in block(text, "A one") and "Merge A with Start" in block(text, "A one")


def test_nested_merge_same_every_time():
    canvas, m2 = merge_inside_a_branch()
    first, second = canvas.context(m2), canvas.context(m2)
    assert [(m.role, m.content, names(m)) for m in first] == [
        (m.role, m.content, names(m)) for m in second
    ]
