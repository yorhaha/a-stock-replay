(() => {
  'use strict';

  const DATA = window.MARKET_DATA;
  if (!DATA) return;

  const NS = 'http://www.w3.org/2000/svg';
  const SERIES = DATA.series.map(([date, close, high, low, amount]) => ({
    date,
    close,
    high,
    low,
    amount,
    t: Date.parse(date + 'T00:00:00Z'),
  }));
  const EPISODES = DATA.episodes;
  const EPISODE_BY_ID = new Map(EPISODES.map((ep) => [ep.id, ep]));
  const MAX_ABS_DRAWDOWN = Math.max(...EPISODES.map((ep) => Math.abs(ep.drawdown)));

  const state = {
    selected: '2026',
    scale: 'log',
  };

  /* ----------------------------- formatting ----------------------------- */
  const numberFormat = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  function fmtNumber(value, digits = 2) {
    if (value == null || Number.isNaN(value)) return '—';
    if (digits === 2) return numberFormat.format(value);
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  function fmtPct(value, digits = 1) {
    if (value == null || Number.isNaN(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    const factor = 10 ** digits;
    const rounded = Math.round((Math.abs(value) + 1e-9) * factor) / factor;
    return `${sign}${rounded.toFixed(digits)}%`;
  }

  function fmtPctTick(value) {
    if (value === 0) return '0%';
    return `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(0)}%`;
  }

  function fmtMillions(value) {
    if (value == null) return '—';
    return `${new Intl.NumberFormat('zh-CN').format(value)} 亿`;
  }

  function fmtDate(iso) {
    return iso.replace(/-/g, '.');
  }

  function fmtMonth(iso) {
    return iso.slice(0, 7).replace('-', '.');
  }

  function parseDate(iso) {
    return Date.parse(iso + 'T00:00:00Z');
  }

  function lowerBound(target) {
    let lo = 0;
    let hi = SERIES.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (SERIES[mid].t < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function nearestIndex(t) {
    const i = lowerBound(t);
    if (i === 0) return 0;
    if (i >= SERIES.length) return SERIES.length - 1;
    return t - SERIES[i - 1].t <= SERIES[i].t - t ? i - 1 : i;
  }

  function findEpisodeAt(date) {
    return EPISODES.find((ep) => date >= ep.start && date <= ep.end) || null;
  }

  /* ----------------------------- svg helpers ----------------------------- */
  function svgNode(tag, attrs = {}, text) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) continue;
      node.setAttribute(key, String(value));
    }
    if (text != null) node.textContent = text;
    return node;
  }

  function append(parent, tag, attrs = {}, text) {
    const node = svgNode(tag, attrs, text);
    parent.appendChild(node);
    return node;
  }

  function linePath(points) {
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join('');
  }

  function makeTooltip(container) {
    const tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    container.appendChild(tip);
    return tip;
  }

  function showTooltip(tip, container, svg, viewWidth, viewHeight, x, y, html) {
    const rect = svg.getBoundingClientRect();
    const sx = rect.width / viewWidth;
    const sy = rect.height / viewHeight;
    const px = Math.min(Math.max(x * sx, 92), rect.width - 92);
    const py = Math.max(78, y * sy);
    tip.innerHTML = html;
    tip.style.left = `${px}px`;
    tip.style.top = `${py}px`;
    tip.classList.add('is-visible');
  }

  function hideTooltip(tip) {
    tip.classList.remove('is-visible');
  }

  /* ----------------------------- overview chart ----------------------------- */
  function renderOverviewChart() {
    const container = document.getElementById('overviewChart');
    if (!container) return;
    const width = Math.max(320, Math.round(container.getBoundingClientRect().width));
    const mobile = width < 620;
    const height = mobile ? 288 : 380;
    const pad = { top: 14, right: mobile ? 8 : 14, bottom: 22, left: mobile ? 34 : 42 };
    const amountHeight = mobile ? 42 : 52;
    const gap = mobile ? 16 : 18;
    const priceHeight = height - pad.top - pad.bottom - amountHeight - gap;
    const plotWidth = width - pad.left - pad.right;
    const amountTop = pad.top + priceHeight + gap;
    const amountBottom = amountTop + amountHeight;

    const domainStart = SERIES[0].t;
    const domainEnd = SERIES[SERIES.length - 1].t;
    const yMin = 900;
    const yMax = 6500;

    const x = (t) => pad.left + ((t - domainStart) / (domainEnd - domainStart)) * plotWidth;
    const y =
      state.scale === 'log'
        ? (v) =>
            pad.top +
            ((Math.log(yMax) - Math.log(v)) / (Math.log(yMax) - Math.log(yMin))) * priceHeight
        : (v) => pad.top + ((yMax - v) / (yMax - yMin)) * priceHeight;

    // 20-day moving average amount.
    const amountMa = [];
    let amountSum = 0;
    for (let i = 0; i < SERIES.length; i += 1) {
      amountSum += SERIES[i].amount;
      if (i >= 20) amountSum -= SERIES[i - 20].amount;
      amountMa.push(i >= 19 ? amountSum / 20 : null);
    }
    const amountMax = Math.ceil(Math.max(...amountMa.filter((v) => v != null)) / 2000) * 2000;
    const amountY = (v) => amountTop + amountHeight - (v / amountMax) * amountHeight;

    container.innerHTML = '';
    const svg = svgNode('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      'aria-hidden': 'true',
      focusable: 'false',
    });
    container.appendChild(svg);

    // Drawdown bands.
    EPISODES.forEach((ep) => {
      const x1 = x(parseDate(ep.start));
      const x2 = x(parseDate(ep.end));
      const w = Math.max(2, x2 - x1);
      const hit = append(svg, 'rect', {
        x: x1,
        y: pad.top,
        width: w,
        height: amountBottom - pad.top,
        class: `chart-band${ep.id === state.selected ? ' is-active' : ''}`,
        'data-episode': ep.id,
        rx: 1,
      });
      hit.addEventListener('click', () => selectEpisode(ep.id, { scroll: true }));
      if (w > 22) {
        append(
          svg,
          'text',
          { x: x1 + w / 2, y: pad.top + 11, class: 'chart-band-label' },
          ep.no,
        );
      }
    });

    // Horizontal grid.
    const grid = append(svg, 'g', { class: 'chart-grid' });
    const yTicks = [1000, 2000, 3000, 4000, 5000, 6000];
    yTicks.forEach((value) => {
      const yy = y(value);
      append(grid, 'line', { x1: pad.left, x2: pad.left + plotWidth, y1: yy, y2: yy });
      append(svg, 'text', {
        x: pad.left - 7,
        y: yy + 3,
        'text-anchor': 'end',
        class: 'chart-axis',
      }, fmtNumber(value, 0));
    });

    // Vertical year grid.
    const years = [2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026];
    years.forEach((year) => {
      const t = Date.UTC(year, 0, 1);
      const xx = Math.max(pad.left, x(t));
      append(grid, 'line', { x1: xx, x2: xx, y1: pad.top, y2: amountBottom });
      append(svg, 'text', {
        x: xx,
        y: height - 5,
        'text-anchor': year === 2026 ? 'end' : 'middle',
        class: 'chart-axis',
      }, String(year));
    });

    // Amount panel baseline and label.
    append(grid, 'line', {
      x1: pad.left,
      x2: pad.left + plotWidth,
      y1: amountBottom,
      y2: amountBottom,
      class: 'is-strong',
    });
    append(svg, 'text', {
      x: pad.left,
      y: amountTop - 5,
      class: 'chart-axis chart-axis--label',
    }, `20 日均成交额 · 上限 ${fmtNumber(amountMax / 10000, 1)} 万亿`);

    // Amount area.
    const amountPoints = [];
    for (let i = 19; i < SERIES.length; i += 1) {
      amountPoints.push({ x: x(SERIES[i].t), y: amountY(amountMa[i]) });
    }
    const amountArea = amountPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join('') + `L${amountPoints[amountPoints.length - 1].x.toFixed(1)},${amountBottom}L${amountPoints[0].x.toFixed(1)},${amountBottom}Z`;
    append(svg, 'path', { d: amountArea, class: 'chart-area chart-area--amount' });
    append(svg, 'path', { d: linePath(amountPoints), class: 'chart-line chart-line--amount' });

    // Price line.
    const pricePoints = SERIES.map((p) => ({ x: x(p.t), y: y(p.close) }));
    append(svg, 'path', { d: linePath(pricePoints), class: 'chart-line' });

    // End label.
    const last = SERIES[SERIES.length - 1];
    append(svg, 'circle', {
      cx: x(last.t),
      cy: y(last.close),
      r: 2.5,
      class: 'chart-dot chart-dot--end',
    });
    if (!mobile) {
      append(svg, 'text', {
        x: x(last.t) - 6,
        y: y(last.close) - 8,
        'text-anchor': 'end',
        class: 'chart-axis chart-end-label',
      }, fmtNumber(last.close, 2));
    }

    // Hover layer.
    const hoverGroup = append(svg, 'g', { opacity: '0' });
    const crosshair = append(hoverGroup, 'line', {
      y1: pad.top,
      y2: amountBottom,
      class: 'chart-crosshair',
    });
    const priceDot = append(hoverGroup, 'circle', {
      r: 3,
      class: 'chart-dot',
    });
    const amountDot = append(hoverGroup, 'circle', {
      r: 2.4,
      class: 'chart-dot chart-dot--small',
    });
    const overlay = append(svg, 'rect', {
      x: pad.left,
      y: pad.top,
      width: plotWidth,
      height: amountBottom - pad.top,
      fill: 'transparent',
      style: 'cursor: crosshair;',
    });
    const tip = makeTooltip(container);

    overlay.addEventListener('mousemove', (event) => {
      const rect = svg.getBoundingClientRect();
      const localX = ((event.clientX - rect.left) / rect.width) * width;
      if (localX < pad.left || localX > pad.left + plotWidth) {
        hideTooltip(tip);
        hoverGroup.setAttribute('opacity', '0');
        return;
      }
      const ratio = (localX - pad.left) / plotWidth;
      const targetT = domainStart + ratio * (domainEnd - domainStart);
      const i = nearestIndex(targetT);
      const item = SERIES[i];
      const prev = SERIES[Math.max(0, i - 1)];
      const change = i === 0 ? 0 : (item.close / prev.close - 1) * 100;
      const xx = x(item.t);
      const yy = y(item.close);
      crosshair.setAttribute('x1', xx);
      crosshair.setAttribute('x2', xx);
      priceDot.setAttribute('cx', xx);
      priceDot.setAttribute('cy', yy);
      amountDot.setAttribute('cx', xx);
      amountDot.setAttribute('cy', amountY(amountMa[i] ?? amountMa[19]));
      hoverGroup.setAttribute('opacity', '1');
      const ep = findEpisodeAt(item.date);
      const html = `<span class="tt-muted">${fmtDate(item.date)}</span><br><strong>${fmtNumber(item.close)}</strong> ${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change).toFixed(2)}%<br><span class="tt-muted">成交 ${fmtMillions(item.amount)}</span>${ep ? `<br><span class="tt-muted">${ep.no} ${ep.name}</span>` : ''}`;
      showTooltip(tip, container, svg, width, height, xx, yy - 8, html);
    });
    overlay.addEventListener('mouseleave', () => {
      hideTooltip(tip);
      hoverGroup.setAttribute('opacity', '0');
    });
    overlay.addEventListener('click', (event) => {
      const rect = svg.getBoundingClientRect();
      const localX = ((event.clientX - rect.left) / rect.width) * width;
      if (localX < pad.left || localX > pad.left + plotWidth) return;
      const ratio = (localX - pad.left) / plotWidth;
      const targetT = domainStart + ratio * (domainEnd - domainStart);
      const ep = findEpisodeAt(SERIES[nearestIndex(targetT)].date);
      if (ep) selectEpisode(ep.id, { scroll: true });
    });
  }

  /* ----------------------------- episode chart ----------------------------- */
  function renderEpisodeChart(ep) {
    const container = document.getElementById('detailChart');
    if (!container) return;
    const width = Math.max(280, Math.round(container.getBoundingClientRect().width));
    const mobile = width < 560;
    const height = mobile ? 230 : 282;
    const pad = { top: 20, right: 14, bottom: 24, left: mobile ? 36 : 42 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;

    const peakIndex = lowerBound(parseDate(ep.start));
    const endIndex = lowerBound(parseDate(ep.end));
    const lastIndex = Math.min(SERIES.length - 1, endIndex + 250);
    const points = SERIES.slice(peakIndex, lastIndex + 1).map((item, i) => {
      const value = i === 0 ? 0 : (item.low / ep.peak - 1) * 100;
      return { ...item, value };
    });

    const values = points.map((p) => p.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const span = Math.max(1, maxValue - minValue);
    const step = span > 60 ? 20 : span > 30 ? 10 : span > 15 ? 5 : 2;
    const yMax = Math.max(maxValue, 0) + span * 0.06;
    const yMin = Math.floor(minValue / step) * step;

    const domainStart = points[0].t;
    const domainEnd = points[points.length - 1].t;
    const x = (t) => pad.left + ((t - domainStart) / (domainEnd - domainStart)) * plotWidth;
    const y = (value) => pad.top + ((yMax - value) / (yMax - yMin)) * plotHeight;

    container.innerHTML = '';
    const svg = svgNode('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      'aria-hidden': 'true',
      focusable: 'false',
    });
    container.appendChild(svg);

    const grid = append(svg, 'g', { class: 'chart-grid' });
    for (let value = 0; value >= yMin; value -= step) {
      const yy = y(value);
      append(grid, 'line', { x1: pad.left, x2: pad.left + plotWidth, y1: yy, y2: yy });
      append(svg, 'text', {
        x: pad.left - 7,
        y: yy + 3,
        'text-anchor': 'end',
        class: 'chart-axis',
      }, fmtPctTick(value));
    }

    // Zero baseline.
    append(svg, 'line', {
      x1: pad.left,
      x2: pad.left + plotWidth,
      y1: y(0),
      y2: y(0),
      class: 'chart-zero',
    });

    const coords = points.map((p) => ({ x: x(p.t), y: y(p.value) }));
    const areaPath =
      `M${coords[0].x.toFixed(1)},${y(0).toFixed(1)}` +
      coords.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('') +
      `L${coords[coords.length - 1].x.toFixed(1)},${y(0).toFixed(1)}Z`;
    append(svg, 'path', { d: areaPath, class: 'chart-area chart-area--detail' });
    append(svg, 'path', { d: linePath(coords), class: 'chart-line chart-line--drawdown' });

    // Peak and trough markers.
    append(svg, 'circle', {
      cx: coords[0].x,
      cy: coords[0].y,
      r: 2.5,
      class: 'chart-dot',
    });
    const troughPoint = points.reduce((best, p) => (p.value < best.value ? p : best), points[0]);
    const troughX = x(troughPoint.t);
    const troughY = y(troughPoint.value);
    append(svg, 'circle', {
      cx: troughX,
      cy: troughY,
      r: 3,
      class: 'chart-dot chart-dot--down',
    });
    append(svg, 'text', {
      x: Math.min(troughX + 7, pad.left + plotWidth - 2),
      y: Math.max(troughY - 7, pad.top + 10),
      'text-anchor': troughX > pad.left + plotWidth * 0.72 ? 'end' : 'start',
      class: 'chart-trough-label',
    }, fmtPct(ep.drawdown));

    // Date labels.
    append(svg, 'text', {
      x: pad.left,
      y: height - 5,
      'text-anchor': 'start',
      class: 'chart-axis',
    }, fmtMonth(points[0].date));
    append(svg, 'text', {
      x: troughX,
      y: height - 5,
      'text-anchor': 'middle',
      class: 'chart-axis',
    }, fmtMonth(troughPoint.date));
    append(svg, 'text', {
      x: pad.left + plotWidth,
      y: height - 5,
      'text-anchor': 'end',
      class: 'chart-axis',
    }, fmtMonth(points[points.length - 1].date));

    // Hover layer.
    const hoverGroup = append(svg, 'g', { opacity: '0' });
    const crosshair = append(hoverGroup, 'line', {
      y1: pad.top,
      y2: pad.top + plotHeight,
      class: 'chart-crosshair',
    });
    const dot = append(hoverGroup, 'circle', { r: 3, class: 'chart-dot' });
    const overlay = append(svg, 'rect', {
      x: pad.left,
      y: pad.top,
      width: plotWidth,
      height: plotHeight,
      fill: 'transparent',
      style: 'cursor: crosshair;',
    });
    const tip = makeTooltip(container);

    overlay.addEventListener('mousemove', (event) => {
      const rect = svg.getBoundingClientRect();
      const localX = ((event.clientX - rect.left) / rect.width) * width;
      if (localX < pad.left || localX > pad.left + plotWidth) {
        hideTooltip(tip);
        hoverGroup.setAttribute('opacity', '0');
        return;
      }
      const ratio = (localX - pad.left) / plotWidth;
      const targetT = domainStart + ratio * (domainEnd - domainStart);
      let lo = 0;
      let hi = points.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid].t < targetT) lo = mid + 1;
        else hi = mid;
      }
      const i = Math.max(1, Math.min(points.length - 1, lo));
      const item = points[i];
      const xx = x(item.t);
      const yy = y(item.value);
      crosshair.setAttribute('x1', xx);
      crosshair.setAttribute('x2', xx);
      dot.setAttribute('cx', xx);
      dot.setAttribute('cy', yy);
      hoverGroup.setAttribute('opacity', '1');
      const html = `<span class="tt-muted">${fmtDate(item.date)}</span><br><strong>${fmtNumber(item.close)}</strong><br><span class="tt-muted">收盘回撤 ${fmtPct((item.close / ep.peakClose - 1) * 100)}</span><br><span class="tt-muted">盘中回撤 ${fmtPct(item.value)}</span>`;
      showTooltip(tip, container, svg, width, height, xx, yy - 8, html);
    });
    overlay.addEventListener('mouseleave', () => {
      hideTooltip(tip);
      hoverGroup.setAttribute('opacity', '0');
    });

    const caption = document.createElement('p');
    caption.className = 'chart-caption';
    caption.textContent = '每日盘中最低价相对区间峰值';
    container.appendChild(caption);
  }

  /* ----------------------------- selection ----------------------------- */
  function selectEpisode(id, options = {}) {
    if (!EPISODE_BY_ID.has(id)) return;
    state.selected = id;
    syncSelection();
    renderDetail(EPISODE_BY_ID.get(id));
    if (options.scroll) {
      document.getElementById('cycles').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (options.updateHash !== false) {
      history.replaceState(null, '', `#ep-${id}`);
    }
  }

  function syncSelection() {
    document.querySelectorAll('[data-episode]').forEach((node) => {
      const active = node.dataset.episode === state.selected;
      if (node.classList.contains('chart-band')) {
        node.classList.toggle('is-active', active);
      }
      if (node.classList.contains('rail-item')) {
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-pressed', String(active));
      }
      if (node.classList.contains('ep-row')) {
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-selected', String(active));
        node.tabIndex = active ? 0 : -1;
      }
      if (node.classList.contains('matrix-cell')) {
        node.classList.toggle('is-selected', active);
      }
    });
    document.querySelectorAll('.matrix-col').forEach((node) => {
      node.classList.toggle('is-selected', node.dataset.episode === state.selected);
    });
  }

  /* ----------------------------- rail ----------------------------- */
  function buildRail() {
    const rail = document.getElementById('episodeRail');
    if (!rail) return;
    rail.innerHTML = '';
    EPISODES.forEach((ep) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rail-item';
      button.dataset.episode = ep.id;
      button.setAttribute('aria-pressed', String(ep.id === state.selected));
      button.setAttribute('aria-label', `${ep.period} ${ep.name}，最大回撤 ${fmtPct(ep.drawdown)}`);
      const width = Math.max(4, (Math.abs(ep.drawdown) / MAX_ABS_DRAWDOWN) * 100);
      button.innerHTML = `
        <span class="rail-item__meta"><span>${ep.no}</span><span>${ep.start.slice(0, 4)}</span></span>
        <span class="rail-item__dd">${fmtPct(ep.drawdown)}</span>
        <span class="rail-item__track"><span class="rail-item__bar" style="width:${width.toFixed(1)}%"></span></span>
      `;
      button.addEventListener('click', () => selectEpisode(ep.id, { scroll: true }));
      rail.appendChild(button);
    });
  }

  /* ----------------------------- episode list ----------------------------- */
  function buildEpisodeList() {
    const list = document.getElementById('episodeList');
    if (!list) return;
    list.innerHTML = '';
    EPISODES.forEach((ep) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ep-row';
      button.dataset.episode = ep.id;
      button.setAttribute('role', 'tab');
      button.id = `ep-tab-${ep.id}`;
      button.setAttribute('aria-label', `${ep.period} ${ep.name}${ep.status === 'ongoing' ? '，进行中' : ''}，最大回撤 ${fmtPct(ep.drawdown)}`);
      button.setAttribute('aria-controls', 'episodeDetail');
      button.setAttribute('aria-selected', String(ep.id === state.selected));
      button.tabIndex = ep.id === state.selected ? 0 : -1;
      button.innerHTML = `
        <span class="ep-row__no">${ep.no}</span>
        <span class="ep-row__body">
          <span class="ep-row__period">${ep.period}</span>
          <span class="ep-row__name">${ep.name}${ep.status === 'ongoing' ? '<span class="ep-row__live" aria-hidden="true"></span>' : ''}</span>
        </span>
        <span class="ep-row__dd">${fmtPct(ep.drawdown)}</span>
      `;
      button.addEventListener('click', () => selectEpisode(ep.id));
      list.appendChild(button);
    });

    list.addEventListener('keydown', (event) => {
      const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const currentIndex = EPISODES.findIndex((ep) => ep.id === state.selected);
      let nextIndex = currentIndex;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % EPISODES.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + EPISODES.length) % EPISODES.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = EPISODES.length - 1;
      const next = EPISODES[nextIndex];
      selectEpisode(next.id);
      document.getElementById(`ep-tab-${next.id}`)?.focus();
    });
  }

  /* ----------------------------- detail ----------------------------- */
  function renderDetail(ep) {
    const container = document.getElementById('episodeDetail');
    if (!container) return;

    const recovery =
      ep.status === 'ongoing'
        ? { value: '—', sub: '进行中' }
        : ep.recoveryDate
          ? { value: `${ep.recoveryMonths} 个月`, sub: fmtDate(ep.recoveryDate) }
          : { value: '未修复', sub: `峰值收盘 ${fmtNumber(ep.peakClose)}` };

    const oneYear =
      ep.oneYear == null
        ? { value: '—', sub: '暂无 250 个交易日' }
        : { value: fmtPct(ep.oneYear), sub: '低谷后 250 个交易日', cls: 'metric__value--down' };

    const threeMonth =
      ep.threeMonth == null ? null : fmtPct(ep.threeMonth);

    const crossMax = Math.max(...ep.cross.map((item) => Math.abs(item.value ?? 0)), 1);
    const crossHtml = ep.cross
      .map((item) => {
        if (item.value == null) {
          return `
            <div class="cross-row">
              <span class="cross-row__name">${item.name}</span>
              <span class="cross-row__track cross-row__track--empty"></span>
              <span class="cross-row__value cross-row__value--empty">—</span>
            </div>`;
        }
        const width = (Math.abs(item.value) / crossMax) * 100;
        return `
          <div class="cross-row">
            <span class="cross-row__name">${item.name}</span>
            <span class="cross-row__track"><span class="cross-row__bar" style="width:${width.toFixed(1)}%"></span></span>
            <span class="cross-row__value">${fmtPct(item.value)}</span>
          </div>`;
      })
      .join('');

    const timelineHtml = ep.events
      .map(
        (event) => `
          <li>
            <span class="timeline__date">${fmtDate(event.date)}</span>
            <span class="timeline__dot timeline__dot--${event.type}" aria-hidden="true"></span>
            <span class="timeline__label">${event.label}</span>
          </li>`,
      )
      .join('');

    const statusLabel = ep.status === 'ongoing' ? '进行中' : '已完成';
    const formLine = ep.status === 'ongoing' ? '尚未见底' : threeMonth ? `见底后 3 个月 ${threeMonth}` : '—';

    container.setAttribute('aria-labelledby', `ep-tab-${ep.id}`);
    container.innerHTML = `
      <header class="detail-head">
        <div>
          <p class="detail-kicker">${ep.no} / ${statusLabel}</p>
          <h3 class="detail-title" id="detailTitle">${ep.name}</h3>
          <p class="detail-period">${ep.period} · ${ep.tradingDays} 个交易日</p>
        </div>
        <div class="detail-drawdown">
          <span class="detail-drawdown__value">${fmtPct(ep.drawdown)}</span>
          <span class="detail-drawdown__label">最大回撤</span>
        </div>
      </header>

      <div class="detail-range">
        <span>${fmtNumber(ep.peak)}</span>
        <span class="detail-range__arrow">→</span>
        <span>${fmtNumber(ep.trough)}</span>
      </div>

      <div class="chart chart--detail" id="detailChart" role="img" aria-label="${ep.name}回撤路径"></div>

      <div class="metric-grid">
        <div class="metric">
          <span class="metric__label">持续</span>
          <span class="metric__value">${ep.months} 个月</span>
          <span class="metric__sub">${ep.tradingDays} 个交易日</span>
        </div>
        <div class="metric">
          <span class="metric__label">单日最大回撤</span>
          <span class="metric__value metric__value--down">${fmtPct(ep.maxDay, 2)}</span>
          <span class="metric__sub">${fmtDate(ep.maxDayDate)}</span>
        </div>
        <div class="metric">
          <span class="metric__label">成交额萎缩</span>
          <span class="metric__value">${ep.amountShrink}×</span>
          <span class="metric__sub">${fmtMillions(ep.amountPeak)} → ${fmtMillions(ep.amountMin)}</span>
        </div>
        <div class="metric">
          <span class="metric__label">见底后 12 个月</span>
          <span class="metric__value ${oneYear.cls ?? ''}">${oneYear.value}</span>
          <span class="metric__sub">${oneYear.sub}</span>
        </div>
        <div class="metric">
          <span class="metric__label">修复前高</span>
          <span class="metric__value ${recovery.value === '—' || recovery.value === '未修复' ? 'metric__value--muted' : ''}">${recovery.value}</span>
          <span class="metric__sub">${recovery.sub}</span>
        </div>
        <div class="metric">
          <span class="metric__label">底部形态</span>
          <span class="metric__value">${ep.form}</span>
          <span class="metric__sub">${formLine}</span>
        </div>
      </div>

      <div class="detail-cols">
        <section class="detail-block">
          <h4>核心原因</h4>
          <p>${ep.cause}</p>
        </section>
        <section class="detail-block">
          <h4>反转触发</h4>
          <p>${ep.reversal}</p>
        </section>
      </div>

      <div class="detail-lower">
        <section>
          <div class="subhead"><h4>指数分化</h4><span>区间最大回撤</span></div>
          <div class="cross-bars">${crossHtml}</div>
        </section>
        <section>
          <div class="subhead"><h4>关键节点</h4><span>${ep.events.length} 项</span></div>
          <ol class="timeline">${timelineHtml}</ol>
        </section>
      </div>
    `;

    container.classList.remove('is-entering');
    void container.offsetWidth;
    container.classList.add('is-entering');
    renderEpisodeChart(ep);
  }

  /* ----------------------------- hero stats ----------------------------- */
  function renderStats() {
    const target = document.getElementById('statStrip');
    if (!target) return;
    const s = DATA.summary;
    const heroSummary = document.getElementById('heroSummary');
    if (heroSummary) {
      heroSummary.textContent = `${s.total} 轮 · ${s.completed} 轮完成 · ${s.ongoing} 轮进行中`;
    }
    const stats = [
      [String(s.total), '轮波段回撤'],
      [fmtPct(s.avgDrawdown), '已完成平均最大回撤'],
      [`${s.avgMonths} 月`, '已完成平均持续'],
      [fmtPct(s.avgOneYear), '见底后 12 个月均值'],
      [fmtPct(s.currentDrawdown), '当前回撤 · 磨底中'],
    ];
    target.innerHTML = stats
      .map(
        ([value, label], i) => `
          <div class="stat${i === stats.length - 1 ? ' stat--current' : ''}">
            <span class="stat__value">${value}</span>
            <span class="stat__label">${label}</span>
          </div>`,
      )
      .join('');
  }

  /* ----------------------------- driver matrix ----------------------------- */
  function renderMatrix() {
    const target = document.getElementById('driverMatrix');
    if (!target) return;
    const drivers = [
      { kind: '内因', label: '估值 / 杠杆 / 拥挤', ids: ['2008', '2016', '2022', '2024', '2026'] },
      { kind: '加速器', label: '紧信用 / 流动性踩踏', ids: ['2008', '2013', '2016', '2019', '2022', '2024', '2026'] },
      { kind: '催化剂', label: '外部宏观冲击', ids: ['2008', '2019', '2022', '2024', '2025', '2026'] },
    ];
    const header = EPISODES.map(
      (ep) => `<th scope="col" class="matrix-col${ep.id === state.selected ? ' is-selected' : ''}" data-episode="${ep.id}">${ep.no}<span>’${ep.start.slice(2, 4)}</span></th>`,
    ).join('');
    const body = drivers
      .map(
        (driver) => `
          <tr>
            <th scope="row" class="matrix-row-label"><span class="matrix__kind">${driver.kind}</span><span>${driver.label}</span></th>
            ${EPISODES.map(
              (ep) => `<td class="matrix-cell${ep.id === state.selected ? ' is-selected' : ''}" data-episode="${ep.id}"><span class="dot ${driver.ids.includes(ep.id) ? '' : 'dot--off'}" aria-label="${driver.label}${driver.ids.includes(ep.id) ? '：具备' : '：不具备'}"></span></td>`,
            ).join('')}
          </tr>`,
      )
      .join('');
    target.innerHTML = `<thead><tr><th class="matrix-corner" aria-label="驱动类型"></th>${header}</tr></thead><tbody>${body}</tbody>`;
  }

  /* ----------------------------- stage grid ----------------------------- */
  function renderStages() {
    const target = document.getElementById('stageGrid');
    if (!target) return;
    const stages = [
      {
        no: '01',
        title: '政策底',
        desc: '打破下跌惯性',
        items: ['印花税单边、汇金增持（2008）', '高层喊话、民企纾困（2018）', '央行结构性工具（2024）', '稳市机制（2025）'],
      },
      {
        no: '02',
        title: '市场底',
        desc: '筹码与情绪出清',
        items: ['强势股补跌', '地量与低换手', '对利空钝化', '极端股债性价比'],
      },
      {
        no: '03',
        title: '主升反转',
        desc: '增量逻辑确认',
        items: ['流动性 / 预期驱动：2014、2019、2024', '盈利周期驱动：2009、2016—2017'],
      },
    ];
    target.innerHTML = stages
      .map(
        (stage) => `
          <section class="stage-card">
            <span class="stage-card__no">${stage.no}</span>
            <h3>${stage.title}</h3>
            <p class="stage-card__desc">${stage.desc}</p>
            <ul>${stage.items.map((item) => `<li>${item}</li>`).join('')}</ul>
          </section>`,
      )
      .join('');
  }

  /* ----------------------------- data table ----------------------------- */
  function renderTable() {
    const tbody = document.querySelector('#dataTable tbody');
    if (!tbody) return;
    tbody.innerHTML = EPISODES.map((ep) => {
      const oneYear = ep.oneYear == null
        ? '<span class="is-muted">—</span>'
        : `<span class="is-up">${fmtPct(ep.oneYear)}</span>`;
      const recovery = ep.status === 'ongoing'
        ? '<span class="is-muted">—</span>'
        : ep.recoveryDate
          ? `${ep.recoveryMonths} 月`
          : '<span class="is-muted">未修复</span>';
      const live = ep.status === 'ongoing' ? '<span class="ep-row__live" aria-hidden="true"></span>' : '';
      return `
        <tr>
          <td>
            <span class="table-range">
              <span class="table-range__name">${ep.name}${live}</span>
              <span class="table-range__period">${ep.period}</span>
            </span>
          </td>
          <td><span class="table-pair">${fmtNumber(ep.peak)} <i>→</i> ${fmtNumber(ep.trough)}</span></td>
          <td class="num is-down">${fmtPct(ep.drawdown)}</td>
          <td class="num">${ep.months} 月</td>
          <td class="num is-down">${fmtPct(ep.maxDay, 2)}</td>
          <td class="num">${ep.amountShrink}×</td>
          <td class="num">${oneYear}</td>
          <td class="num">${recovery}</td>
        </tr>`;
    }).join('');
  }

  /* ----------------------------- theme ----------------------------- */
  function initTheme() {
    const button = document.getElementById('themeToggle');
    const meta = document.querySelector('meta[name="theme-color"]');
    const applyMeta = () => {
      if (!meta) return;
      meta.setAttribute('content', document.documentElement.dataset.theme === 'dark' ? '#0e0f11' : '#fcfcfd');
    };
    applyMeta();
    button?.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch (e) {}
      applyMeta();
    });
  }

  /* ----------------------------- nav ----------------------------- */
  function initNav() {
    const links = [...document.querySelectorAll('[data-nav]')];
    const sections = links
      .map((link) => ({ link, section: document.getElementById(link.dataset.nav) }))
      .filter((item) => item.section);
    if (!sections.length) return;
    let ticking = false;
    const update = () => {
      const y = window.scrollY + 120;
      let active = sections[0];
      for (const item of sections) {
        if (item.section.offsetTop <= y) active = item;
      }
      links.forEach((link) => {
        const isActive = link === active.link;
        link.classList.toggle('is-active', isActive);
        if (isActive) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
    update();
  }

  /* ----------------------------- init ----------------------------- */
  function init() {
    const hash = /^#ep-(\d{4})$/.exec(window.location.hash);
    if (hash && EPISODE_BY_ID.has(hash[1])) state.selected = hash[1];

    buildRail();
    buildEpisodeList();
    renderMatrix();
    renderStages();
    renderStats();
    renderTable();
    syncSelection();
    renderOverviewChart();
    renderDetail(EPISODE_BY_ID.get(state.selected));
    initTheme();
    initNav();

    document.querySelectorAll('[data-scale]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.scale === state.scale);
      button.addEventListener('click', () => {
        state.scale = button.dataset.scale;
        document.querySelectorAll('[data-scale]').forEach((item) => {
          item.classList.toggle('is-active', item === button);
        });
        renderOverviewChart();
      });
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        renderOverviewChart();
        const ep = EPISODE_BY_ID.get(state.selected);
        if (ep) renderEpisodeChart(ep);
      }, 140);
    });

    if (hash) {
      window.requestAnimationFrame(() => {
        document.getElementById('cycles')?.scrollIntoView({ block: 'start' });
      });
    }

    window.addEventListener('hashchange', () => {
      const next = /^#ep-(\d{4})$/.exec(window.location.hash);
      if (next && EPISODE_BY_ID.has(next[1]) && next[1] !== state.selected) {
        selectEpisode(next[1], { updateHash: false });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
