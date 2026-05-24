# focusprofit/tradingview-mcp — Fork Notes

This is a fork of [tradesdontlie/tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) maintained for the FocusProfit trading regression pipeline.

## Why this fork

The upstream MCP server provides `alert_list` via the internal `pricealerts.tradingview.com` REST API. Our regression workflow needs to programmatically enable and disable preset TradingView alerts (see [focusprofit/trademodel](https://github.com/focusprofit/trademodel) regression docs). These wrappers are not yet in upstream, so we maintain them in this fork.

## Branch structure

| Branch | Purpose |
|---|---|
| `main` | Mirror of `upstream/main`. No fork-specific changes here. |
| `focusprofit-features` | Active development branch with all fork-specific additions. **This is the branch used for local MCP server.** |
| `fix/scoping-evaluate-chart-helpers` | Independent bug fix candidate for upstream PR (chart.js helpers). |

## Fork-specific additions

In `focusprofit-features`:

- **`alert_enable`** (MCP tool) and **`alert_disable`** (MCP tool) — activate/deactivate one or more existing TradingView alerts by id via `POST /restart_alerts` and `POST /stop_alerts` on `pricealerts.tradingview.com`. Mirrors the `alert_list` pattern.
- Corresponding CLI subcommands `tv alert enable --ids 1,2,3` and `tv alert disable --ids 1,2,3`.

## Адаптивная precision цен в data_get_pine_labels / pine_boxes / pine_lines

Цены, возвращаемые инструментами `data_get_pine_labels`,
`data_get_pine_boxes` и `data_get_pine_lines`, округляются адаптивно по
абсолютному значению:

| Диапазон значения | Знаков после запятой | Примеры инструментов |
|---|---|---|
| >= 100 | 2 | BTCUSDT, GER40, XAUUSD |
| < 100 | 5 | EURUSD, GBPUSD, мелкие токены |

Реализация: `src/core/data.js`, функция `priceDecimals`.

Known limitation: JPY-пары (USDJPY ~150, GBPJPY ~190 и т.п.) попадают в
диапазон >= 100 и получают 2 знака вместо нужных 3-5. Точное решение
через `chart.symbolExt().minmov` остаётся в качестве followup — upstream
MCP API не возвращает mintick через `quote_get` или `symbol_info`, и
расширение требует отдельной задачи с runtime-проверкой формата
`symbolExt()` на разных классах инструментов.

## Sync with upstream

The fork uses `upstream` remote pointing at `tradesdontlie/tradingview-mcp`:

```sh
git remote -v
# origin    git@github-focusprofit:focusprofit/tradingview-mcp.git
# upstream  https://github.com/tradesdontlie/tradingview-mcp.git
```

To sync upstream changes into our fork:

```sh
# 1. Pull latest upstream/main into our origin/main (fast-forward).
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main

# 2. Rebase our feature branch on the new main.
git checkout focusprofit-features
git rebase main
# Resolve any conflicts in src/core/alerts.js, src/tools/alerts.js,
# src/cli/commands/alerts.js if upstream changed the same areas.
git push origin focusprofit-features --force-with-lease
```

Frequency: as needed — when we want a new upstream feature or bug fix.

## Running the MCP server from this fork

Use the `focusprofit-features` branch:

```sh
cd ~/projects/tradingview-mcp
git checkout focusprofit-features
npm install
node src/server.js
```

The MCP server picks up the additional `alert_enable` and `alert_disable` tools automatically.

## Contributing back to upstream

The `fix/scoping-evaluate-chart-helpers` branch is a candidate for upstream PR (small, focused, fixes a runtime bug in three chart.js helpers). When sending the PR, push that branch as-is and open the PR from `focusprofit:fix/scoping-evaluate-chart-helpers` into `tradesdontlie:main`.

Larger fork-specific features (like `alert_enable` / `alert_disable`) may also be candidates for upstream contribution, but their inclusion in upstream is not a prerequisite for our regression workflow.

## Author identity

All commits in this fork must use:

- `user.name`: `focusprofit`
- `user.email`: `focusprofit.pro@gmail.com`

Set in local `.git/config` for this clone:

```sh
git config user.name "focusprofit"
git config user.email "focusprofit.pro@gmail.com"
```
