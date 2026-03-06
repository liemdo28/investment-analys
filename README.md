# Neon Financial Analyzer

Project chinh hien tai: `E:\Project\Personal\Dau Tu`

Ung dung web phan tich dau tu linh hoat:
- Gia hien tai + historical (Yahoo, Alpha Vantage fallback, TwelveData fallback)
- Chi bao ky thuat: SMA/EMA/RSI/MACD/Bollinger/ATR/Momentum
- Du bao theo moc linh hoat (`5d,1w,1m`...)
- Multi-source score: technical + projection + news + fundamentals + options + macro + on-chain
- Bo sung thi truong noi dia VN: gia vang SJC + ty gia USD (SJC/VCB)
- Dashboard neon den/trang, mapping mau xu huong theo yeu cau

## 1) Nhap API vao file nao?
Ban nhap tat ca API keys vao file:
- `E:\Project\Personal\Dau Tu\.dev.vars`

Cach tao nhanh:
```bash
cd /d E:\Project\Personal\Dau Tu
copy .dev.vars.example .dev.vars
```

Sau do mo file `.dev.vars` va dien key.

Mau day du:
```env
SERPAPI_API_KEY=
ALPHA_VANTAGE_API_KEY=
FINNHUB_API_KEY=
POLYGON_API_KEY=
TWELVEDATA_API_KEY=
FRED_API_KEY=
NEWSAPI_API_KEY=
SJC_PRICE_API_URL=
VCB_EXRATE_XML_URL=
```

## 2) API nao dung cho phan nao?
- `SERPAPI_API_KEY`: tin tuc/chinh tri/xu huong (Google News)
- `NEWSAPI_API_KEY`: news fallback
- `ALPHA_VANTAGE_API_KEY`: du lieu gia fallback khi Yahoo loi
- `TWELVEDATA_API_KEY`: du lieu gia/fundamental fallback
- `FINNHUB_API_KEY`: profile + fundamental metrics
- `POLYGON_API_KEY`: options flow (put/call)
- `FRED_API_KEY`: macro regime (lai suat, that nghiep, yield spread, vix)
- `SJC_PRICE_API_URL` (optional): endpoint SJC gia vang/ty gia (neu de trong se dung default)
- `VCB_EXRATE_XML_URL` (optional): endpoint XML Vietcombank (neu de trong se dung default)

## 3) Chay local
```bash
npm install
npm run dev
```

Mo: `http://127.0.0.1:8788`

## 4) Deploy Cloudflare Pages
Khi deploy, nhap cung cac keys o:
- Cloudflare Dashboard -> Pages -> Project -> Settings -> Environment variables

Sau khi deploy xong, ban nhan 1 URL public dang:
- `https://<project-name>.pages.dev`

URL nay mo duoc tren moi browser (desktop/mobile), chi can co internet.

## 5) API endpoint
### `GET /api/health`
Health check.

### `POST /api/run`
Body mau:
```json
{
  "symbol": "VNM",
  "market": "VN",
  "horizons": "5d,1w,1m",
  "lookback_days": 365,
  "include_news": true
}
```

## 6) Mapping mau xu huong
- `strong-up` (>= +7%): tim
- `strong-down` (<= -7%): xanh ngoc
- `mild-down` (0 -> -7%): do
- `mild-up` (0 -> +7%): xanh la
- `flat`: vang

## 7) Luu y
- Du bao la thong ke/ky thuat, khong phai cam ket loi nhuan.
- Cang nhieu API premium thi multi-source score cang day du va co confidence tot hon.
