# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Turn the local markdown issue tracker (.scratch/) into a single HTML board.

Usage:
    uv run scripts/issues.py                      # writes .scratch/board.html and opens it
    uv run scripts/issues.py --no-open
    uv run scripts/issues.py -s ready-for-agent   # only tickets with this status
    uv run scripts/issues.py -f voice -o out.html # features containing "voice", custom output
"""

import argparse
import html
import re
import webbrowser
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

DONE_STATUSES = {"resolved", "done", "closed", "wontfix"}
STATUS_ORDER = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "claimed", "resolved", "done", "closed", "wontfix"]

STATUS_RE = re.compile(r"^\W*Status\W*[:：]\W*(?P<v>[\w-]+)", re.IGNORECASE | re.MULTILINE)
TYPE_RE = re.compile(r"^\W*Type\W*[:：]\W*(?P<v>[\w-]+)", re.IGNORECASE | re.MULTILINE)
BLOCKED_INLINE_RE = re.compile(r"^\W*Blocked by\W*[:：]\W*(?P<v>.+)$", re.IGNORECASE | re.MULTILINE)
BLOCKED_SECTION_RE = re.compile(r"^##\s*Blocked by\s*\n(?P<v>.*?)(?=^#|\Z)", re.IGNORECASE | re.MULTILINE | re.DOTALL)
TITLE_RE = re.compile(r"^#\s+(?:(?P<n>\d+)\s*[:.\-]\s*)?(?P<t>.+)$", re.MULTILINE)
CHECKBOX_RE = re.compile(r"^\s*[-*]\s+\[(?P<c>[ xX])\]", re.MULTILINE)
NUMBER_RE = re.compile(r"\b(\d{1,3})\b")

CSS = """
:root{--bg:#f6f7f9;--card:#fff;--text:#1c2024;--muted:#6b7480;--line:#e2e5ea;--accent:#3b6df0;--ok:#1f9d55;--warn:#d9480f}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--card:#1d2026;--text:#e8eaed;--muted:#98a1ad;--line:#2d323a;--accent:#7a9bff;--ok:#3ecf7b;--warn:#ff8a4c}}
*{box-sizing:border-box}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto}
h1{font-size:22px;margin:0}
.sub{color:var(--muted);font-size:13px;margin:4px 0 24px}
section{margin-bottom:36px}
h2{font-size:17px;margin:0 0 6px}
.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;max-width:320px;margin-bottom:14px}
.bar>i{display:block;height:100%;background:var(--ok)}
.cols{display:flex;gap:12px;overflow-x:auto;align-items:flex-start;padding-bottom:6px}
.col{flex:0 0 250px}
.col h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:8px}
.card.blocked{border-left:3px solid var(--warn)}
.num{color:var(--muted);font-size:12px}
.title{font-weight:600}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;font-size:12px;color:var(--muted)}
.tag{border:1px solid var(--line);border-radius:10px;padding:0 7px}
.tag.warn{color:var(--warn);border-color:var(--warn)}
.empty{color:var(--muted)}
"""


@dataclass
class Ticket:
    """One ticket file under `.scratch/<feature>/issues/`."""

    feature: str
    number: str
    title: str
    status: str
    kind: str
    blocked_by: list[str]
    checked: int
    total: int


def parse_ticket(path: Path, feature: str) -> Ticket:
    """Read a ticket file and pull out the fields the board shows.

    Args:
        path (Path): The markdown file for a single ticket.
        feature (str): Name of the feature folder the ticket belongs to.

    Returns:
        Ticket: The parsed ticket; missing fields fall back to "-" or empty.
    """
    text = path.read_text(encoding="utf-8")
    prefix = re.match(r"(\d+)", path.stem)
    title_match = TITLE_RE.search(text)
    status = STATUS_RE.search(text)
    kind = TYPE_RE.search(text)
    blocked = BLOCKED_INLINE_RE.search(text) or BLOCKED_SECTION_RE.search(text)
    boxes = CHECKBOX_RE.findall(text)
    return Ticket(
        feature=feature,
        number=(prefix.group(1) if prefix else (title_match.group("n") if title_match and title_match.group("n") else "?")),
        title=title_match.group("t").strip() if title_match else path.stem,
        status=status.group("v").lower() if status else "-",
        kind=kind.group("v").lower() if kind else "",
        blocked_by=[n.zfill(2) for n in NUMBER_RE.findall(blocked.group("v"))] if blocked else [],
        checked=sum(1 for c in boxes if c.lower() == "x"),
        total=len(boxes),
    )


def load_tickets(root: Path) -> dict[str, list[Ticket]]:
    """Collect every ticket under the tracker root, grouped by feature.

    Args:
        root (Path): The `.scratch` directory.

    Returns:
        dict[str, list[Ticket]]: Feature name mapped to its tickets, sorted by number.
    """
    features: dict[str, list[Ticket]] = {}
    for issues_dir in sorted(root.glob("*/issues")):
        feature = issues_dir.parent.name
        tickets = [parse_ticket(p, feature) for p in sorted(issues_dir.glob("*.md"))]
        if tickets:
            features[feature] = tickets
    return features


def render_card(ticket: Ticket, done_numbers: set[str]) -> str:
    """Build the HTML for one ticket card.

    Args:
        ticket (Ticket): The ticket to draw.
        done_numbers (set[str]): Numbers of finished tickets in the same feature.

    Returns:
        str: HTML snippet for the card.
    """
    waiting = [b for b in ticket.blocked_by if b not in done_numbers]
    blocked = ticket.status not in DONE_STATUSES and bool(waiting)
    tags = []
    if ticket.kind:
        tags.append(f'<span class="tag">{html.escape(ticket.kind)}</span>')
    if ticket.total:
        tags.append(f'<span class="tag">{ticket.checked}/{ticket.total} criteria</span>')
    if blocked:
        tags.append(f'<span class="tag warn">blocked by {html.escape(", ".join(waiting))}</span>')
    return (
        f'<div class="card{" blocked" if blocked else ""}">'
        f'<div class="num">#{html.escape(ticket.number)}</div>'
        f'<div class="title">{html.escape(ticket.title)}</div>'
        f'<div class="meta">{"".join(tags)}</div></div>'
    )


def render_feature(feature: str, tickets: list[Ticket], all_tickets: list[Ticket]) -> str:
    """Build one feature's section: progress bar plus a column per status.

    Args:
        feature (str): Feature folder name, used as the heading.
        tickets (list[Ticket]): The tickets to show, already filtered.
        all_tickets (list[Ticket]): Every ticket in the feature, for progress and blocker checks.

    Returns:
        str: HTML snippet for the section.
    """
    done_numbers = {t.number for t in all_tickets if t.status in DONE_STATUSES}
    pct = round(100 * len(done_numbers) / len(all_tickets))
    statuses = sorted({t.status for t in tickets}, key=lambda s: STATUS_ORDER.index(s) if s in STATUS_ORDER else len(STATUS_ORDER))
    cols = []
    for status in statuses:
        cards = "".join(render_card(t, done_numbers) for t in tickets if t.status == status)
        count = sum(1 for t in tickets if t.status == status)
        cols.append(f'<div class="col"><h3>{html.escape(status)} · {count}</h3>{cards}</div>')
    return (
        f"<section><h2>{html.escape(feature)}</h2>"
        f'<div class="sub">{len(done_numbers)}/{len(all_tickets)} done</div>'
        f'<div class="bar"><i style="width:{pct}%"></i></div>'
        f'<div class="cols">{"".join(cols)}</div></section>'
    )


def render_page(sections: list[str]) -> str:
    """Wrap the feature sections in a full, self-contained HTML document.

    Args:
        sections (list[str]): HTML snippets, one per feature.

    Returns:
        str: The complete HTML page.
    """
    body = "".join(sections) or '<p class="empty">No matching tickets.</p>'
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>Issue board</title><style>{CSS}</style></head><body><main>"
        f'<h1>Issue board</h1><div class="sub">Generated {stamp} from .scratch/ — rerun the script to refresh.</div>'
        f"{body}</main></body></html>"
    )


def main() -> None:
    """Parse CLI flags, load the tickets, write the HTML board, and open it."""
    parser = argparse.ArgumentParser(description="Generate an HTML board from the local .scratch issue tracker.")
    parser.add_argument("--root", type=Path, default=Path(".scratch"), help="Tracker directory (default: .scratch)")
    parser.add_argument("-o", "--output", type=Path, help="Output file (default: <root>/board.html)")
    parser.add_argument("-s", "--status", help="Only show tickets with this status")
    parser.add_argument("-f", "--feature", help="Only show features whose name contains this text")
    parser.add_argument("--no-open", action="store_true", help="Write the file without opening a browser")
    args = parser.parse_args()

    if not args.root.is_dir():
        print(f"No tracker found at {args.root}/ yet. Create tickets with /to-tickets first.")
        return

    sections = []
    for feature, tickets in load_tickets(args.root).items():
        if args.feature and args.feature.lower() not in feature.lower():
            continue
        visible = [t for t in tickets if not args.status or t.status == args.status.lower()]
        if visible:
            sections.append(render_feature(feature, visible, tickets))

    output = args.output or args.root / "board.html"
    output.write_text(render_page(sections), encoding="utf-8")
    print(f"Wrote {output} ({len(sections)} feature(s))")
    if not args.no_open:
        webbrowser.open(output.resolve().as_uri())


if __name__ == "__main__":
    main()
