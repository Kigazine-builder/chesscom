# Chess.com Newest Members Widget

This project generates a small HTML page showing the newest members of a Chess.com club.

## Files

- `club.config.json`: change the club slug, title, member count, members page URL, and optionally the club UUID here.
- `generate-newest-members.mjs`: fetches members from the Chess.com public API when possible, then tries the authenticated `QueryClubMembers` service, then falls back to the logged-in members page.
- `docs/index.html`: generated output for GitHub Pages.
- `.github/workflows/update-newest-members.yml`: refreshes the output on a schedule.

## Quick Start

1. Open `club.config.json` and set your real club slug.
2. If the public API does not work for your club, set a logged-in cookie first:

```bash
export CHESS_COOKIE='paste_your_chess_com_cookie_header_here'
```

3. Run:

```bash
cd /Users/ethan/Desktop/chess-club-newest-members
node generate-newest-members.mjs
```

4. Commit and push this folder to a GitHub repo.
5. In GitHub, add a repository secret named `CHESS_COOKIE` with your current Chess.com cookie header value if your club requires authenticated access.
6. If your club needs the authenticated service fallback, keep `clubUuid` set in `club.config.json`.
7. Enable Pages from the `main` branch and `/docs` folder.
8. Run the `Update newest members widget` workflow once, then use the Pages URL as your hosted widget page.

## Notes

- The Chess.com public API provides club members with `joined` timestamps for some clubs, but not all clubs expose that endpoint.
- For clubs like `infinitlegend`, the script can try the authenticated `QueryClubMembers` service if you provide `CHESS_COOKIE`.
- The GitHub Actions workflow only needs a `CHESS_COOKIE` secret for clubs that do not expose enough public member data.
- `clubUuid` is only needed for the authenticated service fallback.
- The logged-in scraper depends on Chess.com's page structure and may need updating later if the site changes.
- If Chess.com does not let you embed live HTML in the sidebar, link to the hosted page or switch to an image-based version later.
