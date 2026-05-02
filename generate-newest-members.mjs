import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, "club.config.json");
const OUTPUT_DIR = path.join(__dirname, "docs");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "index.html");
const CHESS_BASE_URL = "https://www.chess.com";
const MEMBER_URL_RE = /https:\/\/www\.chess\.com\/member\/([a-z0-9_-]+)/i;
const MONTH_LOOKUP = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

async function loadConfig() {
  const raw = await readFile(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);

  const clubSlug = String(parsed.clubSlug || "").trim();
  return {
    clubSlug,
    clubUuid: String(parsed.clubUuid || "").trim(),
    title: String(parsed.title || "Newest Members").trim(),
    count: Math.max(1, Number(parsed.count || 3)),
    membersPageUrl: String(
      parsed.membersPageUrl || `${CHESS_BASE_URL}/clubs/members/${clubSlug}`
    ).trim()
  };
}

function getRequestHeaders(cookie = "") {
  return {
    "User-Agent": "chess-club-newest-members-generator/1.0",
    ...(cookie ? { Cookie: cookie } : {})
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: getRequestHeaders()
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchText(url, cookie = "") {
  const response = await fetch(url, {
    headers: getRequestHeaders(cookie)
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function postJson(url, body, cookie = "") {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...getRequestHeaders(cookie),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function dedupeMembers(payload) {
  const buckets = [
    ...(payload?.weekly || []),
    ...(payload?.monthly || []),
    ...(payload?.all_time || [])
  ];

  const byUsername = new Map();
  for (const member of buckets) {
    const username = String(member?.username || "").trim();
    if (!username) continue;

    const joined = Number(member?.joined || 0);
    const existing = byUsername.get(username);
    if (!existing || joined > existing.joined) {
      byUsername.set(username, { username, joined, source: "public_api" });
    }
  }

  return Array.from(byUsername.values())
    .sort((a, b) => b.joined - a.joined);
}

function decodeHtml(text = "") {
  return String(text)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripTags(text = "") {
  return decodeHtml(String(text).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseJoinedLabel(label = "") {
  const match = label.match(/Joined\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/i);
  if (!match) return 0;

  const monthIndex = MONTH_LOOKUP[match[1].slice(0, 3).toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isInteger(monthIndex) || !day || !year) return 0;

  return Math.floor(Date.UTC(year, monthIndex, day) / 1000);
}

function parseMembersFromHtml(html) {
  const normalized = String(html || "");
  if (!normalized) return [];

  if (/Login - Chess\.com/i.test(normalized) || /id="_target_path"/i.test(normalized)) {
    throw new Error("Chess.com redirected to login. Add a fresh CHESS_COOKIE before running the generator.");
  }

  const segments = normalized.split(/https:\/\/www\.chess\.com\/member\//i);
  const members = [];

  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    const usernameMatch = segment.match(/^([a-z0-9_-]+)/i);
    if (!usernameMatch) continue;

    const username = usernameMatch[1];
    const windowText = normalized.slice(
      normalized.indexOf(`https://www.chess.com/member/${username}`),
      normalized.indexOf(`https://www.chess.com/member/${username}`) + 2500
    );
    const joinedMatch = windowText.match(/Joined\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}/i);
    if (!joinedMatch) continue;

    members.push({
      username,
      joined: parseJoinedLabel(joinedMatch[0]),
      source: "members_page"
    });
  }

  const byUsername = new Map();
  for (const member of members) {
    const existing = byUsername.get(member.username);
    if (!existing || member.joined > existing.joined) {
      byUsername.set(member.username, member);
    }
  }

  return Array.from(byUsername.values())
    .filter(member => member.joined > 0)
    .sort((a, b) => b.joined - a.joined);
}

function parseIsoDateToUnixSeconds(value = "") {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? Math.floor(time / 1000) : 0;
}

function normalizeServiceMembers(payload) {
  const members = Array.isArray(payload?.members) ? payload.members : [];
  return members
    .map(member => ({
      username: member?.userView?.username || "",
      joined: parseIsoDateToUnixSeconds(member?.joinedAt),
      source: "club_member_service"
    }))
    .filter(member => member.username && member.joined > 0)
    .sort((a, b) => b.joined - a.joined);
}

function buildClubMemberQueryPayload(config, newestFirst = true) {
  return {
    pagination: {},
    query: {
      orderBy: [
        {
          option: "CLUB_MEMBERS_ORDER_BY_OPTION_ALPHABETICAL",
          order: "CLUB_MEMBERS_ORDER_ASC"
        }
      ],
      query: {
        clubUuid: config.clubUuid,
        bannedStatus: "BANNED_STATUS_NOT_BANNED",
        closedStatus: "CLOSED_STATUS_NOT_CLOSED"
      }
    }
  };
}

async function loadNewestMembers(config) {
  const cookie = String(process.env.CHESS_COOKIE || "").trim();
  const failures = [];

  try {
    const membersPayload = await fetchJson(
      `${CHESS_BASE_URL}/pub/club/${encodeURIComponent(config.clubSlug)}/members`
    );
    const members = dedupeMembers(membersPayload).slice(0, config.count);
    if (members.length) {
      return {
        members,
        sourceLabel: "Chess.com public API"
      };
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  if (!cookie) {
    throw new Error(
      `Public API lookup failed (${failures.join(" | ")}). Add CHESS_COOKIE to use the logged-in members page.`
    );
  }

  if (config.clubUuid) {
    try {
      const servicePayload = await postJson(
        `${CHESS_BASE_URL}/service/clubs/chesscom.clubs.v3.ClubMemberSearchService/QueryClubMembers`,
        buildClubMemberQueryPayload(config, false),
        cookie
      );
      const members = normalizeServiceMembers(servicePayload).slice(0, config.count);
      if (members.length) {
        return {
          members,
          sourceLabel: "authenticated ClubMemberSearchService"
        };
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    failures.push("clubUuid is missing, so the authenticated ClubMemberSearchService fallback was skipped");
  }

  const html = await fetchText(config.membersPageUrl, cookie);
  const members = parseMembersFromHtml(html).slice(0, config.count);
  if (!members.length) {
    throw new Error(
      `Authenticated fallbacks failed (${failures.join(" | ")}). The members page loaded, but no joined member cards could be parsed.`
    );
  }

  return {
    members,
    sourceLabel: "authenticated Chess.com members page"
  };
}

async function enrichMember(member) {
  const candidates = [
    String(member.username || ""),
    String(member.username || "").toLowerCase()
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const player = await fetchJson(`${CHESS_BASE_URL}/pub/player/${encodeURIComponent(candidate)}`);
      return {
        ...member,
        avatar: player.avatar || "",
        url: player.url || `${CHESS_BASE_URL}/member/${candidate}`,
        displayName: player.username || member.username || candidate
      };
    } catch (error) {
      // Try the next candidate casing before falling back to a simple profile link.
    }
  }

  return {
    ...member,
    avatar: "",
    url: `${CHESS_BASE_URL}/member/${String(member.username || "").toLowerCase()}`,
    displayName: member.username || "Unknown member"
  };
}

function formatJoined(unixSeconds) {
  if (!unixSeconds) return "Joined date unavailable";
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function getInitials(name = "") {
  const clean = String(name || "").replace(/[^a-z0-9]+/gi, " ").trim();
  const parts = clean.split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return "C";
  return parts.map(part => part[0].toUpperCase()).join("");
}

function renderMemberCard(member, index) {
  const safeName = escapeHtml(member.displayName);
  const safeUrl = escapeHtml(member.url);
  const joinedLabel = escapeHtml(formatJoined(member.joined));
  const positionLabel = index === 0 ? "Newest join" : `#${index + 1} newest join`;
  const avatarMarkup = member.avatar
    ? `<img src="${escapeHtml(member.avatar)}" alt="${safeName} avatar" class="avatar-image" />`
    : `<div class="avatar-fallback" aria-hidden="true">${escapeHtml(getInitials(member.displayName))}</div>`;

  return `
    <a class="member-card" href="${safeUrl}" target="_blank" rel="noopener noreferrer">
      <div class="avatar-wrap">
        ${avatarMarkup}
      </div>
      <div class="member-copy">
        <div class="member-topline">${escapeHtml(positionLabel)}</div>
        <h2>${safeName}</h2>
        <p>Joined ${joinedLabel}</p>
      </div>
    </a>
  `;
}

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPage({ title, clubSlug, members, sourceLabel }) {
  const cards = members.length
    ? members.map((member, index) => renderMemberCard(member, index)).join("\n")
    : `
      <div class="empty-state">
        No member data is available right now.
      </div>
    `;

  const updatedAtDate = new Date();
  const updatedAt = updatedAtDate.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const updatedAtIso = updatedAtDate.toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f172a;
      --line: rgba(148, 163, 184, 0.2);
      --text: #e2e8f0;
      --muted: #94a3b8;
      --gold: #fbbf24;
      --blue: #60a5fa;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", Arial, sans-serif;
      background:
        radial-gradient(circle at top, rgba(96, 165, 250, 0.18), transparent 34%),
        linear-gradient(180deg, #0b1120, var(--bg));
      color: var(--text);
      padding: 20px;
    }

    .wrap {
      width: min(100%, 420px);
      margin: 0 auto;
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.9));
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 18px;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
    }

    .eyebrow {
      display: inline-block;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(251, 191, 36, 0.14);
      color: #fde68a;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    h1 {
      margin: 0 0 6px;
      font-size: 28px;
      line-height: 1.05;
    }

    .sub {
      margin: 0 0 18px;
      color: var(--muted);
      line-height: 1.5;
      font-size: 14px;
    }

    .list {
      display: grid;
      gap: 12px;
    }

    .member-card {
      display: grid;
      grid-template-columns: 62px 1fr;
      gap: 14px;
      align-items: center;
      padding: 14px;
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(30, 41, 59, 0.94), rgba(15, 23, 42, 0.94));
      border: 1px solid var(--line);
      text-decoration: none;
      color: inherit;
    }

    .avatar-wrap {
      width: 62px;
      height: 62px;
      border-radius: 18px;
      overflow: hidden;
      background: rgba(96, 165, 250, 0.14);
      border: 1px solid rgba(96, 165, 250, 0.18);
      display: grid;
      place-items: center;
    }

    .avatar-image {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .avatar-fallback {
      color: white;
      font-weight: 800;
      font-size: 22px;
    }

    .member-copy h2 {
      margin: 2px 0 6px;
      font-size: 20px;
      line-height: 1.1;
    }

    .member-copy p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }

    .member-topline {
      color: var(--blue);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .footer {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .empty-state {
      padding: 18px;
      border-radius: 18px;
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid var(--line);
      color: var(--muted);
      line-height: 1.5;
    }

    .refresh-timer {
      margin-top: 8px;
      color: var(--text);
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="eyebrow">Live Club Widget</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">The ${members.length} newest joins for <strong>${escapeHtml(clubSlug)}</strong>.</p>
    <section class="list">
      ${cards}
    </section>
    <div class="footer">
      Updated ${escapeHtml(updatedAt)}. Source: ${escapeHtml(sourceLabel)}.
      <div class="refresh-timer" data-refresh-timer data-last-updated="${escapeHtml(updatedAtIso)}">
        Refreshes about every 5 minutes.
      </div>
    </div>
  </main>
  <script>
    const timerNode = document.querySelector("[data-refresh-timer]");

    if (timerNode) {
      const updatedAtValue = timerNode.getAttribute("data-last-updated");
      const updatedAtMs = Date.parse(updatedAtValue || "");
      const refreshIntervalMs = 5 * 60 * 1000;

      const renderTimer = () => {
        if (!Number.isFinite(updatedAtMs)) {
          timerNode.textContent = "Refreshes about every 5 minutes.";
          return;
        }

        const nextRefreshMs = updatedAtMs + refreshIntervalMs;
        const remainingMs = nextRefreshMs - Date.now();

        if (remainingMs <= 0) {
          timerNode.textContent = "Refresh window reached. Reload soon for the newest data.";
          return;
        }

        const totalSeconds = Math.ceil(remainingMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        timerNode.textContent = "Next refresh window in " + minutes + ":" + String(seconds).padStart(2, "0") + ".";
      };

      renderTimer();
      window.setInterval(renderTimer, 1000);
    }
  </script>
</body>
</html>`;
}

async function main() {
  const config = await loadConfig();
  if (!config.clubSlug) {
    throw new Error("clubSlug is missing in club.config.json");
  }

  const { members, sourceLabel } = await loadNewestMembers(config);
  const enrichedMembers = await Promise.all(members.map(enrichMember));

  const html = renderPage({
    title: config.title,
    clubSlug: config.clubSlug,
    members: enrichedMembers,
    sourceLabel
  });

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_PATH, html, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
