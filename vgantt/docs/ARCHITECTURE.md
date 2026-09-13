# Mimari

Vgantt Suite - `suite.vgantt.com`

## Genel bakış

```
┌─────────────┐   ┌──────────────┐   ┌────────────────────────────┐
│ React (web) │   │  Electron    │   │  VganttAdmin paneli        │
│  tenant UI  │   │  masaüstü    │   │  (aynı React uygulaması)   │
└──────┬──────┘   └───────┬──────┘   └─────────────┬──────────────┘
       │                  │ IPC                     │
       │                  ▼                         │
       │        C:/Rsdw/vault.xlsx                  │
       │        (sunucuya gitmez)                   │
       │                                            │
       └──────────────── HTTPS ─────────────────────┘
                            │
                  suite.vgantt.com  (nginx)
                            │
                   ┌────────▼─────────┐
                   │  NestJS API      │
                   │  guard zinciri   │
                   └────┬────────┬────┘
             tenant pool│        │platform pool
            (vgantt_api)│        │(vgantt_platform_api, BYPASSRLS)
                   ┌────▼────────▼────┐
                   │   PostgreSQL 16  │
                   │  RLS + modül     │
                   │  kapısı          │
                   └──────────────────┘
```

## Tenant izolasyonu

Model: **tek veritabanı, tek şema, `tenant_id` + Row Level Security**.

Seçim gerekçesi: şema-başına-tenant veya veritabanı-başına-tenant modelleri
göç yönetimini tenant sayısıyla çarpar; 30 modüllük bir üründe her göç 500 kez
çalıştırılamaz. RLS ile izolasyon tek yerde tanımlanır ve veritabanı uygular.

İzolasyon dört katmanda birden durur:

| Katman | Ne yapar | Başarısız olursa |
|---|---|---|
| **Bağlantı rolü** | Tenant havuzu `vgantt_api` rolüyle bağlanır; bu rolde `BYPASSRLS` yoktur | Kod hatası çapraz tenant okumaya dönüşemez |
| **RLS politikası** | `tenant_id = app.current_tenant_id()` | Context yoksa `NULL` → 0 satır (fail-closed) |
| **Trigger** | `INSERT`/`UPDATE` sırasında `tenant_id` damgalar, farklıysa reddeder | Yükten gelen `tenant_id` sahtelenemez |
| **Uygulama guard'ı** | JWT → oturum → context | Anlaşılır hata mesajı üretir |

Context her istekte, işlem (transaction) içinde bağlanır:

```ts
await this.db.withTenant(async (db) => {
  // BEGIN; SELECT app.set_tenant_context($tenant, $user);
  return db.query('SELECT * FROM app.licenses');   // WHERE tenant_id YOK
  // COMMIT  -> SET LOCAL context işlemle birlikte ölür
});
```

`SET LOCAL` semantiği kritik: havuzdan gelen bir bağlantı bir sonraki isteğe
önceki tenant'ın bağlamıyla geçemez. `db/tests/isolation_test.sql` bunu
doğrudan test eder.

## İki bağlantı havuzu

```
vgantt_api            NOLOGIN yok, BYPASSRLS YOK    → tenant rotaları
vgantt_platform_api   BYPASSRLS VAR                 → yalnızca /api/admin/*
vgantt_migrator       NOLOGIN, BYPASSRLS, her şeyin sahibi → göçler + SECURITY DEFINER
```

Platform yetkisi bir oturum değişkeniyle değil, **ayrı bir veritabanı rolüyle**
verilir. Tenant tarafındaki bir SQL enjeksiyonu `SET vgantt.is_platform_admin=on`
diyerek yetki yükseltemez, çünkü o rolde baypas mekanizması yoktur.

## Modül lisanslama

`platform.tenant_modules` tablosundaki tek bir `is_enabled` alanı üç şeyi aynı
anda yapar:

1. **Menü** - `GET /auth/me` modülü listelemez, sidebar çizmez
2. **API** - `@RequiresModule('finance')` guard'ı **402 MODULE_NOT_LICENSED** döner
3. **Veri** - RLS politikası `app.tenant_has_module(tenant_id, 'finance')`
   çağırır; satırlar görünmez olur

Veri **silinmez**. Modül yeniden açıldığında her şey geri gelir.

402 seçimi bilinçlidir: 403 "yetkiniz yok" demektir ve kullanıcı yöneticisine
gider; 402 "şirketiniz bu modülü almamış" demektir ve satın alma konuşmasıdır.
Arayüz iki durumu farklı anlatır.

## Guard zinciri

`app.module.ts` içinde global sırayla:

```
1. JwtAuthGuard        kimsin? tenant/admin bağlamını doldurur
2. ModuleLicenseGuard  bu modül şirketine lisanslı mı?
3. PermissionsGuard    rolün bu işleme izin veriyor mu?
```

Ardından PostgreSQL aynı tenant kontrolünü bağımsız olarak tekrar yapar.

## İzinler ve modül bağı

`app.v_user_permissions` view'ı, tenant'ın lisanslamadığı bir modüle ait izinleri
sonuçtan **düşürür**:

```sql
WHERE p.module_key IS NULL OR app.tenant_has_module(u.tenant_id, p.module_key)
```

Yani bir kullanıcının rolü `finance.invoice.write` verse bile, finans modülü
kapatıldığı anda o izin kaybolur. Ayrı bir temizlik işi gerekmez.

## Uyarı motoru

Motor lisans, abonelik veya faturayı **bilmez**. `platform.alert_sources`
tablosunu gezer ve her kaynağın kaydettiği üretici fonksiyonu çağırır.
Ayrıntı: `docs/ALERTS.md`.

## Denetim izi

`audit.activity_log` yalnızca eklenebilir - `UPDATE`/`DELETE` bir trigger ile
engellenir ve API rolüne bu haklar hiç verilmez.

## Veri görselleştirme

Finans panosundaki grafikler doğrulanmış bir paletle çizilir:

- **Aylık nakit akışı** - 3 kategorik seri (mavi/turuncu/su yeşili), tek eksen.
  Üç ölçü de TRY olduğundan ikinci eksene gerek yoktur; çift eksenli grafik
  olmayan bir korelasyon uydurur.
- **Alacak yaşlandırma** - sıralı bir ölçek olduğu için tek renkli 5 adımlı
  rampa (açık = taze, koyu = uzun gecikmiş), kategorik renkler değil.
- Her grafiğin bir **tablo görünümü ikizi** vardır; renk tek başına hiçbir
  değeri taşımaz.

Paletler renk körlüğü ayrımı, açıklık bandı ve kontrast açısından hem açık hem
koyu temada doğrulandı (`apps/web/src/styles/app.css` içindeki yorumlara bakın).

## Alan adı ve kiracı ayrımı

Tek alan adı: `suite.vgantt.com`. Arayüz kökten, API `/api` altından sunulur -
aynı origin, dolayısıyla tarayıcı çapraz-origin istek yapmaz.

Kiracı, alan adından değil **oturumdan** belirlenir: giriş sonrası JWT içindeki
`tid` ve ondan türetilen veritabanı bağlamı. Aynı e-posta birden fazla şirkette
kayıtlıysa giriş ekranı şirket kodunu (`slug`) sorar.

İleride kiracı başına alt alan adı (`acme.vgantt.com`) istenirse altyapı hazır:
`platform.tenants.slug` zaten benzersiz ve URL-güvenli biçimde kısıtlı. Tek
gereken, alt alan adından slug'ı okuyup giriş isteğine eklemek ve joker
sertifika (`*.vgantt.com`) kullanmak olur. Bugünkü kurulum bunu gerektirmiyor.

## Dizin yapısı

```
vgantt/
  db/
    migrations/     0001-0010 + her modül kendi dosyası
    seeds/          referans veri + demo veri
    tests/          izolasyon, guard ve uyarı testleri (psql)
    migrate.sh
  apps/
    api/            NestJS
      src/common/   config, database, context, auth, rbac, licensing, alerts, audit, http
      src/modules/  platform-admin, licenses (A), finance (B), vault (C sınırı)
    web/            React + Vite
      src/lib/      api istemcisi, oturum deposu
      src/modules/  frontend modül kaydı
      src/features/ auth, dashboard, licenses, finance, vault, admin
      src/components/charts/
    desktop/        Electron kabuğu (main + preload)
  packages/
    vault-core/     bağımlılıksız yerel kasa (xlsx + kripto + adaptörler)
  docs/
```
