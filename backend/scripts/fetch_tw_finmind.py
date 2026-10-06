"""用 FinMind 抓台股流動池的「月營收歷史 + 季報(淨利/EPS)」。
免 token 有流量限制 → 加 sleep + 402 退避。存 data/tw_revenue/{code}.json、data/tw_financials/{code}.json"""
import json, time, sys
from pathlib import Path
import httpx

REV = Path("data/tw_revenue"); REV.mkdir(parents=True, exist_ok=True)
FIN = Path("data/tw_financials"); FIN.mkdir(parents=True, exist_ok=True)
API = "https://api.finmindtrade.com/api/v4/data"
codes = json.load(open("data/tw_universe.json"))

def get(c, dataset, data_id, start="2018-01-01"):
    r = c.get(API, params={"dataset": dataset, "data_id": data_id, "start_date": start})
    if r.status_code == 402:
        return "LIMIT"
    return r.json().get("data", [])

def run():
    print(f"FinMind 抓 {len(codes)} 檔(月營收+季報)", flush=True)
    okr = okf = 0
    with httpx.Client(timeout=40, verify=False) as c:
        for i, code in enumerate(codes):
            rev = get(c, "TaiwanStockMonthRevenue", code)
            if rev == "LIMIT":
                print("RATE LIMIT 月營收 @", i, "→ 等 65s", flush=True); time.sleep(65); rev = get(c, "TaiwanStockMonthRevenue", code)
            if isinstance(rev, list) and rev:
                (REV / f"{code}.json").write_text(json.dumps(
                    [{"month": f"{r['revenue_year']}{r['revenue_month']:02d}", "revenue": r["revenue"]} for r in rev],
                    ensure_ascii=False), encoding="utf-8"); okr += 1
            time.sleep(1.2)
            fin = get(c, "TaiwanStockFinancialStatements", code)
            if fin == "LIMIT":
                print("RATE LIMIT 季報 @", i, "→ 等 65s", flush=True); time.sleep(65); fin = get(c, "TaiwanStockFinancialStatements", code)
            if isinstance(fin, list) and fin:
                (FIN / f"{code}.json").write_text(json.dumps(fin, ensure_ascii=False), encoding="utf-8"); okf += 1
            time.sleep(1.2)
            if i % 25 == 0: print(f"{i}/{len(codes)} 營收{okr} 季報{okf}", flush=True)
    print(f"完成:月營收 {okr} 檔,季報 {okf} 檔", flush=True)

if __name__ == "__main__":
    run()
