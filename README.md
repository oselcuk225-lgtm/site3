# Velocity Key Sitesi — Vercel (GitHub ile deploy)

## Ne bu?
Statik panel + `/api` serverless fonksiyon. Veri Upstash KV'da; KV yoksa geçici bellek moduyla **yine de çalışır** (veri kalıcı olmaz, uyarı gösterir).

## Deploy — TEK KOŞUL
Depo kökünde şu 2 şey durmalı (başka hiçbir şey gerekmez):

```text
<repo root>/
  index.html      <- panel
  api/
    index.js      <- fonksiyon (bu dosya için /api route'u otomatik açılır)
```

1. Bu 2 öğeyi reponun **kök dizinine** koy ve `git push` et (bağlı dal: `Nubıx-Ai`).
   - GitHub web'de de yapabilirsin: **Add file → Create new file**, dosya adına `api/index.js` yaz (klasör otomatik oluşur) → içerik kopyala → Commit.
2. **`vercel.json` veya `now.json` varsa SİL** (build hatası verir — eski şema). GitHub web: dosyayı aç → sağ üst **Delete** → Commit.
3. Vercel projesi (cskeysite33) otomatik redeploy olur.
3. Test: panelde **"API'YI TEST ET"** → `✓ API çalışıyor` olmalı.
   - (veya `https://cskeysite33.vercel.app/api?action=ping` → `{"status":"ok",...}`)

## KV (kalıcı veri — opsiyonel ama önerilir)
Vercel → cskeysite33 → **Storage → Create → Upstash (KV) → Connect to project** → redeploy.
Bağlıysa panel testi "KV kalıcı" der; bağlı değilse sarı uyarı gösterir ve veriler geçicidir.

## Loader bağlantısı
Loader'ın kilit ekranında **API sunucu**: `https://cskeysite33.vercel.app/api`
Key: panelde üretilen anahtar ya da test amaçlı **123** (sunucu olmadan da açılır).

## API
- `?action=ping` → yoklama
- `?action=activate&key=X&hwid=SHA256` → aktivasyon + cihaz bağlama
- `?action=check&key=X` → durum sorgu
- `?action=generate&count=N&days=D` → key üret (0 = sınırsız)
- `?action=list` → liste
- `?action=ban&key=X` → ban / kaldır