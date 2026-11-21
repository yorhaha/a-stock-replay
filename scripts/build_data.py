#!/usr/bin/env python3
"""Build the static data bundle for the A-share drawdown review.

Input : data_raw/sh000001.json + cross-index files from Eastmoney.
Output: assets/data.js, assets/episodes.csv
"""
import json, csv, datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data_raw"
OUT = ROOT / "assets"

def load(name):
    raw = json.loads((RAW / f"{name}.json").read_text())
    rows = []
    for line in raw["rows"]:
        p = line.split(",")
        rows.append({
            "date": p[0],
            "open": float(p[1]),
            "close": float(p[2]),
            "high": float(p[3]),
            "low": float(p[4]),
            "amount": float(p[6]),
        })
    return raw["name"], rows

INDEX, SSE = load("sh000001")
_, CHINEXT = load("sz399006")
_, CSI300 = load("sh000300")
_, CSI1000 = load("sh000852")
_, SSE50 = load("sh000016")

def index_of(rows, date):
    for i, r in enumerate(rows):
        if r["date"] == date:
            return i
    raise KeyError(date)

def episode_stats(start, end):
    i0, i1 = index_of(SSE, start), index_of(SSE, end)
    seg = SSE[i0:i1 + 1]
    hi = max(seg, key=lambda r: r["high"])
    lo = min(seg, key=lambda r: r["low"])
    peak_close, trough_close = SSE[i0]["close"], SSE[i1]["close"]
    max_day = min(((seg[i]["close"] / seg[i - 1]["close"] - 1) * 100, seg[i]["date"])
                  for i in range(1, len(seg)))
    def avg_amount(i, n=20):
        a = SSE[max(0, i - n + 1):i + 1]
        return sum(x["amount"] for x in a) / len(a) / 1e8
    amount_peak = avg_amount(i0)
    amt_candidates = [(avg_amount(k), SSE[k]["date"]) for k in range(i0 + 19, i1 + 1)] if i1 - i0 >= 19 else [(avg_amount(i1), end)]
    amount_min, amount_min_date = min(amt_candidates, key=lambda x: x[0])
    # minimum single-day amount
    daily_min = min(seg, key=lambda r: r["amount"])
    # returns after trough
    def ret_after(n):
        j = min(i1 + n, len(SSE) - 1)
        return round((SSE[j]["close"] / trough_close - 1) * 100, 1), SSE[j]["date"]
    ongoing = end >= SSE[-1]["date"]
    ret3, _ = ret_after(60)
    ret12, _ = ret_after(250)
    if ongoing:
        ret3 = None
        ret12 = None
    rec = None
    for j in range(i1 + 1, len(SSE)):
        if SSE[j]["close"] >= peak_close:
            rec = SSE[j]
            break
    rec_months = round((dt.date.fromisoformat(rec["date"]) - dt.date.fromisoformat(end)).days / 30.44, 1) if rec else None
    return {
        "peak": round(hi["high"], 2),
        "peakDate": hi["date"],
        "trough": round(lo["low"], 2),
        "troughDate": lo["date"],
        "drawdown": round((lo["low"] / hi["high"] - 1) * 100, 2),
        "peakClose": round(peak_close, 2),
        "troughClose": round(trough_close, 2),
        "tradingDays": len(seg),
        "calendarDays": (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days,
        "months": round((dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days / 30.44, 1),
        "maxDay": round(max_day[0], 2),
        "maxDayDate": max_day[1],
        "amountPeak": round(amount_peak),
        "amountMin": round(amount_min),
        "amountMinDate": amount_min_date,
        "amountShrink": round(amount_peak / amount_min, 1),
        "minDailyAmount": round(daily_min["amount"] / 1e8),
        "minDailyDate": daily_min["date"],
        "oneYear": ret12,
        "threeMonth": ret3,
        "recoveryDate": rec["date"] if rec else None,
        "recoveryMonths": rec_months,
    }

def cross_stats(start, end):
    out = []
    for name, rows in [("上证指数", SSE), ("沪深300", CSI300), ("上证50", SSE50), ("中证1000", CSI1000), ("创业板指", CHINEXT)]:
        seg = [r for r in rows if start <= r["date"] <= end]
        if not seg:
            out.append({"name": name, "value": None})
            continue
        hi = max(seg, key=lambda r: r["high"])
        lo = min(seg, key=lambda r: r["low"])
        out.append({"name": name, "value": round((lo["low"] / hi["high"] - 1) * 100, 1)})
    return out

EPISODES = [
    dict(
        id="2008", no="01", name="次贷危机", period="2007.10—2008.10", start="2007-10-16", end="2008-10-28",
        status="completed", form="深 V 反转",
        tags=["估值泡沫", "加息提准", "大小非解禁", "次贷危机"],
        cause="极端估值泡沫破裂；国内加息提准防通胀；大小非解禁；全球次贷危机爆发。",
        reversal="“四万亿”财政刺激；货币政策双降；印花税单边征收；汇金增持。",
        events=[
            ("2008-09-15", "雷曼兄弟破产", "external"),
            ("2008-09-18", "印花税单边征收、汇金增持", "policy"),
            ("2008-10-09", "降息 0.27pct、降准 0.5pct", "policy"),
            ("2008-11-05", "四万亿投资计划", "policy"),
        ],
    ),
    dict(
        id="2013", no="02", name="钱荒与增速换挡", period="2009.08—2013.06", start="2009-08-04", end="2013-06-25",
        status="completed", form="长期磨底",
        tags=["四万亿后紧缩", "经济换挡", "钱荒"],
        cause="“四万亿”后高通胀引发紧缩；经济增速换挡；2013 年银行间“钱荒”。",
        reversal="2014 年重启降息降准周期；沪港通开通；改革预期与融资加杠杆。",
        events=[
            ("2013-06-20", "银行间市场“钱荒”", "liquidity"),
            ("2013-06-25", "上证指数见底 1849.65", "market"),
            ("2014-11-17", "沪港通开通", "policy"),
            ("2014-11-21", "央行重启降息", "policy"),
        ],
    ),
    dict(
        id="2016", no="03", name="去杠杆与熔断", period="2015.06—2016.01", start="2015-06-12", end="2016-01-27",
        status="completed", form="杠杆踩踏",
        tags=["场外配资", "8·11 汇改", "熔断"],
        cause="清理场外配资引发去杠杆踩踏；“8·11 汇改”；2016 年初熔断机制导致流动性枯竭。",
        reversal="叫停熔断 + 国家队托底；供给侧改革与棚改货币化带动 2016—2017 年盈利复苏。",
        events=[
            ("2015-06-15", "清理场外配资", "policy"),
            ("2015-07-04", "券商联合救市", "policy"),
            ("2015-08-11", "“8·11”汇改", "policy"),
            ("2016-01-04", "熔断机制生效", "policy"),
            ("2016-01-08", "暂停熔断", "policy"),
        ],
    ),
    dict(
        id="2019", no="04", name="贸易摩擦与信用收缩", period="2018.01—2019.01", start="2018-01-29", end="2019-01-04",
        status="completed", form="政策底 → 市场底",
        tags=["资管新规", "贸易摩擦", "股权质押"],
        cause="资管新规驱动金融去杠杆；中美贸易摩擦；民企股权质押爆仓危机。",
        reversal="2018 年 10 月高层喊话与民企座谈会（政策底）+ 纾困基金；2019 年 1 月全面降准宽信用 + 美联储转鸽。",
        events=[
            ("2018-03-22", "美国 301 调查", "external"),
            ("2018-04-27", "资管新规发布", "policy"),
            ("2018-10-19", "高层喊话稳定市场", "policy"),
            ("2018-11-01", "民营企业座谈会", "policy"),
            ("2019-01-04", "全面降准 1 个百分点", "policy"),
        ],
    ),
    dict(
        id="2022", no="05", name="抱团出清与全球加息", period="2021.02—2022.10", start="2021-02-18", end="2022-10-31",
        status="completed", form="二次探底",
        tags=["茅指数", "地产三条红线", "美联储加息", "俄乌冲突"],
        cause="“茅指数 / 宁组合”估值泡沫出清；地产“三条红线”与平台监管；美联储暴力加息；疫情封控与俄乌冲突。",
        reversal="2022 年 11 月防疫政策优化（“二十条”）+ 地产融资“三支箭”落地，触发估值修复。",
        events=[
            ("2021-07-24", "教育“双减”落地", "policy"),
            ("2022-02-24", "俄乌冲突爆发", "external"),
            ("2022-03-16", "金融委专题会议", "policy"),
            ("2022-04-27", "第一次低点 2863.65", "market"),
            ("2022-10-31", "二次低点 2885.09", "market"),
            ("2022-11-11", "防疫“二十条”", "policy"),
            ("2022-11-28", "地产融资“三支箭”", "policy"),
        ],
    ),
    dict(
        id="2024", no="06", name="地产拖累与微盘踩踏", period="2023.05—2024.09", start="2023-05-09", end="2024-09-18",
        status="completed", form="政策底后二次探底",
        tags=["通缩担忧", "外资流出", "雪球敲入", "量化踩踏"],
        cause="疫后复苏偏弱与通缩担忧；地产持续拖累；外资流出；2024 年初雪球敲入与量化微盘股踩踏。",
        reversal="2024 年“9·24”政策大转向：降准降息、降存量房贷、创设互换便利（SFISF）与回购再贷款 + 政治局会议定调地产“止跌回稳”。",
        events=[
            ("2023-08-27", "印花税减半", "policy"),
            ("2024-02-05", "低点 2635.09", "market"),
            ("2024-02-06", "汇金扩大增持", "policy"),
            ("2024-04-12", "新“国九条”", "policy"),
            ("2024-09-18", "二次低点 2689.70", "market"),
            ("2024-09-24", "降准降息、SFISF、回购再贷款", "policy"),
            ("2024-09-26", "政治局会议定调“止跌回稳”", "policy"),
        ],
    ),
    dict(
        id="2025", no="07", name="对等关税", period="2025.03—2025.04", start="2025-03-19", end="2025-04-07",
        status="completed", form="事件型急跌",
        tags=["对等关税", "全球抛售", "国家队护盘"],
        cause="美国宣布大规模“对等关税”引发全球股市恐慌性抛售与贸易战担忧。",
        reversal="国内稳市机制与“国家队”迅速入场护盘 + 关税博弈预期边际缓和，5 月下旬收复失地。",
        events=[
            ("2025-04-02", "美国宣布“对等关税”", "external"),
            ("2025-04-07", "单日 -7.34%，低点 3040.69", "market"),
            ("2025-04-08", "汇金、央企增持稳市", "policy"),
            ("2025-05-12", "中美日内瓦经贸联合声明", "external"),
            ("2025-05-14", "收复 4 月 3 日收盘位", "market"),
        ],
    ),
    dict(
        id="2026", no="08", name="AI 拥挤交易出清", period="2026.05—至今", start="2026-05-14", end="2026-11-20",
        status="ongoing", form="磨底进行中",
        tags=["AI 算力拥挤", "美联储加息预期", "地缘冲突", "高切低"],
        cause="上半年 AI 硬件与算力主线交易极度拥挤后的集中了结与踩踏；美联储 12 月加息预期升温；海外地缘冲突压制。",
        reversal="尚处于磨底期：“高切低”与防御板块护盘，等待放量企稳与增量资金共识确认。",
        events=[
            ("2026-05-14", "上证高点 4258.86", "market"),
            ("2026-06-25", "创业板高点 4380.41", "market"),
            ("2026-07-17", "单日 -3.05%", "market"),
            ("2026-10-30", "20 日均成交额阶段低点 7397 亿", "liquidity"),
            ("2026-11-20", "盘中低点 3500.83", "market"),
        ],
    ),
]

episodes = []
for ep in EPISODES:
    stats = episode_stats(ep["start"], ep["end"])
    ep = {**ep, **stats, "cross": cross_stats(ep["start"], ep["end"])}
    episode_list = [
        {"date": d, "label": l, "type": t} for d, l, t in ep.pop("events")
    ]
    ep["events"] = episode_list
    episodes.append(ep)

completed = [e for e in episodes if e["status"] == "completed"]
summary = {
    "total": len(episodes),
    "completed": len(completed),
    "ongoing": len(episodes) - len(completed),
    "avgDrawdown": round(sum(e["drawdown"] for e in completed) / len(completed), 1),
    "avgMonths": round(sum(e["months"] for e in completed) / len(completed), 1),
    "avgOneYear": round(sum(e["oneYear"] for e in completed) / len(completed), 1),
    "maxDrawdown": min(e["drawdown"] for e in episodes),
    "currentDrawdown": episodes[-1]["drawdown"],
}

# Long series starts 2006-01-01.
series = []
for r in SSE:
    if r["date"] >= "2006-01-01":
        series.append([r["date"], round(r["close"], 2), round(r["high"], 2), round(r["low"], 2), round(r["amount"] / 1e8)])

payload = {
    "meta": {
        "index": "上证指数",
        "code": "000001",
        "start": series[0][0],
        "end": series[-1][0],
        "generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "东方财富 · 日线",
    },
    "summary": summary,
    "series": series,
    "episodes": episodes,
}

OUT.mkdir(exist_ok=True)
(OUT / "data.js").write_text("window.MARKET_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")

# CSV companion
cols = ["no", "name", "period", "start", "end", "peak", "trough", "drawdown", "months", "tradingDays", "maxDay", "amountPeak", "amountMin", "amountShrink", "oneYear", "recoveryMonths", "form"]
with (OUT / "episodes.csv").open("w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for e in episodes:
        w.writerow({k: e.get(k) for k in cols})

print(json.dumps(summary, ensure_ascii=False, indent=2))
print(f"series {len(series)} points, episodes {len(episodes)}")
print(f"data.js { (OUT/'data.js').stat().st_size/1024:.0f} KB")
