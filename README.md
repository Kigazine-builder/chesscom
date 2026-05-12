# Chess.com Newest Members Widget

This project generates a small GitHub Pages site that loads the newest members of a Chess.com club in the browser.

## Files

- `club.config.json`: change the club slug, club name, title, and member count here.
- `generate-newest-members.mjs`: writes the static Pages HTML into `docs/index.html`.
- `docs/index.html`: generated output for GitHub Pages.
- `.github/workflows/update-newest-members.yml`: refreshes the static output on a schedule.

## Quick Start

1. Open `club.config.json` and set your club slug and club name.
2. Run:

```bash
cd /Users/ethan/Desktop/chesscom-widget
npm run build
```

3. Commit and push this folder to GitHub.
4. Enable Pages from the `main` branch and `/docs` folder.
5. Run the `Update newest members widget` workflow once, then use the Pages URL as your hosted widget page.

## Notes

- The widget loads Chess.com member data in the browser from the public API, so the GitHub Action no longer needs a Chess.com cookie.
- The page auto-refreshes the member list every 60 seconds and shows a live countdown in the footer.
- If Chess.com blocks public data for a club, the widget will show an error message with a retry button.
