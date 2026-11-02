/**
 * HTML for the discipline dashboard (SPEC §3).
 *
 * Server-rendered: the page is one self-contained string with inline CSS and
 * inline SVG, no script, no CDN, no client plugin. It opens from disk or from a
 * host route and looks the same in both.
 *
 * @module dsh-coding-discipline/report
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param {number | null | undefined} value
 * @returns {string}
 */
function pct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${Math.round(value * 100)}%`
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
function stamp(timestamp) {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * One column of the daily chart.
 *
 * @param {{ date: string, rate: number | null, turns: number, hot: boolean }} day
 * @returns {string}
 */
function barColumn(day) {
  const height = day.rate === null ? 0 : Math.max(3, Math.round(day.rate * 100))
  const area = day.rate === null
    ? '<div class="bar-area none"></div>'
    : `<div class="bar-area"><div class="fill${day.hot ? ' hot' : ''}" style="height:${height}%"></div></div>`
  const value = day.rate === null ? '—' : String(Math.round(day.rate * 100))
  return `<div class="bar-col">
  <div class="bar-value">${value}</div>
  ${area}
  <div class="bar-label">${escapeHtml(day.date.slice(5))}</div>
  <div class="bar-sub">${day.turns}轮</div>
</div>`
}

/**
 * @param {Array<object>} daily
 * @returns {string}
 */
function dailyChart(daily) {
  if (daily.length === 0) return '<p class="muted">还没有可用的每日数据。</p>'
  const days = daily.slice(-14)
  const bars = days
    .map((day) => barColumn({
      date: day.date,
      rate: day.closureRate,
      turns: day.editTurns,
      hot: day.withTurns > 0,
    }))
    .join('\n')
  return `<div class="bars">${bars}</div>
<div class="legend"><span class="dot cool"></span>无插件<span class="dot hot"></span>含插件回合</div>`
}

/**
 * Render the whole dashboard.
 *
 * @param {object} summary - output of `summarize`.
 * @param {{ title?: string, source?: string, now?: number }} [options]
 * @returns {string} complete HTML document
 */
export function renderDashboard(summary, options = {}) {
  const title = options.title ?? 'coding-discipline 效果面板'
  const source = options.source ?? ''
  const withArm = summary.arms.with
  const withoutArm = summary.arms.without
  const sufficient = withArm.editTurns >= 5

  const delta = sufficient && withoutArm.closureRate !== null && withArm.closureRate !== null
    ? withArm.closureRate - withoutArm.closureRate
    : null

  const compareRows = [
    ['改动-验证闭环率', pct(withoutArm.closureRate), pct(withArm.closureRate)],
    ['编辑回合数', String(withoutArm.editTurns), String(withArm.editTurns)],
    ['有验证命令的回合', String(withoutArm.verifyTurns), String(withArm.verifyTurns)],
    ['完成声明 / 其中带证据', `${withoutArm.claims} / ${withoutArm.claimsWithEvidence}`, `${withArm.claims} / ${withArm.claimsWithEvidence}`],
    ['平均每轮工具调用', withoutArm.avgToolCalls.toFixed(1), withArm.avgToolCalls.toFixed(1)],
    ['平均回答字符', String(withoutArm.avgChars), String(withArm.avgChars)],
  ]

  const gapRows = summary.gaps.length === 0
    ? '<tr><td colspan="4" class="muted">没有检出「无证据的完成声明」。</td></tr>'
    : summary.gaps
      .map((gap) => `<tr>
  <td class="mono">${escapeHtml(stamp(gap.at))}</td>
  <td class="mono">${escapeHtml(gap.session)} · T${escapeHtml(gap.turn)}</td>
  <td>${escapeHtml(gap.claims.join(' / '))}</td>
  <td class="excerpt">${escapeHtml(gap.excerpt)}</td>
</tr>`)
      .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --bg: #f7f8fa; --card: #ffffff; --ink: #1c1f23; --muted: #6b7280; --line: #e5e7eb;
    --cool: #9aa4b2; --hot: #2f6feb; --warn: #b45309; --warn-bg: #fff7ed;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#15171a; --card:#1d2024; --ink:#e6e8eb; --muted:#9aa0a8; --line:#2c3036;
      --cool:#4b5563; --hot:#6ba1ff; --warn:#fbbf24; --warn-bg:#2a2113; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px; background:var(--bg); color:var(--ink);
    font: 14px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 10px; color: var(--muted); font-weight: 600; letter-spacing: .02em; }
  .meta { color: var(--muted); font-size: 12px; }
  .banner { margin: 16px 0; padding: 12px 14px; border-radius: 10px; background: var(--warn-bg);
    border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); color: var(--warn); font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .kpi-title { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .kpi-big { font-size: 26px; font-weight: 650; letter-spacing: -.01em; }
  .kpi-big small { font-size: 12px; font-weight: 400; color: var(--muted); margin-left: 6px; }
  .delta { font-size: 12px; margin-top: 6px; }
  .up { color: #15803d; } .down { color: #b91c1c; }
  @media (prefers-color-scheme: dark) { .up { color:#4ade80; } .down { color:#f87171; } }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); font-size: 13px; vertical-align: top; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: color-mix(in srgb, var(--card) 88%, var(--ink)); }
  tr:last-child td { border-bottom: 0; }
  td.mono { font-family: var(--mono); font-size: 12px; color: var(--muted); white-space: nowrap; }
  td.excerpt { color: var(--muted); max-width: 420px; }
  .bars { display: flex; gap: 10px; align-items: flex-start; padding: 6px 2px 0; }
  .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; min-width: 0; }
  .bar-value { height: 16px; font-size: 11px; color: var(--muted); }
  .bar-area { width: 100%; max-width: 56px; height: 130px; display: flex; align-items: flex-end; }
  .bar-area .fill { width: 100%; border-radius: 6px 6px 3px 3px; background: var(--cool); }
  .bar-area .fill.hot { background: var(--hot); }
  .bar-area.none { border: 1px dashed var(--line); border-radius: 6px; }
  .bar-label { margin-top: 7px; font-size: 11px; color: var(--muted); }
  .bar-sub { font-size: 10px; color: var(--muted); opacity: .7; }
  .legend { display: flex; gap: 6px; align-items: center; margin-top: 12px; font-size: 11px; color: var(--muted); }
  .legend .dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .legend .dot.cool { background: var(--cool); }
  .legend .dot.hot { background: var(--hot); margin-left: 10px; }
  .muted { color: var(--muted); }
  .method { margin-top: 26px; padding: 14px 16px; border: 1px dashed var(--line); border-radius: 12px; color: var(--muted); font-size: 12px; }
  .method code { font-family: var(--mono); background: color-mix(in srgb, var(--card) 70%, var(--ink)); padding: 1px 5px; border-radius: 4px; }
  .method li { margin: 3px 0; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">生成于 ${escapeHtml(stamp(options.now ?? summary.generatedAt))} · 会话 ${summary.sessions} 个（跳过 ${summary.skipped}）· 数据源 ${escapeHtml(source)}</div>

  ${sufficient ? '' : `<div class="banner">对照组（无插件）有 ${withoutArm.editTurns} 个改动回合，处理组只有 ${withArm.editTurns} 个。处理组攒到 5 个改动回合后，这里的对比才有意义；在那之前，下面的数字是<b>基线</b>，不是提升。</div>`}

  <div class="grid">
    <div class="card">
      <div class="kpi-title">改动-验证闭环率（基线）</div>
      <div class="kpi-big">${pct(withoutArm.closureRate)}<small>${withoutArm.editVerifiedTurns}/${withoutArm.editTurns} 回合</small></div>
      <div class="delta muted">改了代码并在同一轮跑过验证命令的比例</div>
    </div>
    <div class="card">
      <div class="kpi-title">无证据的完成声明</div>
      <div class="kpi-big">${withoutArm.claimsWithoutEvidence}<small>共 ${withoutArm.claims} 次声明</small></div>
      <div class="delta muted">证据覆盖率 ${pct(withoutArm.evidenceRate)}</div>
    </div>
    <div class="card">
      <div class="kpi-title">平均每轮工具调用</div>
      <div class="kpi-big">${withoutArm.avgToolCalls.toFixed(1)}</div>
      <div class="delta muted">回答平均 ${withoutArm.avgChars} 字</div>
    </div>
    <div class="card">
      <div class="kpi-title">处理组（装了插件）</div>
      <div class="kpi-big">${pct(withArm.closureRate)}<small>${withArm.editTurns} 回合</small></div>
      <div class="delta ${delta === null ? 'muted' : delta >= 0 ? 'up' : 'down'}">${delta === null ? '样本不足，暂不比较' : `较基线 ${delta >= 0 ? '+' : ''}${Math.round(delta * 100)} 个百分点`}</div>
    </div>
  </div>

  <h2>每日闭环率</h2>
  <div class="card">${dailyChart(summary.daily)}</div>

  <h2>两组对比</h2>
  <table>
    <thead><tr><th>指标</th><th>无插件（基线）</th><th>有插件（处理组）</th></tr></thead>
    <tbody>${compareRows.map((row) => `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td></tr>`).join('')}</tbody>
  </table>

  <h2>检出样本（可核对）</h2>
  <table>
    <thead><tr><th>时间</th><th>会话 · 回合</th><th>命中词</th><th>当轮结论摘录</th></tr></thead>
    <tbody>${gapRows}</tbody>
  </table>

  <div class="method">
    <b>口径</b>
    <ul>
      <li><code>改动回合</code>：该轮出现过 edit / write / patch 类工具调用。</li>
      <li><code>验证命令</code>：该轮 bash 类工具调用的命令命中 <code>ctest / dotnet test / pytest / npm test / node --test / tsc / cmake --build / msbuild …</code>。</li>
      <li><code>闭环率</code> = 同时有改动和验证的回合 ÷ 改动回合。结构化判定，不含人判断。</li>
      <li><code>完成声明</code>：回合最后一条助手消息里出现完成类措辞；代码块、行内代码、引用和表格行先被剔除，避免把「引用别人的话」算进来。</li>
      <li>分组依据：会话的系统提示里是否含 <code>&lt;coding_discipline&gt;</code> 标记，不靠日期猜。</li>
    </ul>
    <b>局限</b>：不是随机对照，任务难度不同；基线来自插件安装前的历史会话；样本小时差异没有统计意义。这张页面回答的是「行为有没有变」，不是「模型变强了」。
  </div>
</div>
</body>
</html>`
}
