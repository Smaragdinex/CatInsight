# 策略網路:模仿蒙地卡羅(困難電腦)的決定。
# 用法:python3 tools/nn/train_policy.py [epochs]
# 輸入 tools/nn/data/part*.bin(gen-data.mjs 產生),輸出 tools/nn/models/nn-policy.json(模擬器的 nn 座位讀這個;遊戲還沒用)
#
# 網路:205 個特徵 → 256 → 128(共用),接三個頭
#   trade  10 個交易動作的 logits(不能做的動作遮掉),學蒙地卡羅選了哪個(cross-entropy)
#   dice   擲 1 顆 / 2 顆,學蒙地卡羅選了哪個
#   q      10 個動作各自的模擬分數(相對期望值建議的那個),輔助任務,讓共用層學到「動作好多少」
# 驗證集用不同的資料檔(不同局),比較「永遠照期望值建議」這個基準線
# 輸入除了 205 個局面特徵,再加上「期望值策略建議哪個動作」的 one-hot(10 格;擲骰用前 2 格),網路學的是什麼時候該不照建議
import glob, json, sys, time
import numpy as np, torch, torch.nn as nn

EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 12
ROOT = 'tools/nn/data'
meta = json.load(open(f'{ROOT}/part1.json'))
C = {n: i for i, n in enumerate(meta['cols'])}; W = len(meta['cols']); DIM = meta['dim']; NA = 10
F0, M0, Q0 = C['f0'], C['mask0'], C['q0']

def load(files):
    a = np.concatenate([np.fromfile(f, dtype=np.float32).reshape(-1, W) for f in files])
    return a[a[:, 0] < 2]                     # 只要決策(交易 0、擲骰 1),局面紀錄給之後的價值網路
files = sorted(glob.glob(f'{ROOT}/part*.bin'), key=lambda s: int(s.split('part')[1].split('.')[0]))
tr, va = load(files[:-4]), load(files[-4:])
print(f'train {len(tr):,} rows ({int((tr[:,0]==0).sum()):,} trade / {int((tr[:,0]==1).sum()):,} dice), val {len(va):,}')

mu = tr[:, F0:F0 + DIM].mean(0); sd = tr[:, F0:F0 + DIM].std(0) + 1e-3
dev = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
def tens(a):
    bo = np.zeros((len(a), NA), np.float32); bo[np.arange(len(a)), a[:, C['base']].astype(int)] = 1
    x = torch.tensor(np.concatenate([(a[:, F0:F0 + DIM] - mu) / sd, bo], 1))
    mask = torch.tensor(a[:, M0:M0 + NA]); kind = torch.tensor(a[:, 0]).long()
    y = torch.tensor(a[:, C['chosen']]).long(); base = torch.tensor(a[:, C['base']]).long()
    q = torch.tensor(a[:, Q0:Q0 + NA]); qb = q.gather(1, base.clamp(min=0)[:, None]); qrel = (q - qb) * mask   # 相對期望值建議的分數
    return [t.to(dev) for t in (x, mask, kind, y, base, qrel)]
TR, VA = tens(tr), tens(va)

class Net(nn.Module):
    def __init__(s):
        super().__init__()
        s.body = nn.Sequential(nn.Linear(DIM + NA, 256), nn.ReLU(), nn.Linear(256, 128), nn.ReLU())
        s.trade, s.dice, s.q = nn.Linear(128, NA), nn.Linear(128, 2), nn.Linear(128, NA)
    def forward(s, x):
        h = s.body(x); return s.trade(h), s.dice(h), s.q(h)
net = Net().to(dev)
opt = torch.optim.AdamW(net.parameters(), lr=1e-3, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)

def losses(T, idx):
    x, mask, kind, y, base, qrel = (t[idx] for t in T)
    lt, ld, lq = net(x)
    isT, isD = kind == 0, kind == 1
    lt = lt.masked_fill(mask == 0, -1e9); ld = ld.masked_fill(mask[:, :2] == 0, -1e9)
    ce = nn.functional.cross_entropy
    l1 = ce(lt[isT], y[isT]) if isT.any() else 0
    l2 = ce(ld[isD], y[isD]) if isD.any() else 0
    l3 = (((lq - qrel) * mask) ** 2)[isT].sum(1).mean() * 10 if isT.any() else 0
    return l1 + 0.5 * l2 + l3, lt, ld

@torch.no_grad()
def evaluate(T):
    net.eval(); n = len(T[0]); out = {'tN': 0, 'tOK': 0, 'tBase': 0, 'devN': 0, 'devOK': 0, 'dN': 0, 'dOK': 0, 'dBase': 0}
    for i in range(0, n, 65536):
        idx = torch.arange(i, min(n, i + 65536), device=dev)
        _, lt, ld = losses(T, idx); x, mask, kind, y, base, _ = (t[idx] for t in T)
        isT, isD = kind == 0, kind == 1
        pt, pd = lt.argmax(1), ld.argmax(1)
        out['tN'] += int(isT.sum()); out['tOK'] += int((pt == y)[isT].sum()); out['tBase'] += int((base == y)[isT].sum())
        dv = isT & (base != y); out['devN'] += int(dv.sum()); out['devOK'] += int((pt == y)[dv].sum())
        out['dN'] += int(isD.sum()); out['dOK'] += int((pd == y)[isD].sum()); out['dBase'] += int((base == y)[isD].sum())
    net.train(); return out

B = 4096; n = len(TR[0]); t0 = time.time()
for ep in range(EPOCHS):
    perm = torch.randperm(n, device=dev); tot = 0
    for i in range(0, n, B):
        loss, _, _ = losses(TR, perm[i:i + B]); opt.zero_grad(); loss.backward(); opt.step(); tot += float(loss) * min(B, n - i)
    sched.step(); e = evaluate(VA)
    print(f'epoch {ep + 1:2d}  loss {tot / n:.4f}  val 交易 {e["tOK"] / e["tN"]:.1%}(基準 {e["tBase"] / e["tN"]:.1%},'
          f'蒙地卡羅不照期望值的 {e["devN"]:,} 筆猜對 {e["devOK"] / max(1, e["devN"]):.1%})  擲骰 {e["dOK"] / e["dN"]:.1%}(基準 {e["dBase"] / e["dN"]:.1%})  {time.time() - t0:.0f}s')

# 匯出:把標準化併進第一層,遊戲裡直接吃原始特徵
sd_t, mu_t = torch.tensor(sd), torch.tensor(mu)
L1 = net.body[0]; Wf = L1.weight.detach().cpu()[:, :DIM] / sd_t; b1 = L1.bias.detach().cpu() - (Wf * mu_t).sum(1)
W1 = torch.cat([Wf, L1.weight.detach().cpu()[:, DIM:]], 1)   # 後 10 欄是期望值建議的 one-hot,不標準化
L2 = net.body[2]
r = lambda t: [round(float(v), 5) for v in t.reshape(-1)]
pack = lambda w, b: {'in': w.shape[1], 'out': w.shape[0], 'w': r(w), 'b': r(b)}
model = {'kind': 'policy', 'dim': DIM, 'baseOneHot': NA, 'actions': meta['actions'], 'trained': time.strftime('%Y-%m-%d'),
         'layers': [pack(W1, b1), pack(L2.weight.detach().cpu(), L2.bias.detach().cpu())],
         'trade': pack(net.trade.weight.detach().cpu(), net.trade.bias.detach().cpu()),
         'dice': pack(net.dice.weight.detach().cpu(), net.dice.bias.detach().cpu()),
         'val': evaluate(VA)}
json.dump(model, open('tools/nn/models/nn-policy.json', 'w'), separators=(',', ':'))
print('saved tools/nn/models/nn-policy.json', sum(p.numel() for p in net.parameters()), 'params')
