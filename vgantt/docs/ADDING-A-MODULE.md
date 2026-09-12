# Yeni Modül Ekleme Rehberi

Bu proje, yeni modüllerle büyütülmek üzere tasarlandı. Bir modül eklemek
**çekirdek kodu değiştirmeyi gerektirmez**: modül kendi göçünü (migration),
kendi izinlerini, kendi uyarı üreticisini ve kendi arayüz kaydını getirir;
çekirdek bunları kayıt tablolarından okur.

Aşağıdaki adımları sırayla izleyin. Örnek olarak **"Araç Filo Takibi"**
(`fleet`) modülünü ekliyoruz.

---

## Adım 0 - Modülün sınırlarını belirleyin

Üç soruya yanıt verin; şema kararlarının tamamı bunlardan çıkar.

| Soru | `fleet` için yanıt | Etkisi |
|---|---|---|
| Tenant verisi tutuyor mu? | Evet | `app` şemasında tablolar, RLS + modül kapısı |
| Süresi dolan bir şeyi var mı? | Evet (muayene, sigorta) | `platform.alert_sources`'a kayıt |
| Sunucuda veri tutması yasak mı? | Hayır | `stores_server_data = true` |

Üçüncü sorunun yanıtı "evet" ise (şifre kasası gibi) `docs/SECURITY-VAULT.md`
dosyasını okuyun: o durumda sunucu tarafında **tablo açılmaz**.

---

## Adım 1 - Göç dosyası (kendi kendini kaydeden modül)

`db/migrations/0011_module_fleet.sql` oluşturun. Bir modül göçü her zaman aynı
beş bölümden oluşur - `0006_module_licenses.sql` dosyasını şablon olarak
kopyalayın.

```sql
-- 1 --------------------------------------------------------------- katalog
INSERT INTO platform.modules (key, name, description, category, icon, sort_order)
VALUES ('fleet', 'Araç Filo Takibi',
        'Araç, muayene, sigorta ve bakım takibi.', 'operations', 'truck', 40)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name;

-- 2 ------------------------------------------------------------- izinler
INSERT INTO app.permissions (key, module_key, description) VALUES
    ('fleet.read',   'fleet', 'Araç kayıtlarını görüntüleme'),
    ('fleet.write',  'fleet', 'Araç kaydı ekleme ve güncelleme'),
    ('fleet.delete', 'fleet', 'Araç kaydı silme')
ON CONFLICT (key) DO NOTHING;

-- 3 ------------------------------------------------------------- tablolar
CREATE TABLE app.vehicles (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    plate          text NOT NULL,
    inspection_due date NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vehicles_plate_unique UNIQUE (tenant_id, plate)
);

-- Tek satır: RLS + modül kapısı + tenant_id damgası + updated_at + grant'lar.
SELECT app.apply_tenant_rls('app.vehicles', 'fleet');

-- 4 --------------------------------------------------------------- view
CREATE VIEW app.v_vehicle_expiry WITH (security_invoker = true) AS
SELECT v.*, (v.inspection_due - current_date) AS days_remaining
FROM app.vehicles v;

GRANT SELECT ON app.v_vehicle_expiry TO vgantt_api, vgantt_platform_api;

-- 5 ------------------------------------------------------- uyarı kaydı
CREATE OR REPLACE FUNCTION app.generate_fleet_alerts(p_as_of date DEFAULT current_date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, platform AS $$
DECLARE r record; v_days integer; v_count integer := 0;
BEGIN
    FOR r IN
        SELECT v.id, v.tenant_id, v.plate, v.inspection_due
        FROM app.vehicles v
        WHERE v.inspection_due BETWEEN p_as_of - 7 AND p_as_of + 400
          AND app.tenant_has_module(v.tenant_id, 'fleet')
    LOOP
        v_days := r.inspection_due - p_as_of;
        CONTINUE WHEN NOT (v_days = ANY (platform.thresholds_for(r.tenant_id, 'vehicle_inspection'))
                           OR v_days <= 0);

        IF app.emit_notification(
            r.tenant_id, 'fleet.inspection', 'fleet',
            format('%s muayenesine %s gün kaldı', r.plate, v_days),
            NULL, 'vehicle', r.id::text, v_days, r.inspection_due, '/fleet')
        THEN v_count := v_count + 1; END IF;
    END LOOP;
    RETURN v_count;
END $$;

INSERT INTO platform.alert_sources
    (source_type, module_key, audience, generator, default_thresholds, description)
VALUES ('vehicle_inspection', 'fleet', 'tenant',
        'app.generate_fleet_alerts(date)', ARRAY[30, 15, 7, 3], 'Araç muayene takibi')
ON CONFLICT (source_type) DO UPDATE SET generator = EXCLUDED.generator;

INSERT INTO platform.schema_migrations(version) VALUES ('0011_module_fleet')
ON CONFLICT DO NOTHING;
```

**Neden bu kadar kısa:** `app.apply_tenant_rls()` izolasyonu, `alert_sources`
kaydı ise 30/15/7/3 uyarı merdivenini devralmanızı sağlar. Uyarı motoruna
dokunmanız gerekmez; motor kayıt tablosunu gezip sizin fonksiyonunuzu çağırır.

> **Dikkat:** `tenant_id` kolonu olmayan bir tablo `apply_tenant_rls()`
> çağrısında hata verir. Bu kasıtlıdır: izolasyon dışında kalan bir tenant
> tablosu sessizce oluşmaz.

Göçü uygulayın ve izolasyon testlerini çalıştırın:

```bash
db/migrate.sh --reset --demo
db/tests/run.sh
```

---

## Adım 2 - Backend modülü

`apps/api/src/modules/fleet/` altında dört dosya:

```
fleet.dto.ts         class-validator ile giriş doğrulama
fleet.service.ts     TenantDb.withTenant() içinde sorgular
fleet.controller.ts  @RequiresModule('fleet') + @RequirePermissions(...)
fleet.module.ts      NestJS modülü
```

Controller'ın iki dekoratörü zorunludur:

```ts
@Controller('fleet')
@RequireAudience('tenant')
@RequiresModule('fleet')          // modül kapalıysa 402 döner
export class FleetController {
  @Get()
  @RequirePermissions('fleet.read')
  list() { ... }
}
```

Servis katmanında **tek kural**: her sorgu `TenantDb.withTenant()` içinde
çalışır ve `tenant_id`'yi WHERE koşuluna yazmaz - onu PostgreSQL uygular.

```ts
return this.db.withTenant(async (db) =>
  db.query('SELECT * FROM app.v_vehicle_expiry ORDER BY inspection_due'),
);
```

`INSERT` sırasında `tenant_id` göndermeyin; trigger oturumdan damgalar.

---

## Adım 3 - Modülü kaydedin

`apps/api/src/common/licensing/module-registry.ts`:

```ts
export const MODULE_KEYS = ['licenses', 'finance', 'vault', 'fleet'] as const;

fleet: {
  key: 'fleet',
  name: 'Araç Filo Takibi',
  basePath: 'fleet',
  permissions: ['fleet.read', 'fleet.write', 'fleet.delete'],
  storesServerData: true,
  requiresDesktop: false,
},
```

`apps/api/src/app.module.ts` içine `FleetModule`'ü ekleyin. Guard zincirine
dokunmayın; global olarak zaten çalışıyor.

---

## Adım 4 - Frontend modülü

`apps/web/src/features/fleet/FleetPage.tsx` yazın, sonra
`apps/web/src/modules/module-registry.ts` dizisine ekleyin:

```ts
{
  key: 'fleet',
  label: 'Filo Takibi',
  icon: 'truck',
  licenseKey: 'fleet',          // platform.modules.key ile aynı
  permission: 'fleet.read',
  routes: [{ path: '/fleet', label: 'Filo Takibi',
             component: () => import('../features/fleet/FleetPage') }],
}
```

Menüyü ayrıca düzenlemeniz gerekmez: `AppShell` bu listeyi oturumdaki
`enabledModules` ve `permissions` ile süzerek çizer. `App.tsx` içinde rotayı
`<ModuleRoute moduleKey="fleet">` ile sarın.

---

## Adım 5 - Plan paketlerine ekleyin

```sql
INSERT INTO platform.plan_modules (plan_id, module_key)
SELECT id, 'fleet' FROM platform.plans WHERE code IN ('professional', 'enterprise');
```

Bu adımdan sonra VganttAdmin panelindeki **Modül Lisansları** ızgarasında yeni
sütun kendiliğinden belirir; ayrıca arayüz kodu yazmanız gerekmez.

---

## Adım 6 - Doğrulama listesi

Modül tamamlanmadan önce şunların hepsi geçmelidir:

- [ ] `db/tests/run.sh` yeşil (izolasyon + guard + uyarı testleri)
- [ ] Yeni tablolar `app.apply_tenant_rls(..., 'fleet')` ile bağlandı
- [ ] `platform.check_no_secret_columns()` boş sonuç döndürüyor
- [ ] Modül kapalıyken `GET /api/fleet` **402 MODULE_NOT_LICENSED** dönüyor
- [ ] Modül kapalıyken menüde görünmüyor
- [ ] Modül kapalı tenant için `SELECT * FROM app.vehicles` **0 satır** döndürüyor
- [ ] Yetkisiz kullanıcı **403** alıyor
- [ ] Uyarı motoru 30/15/7/3 günlerinde tam olarak birer bildirim üretiyor
- [ ] Modülün `SECURITY DEFINER` fonksiyonları tenant rolüne kapalı
      (`0010_grants.sql` varsayılanı bunu otomatik sağlar - `GRANT EXECUTE ...
      TO PUBLIC` **yazmayın**)
- [ ] `npm run typecheck` temiz

Son üç maddeyi hızlıca doğrulamak için:

```sql
-- modül kapalıyken satır görünmemeli
SELECT app.set_tenant_context('<tenant-uuid>');
SELECT count(*) FROM app.vehicles;        -- 0 bekleniyor

-- merdiven denemesi
SELECT app.generate_fleet_alerts(current_date + 0);
SELECT threshold_days FROM app.notifications
 WHERE source_type = 'vehicle' ORDER BY threshold_days DESC;
```

---

## Sık yapılan hatalar

| Hata | Sonuç | Doğrusu |
|---|---|---|
| Tabloyu `apply_tenant_rls` olmadan oluşturmak | Tenant izolasyonu yok | Her tenant tablosu için çağırın |
| Serviste `WHERE tenant_id = $1` yazmak | Yanlış güven duygusu; RLS zaten uyguluyor | Koşulu yazmayın, `withTenant()` kullanın |
| `INSERT` içinde `tenant_id` göndermek | Çapraz tenant yazma denemesi olarak reddedilir | Alanı hiç göndermeyin |
| Uyarı üreticisini motora elle bağlamak | Motor zaten kayıt tablosunu geziyor | `alert_sources`'a satır ekleyin |
| `platform` havuzunu tenant rotasında kullanmak | RLS baypas edilir | Tenant rotalarında **yalnızca** `TenantDb` |
| Şifre/API anahtarı kolonu eklemek | Göç, event trigger ile reddedilir | Yerel kasayı kullanın (`docs/SECURITY-VAULT.md`) |
| `SECURITY DEFINER` fonksiyona `GRANT ... TO PUBLIC` vermek | Kiracılar arası yetki yükseltme | Varsayılan kilitli; yalnızca gerekiyorsa `TO vgantt_api` |
| Toplu (tüm kiracılar) üreticiyi tenant rotasından çağırmak | Başka kiracıların verisine dokunur | Bağlamdan tenant alan `_my_` sarmalayıcı yazın |
