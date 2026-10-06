# AlphaZero 式訓練:同時訓練策略網路和價值網路。
# 用法:python3 tools/nn/train_az.py <資料夾1> [資料夾2 ...]
#   每個資料夾放 gen-data.mjs 產生的 part*.bin;每個資料夾最後 3 個檔案當驗證集(不同局,不會洩漏)
# 輸出 tools/nn/models/nn-policy.json、nn-value.json(sim.mjs 的 nn / az 座位讀這兩個)
#
# 策略網路:局面特徵 + 期望值建議的 one-hot → 256 → 128 → 交易 10 / 擲骰 2
#   type 0/1(蒙地卡羅的決定):學它選了哪個;type 3/4(az 自我對弈):學 MCTS 的搜尋次數分布(soft target)
# 價值網路:局面特徵 → 256 → 128 → 拿第一的機率(sigmoid)+ 領先差距(輔助)
#   所有紀錄都用,目標是這位玩家那一局最後的結果(贏 1、平手 0.5、輸 0)
import glob, json, sys, time
import numpy as np, torch, torch.nn as nn

import os
dirs = sys.argv[1:] or ['tools/nn/data/gen0']
OUT = os.environ.get('OUT', 'tools/nn/models'); os.makedirs(OUT, exist_ok=True)   # 輸出資料夾(每一代各自一個)
EPOCHS = 12
meta = json.load(open(glob.glob(f'{dirs[0]}/part*.json')[0]))
C = {n: i for i, n in enumerate(meta['cols'])}; W = len(meta['cols']); DIM = meta['dim']; NA = 10
F0, M0, Q0 = C['f0'], C['mask0'], C['q0']
key = lambda s: int(s.split('part')[-1].split('.')[0])
tr_files, va_files = [], []
for d in dirs:
    fs = sorted(glob.glob(f'{d}/part*.bin'), key=key); tr_files += fs[:-3]; va_files += fs[-3:]
load = lambda fs: np.concatenate([np.fromfile(f, dtype=np.float32).reshape(-1, W) for f in fs])
tr, va = load(tr_files), load(va_files)
print(f'資料夾 {dirs}:訓練 {len(tr):,} 筆、驗證 {len(va):,} 筆;類型 {dict(zip(*np.unique(tr[:, 0], return_counts=True)))}')
dev = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
mu = tr[:, F0:F0 + DIM].mean(0); sd = tr[:, F0:F0 + DIM].std(0) + 1e-3
T = lambda a: torch.tensor(a).to(dev)

def mlp(inp):
    return nn.Sequential(nn.Linear(inp, 256), nn.ReLU(), nn.Linear(256, 128), nn.ReLU())
r = lambda t: [round(float(v), 5) for v in t.reshape(-1)]
pack = lambda L: {'in': L.weight.shape[1], 'out': L.weight.shape[0], 'w': r(L.weight.detach().cpu()), 'b': r(L.bias.detach().cpu())}
def fold(L, extra=0):   # 把標準化併進第一層(後面 extra 欄不標準化)
    w = L.weight.detach().cpu(); wf = w[:, :DIM] / torch.tensor(sd); b = L.bias.detach().cpu() - (wf * torch.tensor(mu)).sum(1)
    return {'in': w.shape[1], 'out': w.shape[0], 'w': r(torch.cat([wf, w[:, DIM:]], 1)), 'b': r(b)}

# ───────── 策略網路 ─────────
def pol_tensors(a):
    a = a[a[:, 0] != 2]
    bo = np.zeros((len(a), NA), np.float32); bo[np.arange(len(a)), a[:, C['base']].astype(int)] = 1
    x = np.concatenate([(a[:, F0:F0 + DIM] - mu) / sd, bo], 1)
    mask = a[:, M0:M0 + NA]; kind = a[:, 0].astype(int)
    tgt = np.zeros((len(a), NA), np.float32)
    hard = (kind == 0) | (kind == 1); tgt[np.where(hard)[0], a[hard, C['chosen']].astype(int)] = 1
    soft = (kind == 3) | (kind == 4); tgt[soft] = a[soft, Q0:Q0 + NA]
    isDice = ((kind == 1) | (kind == 4)).astype(np.float32)
    return [T(v) for v in (x, mask, tgt, isDice, a[:, C['chosen']].astype(np.int64), a[:, C['base']].astype(np.int64))]
class Pol(nn.Module):
    def __init__(s): super().__init__(); s.body = mlp(DIM + NA); s.trade = nn.Linear(128, NA); s.dice = nn.Linear(128, 2)
    def forward(s, x, isDice):
        h = s.body(x); lt = s.trade(h); ld = torch.cat([s.dice(h), torch.full((len(x), NA - 2), -1e9, device=x.device)], 1)
        return torch.where(isDice[:, None] > 0, ld, lt)
def pol_loss(net, Tn, idx):
    x, mask, tgt, isD, ch, bs = (t[idx] for t in Tn)
    lg = net(x, isD).masked_fill(mask == 0, -1e9)
    return -(tgt * torch.log_softmax(lg, 1)).sum(1).mean(), lg
TRp, VAp = pol_tensors(tr), pol_tensors(va)
pol = Pol().to(dev); opt = torch.optim.AdamW(pol.parameters(), lr=1e-3, weight_decay=1e-4); sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)
@torch.no_grad()
def pol_eval():
    pol.eval(); n = len(VAp[0]); ok = base = dn = dok = 0
    for i in range(0, n, 65536):
        idx = torch.arange(i, min(n, i + 65536), device=dev); _, lg = pol_loss(pol, VAp, idx); x, mask, tgt, isD, ch, bs = (t[idx] for t in VAp)
        pr = lg.argmax(1); ok += int((pr == ch).sum()); base += int((bs == ch).sum()); dv = bs != ch; dn += int(dv.sum()); dok += int((pr == ch)[dv].sum())
    pol.train(); return ok / n, base / n, dok / max(1, dn)
n = len(TRp[0]); t0 = time.time()
for ep in range(EPOCHS):
    perm = torch.randperm(n, device=dev)
    for i in range(0, n, 4096): l, _ = pol_loss(pol, TRp, perm[i:i + 4096]); opt.zero_grad(); l.backward(); opt.step()
    sch.step()
acc, base, dacc = pol_eval()
print(f'策略網路:驗證集選擇一致 {acc:.1%}(照期望值建議 {base:.1%});不照建議的猜對 {dacc:.1%}  {time.time() - t0:.0f}s')
json.dump({'kind': 'policy', 'dim': DIM, 'baseOneHot': NA, 'actions': meta['actions'], 'trained': time.strftime('%Y-%m-%d %H:%M'), 'data': dirs,
           'layers': [fold(pol.body[0]), pack(pol.body[2])], 'trade': pack(pol.trade), 'dice': {**pack(pol.dice)}, 'val': {'acc': acc, 'base': base, 'devAcc': dacc}},
          open(f'{OUT}/nn-policy.json', 'w'), separators=(',', ':'))

# ───────── 價值網路 ─────────
def val_tensors(a):
    return [T(v) for v in ((a[:, F0:F0 + DIM] - mu) / sd, a[:, C['win']], np.clip(a[:, C['margin']], -3, 3))]
class Val(nn.Module):   # 同一局的局面很像,很容易背答案(過擬合):加 dropout、權重衰減大一點、每個 epoch 看驗證集,留最好的那個
    def __init__(s): super().__init__(); s.body = nn.Sequential(nn.Linear(DIM, 128), nn.ReLU(), nn.Dropout(0.3), nn.Linear(128, 64), nn.ReLU(), nn.Dropout(0.3)); s.win = nn.Linear(64, 1); s.margin = nn.Linear(64, 1)
    def forward(s, x): h = s.body(x); return s.win(h)[:, 0], s.margin(h)[:, 0]
TRv, VAv = val_tensors(tr), val_tensors(va)
val = Val().to(dev); opt = torch.optim.AdamW(val.parameters(), lr=5e-4, weight_decay=1e-2)
bce = nn.functional.binary_cross_entropy_with_logits
@torch.no_grad()
def val_loss():
    val.eval(); x, w, m = VAv; p = torch.cat([val(x[i:i + 65536])[0] for i in range(0, len(x), 65536)]); val.train(); return float(bce(p, w))
n = len(TRv[0]); t0 = time.time(); best, best_state = 9, None
for ep in range(30):
    perm = torch.randperm(n, device=dev)
    for i in range(0, n, 8192):
        idx = perm[i:i + 8192]; x, w, m = (t[idx] for t in TRv); lw, lm = val(x)
        l = bce(lw, w) + 0.2 * ((lm - m) ** 2).mean(); opt.zero_grad(); l.backward(); opt.step()
    vl = val_loss(); print(f'  價值網路 epoch {ep + 1}: 驗證 log loss {vl:.4f}')
    if vl < best: best, best_state, bad = vl, {k: v.clone() for k, v in val.state_dict().items()}, 0
    else:
        bad += 1
        if bad >= 3: break
val.load_state_dict(best_state)
with torch.no_grad():
    val.eval(); x, w, m = VAv; p = torch.cat([torch.sigmoid(val(x[i:i + 65536])[0]) for i in range(0, len(x), 65536)])
    base_rate = float(w.mean()); ll = float(bce(torch.logit(p.clamp(1e-4, 1 - 1e-4)), w)); ll0 = float(bce(torch.full_like(w, float(np.log(base_rate / (1 - base_rate)))), w))
    acc = float(((p > 0.5) == (w > 0.5)).float().mean())
    bins = [(float(lo), float(p[(p >= lo) & (p < lo + 0.2)].mean()), float(w[(p >= lo) & (p < lo + 0.2)].mean()), int(((p >= lo) & (p < lo + 0.2)).sum())) for lo in torch.arange(0, 1, 0.2)]
print(f'價值網路:驗證集 log loss {ll:.4f}(只猜平均勝率 {ll0:.4f}),猜輸贏的準確率 {acc:.1%}  {time.time() - t0:.0f}s')
for lo, pm, wm, k in bins: print(f'  預測 {lo:.1f}~{lo + 0.2:.1f}:平均預測 {pm:.2f},實際勝率 {wm:.2f}({k:,} 筆)')
json.dump({'kind': 'value', 'dim': DIM, 'trained': time.strftime('%Y-%m-%d %H:%M'), 'data': dirs,
           'layers': [fold(val.body[0]), pack(val.body[3])], 'win': pack(val.win), 'val': {'logloss': ll, 'base': ll0, 'acc': acc}},
          open(f'{OUT}/nn-value.json', 'w'), separators=(',', ':'))
print(f'saved {OUT}/nn-policy.json, nn-value.json')
