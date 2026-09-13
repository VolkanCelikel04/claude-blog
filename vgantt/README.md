# Vgantt Suite

Modüler, çok kiracılı (multi-tenant) SaaS platformu. PostgreSQL 16 + NestJS +
React + Electron.

**Üretim:** https://suite.vgantt.com  (arayüz `/`, API `/api`)

## Ne var

| Alan | Durum |
|---|---|
| Çok kiracılı izolasyon | PostgreSQL Row Level Security, ayrı bağlantı rolleri, 29 test |
| RBAC | Sistem rolleri + tenant'a özel roller, modüle bağlı izinler |
| VganttAdmin paneli | Tenant yönetimi, abonelik/ödeme takibi, tek tık modül lisanslama |
| Uyarı motoru | 30/15/7/3 gün merdiveni, eklenti mimarisi, idempotent |
| **Modül A** | Lisans, domain, SSL ve abonelik süre takibi |
| **Modül B** | Düzenli giderler, müşteri alacakları, tahsilat, grafikler |
| **Modül C** | Yerel şifre kasası - `C:/Rsdw/vault.xlsx`, sunucuya hiçbir veri gitmez |

## Hızlı başlangıç

```bash
# 1. Veritabanı (mevcut PostgreSQL sunucunuzda)
cd vgantt
db/migrate.sh --reset --demo

# 2. İzolasyon testleri - buradan geçmeden devam etmeyin
db/tests/run.sh

# 3. Bağımlılıklar
npm install

# 4. API
cp apps/api/.env.example apps/api/.env      # JWT_SECRET değerini değiştirin
npm run dev:api                              # http://localhost:3000/api/docs

# 5. Arayüz
npm run dev:web                              # http://localhost:5173

# 6. Masaüstü kabuğu (şifre kasası için gerekir)
npm run dev:desktop
```

Docker ile geliştirme: `docker compose up postgres` sonra `db/migrate.sh --demo`.

### Demo hesaplar

| Rol | E-posta | Şifre |
|---|---|---|
| VganttAdmin | `admin@vgantt.local` | `12345` |
| Şirket yöneticisi (tüm modüller) | `admin@acme.example` | `Vgantt2026!` |
| Finans sorumlusu | `finans@acme.example` | `Vgantt2026!` |
| Kasa modülü kapalı şirket | `admin@beta.example` | `Vgantt2026!` |
| Yalnızca lisans modülü | `admin@gamma.example` | `Vgantt2026!` |

Demo veri, üç şirketi bilerek farklı uyarı bantlarına yerleştirir: Acme 7 gün,
Beta 30 gün, Gamma 3 gün kala.

## Testler

```bash
db/tests/run.sh          # veritabanı izolasyonu, kasa guard'ı, uyarı merdiveni
npm run test:vault       # yerel kasa: xlsx, şifreleme, ağ yasağı (13 test)
npm run typecheck        # tüm çalışma alanları
```

## Dokümantasyon

| Belge | İçerik |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Katmanlar, izolasyon modeli, iki havuz, guard zinciri |
| [docs/DATABASE.md](docs/DATABASE.md) | Şema, göç sırası, RLS anatomisi, test kapsamı |
| [docs/SECURITY-VAULT.md](docs/SECURITY-VAULT.md) | **Modül C teknik çözümü** - `C:/Rsdw`, şifreleme, sınır |
| [docs/ALERTS.md](docs/ALERTS.md) | 30/15/7/3 uyarı motoru, eşik politikaları |
| [docs/ADDING-A-MODULE.md](docs/ADDING-A-MODULE.md) | **Yeni modül ekleme rehberi** - adım adım |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | **Sunucu kurulumu** - API + PostgreSQL aynı makinede, systemd + nginx |

## Sunucuya kurulum

API'yi PostgreSQL ile aynı sunucuda çalıştırmak için:

```bash
git clone <repo> && cd vgantt
sudo ./deploy/install.sh              # ayar dosyasini olusturur
sudo nano /etc/vgantt/api.env         # sirlari doldurun
sudo ./deploy/install.sh --with-db --with-web
```

Ayrıntılar: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Üretim notları

- `JWT_SECRET` en az 32 karakter olmalı; üretimde uygulama açılışta reddeder.
- `vgantt_api` ve `vgantt_platform_api` rollerinin şifrelerini
  `VGANTT_DB_APP_PASSWORD` / `VGANTT_DB_PLATFORM_PASSWORD` ile verin.
- `db/migrate.sh` süper kullanıcı bağlantısı ister (rol ve event trigger kurar).
- İzleme için `GET /api/health/vault-policy` uç noktası, kasa kuralının canlı
  sistemde hâlâ geçerli olduğunu doğrular.
