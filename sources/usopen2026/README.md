# US Open 2026 draw provenance

The `men-round1.txt` and `women-round1.txt` files preserve the numbered first-round entrant lines extracted from these official USTA US Open PDFs, most recently checked September 3, 2026 (New York time):

- https://www.usopen.org/en_US/scores/draws/2026_MS_draw.pdf
- https://www.usopen.org/en_US/scores/draws/2026_WS_draw.pdf

Only entrants, draw positions, seed numbers, entry status, and listed countries were used. No match scores or winners were imported. These source transcripts are development references and are not loaded by the website. There is no draw or results synchronization job.

Each event has 128 numbered positions. The women's sheet retains seeds 1–32; the men's sheet has 31 displayed seeds after No. 19 Casper Ruud withdrew and was replaced in the same position by unseeded lucky loser Arthur Gea. Array index in `draws.js` is the official position minus one. Names use the given-name initial on compact bracket buttons and the complete name on player cards; source surname capitalization is normalized for display. Q/W/L denote qualifier/wild card/lucky loser as supplied by the sheet.

The September 3 recheck records four post-draw replacements without importing any match result: Thanasi Kokkinakis → Yunchaokete Bu (L), Casper Ruud → Arthur Gea (L), Marin Cilic → Otto Virtanen (L), and Tereza Valentova → Darja Semenistaja (L). Existing slot numbers were preserved so saved brackets and manual results remain attached to the correct draw positions.

Country codes are converted from the PDF's three-letter codes to ISO alpha-2 for flags. Where the official sheet omits country, it stays blank. Optional biography fields remain null in the official draw module; the player cards now overlay a separately sourced historical reference snapshot from `player-reference.js`. See `../player-reference/README.md` for dates, provenance and limitations. Wimbledon biography values are not treated as current facts. Seed numbers are not substituted for rankings.

Before accepting picks, review these static draws against the official sheets for any subsequent withdrawals/replacements. Once picks exist, never reorder positions; changes need explicit commissioner review.
